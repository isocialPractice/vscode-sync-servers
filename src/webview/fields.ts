/**
 * Every field of the Site Settings form: its label, help, where its value
 * lives in the site, and how the text in the form maps to that value.
 */
import type { ProtocolValue, ServerData, SiteData } from '../shared/site-data.ts';

/** The categories of the form, in the order of Dreamweaver's Site Setup. */
export type Category = 'site' | 'servers' | 'local' | 'cloaking' | 'sync' | 'security';

/** The tabs of the server editor. */
export type ServerTab = 'basic' | 'advanced';

/** What a Browse... button next to a field picks. `remoteRoot` picks from what the server shows. */
export type BrowseKind = 'localRoot' | 'serverFolder' | 'remoteRoot' | 'keyFile' | 'caFile';

/** The value of a field as the form holds it. */
export type FieldValue = string | boolean;

/** One field of the form. Server fields act on the server being edited. */
export interface Field {
  readonly id: string;
  readonly kind: 'text' | 'number' | 'checkbox' | 'select' | 'patterns';
  /** A site category, or a tab of the server editor. */
  readonly place: Category | ServerTab;
  readonly label: (server: ServerData | undefined) => string;
  readonly help?: (server: ServerData | undefined) => string | undefined;
  /** Shown beside the field at all times, as a warning. */
  readonly warning?: string;
  readonly choices?: readonly { readonly value: string; readonly label: string }[];
  readonly number?: { readonly min: number; readonly max: number; readonly integer: boolean; readonly optional: boolean };
  readonly required?: boolean;
  readonly optional?: boolean;
  readonly browse?: (server: ServerData | undefined) => BrowseKind | undefined;
  readonly placeholder?: (server: ServerData | undefined) => string | undefined;
  /** False hides the field for this server. */
  readonly visible?: (server: ServerData) => boolean;
  /** Where the value lives in the site, for problems: `local.webUrl`, `servers.0.host`. */
  readonly path: (index: number) => string;
  readonly get: (site: SiteData, server: ServerData | undefined) => FieldValue;
  /** Changes the draft. Numbers arrive parsed; an empty optional field arrives as `undefined`. */
  readonly set: (site: SiteData, server: ServerData | undefined, value: string | number | boolean | undefined) => void;
}

/** The port each protocol uses when a server sets none. */
export const DEFAULT_PORTS: Readonly<Record<Exclude<ProtocolValue, 'local'>, number>> = {
  sftp: 22,
  ftps: 21,
  'ftps-implicit': 990,
  ftp: 21,
};

/** Splits patterns written one per line or separated by spaces. */
export function splitPatterns(text: string): string[] {
  return text.split(/\s+/).filter((pattern) => pattern !== '');
}

function text(value: string | number | boolean | undefined): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function serverOf(server: ServerData | undefined): ServerData {
  if (server === undefined) {
    throw new Error('A server field needs a server.');
  }
  return server;
}

const isLocal = (server: ServerData): boolean => server.protocol === 'local';
const isFtps = (server: ServerData): boolean => server.protocol === 'ftps' || server.protocol === 'ftps-implicit';

/** Changes a server's protocol and drops the settings the new one does not use. */
export function applyProtocol(server: ServerData, next: ProtocolValue): void {
  const before = server.protocol;
  server.protocol = next;
  const options = server.options;
  if (next === 'local') {
    delete server.host;
    delete server.port;
    delete server.username;
    delete server.auth;
    delete options.tls;
    delete options.legacyAlgorithms;
    delete options.allowInsecure;
    delete options.hostKey;
    return;
  }
  if (before !== 'local' && server.port === DEFAULT_PORTS[before]) {
    delete server.port;
  }
  if (next !== 'sftp') {
    delete options.legacyAlgorithms;
    delete options.hostKey;
    if (server.auth !== undefined && server.auth.method !== 'password') {
      server.auth.method = 'password';
      delete server.auth.keyPath;
    }
  }
  if (next !== 'ftps' && next !== 'ftps-implicit') {
    delete options.tls;
  }
  if (next !== 'ftp') {
    delete options.allowInsecure;
  }
}

function tlsOf(server: ServerData): NonNullable<ServerData['options']['tls']> {
  server.options.tls ??= { minVersion: 'TLSv1.2' };
  return server.options.tls;
}

/** Drops the TLS settings when they hold nothing but the defaults; a trusted certificate is kept. */
export function tidyTls(server: ServerData): void {
  const tls = server.options.tls;
  if (tls !== undefined && tls.caFile === undefined && tls.servername === undefined && tls.trustedCertificate === undefined && tls.minVersion === 'TLSv1.2') {
    delete server.options.tls;
  }
}

/**
 * Moves a port typed in Host, as `host:port` or `[IPv6]:port`, into Port,
 * as the Host field reads it everywhere. Returns a problem when Port already
 * holds another port. The extension checks the host fully before it connects
 * or saves.
 */
export function splitHostPort(server: ServerData): string | undefined {
  const host = server.host?.trim();
  if (host === undefined) {
    return undefined;
  }
  const match = /^\[([^\]]+)\]:(\d{1,5})$/.exec(host) ?? /^([^:\s/[\]]+):(\d{1,5})$/.exec(host);
  if (match === null) {
    return undefined;
  }
  const port = Number(match[2]);
  if (port < 1 || port > 65535) {
    return 'The port must be a number from 1 to 65535.';
  }
  if (server.port !== undefined && server.port !== port) {
    return `Host gives port ${String(port)}, but Port says ${String(server.port)}. Keep one of them.`;
  }
  server.host = match[1] ?? host;
  if (server.protocol === 'local' || port !== DEFAULT_PORTS[server.protocol]) {
    server.port = port;
  } else {
    delete server.port;
  }
  return undefined;
}

function authOf(server: ServerData): NonNullable<ServerData['auth']> {
  server.auth ??= { method: 'password', savePassword: false };
  return server.auth;
}

const sitePath = (path: string) => (): string => path;
const serverPath = (path: string) => (index: number): string => `servers.${String(index)}.${path}`;
const fixed = (label: string) => (): string => label;

/** The fields of each site category. */
export const SITE_FIELDS: readonly Field[] = [
  {
    id: 'name',
    kind: 'text',
    place: 'site',
    label: fixed('Site name'),
    help: () => 'The name you know the site by. It must differ from your other sites, ignoring case.',
    required: true,
    path: sitePath('name'),
    get: (site) => site.name,
    set: (site, _server, value) => {
      site.name = typeof value === 'string' ? value : '';
    },
  },
  {
    id: 'localRoot',
    kind: 'text',
    place: 'site',
    label: fixed('Local site folder'),
    help: () => 'The folder on this computer that holds the site.',
    required: true,
    browse: () => 'localRoot',
    path: sitePath('localRoot'),
    get: (site) => site.localRoot,
    set: (site, _server, value) => {
      site.localRoot = typeof value === 'string' ? value : '';
    },
  },
  {
    id: 'localWebUrl',
    kind: 'text',
    place: 'local',
    label: fixed('Web URL'),
    help: () => 'The local web address of the site, such as http://localhost:8080/.',
    optional: true,
    path: sitePath('local.webUrl'),
    get: (site) => site.local.webUrl ?? '',
    set: (site, _server, value) => {
      const url = text(value);
      if (url === undefined) {
        delete site.local.webUrl;
      } else {
        site.local.webUrl = url;
      }
    },
  },
  {
    id: 'caseSensitive',
    kind: 'select',
    place: 'local',
    label: fixed('Case-sensitive names'),
    help: () => 'Whether Index.html and index.html are different files in the local folder.',
    choices: [
      { value: 'auto', label: 'Ask the file system' },
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
    ],
    path: sitePath('local.caseSensitive'),
    get: (site) => (site.local.caseSensitive === undefined ? 'auto' : site.local.caseSensitive ? 'yes' : 'no'),
    set: (site, _server, value) => {
      if (value === 'yes' || value === 'no') {
        site.local.caseSensitive = value === 'yes';
      } else {
        delete site.local.caseSensitive;
      }
    },
  },
  {
    id: 'cache',
    kind: 'checkbox',
    place: 'local',
    label: fixed('Enable cache'),
    help: () => 'Remembers file checksums between runs, so comparing by checksum is faster.',
    path: sitePath('local.cache'),
    get: (site) => site.local.cache,
    set: (site, _server, value) => {
      site.local.cache = value === true;
    },
  },
  {
    id: 'cloakingEnabled',
    kind: 'checkbox',
    place: 'cloaking',
    label: fixed('Enable cloaking'),
    help: () => 'Cloaked files and folders are never scanned, listed, transferred or deleted, on either side.',
    path: sitePath('cloaking.enabled'),
    get: (site) => site.cloaking.enabled,
    set: (site, _server, value) => {
      site.cloaking.enabled = value === true;
    },
  },
  {
    id: 'useGlobalPatterns',
    kind: 'checkbox',
    place: 'cloaking',
    label: fixed('Use global patterns'),
    help: () => 'The global patterns, shared by every site, come before the patterns below, so !keep.psd below brings a file back.',
    path: sitePath('cloaking.useGlobalPatterns'),
    get: (site) => site.cloaking.useGlobalPatterns !== false,
    set: (site, _server, value) => {
      if (value === true) {
        delete site.cloaking.useGlobalPatterns;
      } else {
        site.cloaking.useGlobalPatterns = false;
      }
    },
  },
  {
    id: 'cloakingPatterns',
    kind: 'patterns',
    place: 'cloaking',
    label: fixed('Cloak files matching'),
    help: () =>
      '.psd cloaks a suffix, archive* a name, node_modules/ a folder, /drafts/ a folder at the top of the site, and !keep.psd brings a file back. One per line, or separated by spaces.',
    path: sitePath('cloaking.patterns'),
    get: (site) => site.cloaking.patterns.join('\n'),
    set: (site, _server, value) => {
      site.cloaking.patterns = splitPatterns(typeof value === 'string' ? value : '');
    },
  },
  {
    id: 'maintainInfo',
    kind: 'checkbox',
    place: 'sync',
    label: fixed('Maintain sync information'),
    help: () => 'Keeps sync records, so a file changed on both sides waits for you instead of being overwritten.',
    path: sitePath('sync.maintainInfo'),
    get: (site) => site.sync.maintainInfo,
    set: (site, _server, value) => {
      site.sync.maintainInfo = value === true;
    },
  },
  {
    id: 'compare',
    kind: 'select',
    place: 'sync',
    label: fixed('Compare files by'),
    help: () => 'Checksum reads every file that might differ; size and time is faster.',
    choices: [
      { value: 'metadata', label: 'Size and time' },
      { value: 'checksum', label: 'Checksum' },
    ],
    path: sitePath('sync.compare'),
    get: (site) => site.sync.compare,
    set: (site, _server, value) => {
      site.sync.compare = value === 'checksum' ? 'checksum' : 'metadata';
    },
  },
  {
    id: 'tolerance',
    kind: 'number',
    place: 'sync',
    label: fixed('Time tolerance (seconds)'),
    help: () => 'Times closer than this count as equal, for servers that round them.',
    number: { min: 0, max: 3600, integer: false, optional: false },
    path: sitePath('sync.mtimeToleranceSeconds'),
    get: (site) => String(site.sync.mtimeToleranceSeconds),
    set: (site, _server, value) => {
      site.sync.mtimeToleranceSeconds = Number(value);
    },
  },
  {
    id: 'symlinks',
    kind: 'select',
    place: 'sync',
    label: fixed('Symbolic links'),
    choices: [
      { value: 'skip', label: 'Skip them' },
      { value: 'follow-inside-root', label: 'Follow links inside the site' },
      { value: 'follow', label: 'Follow all links' },
    ],
    help: () => 'A followed link is put and got as the file or folder it points to. Links on the server are never followed.',
    path: sitePath('sync.symlinks'),
    get: (site) => site.sync.symlinks,
    set: (site, _server, value) => {
      site.sync.symlinks = value === 'follow-inside-root' || value === 'follow' ? value : 'skip';
    },
  },
  {
    id: 'concurrency',
    kind: 'number',
    place: 'sync',
    label: fixed('Transfers at once'),
    help: () => 'From 1 to 16.',
    number: { min: 1, max: 16, integer: true, optional: false },
    path: sitePath('sync.concurrency'),
    get: (site) => String(site.sync.concurrency),
    set: (site, _server, value) => {
      site.sync.concurrency = Number(value);
    },
  },
  {
    id: 'maxCount',
    kind: 'number',
    place: 'sync',
    label: fixed('Delete limit (files)'),
    help: () => 'Deleting more files than this asks you to confirm by typing the count.',
    number: { min: 0, max: 1_000_000, integer: true, optional: false },
    path: sitePath('sync.massDelete.maxCount'),
    get: (site) => String(site.sync.massDelete.maxCount),
    set: (site, _server, value) => {
      site.sync.massDelete.maxCount = Number(value);
    },
  },
  {
    id: 'maxPercent',
    kind: 'number',
    place: 'sync',
    label: fixed('Delete limit (percent)'),
    help: () => "Deleting more than this share of a side's files asks you to confirm too.",
    number: { min: 0, max: 100, integer: false, optional: false },
    path: sitePath('sync.massDelete.maxPercent'),
    get: (site) => String(site.sync.massDelete.maxPercent),
    set: (site, _server, value) => {
      site.sync.massDelete.maxPercent = Number(value);
    },
  },
  {
    id: 'recovery',
    kind: 'checkbox',
    place: 'sync',
    label: fixed('Keep a recovery copy'),
    help: () => 'Local files that are deleted or overwritten are kept in the recovery folder first.',
    path: sitePath('sync.recovery.enabled'),
    get: (site) => site.sync.recovery.enabled,
    set: (site, _server, value) => {
      site.sync.recovery.enabled = value === true;
    },
  },
  {
    id: 'keepDays',
    kind: 'number',
    place: 'sync',
    label: fixed('Keep recovery copies for (days)'),
    number: { min: 0, max: 3650, integer: true, optional: false },
    path: sitePath('sync.recovery.keepDays'),
    get: (site) => String(site.sync.recovery.keepDays),
    set: (site, _server, value) => {
      site.sync.recovery.keepDays = Number(value);
    },
  },
  {
    id: 'maxMegabytes',
    kind: 'number',
    place: 'sync',
    label: fixed('Recovery folder size (MB)'),
    number: { min: 0, max: 1_000_000, integer: true, optional: false },
    path: sitePath('sync.recovery.maxMegabytes'),
    get: (site) => String(site.sync.recovery.maxMegabytes),
    set: (site, _server, value) => {
      site.sync.recovery.maxMegabytes = Number(value);
    },
  },
  {
    id: 'guard',
    kind: 'checkbox',
    place: 'security',
    label: fixed('Hold back sensitive files'),
    help: () => 'Files that match are listed unchecked in the preview, and move only when you check them.',
    path: sitePath('sync.guard.enabled'),
    get: (site) => site.sync.guard.enabled,
    set: (site, _server, value) => {
      site.sync.guard.enabled = value === true;
    },
  },
  {
    id: 'guardPatterns',
    kind: 'patterns',
    place: 'security',
    label: fixed('Also hold back'),
    help: () => 'Patterns added to the built-in list, written like cloaking patterns. One per line, or separated by spaces.',
    path: sitePath('sync.guard.patterns'),
    get: (site) => site.sync.guard.patterns.join('\n'),
    set: (site, _server, value) => {
      site.sync.guard.patterns = splitPatterns(typeof value === 'string' ? value : '');
    },
  },
];

/** The fields of the server editor, on its Basic and Advanced tabs. */
export const SERVER_FIELDS: readonly Field[] = [
  {
    id: 'serverName',
    kind: 'text',
    place: 'basic',
    label: fixed('Server name'),
    help: () => 'Unique within the site, such as Production.',
    required: true,
    path: serverPath('name'),
    get: (_site, server) => serverOf(server).name,
    set: (_site, server, value) => {
      serverOf(server).name = typeof value === 'string' ? value : '';
    },
  },
  {
    id: 'protocol',
    kind: 'select',
    place: 'basic',
    label: fixed('Protocol'),
    choices: [
      { value: 'sftp', label: 'SFTP' },
      { value: 'ftps', label: 'FTPS, explicit TLS' },
      { value: 'ftps-implicit', label: 'FTPS, implicit TLS' },
      { value: 'ftp', label: 'FTP, insecure' },
      { value: 'local', label: 'Local or network folder' },
    ],
    path: serverPath('protocol'),
    get: (_site, server) => serverOf(server).protocol,
    set: (_site, server, value) => {
      const next = ['sftp', 'ftps', 'ftps-implicit', 'ftp', 'local'].find((protocol) => protocol === value);
      if (next !== undefined) {
        applyProtocol(serverOf(server), next as ProtocolValue);
      }
    },
  },
  {
    id: 'host',
    kind: 'text',
    place: 'basic',
    label: fixed('Host'),
    help: () => 'The FTP or SFTP host your hosting panel shows, such as sftp.example.com. host:port fills Port.',
    required: true,
    visible: (server) => !isLocal(server),
    path: serverPath('host'),
    get: (_site, server) => serverOf(server).host ?? '',
    set: (_site, server, value) => {
      const target = serverOf(server);
      const host = text(value);
      if (host === undefined) {
        delete target.host;
      } else {
        target.host = host;
      }
    },
  },
  {
    id: 'port',
    kind: 'number',
    place: 'basic',
    label: fixed('Port'),
    help: () => 'Leave it empty for the usual port of the protocol.',
    number: { min: 1, max: 65535, integer: true, optional: true },
    placeholder: (server) => (server === undefined || isLocal(server) ? undefined : String(DEFAULT_PORTS[server.protocol as Exclude<ProtocolValue, 'local'>])),
    visible: (server) => !isLocal(server),
    path: serverPath('port'),
    get: (_site, server) => (serverOf(server).port === undefined ? '' : String(serverOf(server).port)),
    set: (_site, server, value) => {
      const target = serverOf(server);
      if (typeof value === 'number') {
        target.port = value;
      } else {
        delete target.port;
      }
    },
  },
  {
    id: 'username',
    kind: 'text',
    place: 'basic',
    label: fixed('User'),
    help: () => 'Many hosts name FTP accounts in full, such as demo-user@example.com.',
    optional: true,
    visible: (server) => !isLocal(server),
    path: serverPath('username'),
    get: (_site, server) => serverOf(server).username ?? '',
    set: (_site, server, value) => {
      const target = serverOf(server);
      const user = text(value);
      if (user === undefined) {
        delete target.username;
      } else {
        target.username = user;
      }
    },
  },
  {
    id: 'authMethod',
    kind: 'select',
    place: 'basic',
    label: fixed('Sign in with'),
    choices: [
      { value: 'password', label: 'Password' },
      { value: 'key', label: 'Private key file' },
      { value: 'agent', label: 'SSH agent' },
    ],
    visible: (server) => server.protocol === 'sftp',
    path: serverPath('auth.method'),
    get: (_site, server) => serverOf(server).auth?.method ?? 'password',
    set: (_site, server, value) => {
      const auth = authOf(serverOf(server));
      auth.method = value === 'key' || value === 'agent' ? value : 'password';
      if (auth.method !== 'key') {
        delete auth.keyPath;
      }
      if (auth.method === 'agent') {
        auth.savePassword = false;
      }
    },
  },
  {
    id: 'keyPath',
    kind: 'text',
    place: 'basic',
    label: fixed('Private key file'),
    help: () => 'Used where it is; the key is never copied.',
    required: true,
    browse: () => 'keyFile',
    visible: (server) => server.protocol === 'sftp' && server.auth?.method === 'key',
    path: serverPath('auth.keyPath'),
    get: (_site, server) => serverOf(server).auth?.keyPath ?? '',
    set: (_site, server, value) => {
      const auth = authOf(serverOf(server));
      const keyPath = text(value);
      if (keyPath === undefined) {
        delete auth.keyPath;
      } else {
        auth.keyPath = keyPath;
      }
    },
  },
  {
    id: 'allowInsecure',
    kind: 'checkbox',
    place: 'basic',
    label: fixed('Allow plain FTP'),
    warning: 'Plain FTP sends the password and the files in clear text, readable by anyone on the network path. Use SFTP or FTPS when the server offers either.',
    visible: (server) => server.protocol === 'ftp',
    path: serverPath('options.allowInsecure'),
    get: (_site, server) => serverOf(server).options.allowInsecure === true,
    set: (_site, server, value) => {
      const target = serverOf(server);
      if (value === true) {
        target.options.allowInsecure = true;
      } else {
        delete target.options.allowInsecure;
      }
    },
  },
  {
    id: 'savePassword',
    kind: 'checkbox',
    place: 'basic',
    label: (server) => (server?.auth?.method === 'key' ? 'Save the key passphrase' : 'Save password'),
    help: () => "Keeps it in VS Code's secret storage. Without it, you are asked each time you connect.",
    visible: (server) => !isLocal(server) && server.auth?.method !== 'agent',
    path: serverPath('auth.savePassword'),
    get: (_site, server) => serverOf(server).auth?.savePassword === true,
    set: (_site, server, value) => {
      authOf(serverOf(server)).savePassword = value === true;
    },
  },
  {
    id: 'remoteRoot',
    kind: 'text',
    place: 'basic',
    label: (server) => (server !== undefined && isLocal(server) ? 'Folder' : 'Root directory'),
    help: (server) =>
      server !== undefined && isLocal(server)
        ? 'The folder the site is published to: a folder, a mounted drive or a network share.'
        : 'The folder on the server the site is published to, as the account sees it. Browse... picks it from what the server shows.',
    required: true,
    browse: (server) => (server !== undefined && isLocal(server) ? 'serverFolder' : 'remoteRoot'),
    path: serverPath('remoteRoot'),
    get: (_site, server) => serverOf(server).remoteRoot,
    set: (_site, server, value) => {
      serverOf(server).remoteRoot = typeof value === 'string' ? value : '';
    },
  },
  {
    id: 'webUrl',
    kind: 'text',
    place: 'advanced',
    label: fixed('Web URL'),
    help: () => 'The address of the site on this server, such as https://www.example.com/.',
    optional: true,
    path: serverPath('webUrl'),
    get: (_site, server) => serverOf(server).webUrl ?? '',
    set: (_site, server, value) => {
      const target = serverOf(server);
      const url = text(value);
      if (url === undefined) {
        delete target.webUrl;
      } else {
        target.webUrl = url;
      }
    },
  },
  {
    id: 'uploadOnSave',
    kind: 'checkbox',
    place: 'advanced',
    label: fixed('Upload on save'),
    help: () => 'Puts a file to this server when you save it in VS Code, unless it is cloaked or held back.',
    path: serverPath('options.uploadOnSave'),
    get: (_site, server) => serverOf(server).options.uploadOnSave,
    set: (_site, server, value) => {
      serverOf(server).options.uploadOnSave = value === true;
    },
  },
  {
    id: 'timeout',
    kind: 'number',
    place: 'advanced',
    label: fixed('Timeout (seconds)'),
    help: () => 'How long to wait for the server before giving up. From 1 to 600.',
    number: { min: 1, max: 600, integer: true, optional: false },
    path: serverPath('options.timeoutSeconds'),
    get: (_site, server) => String(serverOf(server).options.timeoutSeconds),
    set: (_site, server, value) => {
      serverOf(server).options.timeoutSeconds = Number(value);
    },
  },
  {
    id: 'ipFamily',
    kind: 'select',
    place: 'advanced',
    label: fixed('IP version'),
    choices: [
      { value: 'any', label: 'Either' },
      { value: '4', label: 'IPv4 only' },
      { value: '6', label: 'IPv6 only' },
    ],
    visible: (server) => !isLocal(server),
    path: serverPath('options.ipFamily'),
    get: (_site, server) => (serverOf(server).options.ipFamily === undefined ? 'any' : String(serverOf(server).options.ipFamily)),
    set: (_site, server, value) => {
      const target = serverOf(server);
      if (value === '4' || value === '6') {
        target.options.ipFamily = value === '4' ? 4 : 6;
      } else {
        delete target.options.ipFamily;
      }
    },
  },
  {
    id: 'allowRootDeletes',
    kind: 'checkbox',
    place: 'advanced',
    label: fixed('Allow deletes at the top of the server'),
    help: () => 'Deletes are refused while the root directory is / or a drive root, unless this is on.',
    path: serverPath('options.allowRootDeletes'),
    get: (_site, server) => serverOf(server).options.allowRootDeletes === true,
    set: (_site, server, value) => {
      const target = serverOf(server);
      if (value === true) {
        target.options.allowRootDeletes = true;
      } else {
        delete target.options.allowRootDeletes;
      }
    },
  },
  {
    id: 'legacyAlgorithms',
    kind: 'checkbox',
    place: 'advanced',
    label: fixed('Allow older SSH algorithms'),
    warning: 'Only for an old server that offers nothing newer. Every connection then warns in the log.',
    visible: (server) => server.protocol === 'sftp',
    path: serverPath('options.legacyAlgorithms'),
    get: (_site, server) => serverOf(server).options.legacyAlgorithms === true,
    set: (_site, server, value) => {
      const target = serverOf(server);
      if (value === true) {
        target.options.legacyAlgorithms = true;
      } else {
        delete target.options.legacyAlgorithms;
      }
    },
  },
  {
    id: 'caFile',
    kind: 'text',
    place: 'advanced',
    label: fixed('Certificate authority file'),
    help: () => "A PEM file of extra certificate authorities, for a server whose certificate a private authority signed. The system's authorities stay trusted.",
    optional: true,
    browse: () => 'caFile',
    visible: isFtps,
    path: serverPath('options.tls.caFile'),
    get: (_site, server) => serverOf(server).options.tls?.caFile ?? '',
    set: (_site, server, value) => {
      const target = serverOf(server);
      const file = text(value);
      if (file === undefined) {
        delete tlsOf(target).caFile;
      } else {
        tlsOf(target).caFile = file;
      }
      tidyTls(target);
    },
  },
  {
    id: 'servername',
    kind: 'text',
    place: 'advanced',
    label: fixed('Certificate host name'),
    help: () => 'The name to check the certificate against, when it differs from the address.',
    optional: true,
    visible: isFtps,
    path: serverPath('options.tls.servername'),
    get: (_site, server) => serverOf(server).options.tls?.servername ?? '',
    set: (_site, server, value) => {
      const target = serverOf(server);
      const name = text(value);
      if (name === undefined) {
        delete tlsOf(target).servername;
      } else {
        tlsOf(target).servername = name;
      }
      tidyTls(target);
    },
  },
  {
    id: 'minVersion',
    kind: 'select',
    place: 'advanced',
    label: fixed('Lowest TLS version'),
    choices: [
      { value: 'TLSv1.2', label: 'TLS 1.2' },
      { value: 'TLSv1.3', label: 'TLS 1.3' },
    ],
    visible: isFtps,
    path: serverPath('options.tls.minVersion'),
    get: (_site, server) => serverOf(server).options.tls?.minVersion ?? 'TLSv1.2',
    set: (_site, server, value) => {
      const target = serverOf(server);
      tlsOf(target).minVersion = value === 'TLSv1.3' ? 'TLSv1.3' : 'TLSv1.2';
      tidyTls(target);
    },
  },
  {
    id: 'fileMode',
    kind: 'text',
    place: 'advanced',
    label: fixed('File permissions'),
    help: () => 'Set on uploaded files, such as 644. Empty leaves the server to decide.',
    optional: true,
    visible: (server) => !isLocal(server),
    path: serverPath('options.remoteFileMode'),
    get: (_site, server) => serverOf(server).options.remoteFileMode ?? '',
    set: (_site, server, value) => {
      const target = serverOf(server);
      const mode = text(value);
      if (mode === undefined) {
        delete target.options.remoteFileMode;
      } else {
        target.options.remoteFileMode = mode;
      }
    },
  },
  {
    id: 'dirMode',
    kind: 'text',
    place: 'advanced',
    label: fixed('Folder permissions'),
    help: () => 'Set on folders the sync creates, such as 755. Empty leaves the server to decide.',
    optional: true,
    visible: (server) => !isLocal(server),
    path: serverPath('options.remoteDirMode'),
    get: (_site, server) => serverOf(server).options.remoteDirMode ?? '',
    set: (_site, server, value) => {
      const target = serverOf(server);
      const mode = text(value);
      if (mode === undefined) {
        delete target.options.remoteDirMode;
      } else {
        target.options.remoteDirMode = mode;
      }
    },
  },
];

/** Every field, by id. */
export const FIELDS: ReadonlyMap<string, Field> = new Map([...SITE_FIELDS, ...SERVER_FIELDS].map((field) => [field.id, field]));

/** True when the field belongs to the server editor. */
export function isServerField(field: Field): boolean {
  return field.place === 'basic' || field.place === 'advanced';
}

/** The category a problem path belongs to. */
export function categoryOf(path: string): Category {
  if (path.startsWith('servers') || path === 'remoteServerId' || path === 'testingServerId') {
    return 'servers';
  }
  if (path.startsWith('local.')) {
    return 'local';
  }
  if (path.startsWith('cloaking')) {
    return 'cloaking';
  }
  if (path.startsWith('sync.guard')) {
    return 'security';
  }
  return path.startsWith('sync') ? 'sync' : 'site';
}
