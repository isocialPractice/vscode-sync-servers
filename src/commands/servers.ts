import { isSyncError, sealSecret, SyncSession, type SecretKind, type Server } from '@isocialpractice/cmd-sync-servers';
import * as vscode from 'vscode';
import { certificateOf, errorText, hostProblem } from '../error-text.ts';
import { ALLOW_DELETES, ROOT_DELETES_QUESTION } from '../flows/add-site.ts';
import { pickRemoteRoot } from '../flows/remote-root.ts';
import { SAVE_PASSWORD } from '../host.ts';
import { takesSecret } from '../views/site-rows.ts';
import { openProbe } from './probe.ts';
import { chooseServer, requireSites, type ServerTarget, type Services } from './services.ts';
import { SECRET_KINDS } from './sites.ts';

/** The button of the Reset Sync Information confirmation. */
export const RESET = 'Reset';

function describe({ site, server }: ServerTarget): string {
  return `"${site.name}: ${server.name}"`;
}

function secretLabel(kind: SecretKind): string {
  return kind === 'password' ? 'password' : 'key passphrase';
}

async function withSession<T>(services: Services, target: ServerTarget, work: (session: SyncSession) => Promise<T>): Promise<T> {
  const session = await SyncSession.open({
    registry: services.model.registry(),
    siteId: target.site.id,
    serverId: target.server.id,
    host: services.host,
  });
  try {
    return await work(session);
  } finally {
    await session.close();
  }
}

/** What a connection test found, in words for a message. */
export interface ConnectionTestOutcome {
  readonly ok: boolean;
  readonly cancelled: boolean;
  /** True when signing in failed, so Set Password may help. */
  readonly auth: boolean;
  readonly text: string;
  /** The engine's error when the test failed, for the repair it offers. */
  readonly error?: unknown;
}

/** Connects, signs in and lists the root folder, with a cancellable progress notification. */
export async function runConnectionTest(services: Services, target: ServerTarget): Promise<ConnectionTestOutcome> {
  const name = describe(target);
  try {
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Testing ${name}`, cancellable: true },
      (_progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => {
          controller.abort();
        });
        return withSession(services, target, (session) => session.testConnection(controller.signal));
      },
    );
    services.logger.info('Connection test passed', {
      siteId: target.site.id,
      serverId: target.server.id,
      protocol: result.protocol,
      software: result.software,
      tls: result.tls,
      hostKey: result.hostKey?.fingerprint,
      features: result.features,
      rootEntries: result.rootEntries,
    });
    const software = result.software === undefined ? '' : ` The server is ${result.software}.`;
    return { ok: true, cancelled: false, auth: false, text: `Connected to ${name}. Its root folder holds ${String(result.rootEntries)} item(s).${software}` };
  } catch (error) {
    if (isSyncError(error, 'E_CANCELLED')) {
      return { ok: false, cancelled: true, auth: false, text: `The test of ${name} was cancelled.` };
    }
    const text = errorText(error);
    services.logger.error('Connection test failed', { siteId: target.site.id, serverId: target.server.id, problem: text });
    return { ok: false, cancelled: false, auth: isSyncError(error, 'E_AUTH'), text: `Could not connect to ${name}. ${text}`, error };
  }
}

/** The repairs Test Connection offers after a failure. */
export const CHOOSE_FOLDER = 'Choose Folder';
export const SIGN_IN_AGAIN = 'Sign In Again';
export const EDIT_HOST = 'Edit Host';
export const OPEN_SETTINGS = 'Site Settings';
export const SET_PASSWORD = 'Set Password...';

/** The actions for a failed test: the repair that fits the error first, then Show Log. */
export function repairActions(server: Server, error: unknown): string[] {
  const actions: string[] = [];
  if (isSyncError(error, 'E_REMOTE_ROOT')) {
    // A local folder server's folder is chosen in Site Settings, with the system's folder dialog.
    actions.push(server.protocol === 'local' ? OPEN_SETTINGS : CHOOSE_FOLDER);
  } else if (isSyncError(error, 'E_AUTH')) {
    if (error.details?.reason === 'rejected' && server.auth?.method === 'password') {
      actions.push(SIGN_IN_AGAIN);
    } else if (takesSecret(server)) {
      actions.push(SET_PASSWORD);
    }
  } else if (hostProblem(error) !== undefined || (certificateOf(error)?.coveredNames.length ?? 0) > 0) {
    actions.push(EDIT_HOST);
  }
  return [...actions, 'Show Log'];
}

/** The server as it is saved now, after a repair changed it. */
function fresh(services: Services, target: ServerTarget): ServerTarget | undefined {
  const site = services.model.site(target.site.id);
  const server = site?.servers.find((candidate) => candidate.id === target.server.id);
  return site === undefined || server === undefined ? undefined : { site, server };
}

/**
 * Choose Folder: connects, opens the remote root picker where the account
 * starts, saves the folder picked as the root directory and tests again.
 */
async function chooseFolder(services: Services, target: ServerTarget, error: unknown): Promise<void> {
  const prompter = services.prompter();
  const { site, server } = target;
  let picked: string | undefined;
  try {
    const { probe } = await openProbe(services, { site, server, title: `Connecting to ${server.host ?? server.name}`, savedServer: true });
    try {
      const start = (isSyncError(error) ? error.details?.startingFolder : undefined) ?? probe.startingFolder ?? '/';
      picked = await pickRemoteRoot(prompter, probe, start);
    } finally {
      await probe.close();
    }
  } catch (failure) {
    if (!isSyncError(failure, 'E_CANCELLED')) {
      void prompter.error(`Could not connect to ${describe(target)}. ${errorText(failure)}`, ['Show Log']).then((choice) => {
        if (choice === 'Show Log') {
          services.showLog();
        }
      });
    }
    return;
  }
  if (picked === undefined) {
    return;
  }
  let allowRootDeletes = server.options.allowRootDeletes === true;
  if (picked === '/' && !allowRootDeletes) {
    allowRootDeletes = (await prompter.modal(ROOT_DELETES_QUESTION)) === ALLOW_DELETES;
  }
  const root = picked;
  await services.model.registry().updateServer(site.id, server.id, (draft) => {
    draft.remoteRoot = root;
    if (allowRootDeletes) {
      draft.options.allowRootDeletes = true;
    }
  });
  services.model.refresh();
  services.logger.info('Root directory chosen', { siteId: site.id, serverId: server.id, remoteRoot: root });
  const now = fresh(services, target);
  if (now !== undefined) {
    await reportTest(services, now);
  }
}

/**
 * Sign In Again: asks for the user and the password, up to three times
 * while the server refuses them, and connects. The password is saved only
 * after the server accepts it: at once when the server saves its password,
 * else when Save Password is chosen.
 */
async function signInAgain(services: Services, target: ServerTarget): Promise<void> {
  const prompter = services.prompter();
  const { site, server } = target;
  const host = server.host ?? '';
  const title = `Sign In: ${site.name}: ${server.name}`;
  let username = server.username ?? '';
  let refusal = '';
  for (let attempt = 1; ; attempt += 1) {
    const user = await prompter.text({
      title,
      prompt: `${refusal}The user for ${host}. Many hosts name FTP accounts in full, as user@domain.`,
      value: username,
      validate: (value) => (value.trim() === '' ? 'Enter the user, or press Escape to cancel.' : undefined),
    });
    if (typeof user !== 'string') {
      return;
    }
    username = user.trim();
    const password = await prompter.text({
      title,
      prompt: `The password for ${username} on ${host}. It is saved only after the server accepts it.`,
      password: true,
      validate: (value) => (value === '' ? 'Enter the password, or press Escape to cancel.' : undefined),
    });
    if (typeof password !== 'string' || password === '') {
      return;
    }
    services.logger.redactor.addSecret(password);
    try {
      const { probe } = await openProbe(services, { site, server: { ...server, username }, title: `Signing in to ${host}`, password });
      await probe.close();
    } catch (error) {
      if (isSyncError(error, 'E_CANCELLED')) {
        return;
      }
      if (isSyncError(error, 'E_AUTH') && error.details?.reason === 'rejected' && attempt < 3) {
        refusal = `${host} did not accept that user name or password. `;
        continue;
      }
      void prompter.error(`Could not sign in to ${host}. ${errorText(error)}`, ['Show Log']).then((choice) => {
        if (choice === 'Show Log') {
          services.showLog();
        }
      });
      return;
    }
    if (username !== server.username) {
      await services.model.registry().updateServer(site.id, server.id, (draft) => {
        draft.username = username;
      });
    }
    const saving = server.auth?.savePassword === true;
    const save = async (): Promise<void> => {
      const now = fresh(services, target);
      if (now === undefined) {
        return;
      }
      await services.credentials.set({ siteId: site.id, serverId: server.id, kind: 'password' }, sealSecret(password, now.server));
      await services.model.registry().updateServer(site.id, server.id, (draft) => {
        draft.auth ??= { method: 'password', savePassword: true };
        draft.auth.savePassword = true;
      });
      services.logger.info('Secret saved', { siteId: site.id, serverId: server.id, kind: 'password', store: services.credentials.name });
    };
    if (saving) {
      await save();
    }
    services.model.refresh();
    const signedIn = `Signed in to ${host} as ${username}.`;
    if (saving) {
      void prompter.inform(`${signedIn} The password is saved in ${services.credentials.name}.`);
    } else {
      void prompter.inform(signedIn, [SAVE_PASSWORD]).then(async (choice) => {
        if (choice === SAVE_PASSWORD) {
          await save();
          services.model.refresh();
        }
      });
    }
    return;
  }
}

/** Tests a server and reports the outcome, with the repair that fits a failure. */
async function reportTest(services: Services, target: ServerTarget): Promise<void> {
  const outcome = await runConnectionTest(services, target);
  if (outcome.ok || outcome.cancelled) {
    void services
      .prompter()
      .inform(outcome.text, outcome.ok ? ['Show Log'] : [])
      .then((choice) => {
        if (choice === 'Show Log') {
          services.showLog();
        }
      });
    return;
  }
  void services
    .prompter()
    .error(outcome.text, repairActions(target.server, outcome.error))
    .then((choice) => repair(services, target, outcome.error, choice))
    .catch((error: unknown) => {
      const text = errorText(error);
      services.logger.error('Test Connection repair failed', { problem: text });
      void services.prompter().error(text, ['Show Log']);
    });
}

async function repair(services: Services, target: ServerTarget, error: unknown, choice: string | undefined): Promise<void> {
  const node = { kind: 'server', site: target.site, server: target.server };
  switch (choice) {
    case 'Show Log':
      services.showLog();
      return;
    case SET_PASSWORD:
      await vscode.commands.executeCommand('syncServers.setPassword', node);
      return;
    case CHOOSE_FOLDER:
      await chooseFolder(services, target, error);
      return;
    case SIGN_IN_AGAIN:
      await signInAgain(services, target);
      return;
    case EDIT_HOST:
    case OPEN_SETTINGS:
      await vscode.commands.executeCommand('syncServers.siteSettings', node);
      return;
    default:
      return;
  }
}

/** Test Connection: tests a server and reports the outcome in a notification, with a repair for a failure. */
export async function testConnection(services: Services, arg: unknown): Promise<void> {
  if (!requireSites(services)) {
    return;
  }
  const target = await chooseServer(services, arg, { placeholder: 'Choose the server to test', remoteFirst: true });
  if (target === undefined) {
    return;
  }
  await reportTest(services, target);
}

function noSecretReason(target: ServerTarget): string {
  return target.server.protocol === 'local'
    ? `${describe(target)} is a folder and needs no password.`
    : `${describe(target)} signs in through the SSH agent and needs no saved password.`;
}

/** Set Password...: asks in a password box and saves it in SecretStorage, tied to the server's address. */
export async function setPassword(services: Services, arg: unknown): Promise<void> {
  if (!requireSites(services)) {
    return;
  }
  const target = await chooseServer(services, arg, { placeholder: 'Choose the server whose password to save', remoteFirst: false });
  if (target === undefined) {
    return;
  }
  const { site, server } = target;
  if (!takesSecret(server)) {
    void services.prompter().inform(noSecretReason(target));
    return;
  }
  const kind: SecretKind = server.auth?.method === 'key' ? 'passphrase' : 'password';
  const account = server.username === undefined ? (server.host ?? '') : `${server.username}@${server.host ?? ''}`;
  const answer = await services.prompter().text({
    title: `Set Password: ${site.name}: ${server.name}`,
    prompt:
      kind === 'password'
        ? `The password for ${account}. It is kept in VS Code's secret storage, never in a file.`
        : `The passphrase of the private key for ${account}. It is kept in VS Code's secret storage, never in a file.`,
    password: true,
    validate: (value) => (value === '' ? `Enter the ${secretLabel(kind)}, or press Escape to cancel.` : undefined),
  });
  if (typeof answer !== 'string' || answer === '') {
    return;
  }
  services.logger.redactor.addSecret(answer);
  await services.credentials.set({ siteId: site.id, serverId: server.id, kind }, sealSecret(answer, server));
  await services.model.registry().updateServer(site.id, server.id, (draft) => {
    draft.auth ??= { method: 'password', savePassword: true };
    draft.auth.savePassword = true;
  });
  services.model.refresh();
  services.logger.info('Secret saved', { siteId: site.id, serverId: server.id, kind, store: services.credentials.name });
  void services.prompter().inform(`Saved the ${secretLabel(kind)} of ${describe(target)} in ${services.credentials.name}.`);
}

/** Forget Password: removes the saved password and passphrase, and stops the server from saving one. */
export async function forgetPassword(services: Services, arg: unknown): Promise<void> {
  if (!requireSites(services)) {
    return;
  }
  const target = await chooseServer(services, arg, { placeholder: 'Choose the server whose password to forget', remoteFirst: false });
  if (target === undefined) {
    return;
  }
  const { site, server } = target;
  if (!takesSecret(server)) {
    void services.prompter().inform(noSecretReason(target));
    return;
  }
  let removed = false;
  for (const kind of SECRET_KINDS) {
    removed = (await services.credentials.delete({ siteId: site.id, serverId: server.id, kind })) || removed;
  }
  if (server.auth?.savePassword === true) {
    await services.model.registry().updateServer(site.id, server.id, (draft) => {
      if (draft.auth !== undefined) {
        draft.auth.savePassword = false;
      }
    });
    services.model.refresh();
  }
  services.logger.info('Secret forgotten', { siteId: site.id, serverId: server.id, removed });
  void services
    .prompter()
    .inform(removed ? `Forgot the saved password of ${describe(target)}.` : `${describe(target)} had no password saved in VS Code.`);
}

/** Reset Sync Information: forgets the sync records of a site and server after a confirmation. */
export async function resetSyncInformation(services: Services, arg: unknown): Promise<void> {
  if (!requireSites(services)) {
    return;
  }
  const target = await chooseServer(services, arg, { placeholder: 'Choose the server whose sync records to forget', remoteFirst: true });
  if (target === undefined) {
    return;
  }
  const name = describe(target);
  const choice = await services.prompter().modal({
    message: `Forget the sync records of ${name}?`,
    detail:
      'The next synchronization compares both sides from scratch, and each file that differs waits for you to choose Put or Get. No file is changed.',
    buttons: [RESET],
    warning: true,
  });
  if (choice !== RESET) {
    return;
  }
  await withSession(services, target, (session) => session.resetState());
  services.logger.info('Sync records forgotten', { siteId: target.site.id, serverId: target.server.id });
  void services.prompter().inform(`Forgot the sync records of ${name}. The next sync compares both sides from scratch.`);
}
