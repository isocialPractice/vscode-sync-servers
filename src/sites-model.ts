import { homedir } from 'node:os';
import path from 'node:path';
import { defaultPaths, isSyncError, SiteRegistry, SyncError, type Logger, type Site, type SyncServersPaths } from '@isocialpractice/cmd-sync-servers';
import * as vscode from 'vscode';
import { errorText } from './error-text.ts';

const ACTIVE_SITE_KEY = 'syncServers.activeSiteId';
const RELOAD_DELAY_MS = 100;

/** Options of {@link SitesModel}. */
export interface SitesModelOptions {
  readonly logger: Logger;
  /** Remembers the site chosen with Switch Site in this workspace. */
  readonly workspaceState: vscode.Memento;
  /**
   * Refuses to open the list unless `SYNC_SERVERS_HOME` or
   * `syncServers.configDir` points somewhere, so a test run never reads or
   * writes the real list of sites.
   */
  readonly requireIsolatedHome: boolean;
}

function problemText(error: unknown): string {
  return errorText(error);
}

/** The `syncServers.configDir` setting with `~` expanded, or the problem with it. */
export function configuredDir(value: string): { dir?: string; problem?: string } {
  const trimmed = value.trim();
  if (trimmed === '') {
    return {};
  }
  const expanded = trimmed === '~' || /^~[\\/]/.test(trimmed) ? path.join(homedir(), trimmed.slice(1)) : trimmed;
  return path.isAbsolute(expanded)
    ? { dir: expanded }
    : { problem: `The setting syncServers.configDir must be a full path, such as ${path.join(homedir(), 'sync-servers')}.` };
}

/**
 * The master list of sites, shared with the command line, and the active
 * site. It reloads when `sites.json` changes on disk, whoever changed it.
 */
export class SitesModel implements vscode.Disposable {
  readonly #options: SitesModelOptions;
  readonly #changed = new vscode.EventEmitter<void>();
  #registry: SiteRegistry | undefined;
  #paths: SyncServersPaths | undefined;
  #problem: string | undefined;
  #invalidFile = false;
  #activeSiteId: string | undefined;
  #watcher: vscode.FileSystemWatcher | undefined;
  #timer: NodeJS.Timeout | undefined;

  /** Fires after the list or the active site changes. */
  readonly onDidChange = this.#changed.event;

  constructor(options: SitesModelOptions) {
    this.#options = options;
  }

  /** The folders in use; `undefined` until the list is opened. */
  get paths(): SyncServersPaths | undefined {
    return this.#paths;
  }

  /** Why the list cannot be read, when it cannot. */
  get problem(): string | undefined {
    return this.#problem;
  }

  /** True when the problem is what `sites.json` holds, so opening it in an editor fixes it. */
  get invalidFile(): boolean {
    return this.#problem !== undefined && this.#invalidFile;
  }

  /** Every site, in the order they were added; none while the list cannot be read. */
  get sites(): Site[] {
    return this.#problem === undefined ? (this.#registry?.list() ?? []) : [];
  }

  /** The cloaking patterns every site uses before its own; none while the list cannot be read. */
  get globalPatterns(): readonly string[] {
    return this.#problem === undefined ? (this.#registry?.globalCloaking.patterns ?? []) : [];
  }

  /** The site with this id, as it is now. */
  site(siteId: string): Site | undefined {
    return this.#problem === undefined ? this.#registry?.get(siteId) : undefined;
  }

  /** The id of the active site. */
  get activeSiteId(): string | undefined {
    return this.#activeSiteId;
  }

  /** The site the status bar shows and commands act on when no row is chosen. */
  get activeSite(): Site | undefined {
    return this.#activeSiteId === undefined ? undefined : this.site(this.#activeSiteId);
  }

  /** The registry, for changes. Fails with the problem when the list cannot be read. */
  registry(): SiteRegistry {
    if (this.#registry === undefined || this.#problem !== undefined) {
      throw this.invalidFile ? new SyncError('E_CONFIG_INVALID', this.#problem ?? '') : new Error(this.#problem ?? 'The list of sites is not open yet.');
    }
    return this.#registry;
  }

  /** Opens the list from the configured folder and starts watching it. */
  async open(): Promise<void> {
    this.#stopWatching();
    const { logger } = this.#options;
    const setting = configuredDir(vscode.workspace.getConfiguration('syncServers').get<string>('configDir', ''));
    this.#registry = undefined;
    this.#invalidFile = false;
    if (setting.problem !== undefined) {
      this.#paths = undefined;
      this.#problem = setting.problem;
    } else if (this.#options.requireIsolatedHome && setting.dir === undefined && (process.env.SYNC_SERVERS_HOME ?? '') === '') {
      this.#paths = undefined;
      this.#problem = 'The list of sites is not opened: the tests run without SYNC_SERVERS_HOME.';
    } else {
      const paths = defaultPaths(setting.dir === undefined ? {} : { configDir: setting.dir });
      this.#paths = paths;
      this.#watch(paths);
      try {
        this.#registry = await SiteRegistry.open({ paths, logger });
        this.#problem = undefined;
        logger.info('Opened the list of sites', { file: paths.sitesFile, sites: this.#registry.list().length });
      } catch (error) {
        this.#problem = problemText(error);
        this.#invalidFile = isSyncError(error, 'E_CONFIG_INVALID');
        logger.error('The list of sites cannot be read', { file: paths.sitesFile, problem: this.#problem });
      }
    }
    this.refresh();
  }

  /** Reads `sites.json` again. */
  async reload(): Promise<void> {
    const registry = this.#registry;
    if (registry === undefined) {
      await this.open();
      return;
    }
    try {
      await registry.reload();
      this.#problem = undefined;
    } catch (error) {
      this.#problem = problemText(error);
      this.#invalidFile = isSyncError(error, 'E_CONFIG_INVALID');
      this.#options.logger.error('The list of sites cannot be read', { file: registry.paths.sitesFile, problem: this.#problem });
    }
    this.refresh();
  }

  /** Works out the active site again and tells the views. */
  refresh(): void {
    this.#activeSiteId = this.#resolveActive();
    this.#changed.fire();
  }

  /** Makes a site active in this workspace and records it as the last one chosen; `undefined` clears it. */
  async setActive(siteId: string | undefined): Promise<void> {
    await this.#options.workspaceState.update(ACTIVE_SITE_KEY, siteId);
    if (siteId !== undefined) {
      await this.recordLastSelected(siteId);
    }
    this.refresh();
  }

  /** Records the site last chosen, which the command line's site list also opens on. */
  async recordLastSelected(siteId: string): Promise<void> {
    if (this.#registry !== undefined && this.#problem === undefined && this.#registry.lastSelectedSiteId !== siteId) {
      await this.#registry.setLastSelected(siteId);
    }
  }

  // The site chosen in this workspace, else the site whose local folder is
  // open, else the site last chosen in either front end.
  #resolveActive(): string | undefined {
    const sites = this.sites;
    const known = (id: string | undefined): id is string => id !== undefined && sites.some((site) => site.id === id);
    const chosen = this.#options.workspaceState.get<string>(ACTIVE_SITE_KEY);
    if (known(chosen)) {
      return chosen;
    }
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const site = folder.uri.scheme === 'file' ? this.#registry?.resolve({ path: folder.uri.fsPath }) : undefined;
      if (site !== undefined && this.#problem === undefined) {
        return site.id;
      }
    }
    const last = this.#registry?.lastSelectedSiteId;
    return known(last) ? last : undefined;
  }

  #watch(paths: SyncServersPaths): void {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(paths.configDir), 'sites.json'));
    const changed = (): void => {
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => {
        void this.reload();
      }, RELOAD_DELAY_MS);
    };
    watcher.onDidCreate(changed);
    watcher.onDidChange(changed);
    watcher.onDidDelete(changed);
    this.#watcher = watcher;
  }

  #stopWatching(): void {
    clearTimeout(this.#timer);
    this.#watcher?.dispose();
    this.#watcher = undefined;
  }

  dispose(): void {
    this.#stopWatching();
    this.#changed.dispose();
  }
}
