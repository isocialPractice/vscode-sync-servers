import { homedir } from 'node:os';
import { isSyncError, type CredentialStore, type HostAdapter, type Logger, type Server, type Site } from '@isocialpractice/cmd-sync-servers';
import * as vscode from 'vscode';
import { INTERNAL_COMMANDS } from '../contributions.ts';
import { errorText } from '../error-text.ts';
import type { SitesModel } from '../sites-model.ts';
import type { Prompter } from '../ui/prompt.ts';
import { protocolLabel, serverAddress, serverRoles, shortPath } from '../views/site-rows.ts';
import { isSitesNode } from '../views/sites-view.ts';

/** What every command works with. */
export interface Services {
  readonly model: SitesModel;
  readonly host: HostAdapter;
  readonly credentials: CredentialStore;
  readonly logger: Logger;
  readonly prompter: () => Prompter;
  readonly showLog: () => void;
  /** True when the workspace is trusted; in Restricted Mode nothing uploads on save and every write to a server asks first. */
  readonly trusted: () => boolean;
}

/** The action that opens `sites.json` in an editor. */
export const OPEN_SITES_FILE = 'Open sites.json';

/** A server together with its site, as they are now. */
export interface ServerTarget {
  readonly site: Site;
  readonly server: Server;
}

/** Offers Add Site when there are no sites; returns true when there are some. */
export function requireSites(services: Services): boolean {
  if (services.model.sites.length > 0) {
    return true;
  }
  const { problem } = services.model;
  const actions = problem === undefined ? ['Add Site'] : services.model.invalidFile ? [OPEN_SITES_FILE] : [];
  void services
    .prompter()
    .inform(problem ?? 'No sites yet. Add one first.', actions)
    .then((choice) =>
      choice === 'Add Site'
        ? vscode.commands.executeCommand('syncServers.addSite')
        : choice === OPEN_SITES_FILE
          ? vscode.commands.executeCommand(INTERNAL_COMMANDS.openSitesFile)
          : undefined,
    );
  return false;
}

/** Lets the person pick a site, with the active one highlighted. */
export async function pickSite(services: Services, placeholder: string): Promise<Site | undefined> {
  if (!requireSites(services)) {
    return undefined;
  }
  const home = homedir();
  const answer = await services.prompter().choose({
    title: 'Sync Servers',
    placeholder,
    choices: services.model.sites.map((site) => {
      const remote = site.servers.find((server) => server.id === site.remoteServerId);
      return {
        label: site.name,
        description: shortPath(site.localRoot, home),
        detail: remote === undefined ? 'No Remote server' : `Remote server: ${remote.name} (${protocolLabel(remote.protocol)} ${serverAddress(remote)})`,
        value: site.id,
      };
    }),
    ...(services.model.activeSiteId === undefined ? {} : { selected: services.model.activeSiteId }),
  });
  return typeof answer === 'string' ? services.model.site(answer) : undefined;
}

/**
 * The site a command acts on: the clicked row's, else the active site, else
 * one the person picks. With `alwaysAsk`, a command run from the palette
 * always asks, for actions that cannot be undone.
 */
export async function chooseSite(services: Services, arg: unknown, placeholder: string, alwaysAsk = false): Promise<Site | undefined> {
  if (isSitesNode(arg) && arg.kind !== 'problem') {
    return services.model.site(arg.site.id);
  }
  const active = services.model.activeSite;
  return active !== undefined && !alwaysAsk ? active : pickSite(services, placeholder);
}

/**
 * The server a command acts on: the clicked server; for a clicked site or
 * the active site, its Remote server when `remoteFirst` is set and it has
 * one, else the only server, else one the person picks.
 */
export async function chooseServer(
  services: Services,
  arg: unknown,
  options: { readonly placeholder: string; readonly remoteFirst: boolean },
): Promise<ServerTarget | undefined> {
  if (isSitesNode(arg) && arg.kind === 'server') {
    const site = services.model.site(arg.site.id);
    const server = site?.servers.find((candidate) => candidate.id === arg.server.id);
    return site === undefined || server === undefined ? undefined : { site, server };
  }
  const site = await chooseSite(services, arg, options.placeholder);
  if (site === undefined) {
    return undefined;
  }
  const remote = site.servers.find((server) => server.id === site.remoteServerId);
  if (options.remoteFirst && remote !== undefined) {
    return { site, server: remote };
  }
  if (site.servers.length === 0) {
    void services.prompter().inform(`"${site.name}" has no servers yet. Add one in Site Settings.`);
    return undefined;
  }
  const [only] = site.servers;
  if (site.servers.length === 1 && only !== undefined) {
    return { site, server: only };
  }
  const ordered = [...site.servers].sort((a, b) => serverRoles(site, b).length - serverRoles(site, a).length);
  const answer = await services.prompter().choose({
    title: `Sync Servers: ${site.name}`,
    placeholder: options.placeholder,
    choices: ordered.map((server) => ({
      label: server.name,
      description: `${protocolLabel(server.protocol)} ${serverAddress(server)}`,
      detail: serverRoles(site, server).join(', '),
      value: server.id,
    })),
  });
  const server = site.servers.find((candidate) => candidate.id === answer);
  return server === undefined ? undefined : { site, server };
}

/**
 * Runs a command, showing any failure as an error message with Show Log, and
 * with Open sites.json when the list of sites is not valid.
 */
export function guarded(services: Services, name: string, handler: (arg: unknown, extra: unknown) => Promise<void>): (arg: unknown, extra: unknown) => Promise<void> {
  return async (arg, extra) => {
    try {
      await handler(arg, extra);
    } catch (error) {
      const text = errorText(error);
      services.logger.error(`${name} failed`, { problem: text });
      const actions = isSyncError(error, 'E_CONFIG_INVALID') ? [OPEN_SITES_FILE, 'Show Log'] : ['Show Log'];
      void services
        .prompter()
        .error(text, actions)
        .then((choice) => {
          if (choice === 'Show Log') {
            services.showLog();
          } else if (choice === OPEN_SITES_FILE) {
            void vscode.commands.executeCommand(INTERNAL_COMMANDS.openSitesFile);
          }
        });
    }
  };
}
