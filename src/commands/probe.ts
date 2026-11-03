import { PASSWORD_ENV, ServerProbe, type HostAdapter, type Server, type SecretRequest } from '@isocialpractice/cmd-sync-servers';
import * as vscode from 'vscode';
import type { Services } from './services.ts';

/** A connection made with settings that may not be saved, and the settings with what was decided on the way. */
export interface OpenProbe {
  readonly probe: ServerProbe;
  /** The settings as connected: another host the certificate covers, a trusted key or certificate. */
  readonly server: Server;
}

/**
 * The host adapter for a connection with unsaved settings: decisions are
 * asked as usual, `password` answers the password question when given, and
 * nothing offers to save a password, since the settings may never be saved.
 */
function unsavedHost(host: HostAdapter, password: string | undefined): HostAdapter {
  const confirmCertificate = host.confirmCertificate?.bind(host);
  const promptSecret = host.promptSecret.bind(host);
  return {
    credentials: host.credentials,
    interactive: true,
    ...(host.logger === undefined ? {} : { logger: host.logger }),
    confirmHostKey: host.confirmHostKey.bind(host),
    ...(confirmCertificate === undefined ? {} : { confirmCertificate }),
    promptSecret: (request: SecretRequest) =>
      request.ref.kind === 'password' && password !== undefined && password !== '' ? Promise.resolve(password) : promptSecret(request),
  };
}

/** What connecting decided, as the Site Settings form takes it: the fields of `after` that differ from `before`. */
export function decisionsBetween(
  before: Pick<Server, 'host' | 'options'>,
  after: Pick<Server, 'host' | 'options'>,
): { host?: string; servername?: string; hostKey?: NonNullable<Server['options']['hostKey']>; trustedCertificate?: NonNullable<NonNullable<Server['options']['tls']>['trustedCertificate']> } {
  const decided: ReturnType<typeof decisionsBetween> = {};
  if (after.host !== undefined && after.host !== before.host) {
    decided.host = after.host;
  }
  const servername = after.options.tls?.servername;
  if (servername !== undefined && servername !== before.options.tls?.servername) {
    decided.servername = servername;
  }
  const hostKey = after.options.hostKey;
  if (hostKey !== undefined && hostKey.sha256 !== before.options.hostKey?.sha256) {
    decided.hostKey = hostKey;
  }
  const trusted = after.options.tls?.trustedCertificate;
  if (trusted !== undefined && trusted.sha256 !== before.options.tls?.trustedCertificate?.sha256) {
    decided.trustedCertificate = trusted;
  }
  return decided;
}

/**
 * Connects with `server` as it is, saved or not, under a cancellable
 * progress notification. Host key and certificate decisions are asked in
 * modals and applied to the returned settings only: nothing is written to
 * `sites.json` or SecretStorage. Rejects with the engine's error.
 */
export async function openProbe(
  services: Services,
  options: {
    readonly site: { readonly id: string; readonly name: string };
    readonly server: Server;
    readonly title: string;
    readonly password?: string | undefined;
    /** Use the extension's own host adapter, which may offer to save a password the server accepts. */
    readonly savedServer?: boolean;
    /** Told the settings after each decision, so a decision outlives a sign-in that fails afterwards. */
    readonly decided?: ((server: Server) => void) | undefined;
  },
): Promise<OpenProbe> {
  const working = structuredClone(options.server);
  const host = options.savedServer === true && options.password === undefined ? services.host : unsavedHost(services.host, options.password);
  // A typed password replaces the saved one, which is not read at all.
  const { auth } = options.server;
  const server = options.password === undefined || auth === undefined ? options.server : { ...options.server, auth: { ...auth, savePassword: false } };
  const probe = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: options.title, cancellable: true }, (_progress, token) => {
    const controller = new AbortController();
    token.onCancellationRequested(() => {
      controller.abort();
    });
    return ServerProbe.open({
      site: options.site,
      server,
      host,
      updateServer: (change) => {
        change(working);
        options.decided?.(structuredClone(working));
        return Promise.resolve();
      },
      env: options.password === undefined ? process.env : { ...process.env, [PASSWORD_ENV]: undefined },
      logger: services.logger,
      signal: controller.signal,
    });
  });
  return { probe, server: working };
}
