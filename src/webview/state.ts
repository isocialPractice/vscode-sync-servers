/**
 * The state of the Site Settings form and every change to it, without a DOM.
 * The form edits a draft of the site; Save sends the draft, Revert puts the
 * saved site back.
 */
import type { FromWebview, PickTarget, ToWebview } from '../shared/messages.ts';
import type { ServerData, SiteData } from '../shared/site-data.ts';
import { categoryOf, FIELDS, isServerField, SERVER_FIELDS, splitHostPort, tidyTls, type Category, type Field, type ServerTab } from './fields.ts';

/** The outcome of a connection test, shown under the Test button. */
export interface TestResult {
  readonly running: boolean;
  readonly ok?: boolean;
  readonly text: string;
}

/** Everything the form shows. */
export interface State {
  readonly saved: SiteData;
  readonly draft: SiteData;
  readonly passwordSaved: Readonly<Record<string, boolean>>;
  readonly builtInGuard: readonly string[];
  /** The cloaking patterns every site uses before its own. */
  readonly globalPatterns: readonly string[];
  readonly category: Category;
  readonly advancedOpen: boolean;
  /** The server open in the editor. */
  readonly editing: string | undefined;
  readonly tab: ServerTab;
  /** The server chosen in the servers table. */
  readonly selected: string | undefined;
  /** Text as typed, by problem path, for numbers and pattern lists. */
  readonly raw: Readonly<Record<string, string>>;
  /** Problems the form found, by problem path. */
  readonly local: Readonly<Record<string, string>>;
  /** Problems the last save reported, by problem path. */
  readonly remote: Readonly<Record<string, string>>;
  /** Problems the last save reported that belong to no field. */
  readonly general: readonly string[];
  readonly tests: Readonly<Record<string, TestResult>>;
  /** The live count of cloaked files. */
  readonly cloak: string;
  /** The line in the footer, read out by screen readers. */
  readonly status: string;
}

/** What a control does, kept as data on the element. */
export type Action =
  | { readonly type: 'navigate'; readonly category: Category }
  | { readonly type: 'toggleAdvanced' }
  | { readonly type: 'field'; readonly field: string }
  | { readonly type: 'select'; readonly serverId: string }
  | { readonly type: 'remote'; readonly serverId: string }
  | { readonly type: 'testing'; readonly serverId: string | null }
  | { readonly type: 'addServer' }
  | { readonly type: 'editServer' }
  | { readonly type: 'duplicateServer' }
  | { readonly type: 'removeServer' }
  | { readonly type: 'closeEditor' }
  | { readonly type: 'tab'; readonly tab: ServerTab }
  | { readonly type: 'browse'; readonly target: PickTarget }
  | { readonly type: 'test'; readonly serverId: string }
  | { readonly type: 'setPassword'; readonly serverId: string }
  | { readonly type: 'forgetPassword'; readonly serverId: string }
  | { readonly type: 'forgetHostKey'; readonly serverId: string }
  | { readonly type: 'forgetCertificate'; readonly serverId: string }
  | { readonly type: 'uncloak'; readonly path: string }
  | { readonly type: 'editGlobalPatterns' }
  | { readonly type: 'save' }
  | { readonly type: 'cancel' }
  | { readonly type: 'revert' };

/** The result of a change: the new state, the messages to send, and whether to move focus to the first problem. */
export interface Update {
  readonly state: State;
  readonly messages: readonly FromWebview[];
  readonly focusProblem: boolean;
}

/** Makes a random UUID; the webview passes one built on `crypto.getRandomValues`. */
export type NewId = () => string;

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Deep equality of two JSON values, ignoring key order and keys whose value is `undefined`. */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => sameData(item, b[index]));
  }
  const left = Object.entries(a).filter(([, value]) => value !== undefined);
  const right = Object.entries(b).filter(([, value]) => value !== undefined);
  return left.length === right.length && left.every(([key, value]) => sameData(value, (b as Record<string, unknown>)[key]));
}

/** True when the draft differs from the saved site. */
export function isDirty(state: State): boolean {
  return !sameData(state.draft, state.saved);
}

/** The server being edited in the draft, with its index. */
export function editedServer(state: State): { server: ServerData; index: number } | undefined {
  const index = state.draft.servers.findIndex((server) => server.id === state.editing);
  const server = state.draft.servers[index];
  return server === undefined ? undefined : { server, index };
}

/** True when a server is saved and unchanged, so Test and Set Password act on what the form shows. */
export function isSavedAsShown(state: State, serverId: string): boolean {
  const saved = state.saved.servers.find((server) => server.id === serverId);
  const draft = state.draft.servers.find((server) => server.id === serverId);
  return saved !== undefined && draft !== undefined && sameData(saved, draft);
}

/** The problem shown for a field, by its problem path. */
export function problemAt(state: State, path: string): string | undefined {
  return state.local[path] ?? state.remote[path];
}

/** Every problem path that has a problem now. */
export function problemPaths(state: State): string[] {
  return [...new Set([...Object.keys(state.local), ...Object.keys(state.remote)])];
}

/** The state for a site just loaded or saved. */
export function loaded(message: Extract<ToWebview, { type: 'load' }>): State {
  const server = message.editServerId === undefined ? undefined : message.site.servers.find((candidate) => candidate.id === message.editServerId);
  return {
    saved: message.site,
    draft: clone(message.site),
    passwordSaved: message.passwordSaved,
    builtInGuard: message.builtInGuard,
    globalPatterns: message.globalPatterns,
    category: server === undefined ? 'site' : 'servers',
    advancedOpen: false,
    editing: server?.id,
    tab: 'basic',
    selected: server?.id ?? message.site.remoteServerId ?? message.site.servers[0]?.id,
    raw: {},
    local: {},
    remote: {},
    general: [],
    tests: {},
    cloak: '',
    status: '',
  };
}

function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([candidate]) => candidate !== key));
}

function withoutServerKeys<T>(record: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([path]) => !path.startsWith('servers.')));
}

function numberProblem(field: Field, value: string): string | undefined {
  const rule = field.number;
  if (rule === undefined) {
    return undefined;
  }
  if (value.trim() === '') {
    return rule.optional ? undefined : 'Enter a number.';
  }
  const number = Number(value);
  if (!Number.isFinite(number) || (rule.integer && !Number.isInteger(number))) {
    return rule.integer ? 'Enter a whole number.' : 'Enter a number.';
  }
  return number < rule.min || number > rule.max ? `Enter a number from ${String(rule.min)} to ${String(rule.max)}.` : undefined;
}

function textProblem(field: Field, value: string): string | undefined {
  if (field.required === true && value.trim() === '') {
    return 'This field is needed.';
  }
  if ((field.id === 'fileMode' || field.id === 'dirMode') && value !== '' && !/^[0-7]{3,4}$/.test(value)) {
    return 'Enter an octal mode, such as 644.';
  }
  return undefined;
}

function uniqueName(base: string, taken: readonly string[]): string {
  const lower = new Set(taken.map((name) => name.toLowerCase()));
  for (let count = 1; ; count += 1) {
    const name = count === 1 ? base : `${base} ${String(count)}`;
    if (!lower.has(name.toLowerCase())) {
      return name;
    }
  }
}

function countRequest(draft: SiteData): FromWebview {
  return { type: 'countCloaked', cloaking: clone(draft.cloaking) };
}

/** Applies one change typed or chosen in a field. */
function changeField(state: State, field: Field, value: string | boolean): Update {
  const draft = clone(state.draft);
  const edited = isServerField(field) ? editedServer({ ...state, draft }) : undefined;
  if (isServerField(field) && edited === undefined) {
    return { state, messages: [], focusProblem: false };
  }
  const path = field.path(edited?.index ?? -1);
  let raw = withoutKey(state.raw, path);
  let local = withoutKey(state.local, path);
  const remote = withoutKey(state.remote, path);
  if (field.kind === 'number' && typeof value === 'string') {
    const problem = numberProblem(field, value);
    if (problem === undefined) {
      field.set(draft, edited?.server, value.trim() === '' ? undefined : Number(value));
    } else {
      raw = { ...raw, [path]: value };
      local = { ...local, [path]: problem };
    }
  } else {
    if (typeof value === 'string') {
      const problem = textProblem(field, value);
      if (problem !== undefined) {
        local = { ...local, [path]: problem };
      }
      if (field.kind === 'patterns') {
        raw = { ...raw, [path]: value };
      }
    }
    field.set(draft, edited?.server, value);
  }
  const next: State = { ...state, draft, raw, local, remote, status: '' };
  const messages = field.place === 'cloaking' ? [countRequest(draft)] : [];
  return { state: next, messages, focusProblem: false };
}

/** Moves a port typed in Host into Port, for every server, with a problem where they disagree. */
function readHosts(state: State, only?: string): State {
  const draft = clone(state.draft);
  let local = { ...state.local };
  draft.servers.forEach((server, index) => {
    if (only !== undefined && server.id !== only) {
      return;
    }
    const problem = splitHostPort(server);
    const path = `servers.${String(index)}.host`;
    if (problem === undefined) {
      if (local[path]?.startsWith('Host gives port') === true || local[path]?.startsWith('The port must') === true) {
        local = withoutKey(local, path);
      }
    } else {
      local = { ...local, [path]: problem };
    }
  });
  return { ...state, draft, local };
}

/** The problem `readHosts` found with a server's Host, which stops Test and Browse... until it is fixed. */
function hostProblemOf(state: State, serverId: string): string | undefined {
  const index = state.draft.servers.findIndex((server) => server.id === serverId);
  return state.local[`servers.${String(index)}.host`];
}

function firstServerProblem(state: State, serverId: string): string | undefined {
  const index = state.draft.servers.findIndex((server) => server.id === serverId);
  return problemPaths(state).find((path) => path.startsWith(`servers.${String(index)}.`));
}

/** Applies an action. `value` is what the control holds, for field actions. */
export function update(state: State, action: Action, value: string | boolean | undefined, newId: NewId): Update {
  const same = (next: State, messages: readonly FromWebview[] = []): Update => ({ state: next, messages, focusProblem: false });
  switch (action.type) {
    case 'navigate': {
      const advanced = action.category !== 'site' && action.category !== 'servers';
      const next = { ...state, category: action.category, editing: undefined, advancedOpen: state.advancedOpen || advanced };
      return same(next, action.category === 'cloaking' ? [countRequest(state.draft)] : []);
    }
    case 'toggleAdvanced':
      return same({ ...state, advancedOpen: !state.advancedOpen });
    case 'field': {
      const field = FIELDS.get(action.field);
      return field === undefined || value === undefined ? same(state) : changeField(state, field, value);
    }
    case 'select':
      return same({ ...state, selected: action.serverId });
    case 'remote': {
      const draft = clone(state.draft);
      draft.remoteServerId = action.serverId;
      return same({ ...state, draft, selected: action.serverId });
    }
    case 'testing': {
      const draft = clone(state.draft);
      if (action.serverId === null) {
        delete draft.testingServerId;
      } else {
        draft.testingServerId = action.serverId;
      }
      return same({ ...state, draft });
    }
    case 'addServer': {
      const draft = clone(state.draft);
      const id = newId();
      draft.servers.push({
        id,
        name: uniqueName('New server', draft.servers.map((server) => server.name)),
        protocol: 'sftp',
        remoteRoot: '/',
        options: { passive: true, timeoutSeconds: 30, uploadOnSave: false },
      });
      draft.remoteServerId ??= id;
      return same({ ...state, draft, selected: id, editing: id, tab: 'basic', status: 'Added a server. It is saved with the site.' });
    }
    case 'editServer':
      return state.selected === undefined ? same(state) : same({ ...state, editing: state.selected, tab: 'basic' });
    case 'duplicateServer': {
      const index = state.draft.servers.findIndex((server) => server.id === state.selected);
      const original = state.draft.servers[index];
      if (original === undefined) {
        return same(state);
      }
      const draft = clone(state.draft);
      const copy = clone(original);
      copy.id = newId();
      copy.name = uniqueName(`${original.name} copy`, draft.servers.map((server) => server.name));
      delete copy.options.hostKey;
      if (copy.auth !== undefined) {
        copy.auth.savePassword = false;
      }
      draft.servers.splice(index + 1, 0, copy);
      return same({
        ...state,
        draft,
        selected: copy.id,
        raw: withoutServerKeys(state.raw),
        local: withoutServerKeys(state.local),
        remote: withoutServerKeys(state.remote),
        status: `Added "${copy.name}", a copy of "${original.name}".`,
      });
    }
    case 'removeServer': {
      const index = state.draft.servers.findIndex((server) => server.id === state.selected);
      const removed = state.draft.servers[index];
      if (removed === undefined) {
        return same(state);
      }
      const draft = clone(state.draft);
      draft.servers.splice(index, 1);
      if (draft.remoteServerId === removed.id) {
        const first = draft.servers[0];
        if (first === undefined) {
          delete draft.remoteServerId;
        } else {
          draft.remoteServerId = first.id;
        }
      }
      if (draft.testingServerId === removed.id) {
        delete draft.testingServerId;
      }
      const neighbour = draft.servers[Math.min(index, draft.servers.length - 1)];
      // Server problems are kept by position, which this changes.
      return same({
        ...state,
        draft,
        selected: neighbour?.id,
        editing: undefined,
        raw: withoutServerKeys(state.raw),
        local: withoutServerKeys(state.local),
        remote: withoutServerKeys(state.remote),
        status: `Removed "${removed.name}". Revert brings it back until you save.`,
      });
    }
    case 'closeEditor':
      return same({ ...state, editing: undefined });
    case 'tab':
      return same({ ...state, tab: action.tab });
    case 'browse': {
      if (action.target.kind !== 'remoteRoot') {
        return same(state, [{ type: 'browse', target: action.target }]);
      }
      const serverId = action.target.serverId;
      const read = readHosts(state, serverId);
      const server = read.draft.servers.find((candidate) => candidate.id === serverId);
      const problem = hostProblemOf(read, serverId);
      if (server === undefined || problem !== undefined) {
        return same(problem === undefined ? state : { ...read, status: problem });
      }
      return same(read, [{ type: 'browse', target: action.target, server: clone(server) }]);
    }
    case 'test': {
      // The test connects with what the form shows, saved or not.
      const read = readHosts(state, action.serverId);
      const server = read.draft.servers.find((candidate) => candidate.id === action.serverId);
      const problem = hostProblemOf(read, action.serverId);
      if (server === undefined || problem !== undefined) {
        return same(problem === undefined ? state : { ...read, status: problem });
      }
      return same(
        { ...read, tests: { ...read.tests, [action.serverId]: { running: true, text: 'Testing...' } } },
        [{ type: 'test', serverId: action.serverId, server: clone(server) }],
      );
    }
    case 'setPassword':
    case 'forgetPassword':
      if (!isSavedAsShown(state, action.serverId)) {
        return same({ ...state, status: 'Save the site first, so the password is tied to what the form shows.' });
      }
      return same(state, [{ type: action.type, serverId: action.serverId }]);
    case 'forgetHostKey': {
      const draft = clone(state.draft);
      const server = draft.servers.find((candidate) => candidate.id === action.serverId);
      if (server !== undefined) {
        delete server.options.hostKey;
      }
      return same({ ...state, draft, status: 'The pinned host key is forgotten when you save. The next connection asks about the key again.' });
    }
    case 'forgetCertificate': {
      const draft = clone(state.draft);
      const server = draft.servers.find((candidate) => candidate.id === action.serverId);
      if (server?.options.tls !== undefined) {
        delete server.options.tls.trustedCertificate;
        tidyTls(server);
      }
      return same({ ...state, draft, status: 'The trusted certificate is forgotten when you save. The next connection verifies the certificate again.' });
    }
    case 'editGlobalPatterns':
      return same(state, [{ type: 'editGlobalPatterns' }]);
    case 'uncloak': {
      const draft = clone(state.draft);
      draft.cloaking.paths = draft.cloaking.paths.filter((path) => path !== action.path);
      return same({ ...state, draft, status: `${action.path} is no longer cloaked once you save.` }, [countRequest(draft)]);
    }
    case 'save': {
      const read = readHosts(state);
      const local = Object.entries(read.local);
      if (local.length > 0) {
        const [path] = local[0] ?? [''];
        const server = /^servers\.(\d+)\./.exec(path);
        const target = server === null ? undefined : read.draft.servers[Number(server[1])];
        const field = SERVER_FIELDS.find((candidate) => candidate.path(Number(server?.[1] ?? -1)) === path);
        return {
          state: {
            ...read,
            category: categoryOf(path),
            advancedOpen: read.advancedOpen || !['site', 'servers'].includes(categoryOf(path)),
            editing: target?.id ?? read.editing,
            tab: field?.place === 'advanced' ? 'advanced' : field === undefined ? read.tab : 'basic',
            status: `Fix the ${local.length === 1 ? 'problem' : `${String(local.length)} problems`} marked in the form before saving.`,
          },
          messages: [],
          focusProblem: true,
        };
      }
      return same({ ...read, status: 'Saving...' }, [{ type: 'save', site: clone(read.draft) }]);
    }
    case 'cancel':
      return same(state, [{ type: 'cancel', dirty: isDirty(state) }]);
    case 'revert':
      return same(
        { ...state, draft: clone(state.saved), raw: {}, local: {}, remote: {}, general: [], editing: undefined, status: 'The saved settings are back.' },
        [countRequest(state.saved)],
      );
  }
}

/** Applies a message from the extension. Returns the new state, or `undefined` while nothing is loaded. */
export function receive(state: State | undefined, message: ToWebview): { state: State | undefined; focusProblem: boolean } {
  if (message.type === 'load') {
    return { state: loaded(message), focusProblem: false };
  }
  if (state === undefined) {
    return { state, focusProblem: false };
  }
  switch (message.type) {
    case 'saved': {
      const editing = message.site.servers.some((server) => server.id === state.editing) ? state.editing : undefined;
      return {
        state: {
          ...state,
          saved: message.site,
          draft: clone(message.site),
          passwordSaved: message.passwordSaved,
          editing,
          raw: {},
          local: {},
          remote: {},
          general: [],
          status: message.message,
        },
        focusProblem: false,
      };
    }
    case 'serverState': {
      const draft = clone(state.draft);
      for (const server of draft.servers) {
        const saved = message.site.servers.find((candidate) => candidate.id === server.id);
        if (saved === undefined) {
          continue;
        }
        if (saved.auth !== undefined) {
          server.auth ??= { method: saved.auth.method, savePassword: false };
          server.auth.savePassword = saved.auth.savePassword;
        }
        if (saved.options.hostKey === undefined) {
          delete server.options.hostKey;
        } else {
          server.options.hostKey = clone(saved.options.hostKey);
        }
      }
      return { state: { ...state, saved: message.site, draft, passwordSaved: message.passwordSaved }, focusProblem: false };
    }
    case 'globalPatterns':
      return { state: { ...state, globalPatterns: message.patterns }, focusProblem: false };
    case 'problems': {
      const remote: Record<string, string> = {};
      const general: string[] = [];
      const known = new Set<string>();
      state.draft.servers.forEach((_server, index) => {
        for (const field of SERVER_FIELDS) {
          known.add(field.path(index));
        }
      });
      for (const field of FIELDS.values()) {
        if (!isServerField(field)) {
          known.add(field.path(-1));
        }
      }
      for (const problem of message.problems) {
        if (known.has(problem.path)) {
          remote[problem.path] ??= problem.message;
        } else {
          general.push(problem.path === '' ? problem.message : `${problem.path}: ${problem.message}`);
        }
      }
      const [first] = message.problems;
      const server = first === undefined ? null : /^servers\.(\d+)\./.exec(first.path);
      const target = server === null ? undefined : state.draft.servers[Number(server[1])];
      const field = first === undefined ? undefined : SERVER_FIELDS.find((candidate) => candidate.path(Number(server?.[1] ?? -1)) === first.path);
      const category = first === undefined ? state.category : categoryOf(first.path);
      return {
        state: {
          ...state,
          remote,
          general,
          category,
          advancedOpen: state.advancedOpen || !['site', 'servers'].includes(category),
          editing: target?.id ?? (category === 'servers' ? state.editing : undefined),
          tab: field?.place === 'advanced' ? 'advanced' : field === undefined ? state.tab : 'basic',
          status: message.message,
        },
        focusProblem: true,
      };
    }
    case 'picked': {
      const draft = clone(state.draft);
      const target = message.target;
      if (target.kind === 'localRoot') {
        draft.localRoot = message.path;
      } else {
        const server = draft.servers.find((candidate) => candidate.id === target.serverId);
        if (server !== undefined) {
          const field = { serverFolder: 'remoteRoot', remoteRoot: 'remoteRoot', keyFile: 'keyPath', caFile: 'caFile' }[target.kind];
          FIELDS.get(field)?.set(draft, server, message.path);
        }
      }
      const index = target.kind === 'localRoot' ? -1 : draft.servers.findIndex((candidate) => candidate.id === target.serverId);
      const local = target.kind === 'remoteRoot' ? withoutKey(state.local, `servers.${String(index)}.remoteRoot`) : state.local;
      const status = target.kind === 'remoteRoot' ? `Root directory: ${message.path}. Save to keep it.` : state.status;
      return { state: { ...state, draft, local, status }, focusProblem: false };
    }
    case 'decided': {
      const draft = clone(state.draft);
      const server = draft.servers.find((candidate) => candidate.id === message.serverId);
      if (server === undefined) {
        return { state, focusProblem: false };
      }
      const { decisions } = message;
      if (decisions.host !== undefined) {
        server.host = decisions.host;
      }
      if (decisions.servername !== undefined || decisions.trustedCertificate !== undefined) {
        server.options.tls ??= { minVersion: 'TLSv1.2' };
        if (decisions.servername !== undefined) {
          server.options.tls.servername = decisions.servername;
        }
        if (decisions.trustedCertificate !== undefined) {
          server.options.tls.trustedCertificate = clone(decisions.trustedCertificate);
        }
      }
      if (decisions.hostKey !== undefined) {
        server.options.hostKey = clone(decisions.hostKey);
      }
      if (decisions.allowRootDeletes !== undefined) {
        if (decisions.allowRootDeletes) {
          server.options.allowRootDeletes = true;
        } else {
          delete server.options.allowRootDeletes;
        }
      }
      return { state: { ...state, draft, status: 'What the connection decided is in the form. Save to keep it.' }, focusProblem: false };
    }
    case 'testResult':
      return {
        state: { ...state, tests: { ...state.tests, [message.serverId]: { running: false, ok: message.ok, text: message.text } }, status: message.text },
        focusProblem: false,
      };
    case 'cloakCount': {
      const what = `${String(message.files)} file${message.files === 1 ? '' : 's'} and ${String(message.folders)} folder${message.folders === 1 ? '' : 's'}`;
      const cloak = !message.enabled
        ? 'Cloaking is off, so nothing is cloaked.'
        : `Cloaks ${message.complete ? '' : 'at least '}${what} in the local folder.`;
      return { state: { ...state, cloak }, focusProblem: false };
    }
  }
}

/** Problem paths that belong to the server with this index. */
export function serverHasProblems(state: State, serverId: string): boolean {
  return firstServerProblem(state, serverId) !== undefined;
}
