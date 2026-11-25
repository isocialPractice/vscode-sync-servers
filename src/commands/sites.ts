import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import {
  dreamweaverTakeOver,
  findDreamweaverServers,
  isSyncError,
  sealSecret,
  serverSchema,
  siteCloak,
  SyncSession,
  type SecretKind,
  type Server,
  type Site,
} from '@isocialpractice/cmd-sync-servers';
import * as vscode from 'vscode';
import { errorText } from '../error-text.ts';
import { askNewSite, type AddSiteContext } from '../flows/add-site.ts';
import { isSitesNode } from '../views/sites-view.ts';
import { openProbe } from './probe.ts';
import { chooseSite, pickSite, requireSites, type Services } from './services.ts';

/** The kinds of secret a server can have saved. */
export const SECRET_KINDS: readonly SecretKind[] = ['password', 'passphrase'];

/** The button of the Remove Site confirmation. */
export const REMOVE_SITE = 'Remove Site';
/** The buttons of Open Site Folder when a folder is already open. */
export const OPEN_HERE = 'Open in This Window';
export const OPEN_NEW_WINDOW = 'Open in New Window';

function samePath(a: string, b: string): boolean {
  const relative = path.relative(a, b);
  return relative === '';
}

/** Connects for Add Site with the answers so far, before anything is saved. */
function connectForNewSite(services: Services, ids: { readonly site: string; readonly server: string }): AddSiteContext['connect'] {
  return async ({ siteName, server: input, password }) => {
    if (password !== undefined) {
      services.logger.redactor.addSecret(password);
    }
    const parsed = serverSchema.safeParse({ ...input, id: ids.server });
    if (!parsed.success) {
      return { ok: false, code: 'E_CONFIG_INVALID', message: parsed.error.issues[0]?.message ?? 'The server is not valid.' };
    }
    try {
      const { probe, server } = await openProbe(services, {
        site: { id: ids.site, name: siteName },
        server: parsed.data,
        title: `Connecting to ${parsed.data.host ?? ''}`,
        password,
      });
      return {
        ok: true,
        connection: {
          server,
          startingFolder: probe.startingFolder,
          folders: (folder) => probe.folders(folder),
          exists: (folder) => probe.exists(folder),
          close: () => probe.close(),
        },
      };
    } catch (error) {
      const code = isSyncError(error) ? error.code : 'E_CONNECTION';
      services.logger.warn('Add Site could not connect', { code, problem: errorText(error) });
      return { ok: false, code, reason: isSyncError(error) ? error.details?.reason : undefined, message: errorText(error) };
    }
  };
}

/** The servers Dreamweaver synchronized a folder with, looked for with the cloak a new site starts with: the global patterns. */
function dreamweaverServersOf(services: Services): NonNullable<AddSiteContext['dreamweaverServers']> {
  return async (localRoot) => {
    const cloak = siteCloak({ cloaking: { enabled: true, patterns: [], paths: [] } }, process.platform, services.model.globalPatterns);
    try {
      return await findDreamweaverServers(localRoot, { cloak });
    } catch (error) {
      services.logger.warn("Add Site could not look for Dreamweaver's records", { problem: errorText(error) });
      return [];
    }
  };
}

/**
 * Takes Dreamweaver's records over for a site just added: plans the whole
 * site in both directions and saves what the plan found in sync, so the
 * first preview lists only real differences. The password the server
 * accepted is saved by then, so nothing is asked again. Returns the
 * sentence for the closing message.
 */
async function takeOverRecords(services: Services, site: Site, server: Server): Promise<string> {
  try {
    return await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Reading Dreamweaver's records", cancellable: true },
      async (_progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => {
          controller.abort();
        });
        const session = await SyncSession.open({ registry: services.model.registry(), siteId: site.id, serverId: server.id, host: services.host });
        try {
          const plan = await session.plan({ direction: 'both', scope: { kind: 'site' }, signal: controller.signal });
          await session.settle(plan);
          services.logger.info("Dreamweaver's records taken over", { siteId: site.id, serverId: server.id, adopted: plan.adopted, clock: session.dreamweaverClock });
          return dreamweaverTakeOver(plan.adopted, session.dreamweaverClock ?? 'unknown');
        } finally {
          await session.close();
        }
      },
    );
  } catch (error) {
    services.logger.warn("Dreamweaver's records were not read after Add Site", { siteId: site.id, serverId: server.id, problem: errorText(error) });
    const reason = isSyncError(error, 'E_CANCELLED') ? 'the reading was cancelled.' : errorText(error);
    return `Dreamweaver's records were not read: ${reason} The first synchronization of the whole site takes them over.`;
  }
}

/**
 * Add Site: asks for the site and its first server, connects before
 * anything is saved, picks the root directory from what the server shows,
 * then adds the site and saves the password the server accepted. In a
 * folder Dreamweaver synchronized, it asks whether to use Dreamweaver's
 * records, and with a yes and a tested connection takes them over.
 */
export async function addSite(services: Services): Promise<void> {
  const registry = services.model.registry();
  const startFolder = vscode.workspace.workspaceFolders?.find((folder) => folder.uri.scheme === 'file')?.uri.fsPath;
  const ids = { site: randomUUID(), server: randomUUID() };
  const answers = await askNewSite(services.prompter(), {
    existingNames: services.model.sites.map((site) => site.name),
    startFolder,
    connect: connectForNewSite(services, ids),
    dreamweaverServers: dreamweaverServersOf(services),
  });
  if (answers === undefined) {
    return;
  }
  const servers = (answers.site.servers ?? []).map((server) => ({ ...server, id: ids.server }));
  const site = await registry.add({ ...answers.site, id: ids.site, servers });
  const [server] = site.servers;
  if (answers.password !== undefined && server !== undefined) {
    await services.credentials.set({ siteId: site.id, serverId: server.id, kind: 'password' }, sealSecret(answers.password, server));
    services.logger.info('Secret saved', { siteId: site.id, serverId: server.id, kind: 'password', store: services.credentials.name });
  }
  if (services.model.activeSiteId === undefined) {
    await services.model.setActive(site.id);
  } else {
    services.model.refresh();
  }
  const usesRecords = site.sync.dreamweaver.enabled && site.sync.maintainInfo;
  const takeOver = usesRecords && server !== undefined && answers.tested ? ` ${await takeOverRecords(services, site, server)}` : '';
  const actions = server === undefined ? ['Open Site Folder'] : ['Open Site Folder', 'Test Connection'];
  const where = server === undefined ? '' : ` with the server ${server.name}${answers.tested ? '' : '. The connection was not tested'}`;
  void services
    .prompter()
    .inform(`Added "${site.name}"${where}.${takeOver}`, actions)
    .then((choice) => {
      const node = { kind: 'site', site };
      if (choice === 'Open Site Folder') {
        void vscode.commands.executeCommand('syncServers.openSiteFolder', node);
      } else if (choice === 'Test Connection') {
        void vscode.commands.executeCommand('syncServers.testConnection', node);
      }
    });
}

/** Remove Site: removes a site from the master list after a confirmation, and forgets its saved passwords. */
export async function removeSite(services: Services, arg: unknown): Promise<void> {
  const site = await chooseSite(services, arg, 'Choose the site to remove', true);
  if (site === undefined) {
    return;
  }
  const choice = await services.prompter().modal({
    message: `Remove "${site.name}" from your sites?`,
    detail:
      'Its local folder and the files on its servers are not touched. Its saved passwords are forgotten, and the sync-servers command line no longer lists it either.',
    buttons: [REMOVE_SITE],
    warning: true,
  });
  if (choice !== REMOVE_SITE) {
    return;
  }
  await services.model.registry().remove(site.id);
  let forgotten = 0;
  for (const server of site.servers) {
    for (const kind of SECRET_KINDS) {
      forgotten += (await services.credentials.delete({ siteId: site.id, serverId: server.id, kind })) ? 1 : 0;
    }
  }
  services.logger.info('Saved secrets of a removed site forgotten', { siteId: site.id, servers: site.servers.length, forgotten });
  if (services.model.activeSiteId === site.id) {
    await services.model.setActive(undefined);
  } else {
    services.model.refresh();
  }
  void services.prompter().inform(`Removed "${site.name}" from your sites.`);
}

/** Switch Site: makes another site active in this window. */
export async function switchSite(services: Services, arg: unknown): Promise<void> {
  const site =
    isSitesNode(arg) && arg.kind === 'site' ? services.model.site(arg.site.id) : await pickSite(services, 'Choose the site to switch to');
  if (site !== undefined) {
    await services.model.setActive(site.id);
  }
}

/** Open Site Folder: opens a site's local folder as the workspace, here or in a new window. */
export async function openSiteFolder(services: Services, arg: unknown): Promise<void> {
  if (!requireSites(services)) {
    return;
  }
  const site = await chooseSite(services, arg, 'Choose the site whose folder to open');
  if (site === undefined) {
    return;
  }
  const isFolder = await stat(site.localRoot).then(
    (info) => info.isDirectory(),
    () => false,
  );
  if (!isFolder) {
    void services.prompter().error(`The local folder of "${site.name}" does not exist: ${site.localRoot}`);
    return;
  }
  const open = (vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === 'file');
  if (open.some((folder) => samePath(folder.uri.fsPath, site.localRoot))) {
    await services.model.setActive(site.id);
    void services.prompter().inform(`The folder of "${site.name}" is already open.`);
    return;
  }
  let forceNewWindow = false;
  if (open.length > 0) {
    const choice = await services.prompter().modal({
      message: `Open the folder of "${site.name}"?`,
      detail: site.localRoot,
      buttons: [OPEN_HERE, OPEN_NEW_WINDOW],
    });
    if (choice === undefined) {
      return;
    }
    forceNewWindow = choice === OPEN_NEW_WINDOW;
  }
  await services.model.recordLastSelected(site.id);
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(site.localRoot), { forceNewWindow });
}

/** Opens `sites.json` in an editor, from the row that says it cannot be read. */
export async function openSitesFile(services: Services): Promise<void> {
  const file = services.model.paths?.sitesFile;
  if (file !== undefined) {
    await vscode.window.showTextDocument(vscode.Uri.file(file));
  }
}
