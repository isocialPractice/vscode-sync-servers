import path from 'node:path';
import type { Protocol, Server, Site } from '@isocialpractice/cmd-sync-servers';

/** One row of the Sites view, without `vscode`, so it can be tested. */
export interface Row {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly tooltip: string;
  /** A codicon name. */
  readonly icon: string;
  /** Space-separated tags the menus' `when` clauses match, such as `site active`. */
  readonly contextValue: string;
  readonly expandable: boolean;
  /** Read by screen readers instead of the label and description. */
  readonly accessibilityLabel: string;
}

const PROTOCOL_LABELS: Readonly<Record<Protocol, string>> = {
  sftp: 'SFTP',
  ftps: 'FTPS',
  'ftps-implicit': 'FTPS (implicit)',
  ftp: 'FTP',
  local: 'Folder',
};

/** The protocol as the views name it. */
export function protocolLabel(protocol: Protocol): string {
  return PROTOCOL_LABELS[protocol];
}

/** Where a server is: `host`, `host:port` when the port is not the default, or the folder of a local server. */
export function serverAddress(server: Server): string {
  if (server.protocol === 'local') {
    return server.remoteRoot;
  }
  const host = server.host ?? '';
  const shown = host.includes(':') ? `[${host}]` : host;
  return server.port === undefined ? shown : `${shown}:${String(server.port)}`;
}

/** A path under the home folder written with `~`, as the command line shows it. */
export function shortPath(folder: string, home: string): string {
  const relative = path.relative(home, folder);
  if (home === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return folder;
  }
  return relative === '' ? '~' : `~${path.sep}${relative}`;
}

/** The roles a server holds in its site. */
export function serverRoles(site: Site, server: Server): string[] {
  return [...(site.remoteServerId === server.id ? ['Remote'] : []), ...(site.testingServerId === server.id ? ['Testing'] : [])];
}

/** True when a server signs in with a secret that Set Password can save. */
export function takesSecret(server: Server): boolean {
  return server.protocol !== 'local' && server.auth?.method !== 'agent';
}

/** The row of a site. */
export function siteRow(site: Site, active: boolean, home: string): Row {
  const folder = shortPath(site.localRoot, home);
  const remote = site.servers.find((server) => server.id === site.remoteServerId);
  const remoteText = remote === undefined ? 'No Remote server' : `Remote server: ${remote.name} (${protocolLabel(remote.protocol)} ${serverAddress(remote)})`;
  return {
    id: `site:${site.id}`,
    label: site.name,
    description: active ? `${folder}, active` : folder,
    tooltip: [`${site.name}${active ? ' (active site)' : ''}`, `Local folder: ${site.localRoot}`, remoteText].join('\n'),
    icon: 'globe',
    contextValue: active ? 'site active' : 'site',
    expandable: site.servers.length > 0,
    accessibilityLabel: `${site.name}, site${active ? ', active' : ''}, local folder ${folder}, ${remoteText}`,
  };
}

/** The row of a server under its site. */
export function serverRow(site: Site, server: Server): Row {
  const roles = serverRoles(site, server);
  const where = `${protocolLabel(server.protocol)} ${serverAddress(server)}`;
  const tags = ['server', server.protocol, ...roles.map((role) => role.toLowerCase()), ...(takesSecret(server) ? ['secret'] : [])];
  const user = server.username === undefined ? [] : [`User: ${server.username}`];
  const root = server.protocol === 'local' ? [] : [`Root directory: ${server.remoteRoot}`];
  return {
    id: `server:${site.id}/${server.id}`,
    label: server.name,
    description: roles.length === 0 ? where : `${where}  ${roles.join(', ')}`,
    tooltip: [`${site.name}: ${server.name}`, where, ...user, ...root, ...(roles.length === 0 ? [] : [`${roles.join(' and ')} server`])].join('\n'),
    icon: site.testingServerId === server.id && site.remoteServerId !== server.id ? 'beaker' : 'server',
    contextValue: tags.join(' '),
    expandable: false,
    accessibilityLabel: `${server.name}, server, ${where}${roles.length === 0 ? '' : `, ${roles.join(' and ')}`}`,
  };
}
