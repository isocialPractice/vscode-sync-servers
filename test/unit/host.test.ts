import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  createLogger,
  MemoryCredentialStore,
  memorySink,
  openSecret,
  secretBinding,
  siteSchema,
  type CertificateInfo,
  type HostKeyInfo,
  type SecretRequest,
  type SecretRef,
  type Server,
  type SiteRegistry,
} from '@isocialpractice/cmd-sync-servers';
import type * as vscode from 'vscode';
import { createHost, SAVE_PASSWORD, TRUST_AND_REMEMBER, TRUST_ONCE } from '../../src/host.ts';
import { channelSink, formatRecord, type LogChannel } from '../../src/log.ts';
import { secretKey, SecretStorageStore } from '../../src/secrets.ts';
import { BACK, type ModalQuestion, type TextQuestion } from '../../src/ui/prompt.ts';
import { ScriptedPrompter } from '../helpers/prompter.ts';

const info: HostKeyInfo = {
  host: 'sftp.example.com',
  port: 22,
  algorithm: 'ssh-ed25519',
  sha256: 'A'.repeat(43),
  fingerprint: `SHA256:${'A'.repeat(43)}`,
};
const request: SecretRequest = {
  ref: { siteId: 'site', serverId: 'server', kind: 'password' },
  siteName: 'My Site',
  serverName: 'Production',
  host: 'sftp.example.com',
  username: 'demo-user',
};

function host(prompter: ScriptedPrompter) {
  const sink = memorySink();
  const logger = createLogger({ level: 'debug', sinks: [sink] });
  return { sink, host: createHost({ credentials: new MemoryCredentialStore(), prompter: () => prompter, logger }) };
}

test('a new host key is trusted and pinned, trusted once, or refused', async () => {
  const prompter = new ScriptedPrompter([TRUST_AND_REMEMBER, TRUST_ONCE, undefined]);
  const { host: adapter, sink } = host(prompter);
  assert.equal(await adapter.confirmHostKey(info), 'accept-and-pin');
  assert.equal(await adapter.confirmHostKey(info), 'accept-once');
  assert.equal(await adapter.confirmHostKey(info), 'reject');
  const question = prompter.asked[0]?.question as ModalQuestion;
  assert.equal(question.warning, true);
  assert.ok(question.detail?.includes(info.fingerprint));
  assert.deepEqual(question.buttons, [TRUST_AND_REMEMBER, TRUST_ONCE]);
  assert.deepEqual(
    sink.records.map((record) => record.fields?.decision),
    ['accept-and-pin', 'accept-once', 'reject'],
  );
});

test('a secret is asked for in a password box, and an empty or cancelled answer gives none', async () => {
  const secret = randomBytes(12).toString('hex');
  const prompter = new ScriptedPrompter([secret, '', undefined, BACK]);
  const { host: adapter } = host(prompter);
  assert.equal(await adapter.promptSecret(request), secret);
  assert.equal(await adapter.promptSecret(request), undefined);
  assert.equal(await adapter.promptSecret(request), undefined);
  assert.equal(await adapter.promptSecret(request), undefined);
  const question = prompter.asked[0]?.question as TextQuestion;
  assert.equal(question.password, true);
  assert.equal(question.title, 'My Site: Production');
  assert.match(question.prompt, /^Password for demo-user on sftp\.example\.com\. /);
  assert.equal(adapter.interactive, true);
});

test('a saved password that was not sent is explained above the question', async () => {
  const prompter = new ScriptedPrompter(['example-password']);
  const { host: adapter } = host(prompter);
  const note = 'The saved password is for another host or user, so it was not sent.';
  await adapter.promptSecret({ ...request, note });
  assert.ok((prompter.asked[0]?.question as TextQuestion).prompt.startsWith(`${note} Password for demo-user on sftp.example.com.`));
});

const certificate: CertificateInfo = {
  host: '203.0.113.10',
  port: 21,
  names: ['*.hosting.example.net', 'hosting.example.net'],
  issuer: 'Example Trust CA',
  validFrom: '2026-01-01T00:00:00.000Z',
  validTo: '2027-01-01T00:00:00.000Z',
  sha256: Array.from({ length: 32 }, () => 'AB').join(':'),
  problem: 'name-mismatch',
  coveredNames: ['server1.hosting.example.net'],
};

test('a certificate offers a covered host first, then checking as it, then trusting it, each a decision', async () => {
  const covered = 'server1.hosting.example.net';
  const buttons = [`Connect to ${covered}`, `Check as ${covered}`, TRUST_AND_REMEMBER, TRUST_ONCE];
  const prompter = new ScriptedPrompter([...buttons, undefined]);
  const { host: adapter, sink } = host(prompter);
  const decisions = [];
  for (let index = 0; index < 5; index += 1) {
    decisions.push(await adapter.confirmCertificate?.(certificate));
  }
  assert.deepEqual(decisions, [
    { action: 'use-host', host: covered },
    { action: 'check-as', servername: covered },
    { action: 'accept-and-pin' },
    { action: 'accept-once' },
    { action: 'reject' },
  ]);
  const question = prompter.asked[0]?.question as ModalQuestion;
  assert.deepEqual(question.buttons, buttons);
  assert.equal(question.warning, true);
  for (const shown of ['*.hosting.example.net', 'Example Trust CA', '2026-01-01 to 2027-01-01', certificate.sha256]) {
    assert.ok(question.detail?.includes(shown), shown);
  }
  const logged = sink.records.filter((record) => record.message === 'Certificate decision');
  assert.deepEqual(
    logged.map((record) => record.fields?.decision),
    ['use-host', 'check-as', 'accept-and-pin', 'accept-once', 'reject'],
  );
  assert.deepEqual(Object.keys(logged[0]?.fields ?? {}).sort(), ['decision', 'host', 'names', 'port', 'problem', 'sha256', 'to']);
});

test('a certificate with no covered name offers trusting it, and a changed one shows both fingerprints', async () => {
  const previousSha256 = Array.from({ length: 32 }, () => 'CD').join(':');
  const prompter = new ScriptedPrompter([TRUST_ONCE, undefined]);
  const { host: adapter } = host(prompter);
  assert.deepEqual(await adapter.confirmCertificate?.({ ...certificate, problem: 'self-signed', coveredNames: [] }), { action: 'accept-once' });
  assert.deepEqual(await adapter.confirmCertificate?.({ ...certificate, problem: 'changed', coveredNames: [], previousSha256 }), { action: 'reject' });
  assert.deepEqual((prompter.asked[0]?.question as ModalQuestion).buttons, [TRUST_AND_REMEMBER, TRUST_ONCE]);
  const changed = prompter.asked[1]?.question as ModalQuestion;
  assert.ok(changed.detail?.includes(certificate.sha256));
  assert.ok(changed.detail?.includes(`Trusted before: ${previousSha256}`));
});

test('an expired or not yet valid certificate can only be refused', async () => {
  for (const problem of ['expired', 'not-yet-valid'] as const) {
    const prompter = new ScriptedPrompter([undefined]);
    const { host: adapter } = host(prompter);
    assert.deepEqual(await adapter.confirmCertificate?.({ ...certificate, problem }), { action: 'reject' });
    const question = prompter.asked[0]?.question as ModalQuestion;
    assert.deepEqual(question.buttons, []);
    assert.match(question.detail ?? '', /never trusted/);
  }
});

/** A list of sites holding one SFTP server, for the offer to save a password. */
function fakeRegistry() {
  const ref: SecretRef = { siteId: randomUUID(), serverId: randomUUID(), kind: 'password' };
  const site = siteSchema.parse({
    id: ref.siteId,
    name: 'My Site',
    localRoot: path.join(tmpdir(), 'my-site'),
    servers: [{ id: ref.serverId, name: 'Production', protocol: 'sftp', host: 'sftp.example.com', username: 'demo-user', remoteRoot: '/var/www/my-site' }],
  });
  const registry = {
    get: (siteId: string) => (siteId === site.id ? site : undefined),
    updateServer: (_siteId: string, serverId: string, change: (draft: Server) => void) => {
      const found = site.servers.find((candidate) => candidate.id === serverId);
      if (found !== undefined) {
        change(found);
      }
      return Promise.resolve();
    },
  };
  return { site, registry: registry as unknown as SiteRegistry, accepted: { ...request, ref } };
}

test('an accepted password is offered for saving, and saved sealed for the server as it is', async () => {
  const { site, registry, accepted } = fakeRegistry();
  const credentials = new MemoryCredentialStore();
  const prompter = new ScriptedPrompter().reply(SAVE_PASSWORD);
  let saved = 0;
  const adapter = createHost({
    credentials,
    prompter: () => prompter,
    logger: createLogger({ level: 'debug', sinks: [] }),
    registry: () => registry,
    onSaved: () => {
      saved += 1;
    },
  });
  const secret = randomBytes(12).toString('hex');
  await adapter.secretAccepted?.(accepted, secret);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(saved, 1);
  assert.deepEqual(prompter.shown[0]?.actions, [SAVE_PASSWORD]);
  assert.ok(!prompter.messages.join('\n').includes(secret));
  const [server] = site.servers;
  assert.ok(server !== undefined);
  assert.equal(server.auth?.savePassword, true);
  const stored = await credentials.get(accepted.ref);
  assert.ok(stored !== undefined && stored !== secret);
  assert.equal(openSecret(stored, secretBinding(server)), secret);
});

test('an accepted password is not saved when it is dismissed, or when the server changed before Save Password', async () => {
  const dismissed = fakeRegistry();
  const credentials = new MemoryCredentialStore();
  const quiet = new ScriptedPrompter();
  const logger = createLogger({ level: 'debug', sinks: [] });
  await createHost({ credentials, prompter: () => quiet, logger, registry: () => dismissed.registry }).secretAccepted?.(dismissed.accepted, 'example-password');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await credentials.get(dismissed.accepted.ref), undefined);

  const changed = fakeRegistry();
  const late = new ScriptedPrompter();
  let click: (value: string | undefined) => void = () => undefined;
  late.inform = (message, actions) => {
    late.shown.push({ kind: 'inform', message, actions: actions ?? [] });
    return new Promise((resolve) => {
      click = resolve;
    });
  };
  await createHost({ credentials, prompter: () => late, logger, registry: () => changed.registry }).secretAccepted?.(changed.accepted, 'example-password');
  const [server] = changed.site.servers;
  if (server !== undefined) {
    server.host = 'sftp.example.org';
  }
  click(SAVE_PASSWORD);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await credentials.get(changed.accepted.ref), undefined);
  assert.match(late.messages.at(-1) ?? '', /changed since, so the password was not saved/);
});

class FakeSecretStorage {
  readonly values = new Map<string, string>();

  get(key: string): Promise<string | undefined> {
    return Promise.resolve(this.values.get(key));
  }

  store(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}

test("secrets are kept in VS Code's secret storage under sync-servers/<site>/<server>/<kind>", async () => {
  const storage = new FakeSecretStorage();
  const store = new SecretStorageStore(storage as unknown as vscode.SecretStorage);
  const ref: SecretRef = { siteId: 'site', serverId: 'server', kind: 'passphrase' };
  const secret = randomBytes(12).toString('hex');
  assert.equal(secretKey(ref), 'sync-servers/site/server/passphrase');
  await store.set(ref, secret);
  assert.deepEqual([...storage.values.keys()], ['sync-servers/site/server/passphrase']);
  assert.equal(await store.get(ref), secret);
  assert.equal(await store.delete(ref), true);
  assert.equal(await store.delete(ref), false);
  assert.equal(await store.get(ref), undefined);
});

test('log records reach the channel at their own level, already redacted', () => {
  const lines: string[] = [];
  const channel: LogChannel = {
    error: (message) => lines.push(`error ${message}`),
    warn: (message) => lines.push(`warn ${message}`),
    info: (message) => lines.push(`info ${message}`),
    debug: (message) => lines.push(`debug ${message}`),
  };
  const secret = randomBytes(12).toString('hex');
  const logger = createLogger({ level: 'debug', sinks: [channelSink(channel)] });
  logger.redactor.addSecret(secret);
  logger.info('Connected', { host: 'sftp.example.com' });
  logger.error(`Refused ${secret}`);
  logger.debug('Trace');
  assert.deepEqual(lines, ['info Connected {"host":"sftp.example.com"}', 'error Refused [redacted]', 'debug Trace']);
  assert.equal(formatRecord({ time: '', level: 'warn', message: 'Plain' }), 'Plain');
});
