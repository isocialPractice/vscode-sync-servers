import path from 'node:path';
import {
  createTransport,
  isTransient,
  ROOT,
  siteCloak,
  SyncRecords,
  type RemoteEntry,
  type RemotePath,
  type Server,
  type Site,
  type Transport,
} from '@isocialpractice/cmd-sync-servers';
import * as vscode from 'vscode';
import { CONTEXT, REMOTE_COMMANDS } from '../contributions.ts';
import type { Services } from '../commands/services.ts';
import { errorText } from '../error-text.ts';
import { markFor } from '../marks.ts';
import type { PreviewController } from '../preview/controller.ts';
import type { RemoteNode } from './nodes.ts';

const IDLE_MS = 120_000;

/** One connection to a site's Remote server for browsing, closed after two minutes unused. */
export class RemoteBrowser {
  readonly site: Site;
  readonly server: Server;
  readonly #services: Services;
  #connecting: Promise<Transport> | undefined;
  #idle: NodeJS.Timeout | undefined;

  constructor(services: Services, site: Site, server: Server) {
    this.#services = services;
    this.site = site;
    this.server = server;
  }

  #connection(): Promise<Transport> {
    clearTimeout(this.#idle);
    this.#idle = setTimeout(() => {
      void this.close();
    }, IDLE_MS);
    if (this.#connecting === undefined) {
      const { site, server } = this;
      const transport = createTransport({
        site,
        server,
        host: this.#services.host,
        logger: this.#services.logger,
        pinHostKey: async (info) => {
          const pinned = { algorithm: info.algorithm, sha256: info.sha256, pinnedAt: new Date().toISOString() };
          await this.#services.model.registry().updateServer(site.id, server.id, (draft) => {
            draft.options.hostKey = pinned;
          });
        },
      });
      const connecting = transport.connect().then(() => transport);
      this.#connecting = connecting;
      connecting.catch(() => {
        if (this.#connecting === connecting) {
          this.#connecting = undefined;
        }
      });
    }
    return this.#connecting;
  }

  async #retry<T>(work: (transport: Transport) => Promise<T>): Promise<T> {
    try {
      return await work(await this.#connection());
    } catch (error) {
      if (!isTransient(error)) {
        throw error;
      }
      await this.close();
      return work(await this.#connection());
    }
  }

  /** The entries of one folder. */
  list(dir: RemotePath): Promise<RemoteEntry[]> {
    return this.#retry((transport) => transport.list(dir));
  }

  /** Removes one file. */
  remove(file: RemotePath): Promise<void> {
    return this.#retry((transport) => transport.remove(file));
  }

  /** Closes the connection. */
  async close(): Promise<void> {
    clearTimeout(this.#idle);
    const connecting = this.#connecting;
    this.#connecting = undefined;
    const transport = await connecting?.catch(() => undefined);
    await transport?.close();
  }
}

/** A line in the Remote Files view that is not an entry: a name that cannot be used, or a failure. */
interface MessageNode {
  readonly kind: 'message';
  readonly text: string;
  readonly icon: string;
}

type Node = RemoteNode | MessageNode;

function sizeText(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit] ?? 'TB'}`;
}

/**
 * The Remote Files view: the active site's Remote server, listed one folder
 * at a time as folders are opened, with the same marks as the Explorer.
 */
export class RemoteFilesView implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  readonly #services: Services;
  readonly #changed = new vscode.EventEmitter<Node | undefined>();
  readonly #subscriptions: vscode.Disposable[];
  #browser: RemoteBrowser | undefined;
  #key = '';
  #records: Promise<SyncRecords | undefined> | undefined;

  readonly onDidChangeTreeData = this.#changed.event;

  constructor(services: Services, preview: PreviewController) {
    this.#services = services;
    this.#subscriptions = [
      services.model.onDidChange(() => {
        this.#sync();
      }),
      preview.onDidChange(() => {
        if (preview.running === undefined) {
          this.refresh();
        }
      }),
    ];
    this.#sync();
  }

  #target(): { site: Site; server: Server } | undefined {
    const site = this.#services.model.activeSite;
    const server = site?.servers.find((candidate) => candidate.id === site.remoteServerId);
    return site === undefined || server === undefined ? undefined : { site, server };
  }

  // Starts again when the active site, its Remote server or their settings change.
  #sync(): void {
    const target = this.#target();
    void vscode.commands.executeCommand('setContext', CONTEXT.activeSiteHasRemote, target !== undefined);
    const key = target === undefined ? '' : JSON.stringify([target.site, target.server]);
    if (key === this.#key) {
      return;
    }
    this.#key = key;
    void this.#browser?.close();
    this.#browser = target === undefined ? undefined : new RemoteBrowser(this.#services, target.site, target.server);
    this.#records = undefined;
    this.#changed.fire(undefined);
  }

  /** The browser of the active site's Remote server. */
  get browser(): RemoteBrowser | undefined {
    return this.#browser;
  }

  /** Lists every open folder again. */
  refresh(): void {
    this.#records = undefined;
    this.#changed.fire(undefined);
  }

  async getChildren(node?: Node): Promise<Node[]> {
    const browser = this.#browser;
    if (browser === undefined || node?.kind === 'message' || (node !== undefined && node.type !== 'dir')) {
      return [];
    }
    const { site, server } = browser;
    this.#records ??= this.#services.model.paths === undefined
      ? Promise.resolve(undefined)
      : SyncRecords.load(this.#services.model.paths.stateDir, site.id, server.id, site.sync.maintainInfo).catch(() => undefined);
    let entries: RemoteEntry[];
    try {
      entries = await browser.list((node?.path ?? ROOT) as RemotePath);
    } catch (error) {
      return [{ kind: 'message', text: `Could not list ${node === undefined ? 'the root folder' : node.path}: ${errorText(error)}`, icon: 'error' }];
    }
    const sorted = [...entries].sort((a, b) => Number(b.type === 'dir') - Number(a.type === 'dir') || a.name.localeCompare(b.name, 'en'));
    return sorted.map((entry): Node => {
      if (entry.path === undefined) {
        return { kind: 'message', text: `${entry.name}: ${entry.unsafe ?? 'cannot be used here'}`, icon: 'warning' };
      }
      return {
        kind: 'remote',
        siteId: site.id,
        path: entry.path,
        name: entry.name,
        type: entry.type,
        size: entry.size,
        mtimeMs: entry.mtimeMs,
        local: vscode.Uri.file(path.join(site.localRoot, ...entry.path.split('/'))),
      };
    });
  }

  async getTreeItem(node: Node): Promise<vscode.TreeItem> {
    if (node.kind === 'message') {
      const item = new vscode.TreeItem(node.text);
      item.iconPath = new vscode.ThemeIcon(node.icon);
      item.contextValue = 'message';
      item.tooltip = node.text;
      item.accessibilityInformation = { label: `${node.icon === 'error' ? 'Error' : 'Warning'}: ${node.text}` };
      return item;
    }
    const browser = this.#browser;
    const records = await this.#records;
    const folder = node.type === 'dir';
    const mark =
      browser === undefined
        ? undefined
        : markFor({
            side: 'remote',
            cloaked: siteCloak(browser.site, process.platform, this.#services.model.globalPatterns).isCloaked(node.path, folder),
            conflict: false,
            observed: node.type === 'file' ? { size: node.size, mtimeMs: node.mtimeMs } : undefined,
            record: records?.get(node.path),
            everSynced: (records?.size ?? 0) > 0,
            toleranceMs: browser.site.sync.mtimeToleranceSeconds * 1000,
          });
    const item = new vscode.TreeItem(node.name, folder ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    item.id = `remote:${node.siteId}:${node.path}`;
    item.iconPath = new vscode.ThemeIcon(folder ? 'folder' : node.type === 'file' ? 'file' : 'file-symlink-file');
    const parts = [folder ? '' : sizeText(node.size), mark === undefined ? '' : `${mark.badge} ${mark.word}`].filter((part) => part !== '');
    item.description = parts.join(', ');
    const time = node.mtimeMs === undefined ? 'time unknown' : `modified ${new Date(node.mtimeMs).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
    item.tooltip = [node.path, folder ? 'Folder' : `${String(node.size)} bytes, ${time}`, mark?.tooltip ?? ''].filter((line) => line !== '').join('\n');
    item.contextValue = ['remote', node.type, ...(mark?.word === 'cloaked' ? ['cloaked'] : [])].join(' ');
    item.accessibilityInformation = { label: [node.name, folder ? 'folder' : 'file', folder ? '' : sizeText(node.size), mark?.word ?? ''].filter((part) => part !== '').join(', ') };
    if (node.type === 'file') {
      item.command = { command: REMOTE_COMMANDS[1].id, title: REMOTE_COMMANDS[1].title, arguments: [node] };
    }
    return item;
  }

  dispose(): void {
    for (const subscription of this.#subscriptions) {
      subscription.dispose();
    }
    void this.#browser?.close();
    this.#changed.dispose();
  }
}
