// Runs inside VS Code: the Sites view, the commands that change the list of
// sites, and the command line seeing the same list. The command line runs as
// a child process on the extension host's own Node.js, with the same
// temporary SYNC_SERVERS_HOME.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openSecret, type SecretRef } from '@isocialpractice/cmd-sync-servers';
import * as vscode from 'vscode';
import { OPEN_SETTINGS, RESET } from '../../src/commands/servers.ts';
import { REMOVE_SITE } from '../../src/commands/sites.ts';
import type { TestApi } from '../../src/extension.ts';
import type { SitesNode } from '../../src/views/sites-view.ts';
import { listedSites, secretGone as gone, syncServers, testApi, waitFor } from '../helpers/extension.ts';
import { ScriptedPrompter } from '../helpers/prompter.ts';

suite('Sites', () => {
  const prompter = new ScriptedPrompter();
  const work = mkdtempSync(path.join(tmpdir(), 'sync-servers-sites-'));
  let api: TestApi;

  const folder = (name: string): string => {
    const dir = path.join(work, name);
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  const labels = (): string[] =>
    api.sitesView.getChildren().map((node) => {
      const { label } = api.sitesView.getTreeItem(node);
      return typeof label === 'object' ? label.label : (label ?? '');
    });
  const siteNode = (name: string): SitesNode => {
    const node = api.sitesView.getChildren().find((candidate) => candidate.kind === 'site' && candidate.site.name === name);
    assert.ok(node, `${name} is in the Sites view`);
    return node;
  };
  const serverNode = (siteName: string, serverName: string): SitesNode => {
    const node = api.sitesView.getChildren(siteNode(siteName)).find((candidate) => candidate.kind === 'server' && candidate.server.name === serverName);
    assert.ok(node, `${siteName}: ${serverName} is in the Sites view`);
    return node;
  };
  const siteId = (name: string): string => {
    const site = api.model.sites.find((candidate) => candidate.name === name);
    assert.ok(site, name);
    return site.id;
  };
  const lastMessage = (): string => prompter.messages.at(-1) ?? '';
  const secretGone = (ref: SecretRef): Promise<void> => gone(api, ref);

  suiteSetup(async () => {
    api = await testApi();
    api.usePrompter(prompter);
  });

  suiteTeardown(() => {
    api.usePrompter(undefined);
  });

  test('a site added by the command line appears in the Sites view without a reload', async () => {
    const added = syncServers('site', 'add', '--name', 'Acme Corp', '--local-root', folder('acme'));
    assert.equal(added.status, 0, added.stderr);
    await waitFor('Acme Corp in the Sites view', () => labels().includes('Acme Corp'));
  });

  test('a site added in the view is listed by sync-servers sites, its folder server named after the folder', async () => {
    prompter.answer('My Site', folder('my-site'), 'local', folder('my-site-backup'));
    await vscode.commands.executeCommand('syncServers.addSite');
    assert.equal(prompter.remaining, 0);
    assert.equal(lastMessage(), 'Added "My Site" with the server my-site-backup.');
    const listed = listedSites().find((site) => site.name === 'My Site');
    assert.equal(listed?.remoteServer?.name, 'my-site-backup');
    assert.ok(labels().includes('My Site'));
  });

  test('the first site added in a window becomes its active site, shown in the status bar', () => {
    assert.equal(api.model.activeSite?.name, 'My Site');
    assert.equal(api.statusBar.text, '$(cloud) My Site: my-site-backup');
  });

  test('Add Site connects before it adds anything: a refused connection offers Save Without Testing, which keeps no password', async () => {
    const password = randomBytes(16).toString('hex');
    const shown = prompter.shown.length;
    prompter.answer('Sample App', folder('sample-app'), 'sftp', '127.0.0.1:1', 'demo-user', password, undefined);
    await vscode.commands.executeCommand('syncServers.addSite');
    assert.equal(prompter.remaining, 0);
    assert.ok(!api.model.sites.some((site) => site.name === 'Sample App'), 'cancelled: nothing added');
    assert.match(prompter.messages.slice(shown).join('\n'), /127\.0\.0\.1 refused the connection on port 1\./);

    prompter.answer('Sample App', folder('sample-app'), 'sftp', '127.0.0.1:1', 'demo-user', password, 'save', '/var/www/sample-app');
    await vscode.commands.executeCommand('syncServers.addSite');
    assert.equal(prompter.remaining, 0);
    assert.equal(lastMessage(), 'Added "Sample App" with the server 127.0.0.1. The connection was not tested.');
    const site = api.model.sites.find((candidate) => candidate.name === 'Sample App');
    const server = site?.servers[0];
    assert.ok(site && server);
    assert.deepEqual([server.host, server.port, server.username, server.remoteRoot, server.auth?.savePassword], ['127.0.0.1', 1, 'demo-user', '/var/www/sample-app', false]);
    assert.equal(await api.credentials.get({ siteId: site.id, serverId: server.id, kind: 'password' }), undefined);
    assert.ok(!api.logRecords.some((record) => JSON.stringify(record).includes(password)), 'the password is never logged');
    await api.model.registry().remove(site.id);
    api.model.refresh();
  });

  test('Switch Site makes another site active and records it for the command line', async () => {
    const acme = siteId('Acme Corp');
    prompter.answer(acme);
    await vscode.commands.executeCommand('syncServers.switchSite');
    assert.equal(api.model.activeSite?.name, 'Acme Corp');
    assert.equal(api.statusBar.text, '$(cloud) Acme Corp: No Remote server');
    const file = JSON.parse(readFileSync(api.model.paths?.sitesFile ?? '', 'utf8')) as { lastSelectedSiteId?: string };
    assert.equal(file.lastSelectedSiteId, acme);
  });

  test('Test Connection reaches a local folder server and counts its root folder', async () => {
    writeFileSync(path.join(work, 'my-site-backup', 'index.html'), '<p>Hello from My Site</p>\n');
    await vscode.commands.executeCommand('syncServers.testConnection', siteNode('My Site'));
    assert.match(lastMessage(), /^Connected to "My Site: my-site-backup"\. Its root folder holds 1 item\(s\)\./);
  });

  test('Test Connection offers Site Settings for a local folder server whose folder is gone', async () => {
    const site = api.model.sites.find((candidate) => candidate.name === 'My Site');
    const server = site?.servers[0];
    assert.ok(site && server);
    await api.model.registry().updateServer(site.id, server.id, (draft) => {
      draft.remoteRoot = path.join(work, 'missing-backup');
    });
    api.model.refresh();
    await vscode.commands.executeCommand('syncServers.testConnection', siteNode('My Site'));
    const failure = prompter.shown.at(-1);
    assert.equal(failure?.kind, 'error');
    assert.deepEqual(failure.actions, [OPEN_SETTINGS, 'Show Log']);
    await api.model.registry().updateServer(site.id, server.id, (draft) => {
      draft.remoteRoot = path.join(work, 'my-site-backup');
    });
    api.model.refresh();
  });

  test('Set Password keeps the password in secret storage, tied to the server; Forget Password removes it', async () => {
    const added = syncServers(
      'server', 'add', '--site', 'Acme Corp', '--name', 'Production', '--protocol', 'sftp',
      '--host', 'sftp.example.com', '--user', 'demo-user', '--remote-root', '/var/www/acme',
    );
    assert.equal(added.status, 0, added.stderr);
    const acme = siteId('Acme Corp');
    await waitFor('Production under Acme Corp', () => api.model.site(acme)?.servers.length === 1);
    const node = serverNode('Acme Corp', 'Production');
    const password = randomBytes(16).toString('hex');
    prompter.answer(password);
    await vscode.commands.executeCommand('syncServers.setPassword', node);
    assert.match(lastMessage(), /^Saved the password of "Acme Corp: Production"/);

    const server = api.model.site(acme)?.servers[0];
    assert.ok(server);
    assert.equal(server.auth?.savePassword, true);
    const ref: SecretRef = { siteId: acme, serverId: server.id, kind: 'password' };
    const stored = await api.credentials.get(ref);
    // Secrets are compared with assert.ok, so a failure never prints one.
    assert.ok(openSecret(stored ?? '', server) === password, 'saved for this server');
    assert.ok(openSecret(stored ?? '', { ...server, host: 'sftp.example.net' }) === undefined, 'never for another address');
    assert.ok(!readFileSync(api.model.paths?.sitesFile ?? '', 'utf8').includes(password), 'never in sites.json');

    await vscode.commands.executeCommand('syncServers.forgetPassword', node);
    await secretGone(ref);
    assert.equal(api.model.site(acme)?.servers[0]?.auth?.savePassword, false);
    assert.equal(lastMessage(), 'Forgot the saved password of "Acme Corp: Production".');
  });

  test('a local folder server needs no password', async () => {
    await vscode.commands.executeCommand('syncServers.setPassword', serverNode('My Site', 'my-site-backup'));
    assert.equal(lastMessage(), '"My Site: my-site-backup" is a folder and needs no password.');
  });

  test('Reset Sync Information asks first', async () => {
    const before = prompter.messages.length;
    prompter.answer(undefined);
    await vscode.commands.executeCommand('syncServers.resetSyncInformation', siteNode('My Site'));
    assert.equal(prompter.messages.length, before, 'cancelled: nothing happened');
    prompter.answer(RESET);
    await vscode.commands.executeCommand('syncServers.resetSyncInformation', siteNode('My Site'));
    assert.match(lastMessage(), /^Forgot the sync records of "My Site: my-site-backup"\./);
  });

  test('Remove Site asks first, forgets the saved passwords, and the command line no longer lists the site', async () => {
    const acme = siteId('Acme Corp');
    const node = serverNode('Acme Corp', 'Production');
    const shown = prompter.shown.length;
    prompter.answer(randomBytes(16).toString('hex'));
    await vscode.commands.executeCommand('syncServers.setPassword', node);
    const server = api.model.site(acme)?.servers[0];
    assert.ok(server);
    const ref: SecretRef = { siteId: acme, serverId: server.id, kind: 'password' };
    assert.ok((await api.credentials.get(ref)) !== undefined, 'saved');

    prompter.answer(undefined);
    await vscode.commands.executeCommand('syncServers.removeSite', siteNode('Acme Corp'));
    assert.ok(listedSites().some((site) => site.name === 'Acme Corp'), 'cancelled: still listed');

    prompter.answer(REMOVE_SITE);
    await vscode.commands.executeCommand('syncServers.removeSite', siteNode('Acme Corp'));
    assert.deepEqual(prompter.shown.slice(shown).filter((entry) => entry.kind === 'error'), []);
    assert.ok(!listedSites().some((site) => site.name === 'Acme Corp'));
    assert.ok(!labels().includes('Acme Corp'));
    const removal = api.logRecords.find((record) => record.message === 'Saved secrets of a removed site forgotten');
    assert.deepEqual(removal?.fields, { siteId: acme, servers: 1, forgotten: 1 });
    await secretGone(ref);
    assert.equal(api.model.activeSite, undefined, 'the removed site was active');
    assert.equal(api.statusBar.text, '$(cloud) Sync Servers');
  });

  test('an unreadable sites.json is shown in the view until it is fixed', async () => {
    const file = api.model.paths?.sitesFile ?? '';
    const good = readFileSync(file, 'utf8');
    writeFileSync(file, '{ "schemaVersion": ');
    await waitFor('the problem row', () => api.sitesView.getChildren()[0]?.kind === 'problem');
    writeFileSync(file, good);
    await waitFor('the sites again', () => labels().includes('My Site'));
  });
});
