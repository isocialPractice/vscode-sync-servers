// The messages between the extension and the Site Settings webview, and the
// check every save goes through.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { siteSchema } from '@isocialpractice/cmd-sync-servers';
import { checkSave, pinProblem, problemText } from '../../src/settings/save-check.ts';
import { fromWebviewSchema, toWebviewSchema } from '../../src/shared/messages.ts';
import { asData, sampleSite } from '../helpers/sites.ts';

const localRoot = path.join(tmpdir(), 'my-site');
const backup = path.join(tmpdir(), 'my-site-backup');
const site = sampleSite(localRoot, backup);
const exists = (): boolean => true;
const trustedCertificate = { sha256: Array.from({ length: 32 }, () => 'AB').join(':'), validTo: '2027-01-01T00:00:00.000Z', pinnedAt: new Date().toISOString() };

describe('messages from the webview', () => {
  test('well-formed messages pass', () => {
    const serverId = site.servers[0]?.id ?? '';
    const good: unknown[] = [
      { type: 'ready' },
      { type: 'save', site: asData(site) },
      { type: 'cancel', dirty: true },
      { type: 'browse', target: { kind: 'localRoot' } },
      { type: 'browse', target: { kind: 'caFile', serverId } },
      { type: 'browse', target: { kind: 'remoteRoot', serverId }, server: asData(site).servers[0] },
      { type: 'test', serverId, server: asData(site).servers[0] },
      { type: 'setPassword', serverId },
      { type: 'forgetPassword', serverId },
      { type: 'countCloaked', cloaking: { enabled: true, patterns: ['.psd'], paths: [] } },
    ];
    for (const message of good) {
      assert.equal(fromWebviewSchema.safeParse(message).success, true, JSON.stringify(message).slice(0, 80));
    }
  });

  test('anything else is refused', () => {
    const data = asData(site);
    const malformed: unknown[] = [
      null,
      'save',
      42,
      {},
      { type: 'unknown' },
      { type: 'ready', extra: true },
      { type: 'save' },
      { type: 'save', site: { ...data, extra: 1 } },
      { type: 'save', site: { ...data, id: 'not-a-uuid' } },
      { type: 'save', site: { ...data, name: 'x'.repeat(5000) } },
      { type: 'save', site: { ...data, servers: [{ ...data.servers[0], password: 'example' }] } },
      { type: 'save', site: { ...data, sync: { ...data.sync, compare: 'guess' } } },
      { type: 'cancel', dirty: 'yes' },
      { type: 'browse', target: { kind: 'anywhere' } },
      { type: 'browse', target: { kind: 'localRoot', path: '/etc' } },
      { type: 'test', serverId: '../../etc/passwd', server: data.servers[0] },
      { type: 'test', serverId: data.servers[0]?.id },
      { type: 'test', serverId: data.servers[0]?.id, server: { ...data.servers[0], password: 'example' } },
      { type: 'countCloaked', cloaking: { enabled: 'yes', patterns: [], paths: [] } },
      { type: 'countCloaked', cloaking: { enabled: true, patterns: Array.from({ length: 10_001 }, () => 'x'), paths: [] } },
    ];
    for (const message of malformed) {
      assert.equal(fromWebviewSchema.safeParse(message).success, false, JSON.stringify(message).slice(0, 80));
    }
  });
});

describe('messages to the webview', () => {
  test('a loaded site passes, and a message with a password field does not', () => {
    const load = { type: 'load', site: asData(site), passwordSaved: { [site.servers[0]?.id ?? '']: true }, builtInGuard: ['.env'], globalPatterns: ['.git/'] };
    assert.equal(toWebviewSchema.safeParse(load).success, true);
    assert.equal(toWebviewSchema.safeParse({ ...load, password: 'example' }).success, false);
    assert.equal(toWebviewSchema.safeParse({ type: 'cloakCount', enabled: true, files: -1, folders: 0, complete: true }).success, false);
  });

  test('what a connection decided passes, and nothing else rides along', () => {
    const serverId = site.servers[1]?.id ?? '';
    const decided = { type: 'decided', serverId, decisions: { host: 'server1.hosting.example.net', trustedCertificate, allowRootDeletes: true } };
    assert.equal(toWebviewSchema.safeParse(decided).success, true);
    assert.equal(toWebviewSchema.safeParse({ ...decided, decisions: { ...decided.decisions, password: 'example' } }).success, false);
  });
});

describe('saving', () => {
  test('a valid site is saved with its defaults filled in', () => {
    const result = checkSave(asData(site), site, [site], exists);
    assert.ok(result.kind === 'ok');
    assert.deepEqual(result.site, siteSchema.parse(site));
  });

  test('another site, or a host key the form was never given, is refused', () => {
    assert.equal(checkSave({ ...asData(site), id: randomUUID() }, site, [site], exists).kind, 'refused');
    const injected = asData(site);
    const [first] = injected.servers;
    assert.ok(first);
    first.options.hostKey = { algorithm: 'ssh-ed25519', sha256: 'A'.repeat(43), pinnedAt: new Date().toISOString() };
    assert.equal(checkSave(injected, site, [site], exists).kind, 'refused');
  });

  test('a pinned host key may be kept or forgotten', () => {
    const pinned = structuredClone(site);
    const [first] = pinned.servers;
    assert.ok(first);
    first.options.hostKey = { algorithm: 'ssh-ed25519', sha256: 'B'.repeat(43), pinnedAt: new Date().toISOString() };
    assert.equal(checkSave(asData(pinned), pinned, [pinned], exists).kind, 'ok');
    const forgotten = asData(pinned);
    delete forgotten.servers[0]?.options.hostKey;
    assert.equal(checkSave(forgotten, pinned, [pinned], exists).kind, 'ok');
  });

  test('a trusted certificate the form was not given is refused, and one trusted on connection from the form is saved', () => {
    const draft = asData(site);
    const [, ftps] = draft.servers;
    assert.ok(ftps);
    ftps.options.tls = { minVersion: 'TLSv1.2', trustedCertificate };
    const refused = checkSave(draft, site, [site], exists);
    assert.ok(refused.kind === 'refused');
    assert.match(refused.reason, /trusted certificate it was not given/);
    assert.equal(pinProblem(ftps, site.servers[1], undefined), refused.reason);
    const granted = new Map([[ftps.id, { trustedCertificate }]]);
    const saved = checkSave(draft, site, [site], exists, granted);
    assert.ok(saved.kind === 'ok');
    assert.deepEqual(saved.site.servers[1]?.options.tls?.trustedCertificate, trustedCertificate);
    const other = new Map([[ftps.id, { trustedCertificate: { ...trustedCertificate, sha256: Array.from({ length: 32 }, () => 'CD').join(':') } }]]);
    assert.equal(checkSave(draft, site, [site], exists, other).kind, 'refused');
  });

  test('a host key trusted on connection from the form is saved', () => {
    const draft = asData(site);
    const [first] = draft.servers;
    assert.ok(first);
    const hostKey = { algorithm: 'ssh-ed25519', sha256: 'D'.repeat(43), pinnedAt: new Date().toISOString() };
    first.options.hostKey = hostKey;
    assert.equal(checkSave(draft, site, [site], exists, new Map([[first.id, { hostKey }]])).kind, 'ok');
  });

  test('problems name the field they belong to, in words a person can act on', () => {
    const draft = asData(site);
    const [sftp, ftps, local] = draft.servers;
    assert.ok(sftp && ftps && local);
    delete sftp.host;
    sftp.webUrl = 'www.example.com';
    ftps.protocol = 'ftp';
    local.remoteRoot = path.join(localRoot, 'backup');
    draft.name = 'Acme Corp';
    const acme = { ...sampleSite(path.join(tmpdir(), 'acme'), backup), name: 'Acme Corp' };
    const result = checkSave(draft, site, [site, acme], (folder) => folder !== localRoot);
    assert.ok(result.kind === 'problems');
    const problems = Object.fromEntries(result.problems.map((problem) => [problem.path, problem.message]));
    assert.equal(problems['servers.0.host'], 'Required for the "sftp" protocol.');
    assert.equal(problems['servers.0.webUrl'], 'Enter a full address, such as https://www.example.com/.');
    assert.match(problems['servers.1.options.allowInsecure'] ?? '', /clear text/);
    assert.match(problems['servers.2.remoteRoot'] ?? '', /outside the local site folder/);
    assert.equal(problems.name, 'A site named "Acme Corp" already exists.');
    assert.equal(problems.localRoot, 'This folder does not exist.');
  });

  test('an empty required text field reads as needed', () => {
    assert.equal(problemText({ code: 'too_small', origin: 'string', path: ['name'], message: 'Too small' }), 'This field is needed.');
    assert.equal(problemText({ code: 'too_big', origin: 'string', maximum: 120, path: ['name'], message: 'Too big' }), 'Use at most 120 characters.');
    assert.equal(problemText({ code: 'custom', path: ['x'], message: 'As the engine says.' }), 'As the engine says.');
  });
});

test('global patterns ride along with a load and change while the form is open; the form only asks to edit them', () => {
  const data = asData(site);
  data.cloaking.useGlobalPatterns = false;
  assert.equal(toWebviewSchema.safeParse({ type: 'load', site: data, passwordSaved: {}, builtInGuard: [], globalPatterns: ['.git/'] }).success, true);
  assert.equal(toWebviewSchema.safeParse({ type: 'globalPatterns', patterns: ['.git/', 'node_modules/'] }).success, true);
  assert.equal(fromWebviewSchema.safeParse({ type: 'save', site: data }).success, true);
  assert.equal(fromWebviewSchema.safeParse({ type: 'countCloaked', cloaking: { enabled: true, useGlobalPatterns: false, patterns: [], paths: [] } }).success, true);
  assert.equal(fromWebviewSchema.safeParse({ type: 'editGlobalPatterns' }).success, true);
  assert.equal(fromWebviewSchema.safeParse({ type: 'editGlobalPatterns', patterns: ['.git/'] }).success, false, 'the form never sends patterns to save');
});

test('a site that stops using the global patterns keeps the choice when saved', () => {
  const data = asData(site);
  data.cloaking.useGlobalPatterns = false;
  const result = checkSave(data, site, [site], exists);
  assert.ok(result.kind === 'ok');
  assert.equal(result.site.cloaking.useGlobalPatterns, false);
});
