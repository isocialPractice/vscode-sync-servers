import { SyncSession, type Site } from '@isocialpractice/cmd-sync-servers';
import * as vscode from 'vscode';
import type { Services } from './commands/services.ts';
import { errorText } from './error-text.ts';
import { sitePath } from './explorer-marks.ts';
import { holdBack } from './marks.ts';

/** How long after the last save a file is put, so a burst of saves puts it once. */
export const UPLOAD_DELAY_MS = 300;

/**
 * Upload on save: a file saved in a site's local folder is put to each of
 * the site's servers whose Upload on save option is on, the Testing server
 * among them, 300 ms after the last save. Cloaked and held-back files are
 * never put, nothing is put in Restricted Mode or with
 * `syncServers.uploadOnSave.enabled` off, and a file changed on the server
 * too is left for Synchronize to decide.
 */
export class UploadOnSave implements vscode.Disposable {
  readonly #services: Services;
  readonly #timers = new Map<string, NodeJS.Timeout>();
  readonly #queues = new Map<string, Promise<void>>();
  readonly #subscription: vscode.Disposable;
  #pending = 0;

  constructor(services: Services) {
    this.#services = services;
    this.#subscription = vscode.workspace.onDidSaveTextDocument((document) => {
      this.saved(document.uri);
    });
  }

  /** How many uploads are waiting or running, for tests. */
  get pending(): number {
    return this.#pending;
  }

  /** Handles one saved file. */
  saved(uri: vscode.Uri): void {
    const { model, logger } = this.#services;
    if (uri.scheme !== 'file' || !vscode.workspace.getConfiguration('syncServers').get<boolean>('uploadOnSave.enabled', true)) {
      return;
    }
    let site: Site | undefined;
    try {
      site = model.registry().resolve({ path: uri.fsPath });
    } catch {
      return;
    }
    const relative = site === undefined ? undefined : sitePath(site, uri.fsPath);
    const servers = site?.servers.filter((server) => server.options.uploadOnSave) ?? [];
    if (site === undefined || relative === undefined || servers.length === 0) {
      return;
    }
    if (!this.#services.trusted()) {
      logger.info('Not uploaded on save: the workspace is in Restricted Mode', { siteId: site.id, path: relative });
      return;
    }
    const reason = holdBack(site, relative, model.globalPatterns);
    if (reason !== undefined) {
      logger.info(`Not uploaded on save: ${reason}`, { siteId: site.id, path: relative });
      return;
    }
    for (const server of servers) {
      const key = `${site.id}/${server.id}/${relative}`;
      const waiting = this.#timers.get(key);
      if (waiting === undefined) {
        this.#pending += 1;
      }
      clearTimeout(waiting);
      const siteId = site.id;
      this.#timers.set(
        key,
        setTimeout(() => {
          this.#timers.delete(key);
          this.#enqueue(`${siteId}/${server.id}`, () => this.#put(siteId, server.id, relative));
        }, UPLOAD_DELAY_MS),
      );
    }
  }

  // Puts to one server run one after another, so they never share a sync record file at once.
  #enqueue(key: string, work: () => Promise<void>): void {
    const next = (this.#queues.get(key) ?? Promise.resolve()).then(work).finally(() => {
      this.#pending -= 1;
    });
    this.#queues.set(key, next);
  }

  async #put(siteId: string, serverId: string, relative: string): Promise<void> {
    const { model, host, logger, prompter } = this.#services;
    const site = model.site(siteId);
    const server = site?.servers.find((candidate) => candidate.id === serverId);
    if (site === undefined || server === undefined || !server.options.uploadOnSave || !this.#services.trusted()) {
      return;
    }
    let session: SyncSession | undefined;
    try {
      session = await SyncSession.open({ registry: model.registry(), siteId, serverId, host });
      const outcome = await session.put([relative]);
      if (outcome.result === undefined) {
        logger.warn('Not uploaded on save: it needs a decision', { siteId, serverId, path: relative });
        void prompter().inform(`${relative} was not uploaded to ${server.name}: it changed there too, or needs a look first. Synchronize to choose.`);
        return;
      }
      const failed = outcome.result.items.find((item) => item.outcome === 'failed' || item.outcome === 'stale');
      if (failed !== undefined) {
        logger.error('Upload on save failed', { siteId, serverId, path: relative, problem: failed.error?.message });
        void prompter().error(`Could not upload ${relative} to ${server.name}. ${failed.error?.message ?? ''}`.trim(), ['Show Log']).then((choice) => {
          if (choice === 'Show Log') {
            this.#services.showLog();
          }
        });
        return;
      }
      if (outcome.result.done > 0) {
        logger.info('Uploaded on save', { siteId, serverId, path: relative });
        vscode.window.setStatusBarMessage(`$(cloud-upload) Put ${relative} to ${server.name}`, 3000);
      }
    } catch (error) {
      logger.error('Upload on save failed', { siteId, serverId, path: relative, problem: errorText(error) });
      void prompter().error(`Could not upload ${relative} to ${server.name}. ${errorText(error)}`, ['Show Log']).then((choice) => {
        if (choice === 'Show Log') {
          this.#services.showLog();
        }
      });
    } finally {
      await session?.close();
    }
  }

  dispose(): void {
    this.#subscription.dispose();
    for (const timer of this.#timers.values()) {
      clearTimeout(timer);
    }
  }
}
