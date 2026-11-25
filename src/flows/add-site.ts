import path from 'node:path';
import {
  dreamweaverServerName,
  parseServerAddress,
  type DreamweaverServerCount,
  type NewServer,
  type NewSite,
  type Protocol,
  type ServerAddress,
} from '@isocialpractice/cmd-sync-servers';
import { escapeIcons } from '../status-text.ts';
import { BACK, type Back, type Choice, type ModalQuestion, type Prompter } from '../ui/prompt.ts';
import { pickRemoteRoot, resolveFolder, type FolderSource } from './remote-root.ts';

/** A connection made with the answers so far, before anything is saved. */
export interface Connection extends FolderSource {
  /** The folder the account opens in after signing in. */
  readonly startingFolder?: string | undefined;
  /** The settings as connected, with what the person decided on the way, such as another host the certificate covers. */
  readonly server: NewServer;
  close(): Promise<void>;
}

/** What Add Site connects with: the site's name, the server as answered, and the password typed. */
export interface ConnectRequest {
  readonly siteName: string;
  readonly server: NewServer;
  readonly password: string | undefined;
}

/** What connecting gave: the connection, or why it failed. */
export type ConnectResult =
  | { readonly ok: true; readonly connection: Connection }
  | { readonly ok: false; readonly code: string; readonly reason?: string | undefined; readonly message: string };

/** What Add Site needs to know before it asks. */
export interface AddSiteContext {
  /** The names already in use; a new name must differ ignoring case. */
  readonly existingNames: readonly string[];
  /** Where the folder picker opens: the first workspace folder, when there is one. */
  readonly startFolder?: string | undefined;
  /** Connects with the server as answered so far; `password` answers the password question. */
  readonly connect: (request: ConnectRequest) => Promise<ConnectResult>;
  /**
   * The servers Dreamweaver synchronized a local folder with, from its
   * `_notes/dwsync.xml` files, most used first. Without it, or with none
   * found, nothing is asked about them.
   */
  readonly dreamweaverServers?: (localRoot: string) => Promise<readonly DreamweaverServerCount[]>;
}

/** The answers of Add Site. */
export interface NewSiteAnswers {
  readonly site: NewSite;
  /** The password the server accepted, to save once the site is added. Never logged. */
  readonly password?: string;
  /** False when the person saved the server without testing it. */
  readonly tested: boolean;
}

/** The answer to Protocol: a protocol, or no server for now. */
export type ProtocolAnswer = Protocol | 'none';

/** The choices of Protocol, in the order the command line offers them. */
export const PROTOCOL_CHOICES: readonly Choice<ProtocolAnswer>[] = [
  { label: 'SFTP', description: 'Recommended', value: 'sftp' },
  { label: 'FTPS', description: 'FTP with explicit TLS', value: 'ftps' },
  { label: 'FTPS, implicit TLS', description: 'The older form, usually on port 990', value: 'ftps-implicit' },
  { label: 'FTP', description: 'Insecure: sends the password and files in clear text', value: 'ftp' },
  { label: 'Local or network folder', description: 'A folder, a mounted drive or a network share', value: 'local' },
  { label: 'No server yet', description: 'Add one later in Site Settings', value: 'none' },
];

/** The answers to the question asked in a folder that holds Dreamweaver's records. */
export const USE_DREAMWEAVER: Choice<boolean> = {
  label: "Use Dreamweaver's Sync Records",
  description: 'The files Dreamweaver last synchronized are in sync from the first preview',
  value: true,
};
export const SKIP_DREAMWEAVER: Choice<boolean> = { label: 'Do Not Use Them', value: false };
/** The placeholder of that question. */
export const DREAMWEAVER_PLACEHOLDER = 'This folder holds Dreamweaver synchronization records (_notes/dwsync.xml)';
/** The last answer when Dreamweaver's names are listed: the server is none of them. */
export const NONE_OF_THESE = 'None of These';

/** The button that accepts plain FTP. */
export const USE_FTP = 'Use FTP Anyway';
/** The button that allows deletes when the root directory is the top of the account. */
export const ALLOW_DELETES = 'Allow Deletes';
/** Asked when the root directory picked is "/", the top of what the account can see. */
export const ROOT_DELETES_QUESTION: ModalQuestion = {
  message: '"/" is the top of what this account can see. Let synchronizing delete files there?',
  detail: 'Every delete is listed in the preview first, and local files a sync replaces are kept for 14 days.',
  buttons: [ALLOW_DELETES],
  warning: true,
};

/** The choices offered when connecting fails. */
export type FailureChoice = 'host' | 'retry' | 'save' | 'cancel';
export const CHANGE_HOST: Choice<FailureChoice> = { label: 'Change the Host', value: 'host' };
export const TRY_AGAIN: Choice<FailureChoice> = { label: 'Try Again', description: 'With the user name and password again', value: 'retry' };
export const SAVE_WITHOUT_TESTING: Choice<FailureChoice> = { label: 'Save Without Testing', description: 'Choose the root directory by hand', value: 'save' };
export const CANCEL: Choice<FailureChoice> = { label: 'Cancel', description: 'Add nothing', value: 'cancel' };

const MAX_NAME = 120;
/** Refused sign-ins asked again before the choices are offered. */
const MAX_REFUSALS = 3;

function sameName(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
}

/** The problem with a site name, or `undefined` when it can be used. */
export function siteNameProblem(name: string, existingNames: readonly string[]): string | undefined {
  const trimmed = name.trim();
  if (trimmed === '') {
    return 'Enter a name for the site.';
  }
  if (trimmed.length > MAX_NAME) {
    return `Use at most ${String(MAX_NAME)} characters.`;
  }
  const clash = existingNames.find((existing) => sameName(existing, trimmed));
  return clash === undefined ? undefined : `A site named "${clash}" already exists.`;
}

/** The problem with what was typed in Host, as the engine reads it, or `undefined`. */
export function hostProblem(value: string): string | undefined {
  const parsed = parseServerAddress(value);
  return parsed.ok ? undefined : parsed.problem;
}

/** The problem with a root directory on a server, or `undefined` when it can be used. */
export function remoteRootProblem(value: string): string | undefined {
  return value.trim().startsWith('/') ? undefined : 'Enter a path that starts with "/", such as /var/www/my-site.';
}

/** True when two folders are the same or one holds the other. */
export function foldersOverlap(a: string, b: string): boolean {
  const inside = (parent: string, child: string): boolean => {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  };
  return inside(a, b) || inside(b, a);
}

/** True when two names Dreamweaver gives servers mean the same server: case and a final `/` do not count, as the engine compares them. */
export function sameDreamweaverName(a: string, b: string): boolean {
  const fold = (name: string): string => name.replace(/\/+$/, '').toLowerCase();
  return fold(a) === fold(b);
}

/** A name read from a `dwsync.xml`, as plain text for a quick pick: no control or bidi character, and no icon. */
export function shownDreamweaverName(name: string): string {
  return escapeIcons(name.replace(/[\p{Cc}\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '?'));
}

function filesText(count: number): string {
  return `${String(count)} ${count === 1 ? 'file' : 'files'}`;
}

/** What Add Site decided about Dreamweaver's records. */
export interface DreamweaverAnswer {
  readonly enabled: boolean;
  /** The name Dreamweaver gives the server, when it is not the one built from its host and root. */
  readonly server?: string;
}

/**
 * Asks whether a new site uses Dreamweaver's records, when its folder holds
 * some, and which of the servers Dreamweaver named is this one, when none
 * is the name built from its host and root. `after` is the step before, so
 * the questions carry on its count and Back can return to it.
 */
async function askDreamweaver(
  prompter: Prompter,
  context: AddSiteContext,
  localRoot: string,
  server: Pick<NewServer, 'name' | 'protocol' | 'host' | 'remoteRoot'> | undefined,
  after: number,
): Promise<DreamweaverAnswer | Back | undefined> {
  const names = (await context.dreamweaverServers?.(localRoot)) ?? [];
  if (names.length === 0) {
    return { enabled: false };
  }
  const built = server === undefined ? undefined : dreamweaverServerName({ ...server, options: {} });
  const unmatched = built !== undefined && !names.some((found) => sameDreamweaverName(found.server, built));
  const totalSteps = after + (unmatched ? 2 : 1);
  for (;;) {
    const use = await prompter.choose({
      title: 'Add Site',
      step: after + 1,
      totalSteps,
      placeholder: DREAMWEAVER_PLACEHOLDER,
      choices: [USE_DREAMWEAVER, SKIP_DREAMWEAVER],
      selected: true,
    });
    if (use === undefined || use === BACK) {
      return use;
    }
    if (!use) {
      return { enabled: false };
    }
    if (!unmatched || server === undefined) {
      return { enabled: true };
    }
    const chosen = await prompter.choose<string | null>({
      title: 'Add Site',
      step: after + 2,
      totalSteps,
      placeholder: `Which of the servers Dreamweaver synchronized this folder with is ${server.name}?`,
      choices: [
        ...names.map((found) => ({ label: shownDreamweaverName(found.server), description: filesText(found.files), value: found.server })),
        { label: NONE_OF_THESE, value: null },
      ],
    });
    if (chosen === undefined) {
      return undefined;
    }
    if (chosen !== BACK) {
      return chosen === null ? { enabled: true } : { enabled: true, server: chosen };
    }
  }
}

/** The site with Dreamweaver's records in use, and the server's name in them, when the answer says so. */
function withDreamweaver(site: NewSite, answer: DreamweaverAnswer): NewSite {
  if (!answer.enabled) {
    return site;
  }
  const named = answer.server;
  const servers = site.servers?.map((server) => (named === undefined ? server : { ...server, options: { ...(server.options ?? {}), dreamweaverServer: named } }));
  return { ...site, ...(servers === undefined ? {} : { servers }), sync: { dreamweaver: { enabled: true } } };
}

interface Draft {
  name: string;
  localRoot?: string;
  protocol?: ProtocolAnswer;
  host: string;
  username: string;
  password: string;
  folder?: string;
}

// Go on, finish here, ask the same step again, go back, or cancel.
type StepResult = 'next' | 'done' | 'again' | Back | undefined;

function totalSteps(protocol: ProtocolAnswer | undefined): number {
  if (protocol === 'none') {
    return 3;
  }
  return protocol === 'local' ? 4 : 6;
}

/** The server the answers describe, for connecting: the root is picked once connected. */
function draftServer(draft: Draft, address: ServerAddress): NewServer {
  const protocol = draft.protocol === undefined || draft.protocol === 'none' || draft.protocol === 'local' ? 'sftp' : draft.protocol;
  const username = draft.username.trim();
  return {
    name: address.host,
    protocol,
    host: address.host,
    ...(address.port === undefined ? {} : { port: address.port }),
    ...(username === '' ? {} : { username }),
    remoteRoot: '/',
    auth: { method: 'password', savePassword: false },
    ...(protocol === 'ftp' ? { options: { allowInsecure: true } } : {}),
  };
}

/**
 * Asks for a new site: its name, its local folder, and its first server as a
 * site manager entry: Protocol, Host, User and Password. Then it connects
 * before anything is saved, so a new host key or certificate is decided on,
 * a refused sign-in is asked again, and the root directory is picked from
 * what the server shows. Back returns to the previous question until it
 * connects; Escape or Cancel resolves `undefined` and adds nothing.
 */
export async function askNewSite(prompter: Prompter, context: AddSiteContext): Promise<NewSiteAnswers | undefined> {
  const draft: Draft = { name: '', host: '', username: '', password: '' };
  const title = 'Add Site';
  const position = (step: number): { title: string; step: number; totalSteps: number } => ({
    title,
    step,
    totalSteps: totalSteps(draft.protocol),
  });

  const text = async (step: number, key: 'name' | 'host' | 'username' | 'password', question: {
    prompt: string;
    placeholder?: string;
    password?: boolean;
    validate?: (value: string) => string | undefined;
  }): Promise<StepResult> => {
    const answer = await prompter.text({ ...position(step), ...question, value: draft[key] });
    if (typeof answer !== 'string') {
      return answer;
    }
    draft[key] = answer;
    return 'next';
  };
  const askHost = (): Promise<StepResult> =>
    text(4, 'host', {
      prompt: 'The FTP or SFTP host your hosting panel shows. host:port works when the port is not the usual one.',
      placeholder: 'Such as sftp.example.com',
      validate: hostProblem,
    });
  const askUser = (): Promise<StepResult> =>
    text(5, 'username', { prompt: 'The user name to sign in with. Many hosts name FTP accounts in full, such as demo-user@example.com.', placeholder: 'Such as demo-user' });
  const askPassword = (): Promise<StepResult> =>
    text(6, 'password', {
      prompt: "The password. It is sent only after the server is verified, and saved in VS Code's secret storage once the server accepts it.",
      password: true,
    });

  const steps: (() => Promise<StepResult>)[] = [
    () =>
      text(1, 'name', {
        prompt: 'The site name, unique among your sites.',
        placeholder: 'Such as My Site',
        validate: (value) => siteNameProblem(value, context.existingNames),
      }),
    async () => {
      const folder = await prompter.folder({
        title: `${title}: the local site folder of "${draft.name.trim()}"`,
        openLabel: 'Use as Local Site Folder',
        start: draft.localRoot ?? context.startFolder,
      });
      if (folder === undefined) {
        return BACK;
      }
      draft.localRoot = folder;
      return 'next';
    },
    async () => {
      const protocol = await prompter.choose({
        ...position(3),
        placeholder: 'Protocol: how to reach the first server',
        choices: PROTOCOL_CHOICES,
        selected: draft.protocol ?? 'sftp',
      });
      if (protocol === undefined || protocol === BACK) {
        return protocol;
      }
      if (protocol === 'ftp') {
        const choice = await prompter.modal({
          message: 'Plain FTP sends your password and files in clear text.',
          detail: 'Anyone on the network path can read and change them. Use SFTP or FTPS when the server offers either.',
          buttons: [USE_FTP],
          warning: true,
        });
        if (choice !== USE_FTP) {
          return 'again';
        }
      }
      draft.protocol = protocol;
      return protocol === 'none' ? 'done' : 'next';
    },
    async () => {
      if (draft.protocol !== 'local') {
        return askHost();
      }
      for (;;) {
        const folder = await prompter.folder({
          title: `${title}: the folder the site is published to`,
          openLabel: 'Use as Server Folder',
          start: draft.folder,
        });
        if (folder === undefined) {
          return BACK;
        }
        if (draft.localRoot !== undefined && foldersOverlap(draft.localRoot, folder)) {
          void prompter.error('Choose a folder outside the local site folder. A site cannot be published into itself.');
          continue;
        }
        draft.folder = folder;
        return 'done';
      }
    },
    async () => {
      // An address that names its user, such as user@host, fills User.
      const parsed = parseServerAddress(draft.host);
      if (parsed.ok && parsed.address.username !== undefined && draft.username === '') {
        draft.username = parsed.address.username;
      }
      return askUser();
    },
    askPassword,
  ];

  let index = 0;
  for (;;) {
    let finishedEarly = false;
    while (index < steps.length) {
      const step = steps[index];
      const result = step === undefined ? undefined : await step();
      if (result === undefined) {
        return undefined;
      }
      if (result === BACK) {
        index = Math.max(0, index - 1);
      } else if (result === 'done') {
        finishedEarly = true;
        break;
      } else if (result === 'next') {
        index += 1;
      }
    }
    const name = draft.name.trim();
    const localRoot = draft.localRoot ?? '';
    let site: NewSite;
    let tested: boolean;
    if (draft.protocol === undefined || draft.protocol === 'none') {
      site = { name, localRoot };
      tested = false;
    } else if (draft.protocol === 'local' || (finishedEarly && draft.folder !== undefined)) {
      const folder = draft.folder ?? '';
      site = { name, localRoot, servers: [{ name: path.basename(folder) || 'Local folder', protocol: 'local', remoteRoot: folder }] };
      tested = true;
    } else {
      return connectAndPick(prompter, context, draft, { name, localRoot }, { askHost, askUser, askPassword });
    }
    // Back from Dreamweaver's question asks the step that finished the answers again: Protocol, or the folder.
    const dreamweaver = await askDreamweaver(prompter, context, localRoot, site.servers?.[0], totalSteps(draft.protocol));
    if (dreamweaver === undefined) {
      return undefined;
    }
    if (dreamweaver !== BACK) {
      return { site: withDreamweaver(site, dreamweaver), tested };
    }
  }
}

/** Connects with the answers, offers fixes when that fails, then picks the root and asks about deletes at the top. */
async function connectAndPick(
  prompter: Prompter,
  context: AddSiteContext,
  draft: Draft,
  site: { readonly name: string; readonly localRoot: string },
  ask: { readonly askHost: () => Promise<StepResult>; readonly askUser: () => Promise<StepResult>; readonly askPassword: () => Promise<StepResult> },
): Promise<NewSiteAnswers | undefined> {
  const again = async (question: () => Promise<StepResult>): Promise<boolean> => {
    const result = await question();
    return result !== undefined && result !== BACK;
  };
  let refusals = 0;
  let connection: Connection | undefined;
  for (;;) {
    const parsed = parseServerAddress(draft.host);
    if (!parsed.ok) {
      if (!(await again(ask.askHost))) {
        return undefined;
      }
      continue;
    }
    const address = parsed.address;
    if (address.protocol !== undefined) {
      draft.protocol = address.protocol;
    }
    const result = await context.connect({ siteName: site.name, server: draftServer(draft, address), password: draft.password === '' ? undefined : draft.password });
    if (result.ok) {
      connection = result.connection;
      break;
    }
    if (result.code === 'E_CANCELLED') {
      return undefined;
    }
    void prompter.error(result.message);
    const refused = result.code === 'E_AUTH' && (result.reason === 'rejected' || result.reason === 'missing');
    if (refused) {
      refusals += 1;
      if (refusals < MAX_REFUSALS) {
        if (!(await again(ask.askUser)) || !(await again(ask.askPassword))) {
          return undefined;
        }
        continue;
      }
    }
    const choice = await prompter.choose({
      title: 'Add Site: the connection failed',
      placeholder: 'What now?',
      choices: [refused ? TRY_AGAIN : CHANGE_HOST, SAVE_WITHOUT_TESTING, CANCEL],
    });
    if (choice === undefined || choice === BACK || choice === 'cancel') {
      return undefined;
    }
    if (choice === 'save') {
      break;
    }
    if (choice === 'retry') {
      refusals = 0;
      if (!(await again(ask.askUser)) || !(await again(ask.askPassword))) {
        return undefined;
      }
    } else if (!(await again(ask.askHost))) {
      return undefined;
    }
  }

  const parsed = parseServerAddress(draft.host);
  const address: ServerAddress = parsed.ok ? parsed.address : { host: draft.host };
  const tested = connection !== undefined;
  const password = tested && draft.password !== '' ? draft.password : undefined;
  const server: NewServer = connection?.server ?? draftServer(draft, address);
  let typedRoot = address.remoteRoot ?? '/';
  let picked = false;
  try {
    // Back from Dreamweaver's question asks for the root directory again.
    for (;;) {
      let root: string | undefined;
      if (connection === undefined) {
        const typed = await prompter.text({
          title: 'Add Site: the root directory',
          prompt: 'The folder on the server the site is published to, as the account sees it. The connection was not tested.',
          value: typedRoot,
          validate: remoteRootProblem,
        });
        if (typeof typed !== 'string') {
          return undefined;
        }
        root = typed.trim();
        typedRoot = root;
      } else {
        const start = connection.startingFolder ?? '/';
        const wanted = address.remoteRoot === undefined || picked ? undefined : resolveFolder(address.remoteRoot, start);
        root = wanted !== undefined && (await connection.exists(wanted)) ? wanted : await pickRemoteRoot(prompter, connection, start);
        picked = true;
        if (root === undefined) {
          return undefined;
        }
      }
      const options: NonNullable<NewServer['options']> = { ...(server.options ?? {}) };
      if (root === '/') {
        const choice = await prompter.modal(ROOT_DELETES_QUESTION);
        if (choice === ALLOW_DELETES) {
          options.allowRootDeletes = true;
        }
      }
      const saved: NewServer = {
        ...server,
        name: server.host ?? address.host,
        remoteRoot: root,
        auth: { method: 'password', savePassword: password !== undefined },
        ...(Object.keys(options).length === 0 ? {} : { options }),
      };
      const dreamweaver = await askDreamweaver(prompter, context, site.localRoot, saved, totalSteps(draft.protocol));
      if (dreamweaver === undefined) {
        return undefined;
      }
      if (dreamweaver !== BACK) {
        const answered = withDreamweaver({ name: site.name, localRoot: site.localRoot, servers: [saved] }, dreamweaver);
        return { site: answered, ...(password === undefined ? {} : { password }), tested };
      }
    }
  } finally {
    await connection?.close();
  }
}
