// Runs inside VS Code: the Site Settings panel, fed messages as its webview
// would send them, malformed ones included. The tests read what the panel
// sends back, the list of sites, and the command line's view of it.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { siteSchema, type SecretRef } from '@isocialpractice/cmd-sync-servers';
import * as vscode from 'vscode';
import type { TestApi } from '../../src/extension.ts';
import { DISCARD, RELOAD, type SiteSettingsPanel } from '../../src/settings/panel.ts';
import type { ToWebview } from '../../src/shared/messages.ts';
import type { SiteData } from '../../src/shared/site-data.ts';
import { listedSites, secretGone, syncServers, testApi, waitFor } from '../helpers/extension.ts';
import { ScriptedPrompter } from '../helpers/prompter.ts';

type Posted<T extends ToWebview['type']> = Extract<ToWebview, { type: T }>;

suite('Site Settings', () => {
  const prompter = new ScriptedPrompter();
  const work = mkdtempSync(path.join(tmpdir(), 'sync-servers-settings-'));
  const password = randomBytes(16).toString('hex');
  let api: TestApi;
  let panel: SiteSettingsPanel;
  let siteId: string;

  const folder = (name: string): string => {
    const dir = path.join(work, name);
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  const last = <T extends ToWebview['type']>(type: T): Posted<T> => {
    const found = [...panel.posted].reverse().find((message) => message.type === type);
    assert.ok(found, `the panel sent ${type}`);
    return found as Posted<T>;
  };
  const sitesFile = (): string => readFileSync(api.model.paths?.sitesFile ?? '', 'utf8');
  const noSecretPosted = (secret: string): void => {
    // Compared with assert.ok, so a failure never prints the secret.
    assert.ok(!JSON.stringify(panel.posted).includes(secret), 'no message to the webview carries the password');
  };

  suiteSetup(async () => {
    api = await testApi();
    api.usePrompter(prompter);
    const site = await api.model.registry().add({
      name: 'Sample App',
      localRoot: folder('sample-app'),
      servers: [
        { name: 'Production', protocol: 'sftp', host: 'sftp.example.com', username: 'demo-user', remoteRoot: '/var/www/sample-app' },
        { name: 'Staging', protocol: 'ftps', host: 'ftp.example.org', remoteRoot: '/' },
        { name: 'Backup', protocol: 'local', remoteRoot: folder('sample-app-backup') },
      ],
    });
    siteId = site.id;
    api.model.refresh();
    prompter.answer(password);
    await vscode.commands.executeCommand('syncServers.setPassword', { kind: 'server', site, server: site.servers[0] });
    await vscode.commands.executeCommand('syncServers.siteSettings', { kind: 'site', site });
    const opened = api.siteSettings.panel(siteId);
    assert.ok(opened, 'Site Settings opened');
    panel = opened;
  });

  suiteTeardown(() => {
    api.siteSettings.panel(siteId)?.dispose();
    api.usePrompter(undefined);
  });

  const pageProblems = (): string[] =>
    api.logRecords.filter((record) => record.message === 'The Site Settings page reported a problem').map((record) => String(record.fields?.problem));

  test('the page loads under its Content-Security-Policy and asks for the site', async () => {
    await waitFor('the page to ask for the site', () => panel.posted.some((message) => message.type === 'load'));
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.deepEqual(pageProblems(), []);
  });

  test('the form gets the site and whether each password is saved, never a password', async () => {
    await panel.receive({ type: 'ready' });
    const load = last('load');
    assert.equal(load.site.name, 'Sample App');
    const [production, staging] = load.site.servers;
    assert.ok(production && staging);
    assert.equal(load.passwordSaved[production.id], true);
    assert.equal(load.passwordSaved[staging.id], false);
    assert.ok(load.builtInGuard.includes('.env'));
    noSecretPosted(password);
  });

  test('malformed messages are dropped and change nothing', async () => {
    const posted = panel.posted.length;
    const file = sitesFile();
    const dropped = (): number => api.logRecords.filter((record) => record.message.startsWith('Dropped a message from Site Settings')).length;
    const before = dropped();
    const site = last('load').site;
    const malformed: unknown[] = [
      undefined,
      null,
      'save',
      { type: 'save' },
      { type: 'save', site: { ...site, extra: true } },
      { type: 'save', site: { ...site, name: 'x'.repeat(5000) } },
      { type: 'test', serverId: '../../etc' },
      { type: 'browse', target: { kind: 'localRoot', path: work } },
      { type: 'setPassword', serverId: randomUUID(), password: 'example' },
      { type: 'countCloaked', cloaking: { enabled: 'yes', patterns: [], paths: [] } },
      { type: 'eval', code: '1' },
    ];
    for (const message of malformed) {
      await panel.receive(message);
    }
    assert.equal(panel.posted.length, posted, 'nothing was sent back');
    assert.equal(sitesFile(), file, 'the list of sites is unchanged');
    assert.equal(dropped() - before, malformed.length, 'each was logged as dropped');
  });

  test('every field the form edits is saved, and the command line sees the change', async () => {
    const draft: SiteData = structuredClone(last('load').site);
    const [production, staging, backup] = draft.servers;
    assert.ok(production && staging && backup);
    draft.name = 'Sample App Renamed';
    draft.local = { webUrl: 'http://localhost:8080/', caseSensitive: true, cache: false };
    draft.cloaking = { enabled: false, patterns: ['.psd', 'node_modules/'], paths: ['drafts'] };
    draft.sync = {
      maintainInfo: false,
      compare: 'checksum',
      mtimeToleranceSeconds: 3,
      symlinks: 'follow-inside-root',
      concurrency: 8,
      guard: { enabled: false, patterns: ['*.bak'] },
      massDelete: { maxCount: 10, maxPercent: 50 },
      recovery: { enabled: false, keepDays: 7, maxMegabytes: 256 },
    };
    production.port = 2222;
    production.auth = { method: 'key', keyPath: path.join(work, 'id_ed25519'), savePassword: false };
    production.webUrl = 'https://www.example.com/';
    production.options = {
      passive: true,
      ipFamily: 4,
      timeoutSeconds: 60,
      allowRootDeletes: true,
      legacyAlgorithms: true,
      uploadOnSave: true,
      remoteFileMode: '644',
      remoteDirMode: '755',
    };
    staging.options.tls = { caFile: path.join(work, 'ca.pem'), servername: 'ftp.example.org', minVersion: 'TLSv1.3' };
    backup.remoteRoot = folder('sample-app-mirror');
    draft.remoteServerId = staging.id;
    draft.testingServerId = backup.id;

    await panel.receive({ type: 'save', site: draft });
    assert.equal(last('saved').message, 'Saved "Sample App Renamed".');
    assert.deepEqual(api.model.site(siteId), siteSchema.parse(draft));
    const listed = listedSites().find((site) => site.id === siteId);
    assert.equal(listed?.name, 'Sample App Renamed');
    assert.equal(listed.remoteServer?.name, 'Staging');
  });

  test('a save with problems names each field and changes nothing', async () => {
    const file = sitesFile();
    const draft: SiteData = structuredClone(last('saved').site);
    const [production, , backup] = draft.servers;
    assert.ok(production && backup);
    delete production.host;
    backup.remoteRoot = path.join(draft.localRoot, 'inside');
    await panel.receive({ type: 'save', site: draft });
    const problems = last('problems');
    assert.deepEqual(problems.problems.map((problem) => problem.path).sort(), ['servers.0.host', 'servers.2.remoteRoot']);
    assert.equal(problems.message, 'Not saved: 2 problems need fixing.');
    assert.equal(sitesFile(), file);
  });

  test('a host key the form was never given is refused', async () => {
    const file = sitesFile();
    const draft: SiteData = structuredClone(last('saved').site);
    const [production] = draft.servers;
    assert.ok(production);
    production.options.hostKey = { algorithm: 'ssh-ed25519', sha256: 'A'.repeat(43), pinnedAt: new Date().toISOString() };
    await panel.receive({ type: 'save', site: draft });
    assert.equal(last('problems').message, 'Not saved: the change was refused.');
    assert.equal(sitesFile(), file);
  });

  test('a change the command line made meanwhile is never overwritten without asking', async () => {
    const edited = syncServers('site', 'edit', 'Sample App Renamed', '--name', 'Sample App Elsewhere');
    assert.equal(edited.status, 0, edited.stderr);
    await waitFor('the change from the command line', () => api.model.site(siteId)?.name === 'Sample App Elsewhere');
    const draft: SiteData = structuredClone(last('saved').site);
    draft.local.cache = true;
    prompter.answer(RELOAD);
    await panel.receive({ type: 'save', site: draft });
    assert.equal(last('load').site.name, 'Sample App Elsewhere', 'the form reloads with the change');
    assert.equal(api.model.site(siteId)?.local.cache, false, 'nothing was saved');
    const again: SiteData = structuredClone(last('load').site);
    again.local.cache = true;
    await panel.receive({ type: 'save', site: again });
    assert.equal(last('saved').site.local.cache, true, 'a save from the reloaded form needs no question');
  });

  test('Browse... fills its field with the folder picked', async () => {
    const picked = folder('sample-app-moved');
    prompter.answer(picked);
    await panel.receive({ type: 'browse', target: { kind: 'localRoot' } });
    assert.equal(last('picked').path, picked);
  });

  test('the count of cloaked files follows the patterns', async () => {
    const root = api.model.site(siteId)?.localRoot ?? '';
    mkdirSync(path.join(root, 'img'), { recursive: true });
    writeFileSync(path.join(root, 'img', 'hero.psd'), 'x');
    writeFileSync(path.join(root, 'index.html'), 'x');
    const count = panel.posted.length;
    await panel.receive({ type: 'countCloaked', cloaking: { enabled: true, patterns: ['.psd'], paths: [] } });
    await waitFor('the count', () => panel.posted.slice(count).some((message) => message.type === 'cloakCount'));
    const result = last('cloakCount');
    assert.deepEqual([result.files, result.folders, result.complete], [1, 0, true]);
  });

  test('the form shows the global patterns as they change, counts with them, and keeps a site that stops using them', async () => {
    await panel.receive({ type: 'ready' });
    const root = api.model.site(siteId)?.localRoot ?? '';
    writeFileSync(path.join(root, 'Shortcut.lnk'), 'x');
    try {
      await api.model.registry().updateGlobalCloaking((cloaking) => {
        cloaking.patterns = ['*.lnk'];
      });
      api.model.refresh();
      await waitFor('the global patterns', () => panel.posted.some((message) => message.type === 'globalPatterns' && message.patterns.includes('*.lnk')));
      const count = panel.posted.length;
      await panel.receive({ type: 'countCloaked', cloaking: { enabled: true, patterns: [], paths: [] } });
      await waitFor('the count', () => panel.posted.slice(count).some((message) => message.type === 'cloakCount'));
      assert.equal(last('cloakCount').files, 1);

      const data = structuredClone<SiteData>(api.model.site(siteId) ?? assert.fail('the site is there'));
      data.cloaking.useGlobalPatterns = false;
      await panel.receive({ type: 'save', site: data });
      assert.equal(api.model.site(siteId)?.cloaking.useGlobalPatterns, false);
      assert.match(sitesFile(), /"useGlobalPatterns": false/);
      await panel.receive({ type: 'ready' });
      assert.equal(last('load').site.cloaking.useGlobalPatterns, false);
      assert.deepEqual(last('load').globalPatterns, ['*.lnk']);

      prompter.answer(undefined);
      await panel.receive({ type: 'editGlobalPatterns' });
      assert.equal((prompter.asked.at(-1)?.question as { title?: string }).title, 'Global Cloaking Patterns');

      delete data.cloaking.useGlobalPatterns;
      await panel.receive({ type: 'save', site: data });
      assert.doesNotMatch(sitesFile(), /useGlobalPatterns/);
    } finally {
      await api.model.registry().updateGlobalCloaking((cloaking) => {
        cloaking.patterns = [];
      });
      api.model.refresh();
    }
  });

  const shownServer = (index: number): SiteData['servers'][number] => {
    const site = api.model.site(siteId);
    assert.ok(site);
    const server = structuredClone<SiteData>(site).servers[index];
    assert.ok(server);
    return server;
  };

  test('Test reaches the local folder server and reports in the form', async () => {
    const backup = shownServer(2);
    await panel.receive({ type: 'test', serverId: backup.id, server: backup });
    const result = last('testResult');
    assert.equal(result.ok, true);
    assert.match(result.text, /^The folder .*sample-app-mirror is there\./);
  });

  test('Test uses what the form shows before it is saved, and saves nothing', async () => {
    const file = sitesFile();
    const backup = { ...shownServer(2), remoteRoot: path.join(work, 'not-made-yet') };
    await panel.receive({ type: 'test', serverId: backup.id, server: backup });
    assert.equal(last('testResult').ok, false);
    assert.match(last('testResult').text, /not-made-yet was not found/);

    const production = { ...shownServer(0), host: '127.0.0.1', port: 1 };
    await panel.receive({ type: 'test', serverId: production.id, server: production });
    assert.equal(last('testResult').ok, false);
    assert.match(last('testResult').text, /^Could not connect to 127\.0\.0\.1\. 127\.0\.0\.1 refused the connection on port 1\./);
    assert.equal(sitesFile(), file, 'nothing was saved');
  });

  test('Test refuses a host key or certificate the form was never given, and connects nowhere', async () => {
    const production = shownServer(0);
    production.host = '127.0.0.1';
    production.port = 1;
    production.options.hostKey = { algorithm: 'ssh-ed25519', sha256: 'A'.repeat(43), pinnedAt: new Date().toISOString() };
    await panel.receive({ type: 'test', serverId: production.id, server: production });
    assert.equal(last('testResult').ok, false);
    assert.match(last('testResult').text, /^Not tested: The form sent a host key it was not given\./);
    const refused = api.logRecords.filter((record) => record.message === 'Dropped a server from Site Settings that the form cannot make');
    assert.equal(refused.length, 1);
  });

  test('Browse... for the root directory connects with what the form shows, and reports a failure', async () => {
    const production = { ...shownServer(0), host: '127.0.0.1', port: 1 };
    const posted = panel.posted.length;
    await panel.receive({ type: 'browse', target: { kind: 'remoteRoot', serverId: production.id }, server: production });
    assert.match(prompter.messages.at(-1) ?? '', /^Could not connect to 127\.0\.0\.1\. 127\.0\.0\.1 refused the connection on port 1\./);
    assert.ok(!panel.posted.slice(posted).some((message) => message.type === 'picked'), 'nothing was picked');
  });

  test('Set Password from the form tells the form whether one is saved, never what it is', async () => {
    const staging = api.model.site(siteId)?.servers[1];
    assert.ok(staging);
    const secret = randomBytes(16).toString('hex');
    prompter.answer(secret);
    await panel.receive({ type: 'setPassword', serverId: staging.id });
    const state = last('serverState');
    assert.equal(state.passwordSaved[staging.id], true);
    assert.equal(state.site.servers[1]?.auth?.savePassword, true);
    noSecretPosted(secret);
    noSecretPosted(password);
  });

  test('a server removed in the form has its saved password forgotten', async () => {
    const site = api.model.site(siteId);
    const staging = site?.servers[1];
    assert.ok(site && staging);
    const ref: SecretRef = { siteId, serverId: staging.id, kind: 'password' };
    assert.ok((await api.credentials.get(ref)) !== undefined, 'saved');
    const draft: SiteData = structuredClone(last('serverState').site);
    draft.servers = draft.servers.filter((server) => server.id !== staging.id);
    draft.remoteServerId = draft.servers[0]?.id;
    delete draft.testingServerId;
    await panel.receive({ type: 'save', site: draft });
    assert.equal(last('saved').site.servers.length, 2);
    await secretGone(api, ref);
  });

  test('the page drew every message it was sent without a problem', () => {
    assert.deepEqual(pageProblems(), []);
  });

  test('the page loads in the light, dark and both high contrast themes, and at 200 % zoom', async () => {
    const workbench = vscode.workspace.getConfiguration('workbench');
    const window = vscode.workspace.getConfiguration('window');
    const site = api.model.site(siteId);
    assert.ok(site);
    const looks: [string, number][] = [
      ['Default Light Modern', 0],
      ['Default Dark Modern', 0],
      ['Default High Contrast', 0],
      ['Default High Contrast Light', 0],
      ['Default Dark Modern', 3.8],
    ];
    try {
      for (const [theme, zoom] of looks) {
        await workbench.update('colorTheme', theme, vscode.ConfigurationTarget.Global);
        await window.update('zoomLevel', zoom, vscode.ConfigurationTarget.Global);
        api.siteSettings.panel(siteId)?.dispose();
        const opened = api.siteSettings.open(site);
        await waitFor(`the page in ${theme}`, () => opened.posted.some((message) => message.type === 'load'));
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.deepEqual(pageProblems(), [], theme);
        panel = opened;
      }
    } finally {
      await workbench.update('colorTheme', undefined, vscode.ConfigurationTarget.Global);
      await window.update('zoomLevel', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test('Cancel with unsaved changes asks first', async () => {
    prompter.answer(undefined);
    await panel.receive({ type: 'cancel', dirty: true });
    assert.ok(api.siteSettings.panel(siteId), 'still open');
    prompter.answer(DISCARD);
    await panel.receive({ type: 'cancel', dirty: true });
    assert.equal(api.siteSettings.panel(siteId), undefined, 'closed');
  });
});
