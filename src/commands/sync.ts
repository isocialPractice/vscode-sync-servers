import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  isSyncError,
  resultLine,
  SyncSession,
  type Action,
  type PlanOptions,
  type ProgressEvent,
  type Server,
  type Site,
} from '@isocialpractice/cmd-sync-servers';
import * as vscode from 'vscode';
import { askSync, type SyncChoice } from '../flows/sync-options.ts';
import { binarySummary, isBinary, type ComparedCopy } from '../preview/compare-text.ts';
import type { PreviewController } from '../preview/controller.ts';
import type { RemoteDocuments } from '../preview/remote-documents.ts';
import { isPreviewRow, type PreviewNode, type PreviewView } from '../preview/view.ts';
import { realPathOf } from '../real-path.ts';
import { isRemoteNode } from '../remote/nodes.ts';
import { isSitesNode } from '../views/sites-view.ts';
import { chooseSite, requireSites, type Services } from './services.ts';

/** What the synchronization commands work with, beyond every command's services. */
export interface SyncServices extends Services {
  readonly preview: PreviewController;
  readonly previewView: PreviewView;
  readonly remoteDocuments: RemoteDocuments;
  /** Remembers the last answers of the Synchronize dialog for each site. */
  readonly memory: vscode.Memento;
}

/** The button of the question asked before putting or getting a whole site. */
export function wholeSiteButton(direction: 'put' | 'get'): string {
  return direction === 'put' ? 'Put Entire Site' : 'Get Entire Site';
}

/** The button that saves open files before they are put. */
export const SAVE_AND_PUT = 'Save and Put';

/** The button that puts from an untrusted workspace. */
export const PUT_ANYWAY = 'Put Anyway';

/** The local file a command argument stands for: a file Uri, or a row of the Remote Files view. */
export function uriOf(value: unknown): vscode.Uri | undefined {
  if (value instanceof vscode.Uri) {
    return value;
  }
  return isRemoteNode(value) ? value.local : undefined;
}

/** The files a command was started on: the Explorer's or Remote Files view's selection, one file, or none. */
export function urisFrom(arg: unknown, extra: unknown): vscode.Uri[] {
  const many = Array.isArray(extra) && extra.length > 0 ? extra.map(uriOf) : [];
  const chosen = many.length > 0 && many.every((uri) => uri !== undefined) ? many : [uriOf(arg)];
  return chosen.filter((uri): uri is vscode.Uri => uri?.scheme === 'file');
}

function relativeIn(root: string, file: string): string | undefined {
  const relative = path.relative(root, file);
  if (relative === '') {
    return '';
  }
  return relative.startsWith('..') || path.isAbsolute(relative) ? undefined : relative.split(path.sep).join('/');
}

/** The site that holds every one of the files, with their site-relative paths, or why there is none. */
export function siteForFiles(services: Services, uris: readonly vscode.Uri[]): { site: Site; paths: string[] } | string {
  const registry = services.model.registry();
  let site: Site | undefined;
  const paths: string[] = [];
  for (const uri of uris) {
    // The engine matches real paths, and it can only find one for a file
    // that exists, so a file Get is about to download is matched through
    // the real path of its folder.
    const file = realPathOf(uri.fsPath);
    const found = registry.resolve({ path: file }) ?? registry.resolve({ path: uri.fsPath });
    if (found === undefined) {
      return `${uri.fsPath} is not inside the local folder of any site.`;
    }
    if (site !== undefined && site.id !== found.id) {
      return `The files belong to more than one site: "${site.name}" and "${found.name}". Choose files of one site.`;
    }
    site = found;
    const relative = relativeIn(realPathOf(found.localRoot), file) ?? relativeIn(found.localRoot, uri.fsPath);
    if (relative !== undefined) {
      paths.push(relative);
    }
  }
  return site === undefined ? 'No file was chosen.' : { site, paths };
}

function remoteOf(services: Services, site: Site): Server | undefined {
  const server = site.servers.find((candidate) => candidate.id === site.remoteServerId);
  if (server === undefined) {
    void services
      .prompter()
      .inform(`"${site.name}" has no Remote server. Choose one in Site Settings.`, ['Site Settings'])
      .then((choice) => (choice === 'Site Settings' ? vscode.commands.executeCommand('syncServers.siteSettings', { kind: 'site', site }) : undefined));
  }
  return server;
}

function scanMessage(event: ProgressEvent): string | undefined {
  switch (event.type) {
    case 'scan-local':
      return `${String(event.files)} local files`;
    case 'scan-remote':
      return `${String(event.files)} files on the server`;
    case 'compare':
      return `Comparing ${String(event.files)} files`;
    default:
      return undefined;
  }
}

async function openSession(services: Services, site: Site, server: Server): Promise<SyncSession> {
  return SyncSession.open({ registry: services.model.registry(), siteId: site.id, serverId: server.id, host: services.host });
}

/** Scans both sides and shows the plan in the Sync Preview, or says the site is in sync. */
export async function planAndShow(services: SyncServices, site: Site, server: Server, options: Omit<PlanOptions, 'signal' | 'onProgress'>): Promise<void> {
  const session = await openSession(services, site, server);
  let plan;
  try {
    plan = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Comparing "${site.name}" with ${server.name}`, cancellable: true },
      (progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => {
          controller.abort();
        });
        return session.plan({
          ...options,
          signal: controller.signal,
          onProgress: (event) => {
            const message = scanMessage(event);
            if (message !== undefined) {
              progress.report({ message });
            }
          },
        });
      },
    );
  } catch (error) {
    await session.close();
    if (isSyncError(error, 'E_CANCELLED')) {
      void services.prompter().inform('The comparison was cancelled.');
      return;
    }
    throw error;
  }
  if (plan.items.length === 0) {
    await session.close();
    void services.prompter().inform(`"${site.name}" and ${server.name} are in sync. ${String(plan.unlisted)} ${plan.unlisted === 1 ? 'file' : 'files'} compared.`);
    return;
  }
  services.logger.info('Preview ready', { siteId: site.id, serverId: server.id, direction: plan.direction, rows: plan.items.length });
  await services.preview.show({ session, plan, site, server });
}

/** Synchronize...: the three questions, then the plan in the Sync Preview. */
export async function synchronize(services: SyncServices, arg: unknown, extra: unknown): Promise<void> {
  if (!requireSites(services)) {
    return;
  }
  const uris = urisFrom(arg, extra);
  let site: Site | undefined;
  let selection: string[] = [];
  if (uris.length > 0) {
    const found = siteForFiles(services, uris);
    if (typeof found === 'string') {
      void services.prompter().error(found);
      return;
    }
    site = found.site;
    selection = found.paths;
  } else {
    site = await chooseSite(services, arg, 'Choose the site to synchronize');
  }
  if (site === undefined) {
    return;
  }
  const server = isSitesNode(arg) && arg.kind === 'server' ? site.servers.find((candidate) => candidate.id === arg.server.id) : remoteOf(services, site);
  if (server === undefined) {
    return;
  }
  const key = `syncServers.lastSync.${site.id}`;
  const choice = await askSync(services.prompter(), {
    siteName: site.name,
    selection: selection.includes('') ? 0 : selection.length,
    last: services.memory.get<Partial<SyncChoice>>(key),
  });
  if (choice === undefined) {
    return;
  }
  await services.memory.update(key, choice);
  await planAndShow(services, site, server, {
    direction: choice.direction,
    deleteOrphans: choice.deleteOrphans,
    scope: choice.scope === 'selection' && selection.length > 0 && !selection.includes('') ? { kind: 'paths', paths: selection } : { kind: 'site' },
  });
}

async function saveOpenFiles(services: Services, uris: readonly vscode.Uri[]): Promise<boolean> {
  const dirty = vscode.workspace.textDocuments.filter((document) => document.isDirty && uris.some((uri) => document.uri.fsPath === uri.fsPath || relativeIn(uri.fsPath, document.uri.fsPath) !== undefined));
  if (dirty.length === 0) {
    return true;
  }
  const names = dirty.map((document) => path.basename(document.uri.fsPath)).join(', ');
  const choice = await services.prompter().modal({
    message: `Save ${names} before putting ${dirty.length === 1 ? 'it' : 'them'}?`,
    detail: 'The server gets the files as they are saved on disk.',
    buttons: [SAVE_AND_PUT],
  });
  if (choice !== SAVE_AND_PUT) {
    return false;
  }
  for (const document of dirty) {
    await document.save();
  }
  return true;
}

/** Put and Get: the active file, the files chosen in the Explorer, or a whole site, through the same plan and guards. */
export async function transfer(services: SyncServices, direction: 'put' | 'get', arg: unknown, extra: unknown): Promise<void> {
  if (!requireSites(services)) {
    return;
  }
  let site: Site | undefined;
  let paths: string[];
  let uris = urisFrom(arg, extra);
  if (isSitesNode(arg) && arg.kind !== 'problem') {
    site = services.model.site(arg.site.id);
    if (site === undefined) {
      return;
    }
    const choice = await services.prompter().modal({
      message: `${direction === 'put' ? 'Put' : 'Get'} the whole of "${site.name}"?`,
      detail: direction === 'put' ? 'Every file of the site that differs is uploaded.' : 'Every file of the site that differs is downloaded.',
      buttons: [wholeSiteButton(direction)],
    });
    if (choice !== wholeSiteButton(direction)) {
      return;
    }
    paths = [''];
    uris = [vscode.Uri.file(site.localRoot)];
  } else {
    if (uris.length === 0) {
      const active = vscode.window.activeTextEditor?.document.uri;
      uris = active?.scheme === 'file' ? [active] : [];
    }
    if (uris.length === 0) {
      void services.prompter().inform(`Open a file of a site, or choose files in the Explorer, to ${direction} them.`);
      return;
    }
    const found = siteForFiles(services, uris);
    if (typeof found === 'string') {
      void services.prompter().error(found);
      return;
    }
    site = found.site;
    paths = found.paths;
  }
  const server = remoteOf(services, site);
  if (server === undefined) {
    return;
  }
  if (direction === 'put') {
    if (!(await saveOpenFiles(services, uris))) {
      return;
    }
    if (!services.trusted()) {
      const choice = await services.prompter().modal({
        message: `This workspace is in Restricted Mode. Put to ${server.name} anyway?`,
        detail: 'Files will be written to the server.',
        buttons: [PUT_ANYWAY],
        warning: true,
      });
      if (choice !== PUT_ANYWAY) {
        return;
      }
    }
  }
  const session = await openSession(services, site, server);
  const shown = paths.length === 1 && paths[0] !== '' ? paths[0] : paths[0] === '' ? `"${site.name}"` : `${String(paths.length)} items`;
  let outcome;
  try {
    outcome = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `${direction === 'put' ? 'Putting' : 'Getting'} ${String(shown)}`, cancellable: true },
      (progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => {
          controller.abort();
        });
        return session[direction](paths, {
          signal: controller.signal,
          onProgress: (event) => {
            if (event.type === 'transfer') {
              progress.report({ message: `${String(event.completed)} of ${String(event.total)}: ${event.path}` });
            }
          },
        });
      },
    );
  } catch (error) {
    await session.close();
    if (isSyncError(error, 'E_CANCELLED')) {
      void services.prompter().inform(`The ${direction} was cancelled.`);
      return;
    }
    throw error;
  }
  if (outcome.result === undefined) {
    services.logger.info('Preview ready', { siteId: site.id, serverId: server.id, direction, rows: outcome.plan.items.length });
    await services.preview.show({ session, plan: outcome.plan, site, server });
    void services.prompter().inform('Some of the files need a look before they move. They are in the Sync Preview.');
    return;
  }
  await session.close();
  const result = outcome.result;
  if (outcome.plan.items.length === 0) {
    void services.prompter().inform(`Nothing to ${direction}: the files are cloaked, or already the same on both sides.`);
    return;
  }
  services.logger.info(`${direction === 'put' ? 'Put' : 'Get'} finished`, { siteId: site.id, done: result.done, failed: result.failed });
  for (const item of result.items.filter((entry) => entry.outcome === 'failed' || entry.outcome === 'stale')) {
    services.logger.warn(`${item.path}: ${item.error?.message ?? item.outcome}`, { siteId: site.id });
  }
  void (result.failed > 0 ? services.prompter().error(resultLine(result), ['Show Log']) : services.prompter().inform(resultLine(result))).then((choice) => {
    if (choice === 'Show Log') {
      services.showLog();
    }
  });
}

/** Compare with Remote: the server's copy beside the local file, or sizes, times and hashes for a binary file. */
export async function compareWithRemote(services: SyncServices, arg: unknown): Promise<void> {
  let site: Site | undefined;
  let server: Server | undefined;
  let filePath: string | undefined;
  const pending = services.preview.pending;
  if (isPreviewRow(arg) && pending !== undefined) {
    site = pending.site;
    server = pending.server;
    filePath = arg.item.path;
  } else {
    const uri = uriOf(arg) ?? vscode.window.activeTextEditor?.document.uri;
    if (uri?.scheme !== 'file') {
      void services.prompter().inform('Open a file of a site to compare it with the server.');
      return;
    }
    const found = siteForFiles(services, [uri]);
    if (typeof found === 'string') {
      void services.prompter().error(found);
      return;
    }
    site = found.site;
    filePath = found.paths[0];
    server = remoteOf(services, site);
  }
  if (server === undefined || filePath === undefined || filePath === '') {
    return;
  }
  const shared = pending !== undefined && pending.site.id === site.id && pending.server.id === server.id;
  const session = shared ? pending.session : await openSession(services, site, server);
  let local: ComparedCopy | undefined;
  let remote: ComparedCopy | undefined;
  try {
    const target = filePath;
    const comparison = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Fetching ${target} from ${server.name}`, cancellable: true },
      (_progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => {
          controller.abort();
        });
        return session.compare(target, controller.signal);
      },
    );
    try {
      local = comparison.local === undefined ? undefined : { bytes: await readFile(comparison.local.file), mtimeMs: comparison.local.mtimeMs };
      remote = comparison.remote === undefined ? undefined : { bytes: await readFile(comparison.remote.file), mtimeMs: comparison.remote.mtimeMs };
    } finally {
      await comparison.dispose();
    }
  } finally {
    if (!shared) {
      await session.close();
    }
  }
  if (remote === undefined) {
    void services.prompter().inform(local === undefined ? `"${filePath}" is on neither side.` : `"${filePath}" is not on ${server.name}.`);
    return;
  }
  const label = server.name.replace(/[\\/]/g, '_');
  if (isBinary(local) || isBinary(remote)) {
    const summary = services.remoteDocuments.add(label, `${filePath}.txt`, binarySummary(filePath, server.name, local, remote));
    await vscode.window.showTextDocument(summary, { preview: true });
    return;
  }
  const remoteUri = services.remoteDocuments.add(label, filePath, remote.bytes.toString('utf8'));
  if (local === undefined) {
    await vscode.window.showTextDocument(remoteUri, { preview: true });
    return;
  }
  const localUri = vscode.Uri.file(path.join(site.localRoot, ...filePath.split('/')));
  await vscode.commands.executeCommand('vscode.diff', remoteUri, localUri, `${filePath} (${server.name}) ↔ Local`);
}

/** The rows a preview command acts on: those it was started on, else those chosen in the view. */
export function previewRows(services: SyncServices, arg: unknown, extra: unknown): number[] {
  const nodes: unknown[] = Array.isArray(extra) && extra.length > 0 ? extra : arg === undefined ? [] : [arg];
  const ids = nodes.flatMap((node) => {
    if (isPreviewRow(node)) {
      return [node.item.id];
    }
    const group = node as PreviewNode;
    return typeof node === 'object' && node !== null && 'kind' in node && group.kind === 'group'
      ? group.rows.flatMap((row) => (row.kind === 'row' ? [row.item.id] : []))
      : [];
  });
  return ids.length > 0 ? ids : services.previewView.selectedRows().map((item) => item.id);
}

const WHY_NOT: Partial<Record<Action, string>> = {
  put: 'have no local copy to put',
  get: 'have no copy on the server to get',
  synced: 'are not on both sides',
  'delete-remote': 'are not on the server',
  'delete-local': 'are not in the local folder',
};

/** A row action from the preview: Use Local, Use Remote, Skip, Mark Synchronized, or a delete. */
export function setRowAction(services: SyncServices, action: Action, arg: unknown, extra: unknown): Promise<void> {
  const ids = previewRows(services, arg, extra);
  if (ids.length === 0) {
    void services.prompter().inform('Choose rows in the Sync Preview first.');
    return Promise.resolve();
  }
  const changed = services.preview.setAction(ids, action);
  if (changed < ids.length) {
    const left = ids.length - changed;
    void services.prompter().inform(`${String(left)} of the chosen ${ids.length === 1 ? 'row' : 'rows'} ${WHY_NOT[action] ?? 'cannot take that action'}, so ${left === 1 ? 'it was' : 'they were'} left as ${left === 1 ? 'it was' : 'they were'}.`);
  }
  return Promise.resolve();
}
