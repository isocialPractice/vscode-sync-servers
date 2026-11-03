import {
  DIRECTION_TITLES,
  isSyncError,
  resultLine,
  type Action,
  type Server,
  type Site,
  type SyncPlan,
  type SyncResult,
  type SyncSession,
} from '@isocialpractice/cmd-sync-servers';
import * as vscode from 'vscode';
import type { Services } from '../commands/services.ts';
import { CONTEXT, VIEWS } from '../contributions.ts';

/** A plan waiting in the Sync Preview, with the session that made it. */
export interface Pending {
  readonly session: SyncSession;
  readonly plan: SyncPlan;
  readonly site: Site;
  readonly server: Server;
}

/** A finished run kept in the preview because some files failed. */
export interface Finished {
  readonly result: SyncResult;
  readonly site: Site;
  readonly server: Server;
}

/** How far a run has got. */
export interface Running {
  readonly site: Site;
  readonly completed: number;
  readonly total: number;
}

/** The button that confirms deletes when `syncServers.confirmDeletes` is on. */
export function deleteButton(count: number): string {
  return `Delete ${String(count)} ${count === 1 ? 'File' : 'Files'}`;
}

/** The button that runs a synchronization from an untrusted workspace. */
export const SYNCHRONIZE_ANYWAY = 'Synchronize Anyway';

/**
 * The Sync Preview's state: the plan waiting for the person, or the result of
 * a run that had failures, and the run in progress.
 */
export class PreviewController implements vscode.Disposable {
  readonly #services: Services;
  readonly #changed = new vscode.EventEmitter<void>();
  #pending: Pending | undefined;
  #finished: Finished | undefined;
  #running: Running | undefined;
  #abort: AbortController | undefined;

  /** Fires when the plan, a choice, the run or its result changes. */
  readonly onDidChange = this.#changed.event;

  constructor(services: Services) {
    this.#services = services;
  }

  get pending(): Pending | undefined {
    return this.#pending;
  }

  get finished(): Finished | undefined {
    return this.#finished;
  }

  get running(): Running | undefined {
    return this.#running;
  }

  /** True when rows wait for a decision, or the last run had failures: the status bar warns. */
  get attention(): { readonly site: Site; readonly text: string } | undefined {
    if (this.#pending !== undefined && this.#pending.plan.summary.resolve > 0) {
      const count = this.#pending.plan.summary.resolve;
      return { site: this.#pending.site, text: `${String(count)} need${count === 1 ? 's' : ''} a decision` };
    }
    if (this.#finished !== undefined && this.#finished.result.failed > 0) {
      return { site: this.#finished.site, text: `${String(this.#finished.result.failed)} failed` };
    }
    return undefined;
  }

  #fire(): void {
    void vscode.commands.executeCommand('setContext', CONTEXT.previewActive, this.#pending !== undefined || this.#finished !== undefined);
    void vscode.commands.executeCommand('setContext', CONTEXT.previewPending, this.#pending !== undefined);
    this.#changed.fire();
  }

  /** Shows a plan in the Sync Preview, replacing any other. The preview owns the session from here. */
  async show(pending: Pending): Promise<void> {
    await this.close();
    this.#pending = pending;
    this.#fire();
    await vscode.commands.executeCommand(`${VIEWS.preview}.focus`);
  }

  /** Closes the preview and its session. */
  async close(): Promise<void> {
    const pending = this.#pending;
    this.#pending = undefined;
    this.#finished = undefined;
    await pending?.session.close();
    this.#fire();
  }

  /** The actions a row can take. */
  allowed(id: number): Action[] {
    return this.#pending?.plan.allowedActions(id) ?? [];
  }

  /** Gives rows an action; rows that cannot take it are left as they are. Returns how many changed. */
  setAction(ids: readonly number[], action: Action): number {
    const plan = this.#pending?.plan;
    if (plan === undefined) {
      return 0;
    }
    let changed = 0;
    for (const id of ids) {
      if (plan.allowedActions(id).includes(action)) {
        plan.setAction(id, action);
        changed += 1;
      }
    }
    this.#fire();
    return changed;
  }

  /** Checks or unchecks rows; rows waiting for a decision and rows that cannot move are left as they are. */
  setChecked(ids: readonly number[], checked: boolean): void {
    const plan = this.#pending?.plan;
    if (plan === undefined) {
      return;
    }
    for (const id of ids) {
      const item = plan.item(id);
      if (item !== undefined && item.state !== 'problem' && item.action !== 'resolve') {
        plan.setChecked(id, checked);
      }
    }
    this.#fire();
  }

  /** Checks or unchecks every row that can be. */
  setAllChecked(checked: boolean): void {
    this.setChecked(this.#pending?.plan.items.map((item) => item.id) ?? [], checked);
  }

  /** Stops the run in progress between files. */
  cancelRun(): void {
    this.#abort?.abort();
  }

  /**
   * Runs the checked rows: asks before deletes when `syncServers.confirmDeletes`
   * is on and before writing to a server from an untrusted workspace, asks for
   * the typed count past the mass-delete limit, and reports the result.
   */
  async run(): Promise<SyncResult | undefined> {
    const pending = this.#pending;
    if (pending === undefined || this.#running !== undefined) {
      return undefined;
    }
    const { plan, site, server, session } = pending;
    const prompter = this.#services.prompter();
    const checked = plan.items.filter((item) => item.checked === true && item.state !== 'problem' && item.action !== 'skip');
    if (checked.length === 0) {
      void prompter.inform(plan.summary.resolve > 0 ? 'No file is checked. Choose an action for the files that need a decision.' : 'No file is checked.');
      return undefined;
    }
    const deletes = checked.filter((item) => item.action === 'delete-remote' || item.action === 'delete-local');
    if (deletes.length > 0 && vscode.workspace.getConfiguration('syncServers').get<boolean>('confirmDeletes', true)) {
      const shown = deletes.slice(0, 10).map((item) => `${item.action === 'delete-remote' ? 'On the server' : 'Local'}: ${item.path}`);
      const choice = await prompter.modal({
        message: `Delete ${String(deletes.length)} ${deletes.length === 1 ? 'file' : 'files'} while synchronizing "${site.name}"?`,
        detail: [...shown, ...(deletes.length > shown.length ? [`and ${String(deletes.length - shown.length)} more`] : [])].join('\n'),
        buttons: [deleteButton(deletes.length)],
        warning: true,
      });
      if (choice !== deleteButton(deletes.length)) {
        return undefined;
      }
    }
    const writesToServer = checked.some((item) => item.action === 'put' || item.action === 'delete-remote');
    if (writesToServer && !this.#services.trusted()) {
      const choice = await prompter.modal({
        message: `This workspace is in Restricted Mode. Synchronize "${site.name}" with ${server.name} anyway?`,
        detail: 'Files will be written to the server.',
        buttons: [SYNCHRONIZE_ANYWAY],
        warning: true,
      });
      if (choice !== SYNCHRONIZE_ANYWAY) {
        return undefined;
      }
    }
    const abort = new AbortController();
    this.#abort = abort;
    this.#running = { site, completed: 0, total: checked.length };
    this.#fire();
    let result: SyncResult;
    try {
      result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Synchronizing "${site.name}" with ${server.name}`, cancellable: true },
        (progress, token) => {
          token.onCancellationRequested(() => {
            abort.abort();
          });
          return session.execute(plan, {
            signal: abort.signal,
            confirmMassDelete: (count, side) => this.#confirmMassDelete(count, side),
            onProgress: (event) => {
              if (event.type === 'transfer') {
                this.#running = { site, completed: event.completed, total: event.total };
                progress.report({ increment: 100 / Math.max(1, event.total), message: `${String(event.completed)} of ${String(event.total)}: ${event.path}` });
                this.#changed.fire();
              }
            },
          });
        },
      );
    } catch (error) {
      this.#running = undefined;
      this.#abort = undefined;
      this.#fire();
      if (isSyncError(error, 'E_CANCELLED')) {
        void prompter.inform('The synchronization was cancelled before any file moved.');
        return undefined;
      }
      throw error;
    }
    this.#running = undefined;
    this.#abort = undefined;
    this.#log(result, site);
    await session.close();
    this.#pending = undefined;
    this.#finished = result.failed > 0 || result.cancelled ? { result, site, server } : undefined;
    this.#fire();
    const line = result.cancelled ? `The synchronization was cancelled. ${resultLine(result)}` : resultLine(result);
    const show = this.#finished === undefined ? [] : ['Show Details'];
    const report = result.failed > 0 ? prompter.error(line, show) : prompter.inform(line, show);
    void report.then(async (choice) => {
      if (choice === 'Show Details') {
        await vscode.commands.executeCommand(`${VIEWS.preview}.focus`);
        this.#services.showLog();
      }
    });
    return result;
  }

  async #confirmMassDelete(count: number, side: 'local' | 'remote'): Promise<boolean> {
    const where = side === 'remote' ? 'on the server' : 'in the local folder';
    const answer = await this.#services.prompter().text({
      title: 'Confirm a large delete',
      prompt: `This run deletes ${String(count)} files ${where}, more than the site's delete limit. Type ${String(count)} to go ahead.`,
      validate: (value) => (value.trim() === '' || value.trim() === String(count) ? undefined : `Type ${String(count)} exactly, or press Escape to cancel.`),
    });
    return typeof answer === 'string' && answer.trim() === String(count);
  }

  #log(result: SyncResult, site: Site): void {
    const { logger } = this.#services;
    logger.info('Synchronization finished', { siteId: site.id, done: result.done, failed: result.failed, skipped: result.skipped, cancelled: result.cancelled });
    for (const item of result.items.filter((entry) => entry.outcome === 'failed' || entry.outcome === 'stale')) {
      logger.warn(`${item.path}: ${item.error?.message ?? item.outcome}`, { siteId: site.id, action: item.action, outcome: item.outcome });
    }
  }

  /** The heading the preview shows above its rows. */
  heading(): string {
    if (this.#pending !== undefined) {
      const { site, server, plan } = this.#pending;
      return `${site.name} and ${server.name}: ${DIRECTION_TITLES[plan.direction]}`;
    }
    if (this.#finished !== undefined) {
      return `${this.#finished.site.name}: ${resultLine(this.#finished.result)}`;
    }
    return '';
  }

  dispose(): void {
    this.cancelRun();
    void this.#pending?.session.close();
    this.#changed.dispose();
  }
}
