import { readFile } from 'node:fs/promises';
import { SyncRecords, SyncSession, toRemotePath } from '@isocialpractice/cmd-sync-servers';
import * as vscode from 'vscode';
import { binarySummary, isBinary } from '../preview/compare-text.ts';
import { isRemoteNode, type RemoteNode } from '../remote/nodes.ts';
import type { RemoteFilesView } from '../remote/remote-files.ts';
import type { SyncServices } from './sync.ts';

/** The button of the Delete on Server confirmation. */
export const DELETE_ON_SERVER = 'Delete on Server';

/** True when a server's remote root is the top of the server, where deletes are refused unless allowed. */
export function rootIsTop(remoteRoot: string): boolean {
  return /^\/(?:[A-Za-z]:\/?)?$/.test(remoteRoot);
}

function chosen(arg: unknown, selection: readonly unknown[]): RemoteNode | undefined {
  if (isRemoteNode(arg)) {
    return arg;
  }
  const [first] = selection;
  return isRemoteNode(first) ? first : undefined;
}

/** Open Read-Only: the server's copy of a file, in a read-only editor. */
export async function openReadOnly(services: SyncServices, view: RemoteFilesView, arg: unknown, selection: readonly unknown[]): Promise<void> {
  const node = chosen(arg, selection);
  const browser = view.browser;
  if (node?.type !== 'file' || browser === undefined) {
    void services.prompter().inform('Choose a file in the Remote Files view.');
    return;
  }
  const session = await SyncSession.open({ registry: services.model.registry(), siteId: browser.site.id, serverId: browser.server.id, host: services.host });
  let bytes: Buffer;
  try {
    const comparison = await session.compare(node.path);
    try {
      if (comparison.remote === undefined) {
        void services.prompter().inform(`"${node.path}" is no longer on ${browser.server.name}.`);
        return;
      }
      bytes = await readFile(comparison.remote.file);
    } finally {
      await comparison.dispose();
    }
  } finally {
    await session.close();
  }
  const label = browser.server.name.replace(/[\\/]/g, '_');
  const copy = { bytes, mtimeMs: node.mtimeMs };
  if (isBinary(copy)) {
    const summary = binarySummary(node.path, browser.server.name, undefined, copy);
    await vscode.window.showTextDocument(services.remoteDocuments.add(label, `${node.path}.txt`, summary), { preview: true });
    return;
  }
  await vscode.window.showTextDocument(services.remoteDocuments.add(label, node.path, bytes.toString('utf8')), { preview: true });
}

/**
 * Delete on Server: removes one file from the Remote server after a
 * confirmation, and forgets its sync record, so the next sync sees the local
 * copy as new. Refused at the top of a server unless the server allows it.
 */
export async function deleteOnServer(services: SyncServices, view: RemoteFilesView, arg: unknown, selection: readonly unknown[]): Promise<void> {
  const node = chosen(arg, selection);
  const browser = view.browser;
  if (node?.type !== 'file' || browser === undefined) {
    void services.prompter().inform('Choose a file in the Remote Files view. Folders are removed by synchronizing with the delete option.');
    return;
  }
  const { site, server } = browser;
  if (rootIsTop(server.remoteRoot) && server.options.allowRootDeletes !== true) {
    void services
      .prompter()
      .error(`The root directory of ${server.name} is the top of the server, where deletes are refused. Allow them in the server's Advanced settings to delete here.`);
    return;
  }
  const choice = await services.prompter().modal({
    message: `Delete "${node.path}" on ${server.name}?`,
    detail: `It is removed from the server and cannot be brought back from there. The local copy, if there is one, is kept.${services.trusted() ? '' : ' This workspace is in Restricted Mode.'}`,
    buttons: [DELETE_ON_SERVER],
    warning: true,
  });
  if (choice !== DELETE_ON_SERVER) {
    return;
  }
  await browser.remove(toRemotePath(node.path));
  const stateDir = services.model.paths?.stateDir;
  if (stateDir !== undefined) {
    const records = await SyncRecords.load(stateDir, site.id, server.id, site.sync.maintainInfo);
    records.delete(node.path);
    await records.save();
  }
  services.logger.info('Deleted on the server', { siteId: site.id, serverId: server.id, path: node.path });
  view.refresh();
  void services.prompter().inform(`Deleted "${node.path}" on ${server.name}.`);
}
