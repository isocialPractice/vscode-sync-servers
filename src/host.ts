import {
  sealSecret,
  secretBinding,
  type CertificateDecision,
  type CertificateInfo,
  type CredentialStore,
  type HostAdapter,
  type HostKeyDecision,
  type HostKeyInfo,
  type Logger,
  type SecretRequest,
  type SiteRegistry,
} from '@isocialpractice/cmd-sync-servers';
import type { ModalQuestion, Prompter, TextQuestion } from './ui/prompt.ts';

/** The button that trusts a new host key or certificate and remembers it in the server's settings. */
export const TRUST_AND_REMEMBER = 'Trust and Remember';
/** The button that trusts a new host key or certificate for this connection only. */
export const TRUST_ONCE = 'Trust Once';
/** The button that saves a password the server just accepted. */
export const SAVE_PASSWORD = 'Save Password';

/** The modal warning shown for an SSH host key seen for the first time. */
export function hostKeyQuestion(info: HostKeyInfo): ModalQuestion {
  return {
    message: `Trust the host key of ${info.host}?`,
    detail: [
      `This is the first connection to ${info.host} on port ${String(info.port)}. It offered this ${info.algorithm} key:`,
      '',
      info.fingerprint,
      '',
      'Compare it with the fingerprint your host publishes before trusting it. A remembered key is pinned in the server\'s settings, and a different key later stops the connection.',
    ].join('\n'),
    buttons: [TRUST_AND_REMEMBER, TRUST_ONCE],
    warning: true,
  };
}

function problemSentence(info: CertificateInfo): string {
  switch (info.problem) {
    case 'name-mismatch':
      return `The certificate of ${info.host} names another host.`;
    case 'self-signed':
      return `The certificate of ${info.host} is signed by itself, not by an authority this computer trusts.`;
    case 'untrusted-issuer':
      return `The certificate of ${info.host} comes from an authority this computer does not trust.`;
    case 'changed':
      return `The certificate of ${info.host} is not the one you trusted before.`;
    case 'expired':
      return `The certificate of ${info.host} has expired.`;
    case 'not-yet-valid':
      return `The certificate of ${info.host} is not valid yet.`;
    case 'other':
      return `The certificate of ${info.host} could not be verified.`;
  }
}

/**
 * The modal shown for a certificate that did not verify, with the buttons in
 * order of preference: a host name it covers, checking it as that name, then
 * trusting it. Expired and not-yet-valid certificates get no button that
 * trusts them. `decisions` maps each button to its decision; closing the
 * modal refuses the certificate.
 */
export function certificateQuestion(info: CertificateInfo): { readonly question: ModalQuestion; readonly decisions: ReadonlyMap<string, CertificateDecision> } {
  const decisions = new Map<string, CertificateDecision>();
  const covered = info.coveredNames[0];
  const untrustable = info.problem === 'expired' || info.problem === 'not-yet-valid';
  if (!untrustable) {
    if (covered !== undefined) {
      decisions.set(`Connect to ${covered}`, { action: 'use-host', host: covered });
      decisions.set(`Check as ${covered}`, { action: 'check-as', servername: covered });
    }
    decisions.set(TRUST_AND_REMEMBER, { action: 'accept-and-pin' });
    decisions.set(TRUST_ONCE, { action: 'accept-once' });
  }
  const detail = [
    `Issued to: ${info.names.join(', ') || 'no names'}`,
    `Issued by: ${info.issuer}`,
    `Valid: ${info.validFrom.slice(0, 10)} to ${info.validTo.slice(0, 10)}`,
    `SHA-256: ${info.sha256}`,
    ...(info.previousSha256 === undefined ? [] : [`Trusted before: ${info.previousSha256}`]),
    '',
    ...(untrustable
      ? ['A certificate outside its validity dates is never trusted. Ask the host to renew it, or check the date and time of this computer.']
      : [
          ...(covered === undefined
            ? []
            : [`${info.host} is ${covered}, which this certificate covers. Connecting to it, or checking the certificate as it, keeps full verification.`, '']),
          info.problem === 'changed'
            ? 'A new certificate can be a renewal, or a machine in the middle. Compare the new fingerprint with the one your host publishes before trusting it.'
            : 'Compare the fingerprint with the one your host publishes before trusting it. A remembered certificate is trusted by its fingerprint in the server\'s settings.',
        ]),
  ].join('\n');
  return { question: { message: problemSentence(info), detail, buttons: [...decisions.keys()], warning: true }, decisions };
}

/** The password box shown when the engine needs a secret that is not saved. */
export function secretPrompt(request: SecretRequest): TextQuestion {
  const what = request.ref.kind === 'password' ? 'Password' : 'Passphrase of the private key';
  const account = request.host === undefined ? '' : ` for ${request.username === undefined ? '' : `${request.username} on `}${request.host}`;
  return {
    title: `${request.siteName}: ${request.serverName}`,
    prompt: `${request.note === undefined ? '' : `${request.note} `}${what}${account}. It is used for this connection; you are offered to save it once the server accepts it.`,
    password: true,
  };
}

/**
 * What the engine needs from VS Code: SecretStorage, the host key and
 * certificate modals, the password box, and an offer to save a password
 * the server just accepted.
 */
export function createHost(options: {
  readonly credentials: CredentialStore;
  readonly prompter: () => Prompter;
  readonly logger: Logger;
  /** Where the server of an accepted password is looked up, so it is saved for the server as it is. */
  readonly registry?: (() => SiteRegistry | undefined) | undefined;
  /** Called after a password is saved, so the views can show it. */
  readonly onSaved?: (() => void) | undefined;
}): HostAdapter {
  const { credentials, prompter, logger } = options;
  return {
    credentials,
    interactive: true,
    logger,
    confirmHostKey: async (info: HostKeyInfo): Promise<HostKeyDecision> => {
      const choice = await prompter().modal(hostKeyQuestion(info));
      const decision: HostKeyDecision = choice === TRUST_AND_REMEMBER ? 'accept-and-pin' : choice === TRUST_ONCE ? 'accept-once' : 'reject';
      logger.info('Host key decision', { host: info.host, port: info.port, fingerprint: info.fingerprint, decision });
      return decision;
    },
    confirmCertificate: async (info: CertificateInfo): Promise<CertificateDecision> => {
      const { question, decisions } = certificateQuestion(info);
      const choice = await prompter().modal(question);
      const decision = (choice === undefined ? undefined : decisions.get(choice)) ?? { action: 'reject' };
      logger.info('Certificate decision', {
        host: info.host,
        port: info.port,
        names: info.names.join(', '),
        sha256: info.sha256,
        problem: info.problem,
        decision: decision.action,
        ...('host' in decision ? { to: decision.host } : 'servername' in decision ? { checkAs: decision.servername } : {}),
      });
      return decision;
    },
    promptSecret: async (request: SecretRequest): Promise<string | undefined> => {
      const answer = await prompter().text(secretPrompt(request));
      return typeof answer === 'string' && answer !== '' ? answer : undefined;
    },
    secretAccepted: (request: SecretRequest, secret: string): Promise<void> => {
      const registry = options.registry?.();
      const server = registry?.get(request.ref.siteId)?.servers.find((candidate) => candidate.id === request.ref.serverId);
      if (registry === undefined || server === undefined) {
        return Promise.resolve();
      }
      const binding = secretBinding(server);
      const what = request.ref.kind === 'password' ? 'password' : 'key passphrase';
      // The offer does not hold up the connection; the password is saved only for the settings the server accepted it with.
      void prompter()
        .inform(`${request.siteName}: ${request.serverName} accepted the ${what}. Save it in ${credentials.name}?`, [SAVE_PASSWORD])
        .then(async (choice) => {
          if (choice !== SAVE_PASSWORD) {
            return;
          }
          const now = registry.get(request.ref.siteId)?.servers.find((candidate) => candidate.id === request.ref.serverId);
          if (now === undefined || secretBinding(now) !== binding) {
            void prompter().error(`The settings of ${request.siteName}: ${request.serverName} changed since, so the ${what} was not saved.`);
            return;
          }
          await credentials.set(request.ref, sealSecret(secret, now));
          await registry.updateServer(request.ref.siteId, now.id, (draft) => {
            draft.auth ??= { method: 'password', savePassword: true };
            draft.auth.savePassword = true;
          });
          logger.info('Secret saved', { siteId: request.ref.siteId, serverId: now.id, kind: request.ref.kind, store: credentials.name });
          options.onSaved?.();
        })
        .catch((error: unknown) => {
          logger.warn('The accepted password was not saved', { problem: error instanceof Error ? error.message : String(error) });
        });
      return Promise.resolve();
    },
  };
}
