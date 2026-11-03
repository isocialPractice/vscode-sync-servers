import path from 'node:path';
import { siteCloak, SyncRecords, type Cloak, type Site } from '@isocialpractice/cmd-sync-servers';
import * as vscode from 'vscode';
import { localEntry, markFor, type Mark } from './marks.ts';
import type { PreviewController } from './preview/controller.ts';
import type { SitesModel } from './sites-model.ts';

/** What the marks of the active site are worked out from. */
interface Known {
  readonly site: Site;
  readonly cloak: Cloak;
  readonly records: SyncRecords | undefined;
  readonly toleranceMs: number;
}

/** The site-relative path of a file inside a site's local folder, or `undefined`. */
export function sitePath(site: Site, file: string): string | undefined {
  const relative = path.relative(site.localRoot, file);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return undefined;
  }
  return relative.split(path.sep).join('/');
}

/**
 * The Explorer's marks for the active site: cloaked items dimmed with ⊘,
 * files changed since the last sync with ↑, files that need a decision with
 * ! in the warning colour. They are worked out again after every sync, on
 * save and when the site changes, never on a timer and never from a server.
 */
export class ExplorerMarks implements vscode.FileDecorationProvider, vscode.Disposable {
  readonly #model: SitesModel;
  readonly #preview: PreviewController;
  readonly #changed = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly #subscriptions: vscode.Disposable[];
  #known: Known | undefined;
  #conflicts = new Set<string>();
  #loading: Promise<void> = Promise.resolve();

  readonly onDidChangeFileDecorations = this.#changed.event;

  constructor(model: SitesModel, preview: PreviewController) {
    this.#model = model;
    this.#preview = preview;
    this.#subscriptions = [
      vscode.window.registerFileDecorationProvider(this),
      model.onDidChange(() => {
        void this.refresh();
      }),
      preview.onDidChange(() => {
        if (preview.running === undefined) {
          void this.refresh();
        }
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        this.#changed.fire(document.uri);
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('syncServers.decorations.enabled')) {
          this.#changed.fire(undefined);
        }
      }),
    ];
    void this.refresh();
  }

  /** Reads the active site's records again and redraws every mark. */
  refresh(): Promise<void> {
    this.#loading = this.#load();
    return this.#loading;
  }

  /** Resolves once the last refresh has finished, for tests. */
  get ready(): Promise<void> {
    return this.#loading;
  }

  async #load(): Promise<void> {
    const site = this.#model.activeSite;
    const stateDir = this.#model.paths?.stateDir;
    const remote = site?.servers.find((server) => server.id === site.remoteServerId);
    let records: SyncRecords | undefined;
    if (site !== undefined && remote !== undefined && stateDir !== undefined) {
      records = await SyncRecords.load(stateDir, site.id, remote.id, site.sync.maintainInfo).catch(() => undefined);
    }
    this.#known = site === undefined ? undefined : { site, cloak: siteCloak(site, process.platform, this.#model.globalPatterns), records, toleranceMs: site.sync.mtimeToleranceSeconds * 1000 };
    const pending = this.#preview.pending;
    this.#conflicts = new Set(
      pending !== undefined && pending.site.id === site?.id ? pending.plan.items.filter((item) => item.action === 'resolve').map((item) => item.path) : [],
    );
    this.#changed.fire(undefined);
  }

  /** The mark of a local file or folder of the active site. */
  markOf(uri: vscode.Uri): Mark | undefined {
    const known = this.#known;
    if (known === undefined || uri.scheme !== 'file' || !vscode.workspace.getConfiguration('syncServers').get<boolean>('decorations.enabled', true)) {
      return undefined;
    }
    const relative = sitePath(known.site, uri.fsPath);
    if (relative === undefined) {
      return undefined;
    }
    const info = localEntry(known.site, uri.fsPath);
    if (info === undefined) {
      return undefined;
    }
    return markFor({
      side: 'local',
      cloaked: known.cloak.isCloaked(relative, info.isDirectory()),
      conflict: this.#conflicts.has(relative),
      observed: info.isFile() ? { size: info.size, mtimeMs: info.mtimeMs } : undefined,
      record: known.records?.get(relative),
      everSynced: (known.records?.size ?? 0) > 0,
      toleranceMs: known.toleranceMs,
    });
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const mark = this.markOf(uri);
    if (mark === undefined) {
      return undefined;
    }
    const color =
      mark.tone === 'dim' ? new vscode.ThemeColor('list.deemphasizedForeground') : mark.tone === 'warning' ? new vscode.ThemeColor('list.warningForeground') : undefined;
    const decoration = new vscode.FileDecoration(mark.badge, mark.tooltip, color);
    decoration.propagate = mark.tone === 'warning';
    return decoration;
  }

  dispose(): void {
    for (const subscription of this.#subscriptions) {
      subscription.dispose();
    }
    this.#changed.dispose();
  }
}
