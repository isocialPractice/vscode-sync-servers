// Runs inside VS Code: the synchronization scenarios that apply to a local
// folder server, each through the extension's own commands, the Sync
// Preview and its row actions. Every scenario gets a fresh site.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Site } from '@isocialpractice/cmd-sync-servers';
import * as vscode from 'vscode';
import { wholeSiteButton } from '../../src/commands/sync.ts';
import { REMOTE_SCHEME } from '../../src/contributions.ts';
import type { TestApi } from '../../src/extension.ts';
import { deleteButton } from '../../src/preview/controller.ts';
import type { PreviewNode } from '../../src/preview/view.ts';
import { testApi } from '../helpers/extension.ts';
import { ScriptedPrompter } from '../helpers/prompter.ts';

const BASE = Date.UTC(2026, 0, 1);
const LATER = BASE + 3_600_000;

type Row = Extract<PreviewNode, { kind: 'row' }>;

suite('Synchronize', () => {
  const prompter = new ScriptedPrompter();
  const work = mkdtempSync(path.join(tmpdir(), 'sync-servers-sync-'));
  let api: TestApi;
  let count = 0;

  /** A fresh site whose Remote server is a local folder. */
  async function newSite(options: { patterns?: string[]; paths?: string[]; caseSensitive?: boolean } = {}): Promise<{ site: Site; local: string; remote: string }> {
    count += 1;
    const local = path.join(work, `site-${String(count)}`);
    const remote = path.join(work, `server-${String(count)}`);
    mkdirSync(local, { recursive: true });
    mkdirSync(remote, { recursive: true });
    const site = await api.model.registry().add({
      name: `Scenario ${String(count)}`,
      localRoot: local,
      servers: [{ name: 'Backup', protocol: 'local', remoteRoot: remote }],
      cloaking: { patterns: options.patterns ?? [], paths: options.paths ?? [] },
      ...(options.caseSensitive === undefined ? {} : { local: { caseSensitive: options.caseSensitive } }),
    });
    api.model.refresh();
    return { site, local, remote };
  }

  function write(root: string, name: string, content: string | Buffer, time = BASE): void {
    const file = path.join(root, ...name.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
    utimesSync(file, time / 1000, time / 1000);
  }

  function read(root: string, name: string): string | undefined {
    const file = path.join(root, ...name.split('/'));
    return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  }

  const node = (site: Site): unknown => ({ kind: 'site', site });
  const lastMessage = (): string => prompter.messages.at(-1) ?? '';

  /** Synchronize... with the two answers, then the preview's rows. */
  async function preview(site: Site, direction: 'put' | 'get' | 'both', deleteOrphans = false): Promise<void> {
    prompter.answer(direction, deleteOrphans);
    await vscode.commands.executeCommand('syncServers.synchronize', node(site));
  }

  function rows(): Row[] {
    return api.previewView.getChildren().flatMap((group) => api.previewView.getChildren(group)).filter((child): child is Row => child.kind === 'row');
  }

  function row(file: string): Row {
    const found = rows().find((candidate) => candidate.item.path === file);
    assert.ok(found, `${file} is in the Sync Preview`);
    return found;
  }

  function groups(): string[] {
    return api.previewView.getChildren().map((group) => (group.kind === 'group' ? group.label : ''));
  }

  async function run(): Promise<void> {
    await vscode.commands.executeCommand('syncServers.preview.synchronize');
  }

  /** Puts the files on both sides and records them as synchronized. */
  async function synced(site: Site, local: string, files: Record<string, string>): Promise<void> {
    for (const [name, content] of Object.entries(files)) {
      write(local, name, content);
    }
    await preview(site, 'put');
    await run();
    assert.match(lastMessage(), /^Synchronized \d+ files?\. 0 failed\./);
  }

  suiteSetup(async () => {
    api = await testApi();
    api.usePrompter(prompter);
  });

  suiteTeardown(async () => {
    await api.preview.close();
    api.usePrompter(undefined);
  });

  teardown(async () => {
    await api.preview.close();
    assert.equal(prompter.remaining, 0, 'every scripted answer was used');
  });

  test('first sync in each direction', async () => {
    const { site, local, remote } = await newSite();
    write(local, 'index.html', '<h1>Home</h1>');
    write(local, 'css/site.css', 'body {}');
    await preview(site, 'put');
    assert.deepEqual(groups(), ['Put']);
    assert.deepEqual(rows().map((entry) => [entry.item.path, entry.item.checked]), [
      ['css/site.css', true],
      ['index.html', true],
    ]);
    await run();
    assert.equal(lastMessage(), 'Synchronized 2 files. 0 failed. 0 skipped.');
    assert.equal(read(remote, 'css/site.css'), 'body {}');
    assert.equal(api.preview.pending, undefined, 'the preview closes after a clean run');

    write(remote, 'about.html', 'About');
    await preview(site, 'get');
    assert.deepEqual(groups(), ['Get']);
    await run();
    assert.equal(read(local, 'about.html'), 'About');

    await preview(site, 'both');
    assert.match(lastMessage(), /^"Scenario \d+" and Backup are in sync\. 3 files compared\./);
  });

  test('an edit on each side goes the right way', async () => {
    const { site, local, remote } = await newSite();
    await synced(site, local, { 'index.html': 'v1', 'about.html': 'v1' });
    write(local, 'index.html', 'v2 local', LATER);
    write(remote, 'about.html', 'v2 remote', LATER);
    await preview(site, 'both');
    assert.deepEqual(groups(), ['Put', 'Get']);
    await run();
    assert.equal(read(remote, 'index.html'), 'v2 local');
    assert.equal(read(local, 'about.html'), 'v2 remote');
  });

  test('a conflict waits for a decision, and each decision does what it says', async () => {
    const { site, local, remote } = await newSite();
    const files = { 'put.html': 'v1', 'get.html': 'v1', 'skip.html': 'v1', 'synced.html': 'v1' };
    await synced(site, local, files);
    for (const name of Object.keys(files)) {
      write(local, name, `${name} local edit`, LATER);
      write(remote, name, `${name} remote edit!`, LATER);
    }
    await preview(site, 'put');
    assert.deepEqual(groups(), ['Resolve']);
    assert.ok(rows().every((entry) => api.previewView.getTreeItem(entry).checkboxState === undefined), 'no checkbox before a decision');
    assert.equal(api.statusBar.warning, true, 'the status bar warns while files need a decision');
    assert.match(api.statusBar.text, /4 need a decision$/);

    await run();
    assert.equal(lastMessage(), 'No file is checked. Choose an action for the files that need a decision.');

    await vscode.commands.executeCommand('syncServers.preview.useLocal', row('put.html'));
    await vscode.commands.executeCommand('syncServers.preview.useRemote', row('get.html'));
    await vscode.commands.executeCommand('syncServers.preview.skip', row('skip.html'));
    await vscode.commands.executeCommand('syncServers.preview.markSynchronized', row('synced.html'));
    assert.deepEqual(groups(), ['Put', 'Get', 'Skip']);
    await run();
    assert.equal(read(remote, 'put.html'), 'put.html local edit');
    assert.equal(read(local, 'get.html'), 'get.html remote edit!');
    assert.equal(read(remote, 'skip.html'), 'skip.html remote edit!');
    assert.equal(api.statusBar.warning, false);

    await preview(site, 'both');
    assert.deepEqual(rows().map((entry) => [entry.item.path, entry.item.action]), [['skip.html', 'resolve']]);
  });

  test('deletes need the delete option, and never-synced orphans wait for a check', async () => {
    const { site, local, remote } = await newSite();
    await synced(site, local, { 'keep.html': 'k', 'one.html': '1', 'two.html': '2', 'three.html': '3', 'old/page.html': 'old' });
    rmSync(path.join(local, 'old'), { recursive: true });
    write(remote, 'stray.html', 'stray');
    await preview(site, 'put');
    assert.match(lastMessage(), /are in sync/, 'without the delete option nothing is deleted');

    await preview(site, 'put', true);
    assert.deepEqual(rows().map((entry) => [entry.item.path, entry.item.action, entry.item.checked]), [
      ['old/page.html', 'delete-remote', true],
      ['stray.html', 'delete-remote', false],
    ]);
    prompter.answer(deleteButton(1));
    await run();
    assert.equal(read(remote, 'old/page.html'), undefined);
    assert.equal(read(remote, 'stray.html'), 'stray', 'the unchecked orphan stays');

    await preview(site, 'put', true);
    await vscode.commands.executeCommand('syncServers.preview.checkAll');
    prompter.answer(deleteButton(1));
    await run();
    assert.equal(read(remote, 'stray.html'), undefined);
    assert.equal(read(remote, 'keep.html'), 'k');
  });

  test('the mass-delete and empty-root guards stop a mirror before it starts', async () => {
    const { site, local, remote } = await newSite();
    await synced(site, local, { 'a.html': 'a', 'b.html': 'b', 'c.html': 'c', 'd.html': 'd' });
    rmSync(path.join(local, 'a.html'));
    rmSync(path.join(local, 'b.html'));
    await preview(site, 'put', true);
    prompter.answer(deleteButton(2), undefined);
    await run();
    assert.match(lastMessage(), /2 remote deletes is more than/);
    assert.equal(read(remote, 'a.html'), 'a', 'nothing was deleted');
    assert.ok(api.preview.pending, 'the preview waits for another try');

    prompter.answer(deleteButton(2), '2');
    await run();
    assert.equal(read(remote, 'a.html'), undefined);
    assert.equal(read(remote, 'b.html'), undefined);

    rmSync(path.join(local, 'c.html'));
    rmSync(path.join(local, 'd.html'));
    await preview(site, 'put', true);
    prompter.answer(deleteButton(2));
    await run();
    assert.match(lastMessage(), /is empty, so mirroring it would delete every file/);
    assert.equal(read(remote, 'c.html'), 'c');
  });

  test('cloaked files by suffix, name, folder and path are never listed, transferred or deleted', async () => {
    const { site, local, remote } = await newSite({ patterns: ['.psd archive*', 'node_modules/'], paths: ['drafts'] });
    for (const name of ['art/cover.psd', 'archive-2026.zip', 'node_modules/lib/x.js', 'drafts/next.html', 'index.html']) {
      write(local, name, name);
    }
    write(remote, 'drafts/remote-only.html', 'r');
    await preview(site, 'both', true);
    assert.deepEqual(rows().map((entry) => entry.item.path), ['index.html']);
    await run();
    assert.equal(read(remote, 'art/cover.psd'), undefined);
    assert.equal(read(remote, 'drafts/remote-only.html'), 'r');
  });

  test('the guard holds back sensitive files until checked', async () => {
    const { site, local, remote } = await newSite();
    write(local, '.env', 'EXAMPLE=1');
    write(local, 'index.html', 'home');
    await preview(site, 'put');
    assert.deepEqual(groups(), ['Put', 'Guarded']);
    assert.equal(api.previewView.getTreeItem(row('.env')).checkboxState, vscode.TreeItemCheckboxState.Unchecked);
    await run();
    assert.equal(read(remote, '.env'), undefined);
    assert.equal(read(remote, 'index.html'), 'home');
  });

  test('a file changed after the preview is skipped as stale, and the failure stays in view', async () => {
    const { site, local, remote } = await newSite();
    write(local, 'a.html', 'a');
    write(local, 'b.html', 'b');
    await preview(site, 'put');
    write(local, 'a.html', 'a changed', LATER);
    await run();
    assert.equal(lastMessage(), 'Synchronized 1 file. 1 failed. 0 skipped.');
    assert.equal(read(remote, 'a.html'), undefined);
    assert.deepEqual(groups(), ['Failed', 'Done']);
    assert.equal(api.statusBar.warning, true);
    assert.match(api.statusBar.text, /1 failed$/);
  });

  test('a cancelled run keeps what it finished and moves the rest on the next run', async () => {
    const { site, local, remote } = await newSite();
    write(local, 'a.html', 'a');
    await preview(site, 'put');
    const cancel = api.preview.onDidChange(() => {
      if (api.preview.running !== undefined) {
        api.preview.cancelRun();
      }
    });
    try {
      await run();
    } finally {
      cancel.dispose();
    }
    assert.match(lastMessage(), /^The synchronization was cancelled\. Synchronized 0 files\./);
    assert.equal(read(remote, 'a.html'), undefined);
    assert.deepEqual(readdirSync(remote).filter((name) => name.endsWith('.part')), [], 'no partial file is left');
    await preview(site, 'put');
    await run();
    assert.equal(read(remote, 'a.html'), 'a');
  });

  test('Put and Get move a file at once, unless it needs a look first', async () => {
    const { site, local, remote } = await newSite();
    write(local, 'index.html', 'home');
    write(local, '.env', 'EXAMPLE=1');
    write(remote, 'about.html', 'About');
    await vscode.commands.executeCommand('syncServers.put', vscode.Uri.file(path.join(local, 'index.html')));
    assert.equal(lastMessage(), 'Synchronized 1 file. 0 failed. 0 skipped.');
    assert.equal(read(remote, 'index.html'), 'home');

    await vscode.commands.executeCommand('syncServers.get', vscode.Uri.file(path.join(local, 'about.html')));
    assert.equal(read(local, 'about.html'), 'About');

    await vscode.commands.executeCommand('syncServers.put', vscode.Uri.file(path.join(local, '.env')));
    assert.equal(lastMessage(), 'Some of the files need a look before they move. They are in the Sync Preview.');
    assert.deepEqual(groups(), ['Guarded']);
    assert.equal(read(remote, '.env'), undefined);
    await api.preview.close();

    prompter.answer(wholeSiteButton('put'));
    await vscode.commands.executeCommand('syncServers.put', node(site));
    assert.deepEqual(groups(), ['Guarded'], 'the whole site goes through the same guard');
  });

  test('Compare with Remote shows the server copy beside the local file, and sums up a binary one', async () => {
    const { local, remote } = await newSite();
    write(local, 'index.html', '<p>Local</p>\n');
    write(remote, 'index.html', '<p>Server</p>\n');
    write(local, 'logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]));
    write(remote, 'logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 2]));
    await vscode.commands.executeCommand('syncServers.compareWithRemote', vscode.Uri.file(path.join(local, 'index.html')));
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(tab instanceof vscode.TabInputTextDiff, 'a diff editor opened');
    assert.equal(tab.original.scheme, REMOTE_SCHEME);
    assert.equal((await vscode.workspace.openTextDocument(tab.original)).getText(), '<p>Server</p>\n');
    assert.equal(tab.modified.toString(), vscode.Uri.file(path.join(local, 'index.html')).toString());

    await vscode.commands.executeCommand('syncServers.compareWithRemote', vscode.Uri.file(path.join(local, 'logo.png')));
    const summary = vscode.window.activeTextEditor?.document;
    assert.equal(summary?.uri.scheme, REMOTE_SCHEME);
    assert.match(summary.getText(), /SHA-256 [0-9a-f]{64}[\s\S]*The two copies differ\./);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('names that cannot be used locally, case twins and links outside the site are listed and never written', async function () {
    if (process.platform !== 'linux') {
      this.skip();
    }
    const { site, local, remote } = await newSite({ caseSensitive: false });
    write(remote, 'Index.html', 'upper');
    write(remote, 'index.html', 'lower');
    write(remote, 'a\\b.txt', 'backslash');
    write(remote, 'bad\u0001name.txt', 'control');
    write(remote, 'good.html', 'good');
    symlinkSync(path.join(work, 'elsewhere'), path.join(remote, 'outside'));
    await preview(site, 'get');
    assert.deepEqual(groups(), ['Get', 'Errors']);
    assert.ok(rows().filter((entry) => entry.item.state === 'problem').length >= 4);
    await run();
    assert.equal(read(local, 'good.html'), 'good');
    assert.equal(read(local, 'index.html'), undefined);
    assert.equal(existsSync(path.join(local, 'outside')), false);
  });
});
