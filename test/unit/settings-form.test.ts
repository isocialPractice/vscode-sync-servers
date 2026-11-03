// The Site Settings form without a browser: its state, its changes, and the
// page it draws, checked for labels and ARIA.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { DEFAULT_GUARD_PATTERNS, type Site } from '@isocialpractice/cmd-sync-servers';
import type { ToWebview } from '../../src/shared/messages.ts';
import { applyProtocol, tidyTls, type Category } from '../../src/webview/fields.ts';
import { isDirty, isSavedAsShown, loaded, receive, update, type Action, type State } from '../../src/webview/state.ts';
import { view } from '../../src/webview/view.ts';
import { textOf, walk, type VNode } from '../../src/webview/vnode.ts';
import { asData, sampleSite } from '../helpers/sites.ts';

const site = sampleSite(path.join(tmpdir(), 'my-site'), path.join(tmpdir(), 'my-site-backup'));
const [production, staging] = site.servers as [Site['servers'][number], Site['servers'][number], Site['servers'][number]];

function start(): State {
  return loaded({ type: 'load', site: asData(site), passwordSaved: { [production.id]: true }, builtInGuard: [...DEFAULT_GUARD_PATTERNS], globalPatterns: ['.git/', 'node_modules/'] });
}

function act(state: State, action: Action, value?: string | boolean): State {
  return update(state, action, value, randomUUID).state;
}

function edit(state: State, field: string, value: string | boolean): State {
  return act(state, { type: 'field', field }, value);
}

describe('the form state', () => {
  test('a text change makes the form dirty, and Revert puts the saved site back', () => {
    let state = edit(start(), 'name', 'Sample App');
    assert.equal(state.draft.name, 'Sample App');
    assert.equal(isDirty(state), true);
    state = act(state, { type: 'revert' });
    assert.equal(state.draft.name, 'My Site');
    assert.equal(isDirty(state), false);
  });

  test('clearing an optional field removes it, so the form is clean again', () => {
    let state = edit(start(), 'localWebUrl', 'http://localhost:8080/');
    assert.equal(state.draft.local.webUrl, 'http://localhost:8080/');
    state = edit(state, 'localWebUrl', '');
    assert.equal('webUrl' in state.draft.local, false);
    assert.equal(isDirty(state), false);
  });

  test('a number outside its range is kept as typed and marked; a valid one is stored', () => {
    let state = edit(start(), 'concurrency', '40');
    assert.equal(state.draft.sync.concurrency, 4);
    assert.equal(state.raw['sync.concurrency'], '40');
    assert.equal(state.local['sync.concurrency'], 'Enter a number from 1 to 16.');
    const blocked = update(state, { type: 'save' }, undefined, randomUUID);
    assert.deepEqual(blocked.messages, [], 'nothing is sent while a field is marked');
    assert.equal(blocked.focusProblem, true);
    assert.equal(blocked.state.category, 'sync');
    state = edit(state, 'concurrency', '8');
    assert.equal(state.draft.sync.concurrency, 8);
    assert.equal(state.local['sync.concurrency'], undefined);
    const saving = update(state, { type: 'save' }, undefined, randomUUID);
    assert.equal(saving.messages[0]?.type, 'save');
  });

  test('selects and checkboxes map to the values the site stores', () => {
    let state = edit(start(), 'caseSensitive', 'no');
    assert.equal(state.draft.local.caseSensitive, false);
    state = edit(state, 'caseSensitive', 'auto');
    assert.equal('caseSensitive' in state.draft.local, false);
    state = edit(state, 'cache', false);
    assert.equal(state.draft.local.cache, false);
  });

  test('Symbolic links keeps each of its three values through a save, and nothing else', () => {
    for (const value of ['follow', 'follow-inside-root', 'skip'] as const) {
      const state = edit(edit(start(), 'symlinks', 'follow'), 'symlinks', value);
      assert.equal(state.draft.sync.symlinks, value);
      const message = update(state, { type: 'save' }, undefined, randomUUID).messages[0];
      assert.equal(message?.type === 'save' ? message.site.sync.symlinks : undefined, value);
    }
    assert.equal(edit(start(), 'symlinks', 'always').draft.sync.symlinks, 'skip');
  });

  test('cloaking patterns split on spaces and lines, and keep the text as typed; each change asks for a new count', () => {
    const result = update(start(), { type: 'field', field: 'cloakingPatterns' }, '.psd node_modules/\n/drafts/', randomUUID);
    assert.deepEqual(result.state.draft.cloaking.patterns, ['.psd', 'node_modules/', '/drafts/']);
    assert.equal(result.state.raw['cloaking.patterns'], '.psd node_modules/\n/drafts/');
    assert.equal(result.messages[0]?.type, 'countCloaked');
  });

  test('servers are added, duplicated, removed, and given the Remote and Testing roles', () => {
    let state = act(start(), { type: 'select', serverId: production.id });
    state = act(state, { type: 'duplicateServer' });
    const copy = state.draft.servers[1];
    assert.equal(copy?.name, 'Production copy');
    assert.equal(copy.auth?.savePassword ?? false, false);
    state = act(state, { type: 'addServer' });
    assert.equal(state.draft.servers.at(-1)?.name, 'New server');
    assert.equal(state.editing, state.draft.servers.at(-1)?.id);
    state = act(state, { type: 'remote', serverId: staging.id });
    assert.equal(state.draft.remoteServerId, staging.id);
    state = act(state, { type: 'testing', serverId: null });
    assert.equal(state.draft.testingServerId, undefined);
    state = act(state, { type: 'select', serverId: staging.id });
    state = act(state, { type: 'removeServer' });
    assert.equal(state.draft.remoteServerId, production.id, 'the first server becomes Remote');
    assert.ok(!state.draft.servers.some((server) => server.id === staging.id));
  });

  test('changing the protocol drops what the new one does not use', () => {
    const server = structuredClone(asData(site).servers[0]);
    assert.ok(server);
    server.port = 22;
    server.auth = { method: 'key', keyPath: path.join(tmpdir(), 'id_ed25519'), savePassword: false };
    server.options.legacyAlgorithms = true;
    applyProtocol(server, 'ftps');
    assert.equal(server.port, undefined, 'the default SFTP port is dropped');
    assert.deepEqual(server.auth, { method: 'password', savePassword: false });
    assert.equal(server.options.legacyAlgorithms, undefined);
    applyProtocol(server, 'local');
    assert.equal(server.host, undefined);
    assert.equal(server.auth, undefined);
  });

  test('Test connects with the server as the form shows it, with host:port moved into Port', () => {
    let state = act(start(), { type: 'select', serverId: production.id });
    state = act(state, { type: 'editServer' });
    assert.equal(isSavedAsShown(state, production.id), true);
    state = edit(state, 'host', 'sftp.example.net:2222');
    const testing = update(state, { type: 'test', serverId: production.id }, undefined, randomUUID);
    const shown = { ...asData(site).servers[0], host: 'sftp.example.net', port: 2222 };
    assert.deepEqual(testing.messages, [{ type: 'test', serverId: production.id, server: shown }]);
    assert.equal(testing.state.tests[production.id]?.running, true);
    assert.equal(testing.state.draft.servers[0]?.port, 2222);
  });

  test('a port in Host that disagrees with Port stops Test and Browse... with the problem', () => {
    let state = act(act(start(), { type: 'select', serverId: production.id }), { type: 'editServer' });
    state = edit(state, 'port', '2200');
    state = edit(state, 'host', 'sftp.example.net:2222');
    for (const action of [{ type: 'test', serverId: production.id }, { type: 'browse', target: { kind: 'remoteRoot', serverId: production.id } }] as const) {
      const blocked = update(state, action, undefined, randomUUID);
      assert.deepEqual(blocked.messages, []);
      assert.match(blocked.state.status, /Host gives port 2222, but Port says 2200/);
    }
  });

  test('Set Password waits until the server is saved as shown', () => {
    let state = act(start(), { type: 'select', serverId: production.id });
    state = edit(act(state, { type: 'editServer' }), 'host', 'sftp.example.net');
    const blocked = update(state, { type: 'setPassword', serverId: production.id }, undefined, randomUUID);
    assert.deepEqual(blocked.messages, []);
    assert.match(blocked.state.status, /Save the site first/);
  });

  test('Browse... for the root directory sends the server as shown, and the folder picked fills the field', () => {
    const editing = act(act(start(), { type: 'select', serverId: production.id }), { type: 'editServer' });
    const state = edit(editing, 'username', 'demo-user@example.com');
    const target = { kind: 'remoteRoot', serverId: production.id } as const;
    const browsing = update(state, { type: 'browse', target }, undefined, randomUUID);
    assert.deepEqual(browsing.messages, [{ type: 'browse', target, server: { ...asData(site).servers[0], username: 'demo-user@example.com' } }]);
    const picked = receive(browsing.state, { type: 'picked', target, path: '/var/www/example.com' }).state;
    assert.ok(picked);
    assert.equal(picked.draft.servers[0]?.remoteRoot, '/var/www/example.com');
    assert.match(picked.status, /Save to keep it/);
    assert.equal(isDirty(picked), true);
  });

  test('what a connection decided goes into the form unsaved', () => {
    const trustedCertificate = { sha256: Array.from({ length: 32 }, () => 'AB').join(':'), validTo: '2027-01-01T00:00:00.000Z', pinnedAt: new Date().toISOString() };
    const decided = receive(start(), {
      type: 'decided',
      serverId: staging.id,
      decisions: { host: 'server1.hosting.example.net', servername: 'server1.hosting.example.net', trustedCertificate, allowRootDeletes: true },
    }).state;
    assert.ok(decided);
    const server = decided.draft.servers[1];
    assert.ok(server);
    assert.equal(server.host, 'server1.hosting.example.net');
    assert.deepEqual(server.options.tls, { minVersion: 'TLSv1.2', servername: 'server1.hosting.example.net', trustedCertificate });
    assert.equal(server.options.allowRootDeletes, true);
    assert.equal(isDirty(decided), true);
    assert.match(decided.status, /Save to keep it/);
  });

  test('a trusted certificate is kept by tidyTls, and Forget Certificate removes it', () => {
    const server = structuredClone(asData(site).servers[1]);
    assert.ok(server);
    const trustedCertificate = { sha256: Array.from({ length: 32 }, () => 'AB').join(':'), validTo: '2027-01-01T00:00:00.000Z', pinnedAt: new Date().toISOString() };
    server.options.tls = { minVersion: 'TLSv1.2', trustedCertificate };
    tidyTls(server);
    assert.deepEqual(server.options.tls, { minVersion: 'TLSv1.2', trustedCertificate });
    const withCertificate = receive(start(), { type: 'decided', serverId: staging.id, decisions: { trustedCertificate } }).state ?? start();
    const forgotten = act(withCertificate, { type: 'forgetCertificate', serverId: staging.id });
    assert.equal(forgotten.draft.servers[1]?.options.tls, undefined);
    assert.match(forgotten.status, /verifies the certificate again/);
  });

  test('problems from a save open the field they belong to', () => {
    const message: ToWebview = { type: 'problems', problems: [{ path: 'servers.1.options.tls.caFile', message: 'File not found.' }], message: 'Not saved.' };
    const result = receive(start(), message);
    assert.equal(result.focusProblem, true);
    assert.ok(result.state);
    assert.equal(result.state.category, 'servers');
    assert.equal(result.state.editing, staging.id);
    assert.equal(result.state.tab, 'advanced');
    assert.equal(result.state.remote['servers.1.options.tls.caFile'], 'File not found.');
  });

  test('a problem for no field is listed as it is', () => {
    const result = receive(start(), { type: 'problems', problems: [{ path: 'servers', message: 'Too many.' }], message: 'Not saved.' });
    assert.deepEqual(result.state?.general, ['servers: Too many.']);
  });

  test('a password saved or a host key pinned elsewhere reaches the draft without losing its edits', () => {
    let state = edit(start(), 'name', 'Sample App');
    const after = asData(site);
    const [first] = after.servers;
    assert.ok(first);
    first.auth = { method: 'password', savePassword: true };
    first.options.hostKey = { algorithm: 'ssh-ed25519', sha256: 'C'.repeat(43), pinnedAt: new Date().toISOString() };
    state = receive(state, { type: 'serverState', site: after, passwordSaved: { [production.id]: true } }).state ?? state;
    assert.equal(state.draft.name, 'Sample App');
    assert.equal(state.draft.servers[0]?.auth?.savePassword, true);
    assert.equal(state.draft.servers[0].options.hostKey?.sha256, 'C'.repeat(43));
    state = act(state, { type: 'forgetHostKey', serverId: production.id });
    assert.equal(state.draft.servers[0]?.options.hostKey, undefined);
  });

  test('a picked file or folder fills its field', () => {
    const file = path.join(tmpdir(), 'ca.pem');
    const state = receive(start(), { type: 'picked', target: { kind: 'caFile', serverId: staging.id }, path: file }).state;
    assert.equal(state?.draft.servers[1]?.options.tls?.caFile, file);
  });

  test('the cloak count reads as a sentence', () => {
    assert.equal(receive(start(), { type: 'cloakCount', enabled: true, files: 1, folders: 2, complete: false }).state?.cloak, 'Cloaks at least 1 file and 2 folders in the local folder.');
    assert.equal(receive(start(), { type: 'cloakCount', enabled: false, files: 0, folders: 0, complete: true }).state?.cloak, 'Cloaking is off, so nothing is cloaked.');
  });
});

function nodes(state: State): VNode[] {
  return [...walk(view(state))];
}

function pages(): { name: string; state: State }[] {
  const categories: Category[] = ['site', 'servers', 'local', 'cloaking', 'sync', 'security'];
  const list: { name: string; state: State }[] = categories.map((category) => ({ name: category, state: act(start(), { type: 'navigate', category }) }));
  for (const server of site.servers) {
    for (const tab of ['basic', 'advanced'] as const) {
      let state = act(start(), { type: 'navigate', category: 'servers' });
      state = act(act(state, { type: 'select', serverId: server.id }), { type: 'editServer' });
      list.push({ name: `${server.name} ${tab}`, state: act(state, { type: 'tab', tab }) });
    }
  }
  const failing = receive(start(), {
    type: 'problems',
    problems: [
      { path: 'name', message: 'This field is needed.' },
      { path: 'servers.0.host', message: 'Required for the "sftp" protocol.' },
    ],
    message: 'Not saved.',
  }).state;
  assert.ok(failing);
  list.push({ name: 'with problems', state: failing });
  return list;
}

describe('the page', () => {
  for (const { name, state } of pages()) {
    test(`${name}: every control has a visible label, and every description it points to exists`, () => {
      const all = nodes(state);
      const ids = new Set(all.map((node) => node.attrs.id).filter((id) => typeof id === 'string'));
      const labelled = new Set(all.filter((node) => node.tag === 'label').map((node) => node.attrs.for));
      for (const control of all.filter((node) => ['input', 'select', 'textarea'].includes(node.tag))) {
        const named = typeof control.attrs['aria-label'] === 'string' || labelled.has(control.attrs.id);
        assert.ok(named, `${control.tag} ${String(control.attrs.id)} has a label`);
        assert.equal(control.attrs.placeholder !== undefined && !named, false);
      }
      for (const node of all) {
        for (const id of String(node.attrs['aria-describedby'] ?? '').split(' ').filter((part) => part !== '')) {
          assert.ok(ids.has(id), `${id} exists`);
        }
        assert.ok(!('style' in node.attrs), 'no inline style');
        assert.ok(!Object.keys(node.attrs).some((key) => /^on/i.test(key)), 'no inline handler');
      }
      for (const node of all) {
        if ('data-on-click' in node.attrs) {
          assert.ok(['button', 'input'].includes(node.tag), `${node.tag} with a click action is a native control`);
        }
        assert.ok(Number(node.attrs.tabindex ?? 0) <= 0, 'the tab order follows the page');
      }
      const buttons = all.filter((node) => node.tag === 'button');
      assert.equal(buttons.filter((node) => node.attrs.class === 'primary').length, 1, 'one primary button');
      assert.ok(buttons.every((node) => node.attrs.type === 'button'));
      assert.ok(buttons.every((node) => textOf(node).trim() !== ''), 'every button has words');
    });
  }

  test('a field with a problem is marked invalid and described by its problem', () => {
    const state = pages().find((page) => page.name === 'with problems')?.state;
    assert.ok(state);
    const input = nodes(state).find((node) => node.attrs.id === 'f-name');
    assert.equal(input?.attrs['aria-invalid'], 'true');
    assert.match(String(input.attrs['aria-describedby']), /f-name-problem/);
    const nav = nodes(state).find((node) => node.attrs.id === 'nav-servers');
    assert.ok(nav && textOf(nav).includes('has problems'), 'the category says it has problems in words');
  });

  test('the server editor uses tabs that say which one is selected', () => {
    const state = pages().find((page) => page.name === 'Production advanced')?.state;
    assert.ok(state);
    const tabs = nodes(state).filter((node) => node.attrs.role === 'tab');
    assert.deepEqual(
      tabs.map((node) => [node.attrs.id, node.attrs['aria-selected'], node.attrs.tabindex]),
      [
        ['tab-basic', 'false', -1],
        ['tab-advanced', 'true', 0],
      ],
    );
    const panel = nodes(state).find((node) => node.attrs.role === 'tabpanel');
    assert.equal(panel?.attrs['aria-labelledby'], 'tab-advanced');
  });

  test('the password is never part of the form: only whether one is saved', () => {
    let state = act(start(), { type: 'navigate', category: 'servers' });
    state = act(act(state, { type: 'select', serverId: production.id }), { type: 'editServer' });
    const all = nodes(state);
    assert.ok(!all.some((node) => node.attrs.type === 'password'));
    assert.equal(textOf(all.find((node) => node.attrs.id === 'password-state') ?? ''), 'Password: Saved');
  });

  test('a server reads Protocol, Host and User, with Browse... beside the root directory and Web URL under Advanced', () => {
    let state = act(start(), { type: 'navigate', category: 'servers' });
    state = act(act(state, { type: 'select', serverId: production.id }), { type: 'editServer' });
    const labels = new Map(nodes(state).filter((node) => node.tag === 'label').map((node) => [node.attrs.for, textOf(node).replace('(optional)', '').trim()]));
    assert.equal(labels.get('f-protocol'), 'Protocol');
    assert.equal(labels.get('f-host'), 'Host');
    assert.equal(labels.get('f-username'), 'User');
    assert.equal(labels.get('f-remoteRoot'), 'Root directory');
    assert.equal(labels.has('f-webUrl'), false);
    const browse = nodes(state).find((node) => node.tag === 'button' && String(node.attrs['data-on-click']).includes('remoteRoot'));
    assert.ok(browse, 'Browse... for the root directory');
    assert.match(textOf(browse), /Browse/);
    const advanced = nodes(act(state, { type: 'tab', tab: 'advanced' }));
    assert.ok(advanced.some((node) => node.tag === 'label' && node.attrs.for === 'f-webUrl'));
  });

  test('an FTPS server shows its trusted certificate with Forget Certificate', () => {
    const trustedCertificate = { sha256: Array.from({ length: 32 }, () => 'AB').join(':'), validTo: '2027-01-01T00:00:00.000Z', pinnedAt: new Date().toISOString() };
    let state = receive(start(), { type: 'decided', serverId: staging.id, decisions: { trustedCertificate } }).state ?? start();
    state = act(act(act(state, { type: 'navigate', category: 'servers' }), { type: 'select', serverId: staging.id }), { type: 'editServer' });
    const all = nodes(act(state, { type: 'tab', tab: 'advanced' }));
    assert.ok(all.some((node) => textOf(node).includes(trustedCertificate.sha256)));
    assert.ok(all.some((node) => node.tag === 'button' && textOf(node).trim() === 'Forget Certificate'));
  });

  test('plain FTP shows its warning beside the switch that allows it', () => {
    let state = act(start(), { type: 'navigate', category: 'servers' });
    state = act(act(state, { type: 'select', serverId: staging.id }), { type: 'editServer' });
    state = edit(state, 'protocol', 'ftp');
    const warning = nodes(state).find((node) => node.attrs.id === 'f-allowInsecure-warning');
    assert.match(textOf(warning ?? ''), /clear text/);
  });
});

describe('global cloaking in the form', () => {
  test('Cloaking lists the global patterns; Use global patterns is written only when off; the button asks the extension', () => {
    const state = act(start(), { type: 'navigate', category: 'cloaking' });
    const shown = textOf(view(state));
    assert.match(shown, /Global patterns/);
    assert.match(shown, /node_modules\//);
    assert.match(shown, /Edit Global Patterns\.\.\./);
    const off = update(state, { type: 'field', field: 'useGlobalPatterns' }, false, randomUUID);
    assert.equal(off.state.draft.cloaking.useGlobalPatterns, false);
    assert.equal(off.messages[0]?.type, 'countCloaked');
    assert.match(textOf(view(off.state)), /Not used by this site/);
    const on = update(off.state, { type: 'field', field: 'useGlobalPatterns' }, true, randomUUID);
    assert.equal('useGlobalPatterns' in on.state.draft.cloaking, false, 'on is the default, so it is not written');
    assert.deepEqual(update(state, { type: 'editGlobalPatterns' }, undefined, randomUUID).messages, [{ type: 'editGlobalPatterns' }]);
    const changed = receive(state, { type: 'globalPatterns', patterns: ['*.lnk'] }).state;
    assert.deepEqual(changed?.globalPatterns, ['*.lnk']);
    const none = receive(state, { type: 'globalPatterns', patterns: [] }).state;
    assert.ok(none);
    assert.match(textOf(view(none)), /No global patterns yet\./);
  });
});
