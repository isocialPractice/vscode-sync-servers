// Runs inside VS Code: the Explorer's marks, Cloak and Uncloak, the Remote
// Files view, upload on save, and what Restricted Mode holds back.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { NewServer, Site } from '@isocialpractice/cmd-sync-servers';
import * as vscode from 'vscode';
import { DELETE_ON_SERVER } from '../../src/commands/remote.ts';
import { REMOVE } from '../../src/flows/global-cloaking.ts';
import { PUT_ANYWAY } from '../../src/commands/sync.ts';
import { REMOTE_SCHEME } from '../../src/contributions.ts';
import type { TestApi } from '../../src/extension.ts';
import { SYNCHRONIZE_ANYWAY } from '../../src/preview/controller.ts';
import type { RemoteNode } from '../../src/remote/nodes.ts';
import { syncServers, testApi, waitFor } from '../helpers/extension.ts';
import { ScriptedPrompter } from '../helpers/prompter.ts';

const BASE = Date.UTC(2026, 0, 1);
const LATER = BASE + 3_600_000;
const QUIET_MS = 900;

suite('Explorer, Remote Files and upload on save', () => {
  const prompter = new ScriptedPrompter();
  const work = mkdtempSync(path.join(tmpdir(), 'sync-servers-explorer-'));
  let api: TestApi;
  let count = 0;

  function folder(name: string): string {
    const dir = path.join(work, name);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  async function newSite(options: { uploadOnSave?: boolean; testing?: boolean; patterns?: string[] } = {}): Promise<{ site: Site; local: string; remote: string; testing: string }> {
    count += 1;
    const local = folder(`site-${String(count)}`);
    const remote = folder(`server-${String(count)}`);
    const testing = folder(`testing-${String(count)}`);
    const servers: NewServer[] = [{ name: 'Production', protocol: 'local', remoteRoot: remote, options: { uploadOnSave: options.uploadOnSave === true && options.testing !== true } }];
    if (options.testing === true) {
      servers.push({ name: 'Staging', protocol: 'local', remoteRoot: testing, options: { uploadOnSave: true } });
    }
    const site = await api.model.registry().add({ name: `Explorer ${String(count)}`, localRoot: local, servers, cloaking: { patterns: options.patterns ?? [] } });
    if (options.testing === true) {
      await api.model.registry().update(site.id, (draft) => {
        draft.testingServerId = draft.servers[1]?.id;
      });
    }
    api.model.refresh();
    return { site: api.model.site(site.id) ?? site, local, remote, testing };
  }

  function write(root: string, name: string, content: string, time = BASE): void {
    const file = path.join(root, ...name.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
    utimesSync(file, time / 1000, time / 1000);
  }

  function read(root: string, name: string): string | undefined {
    const file = path.join(root, ...name.split('/'));
    return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  }

  const uri = (root: string, name: string): vscode.Uri => vscode.Uri.file(path.join(root, ...name.split('/')));
  const lastMessage = (): string => prompter.messages.at(-1) ?? '';

  async function syncPut(site: Site): Promise<void> {
    prompter.answer('put', false);
    await vscode.commands.executeCommand('syncServers.synchronize', { kind: 'site', site });
    if (api.preview.pending !== undefined) {
      await vscode.commands.executeCommand('syncServers.preview.synchronize');
    }
  }

  /** Types into a file in an editor and saves it, as a person would. */
  async function edit(file: vscode.Uri, text: string): Promise<void> {
    const document = await vscode.workspace.openTextDocument(file);
    const change = new vscode.WorkspaceEdit();
    change.replace(file, new vscode.Range(0, 0, document.lineCount, 0), text);
    await vscode.workspace.applyEdit(change);
    await document.save();
  }

  const uploads = (file: string): number =>
    api.logRecords.filter((record) => record.message === 'Uploaded on save' && record.fields?.path === file).length;

  async function quiet(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
    await waitFor('the uploads to finish', () => api.uploadOnSave.pending === 0);
  }

  suiteSetup(async () => {
    api = await testApi();
    api.usePrompter(prompter);
  });

  suiteTeardown(async () => {
    await api.preview.close();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    api.useTrust(undefined);
    api.usePrompter(undefined);
  });

  teardown(async () => {
    await api.preview.close();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    assert.equal(prompter.remaining, 0, 'every scripted answer was used');
  });

  test('the Explorer marks changed, new and cloaked files, and files that need a decision', async () => {
    const { site, local, remote } = await newSite({ patterns: ['.psd'] });
    write(local, 'index.html', 'v1');
    write(local, 'about.html', 'v1');
    write(local, 'art/cover.psd', 'art');
    await syncPut(site);
    await api.model.setActive(site.id);
    await api.marks.refresh();
    assert.equal(api.marks.markOf(uri(local, 'index.html')), undefined, 'as it was at the last sync');
    assert.equal(api.marks.markOf(uri(local, 'art/cover.psd'))?.badge, '⊘');

    write(local, 'index.html', 'v2', LATER);
    write(local, 'news.html', 'new');
    assert.equal(api.marks.markOf(uri(local, 'index.html'))?.tooltip, 'Changed since the last sync. Put uploads it.');
    assert.equal(api.marks.markOf(uri(local, 'news.html'))?.word, 'new');

    write(local, 'about.html', 'local edit', LATER);
    write(remote, 'about.html', 'server edit!', LATER);
    prompter.answer('put', false);
    await vscode.commands.executeCommand('syncServers.synchronize', { kind: 'site', site });
    await api.marks.ready;
    const decoration = api.marks.provideFileDecoration(uri(local, 'about.html'));
    assert.equal(decoration?.badge, '!');
    assert.ok(decoration.color instanceof vscode.ThemeColor);
    assert.equal(decoration.color.id, 'list.warningForeground');
    assert.ok((decoration.tooltip ?? '') !== '', 'every badge has a tooltip');

    const settings = vscode.workspace.getConfiguration('syncServers');
    await settings.update('decorations.enabled', false, vscode.ConfigurationTarget.Global);
    try {
      assert.equal(api.marks.markOf(uri(local, 'about.html')), undefined, 'the setting turns the marks off');
    } finally {
      await settings.update('decorations.enabled', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test('Cloak and Uncloak change the cloaked paths of the site the files belong to', async () => {
    const { site, local } = await newSite({ patterns: ['.psd'] });
    write(local, 'drafts/next.html', 'next');
    write(local, 'notes.txt', 'notes');
    write(local, 'art/cover.psd', 'art');
    await vscode.commands.executeCommand('syncServers.cloak', uri(local, 'drafts'), [uri(local, 'drafts'), uri(local, 'notes.txt')]);
    assert.deepEqual(api.model.site(site.id)?.cloaking.paths, ['drafts', 'notes.txt']);
    assert.equal(lastMessage(), 'Cloaked 2 items. They are never synchronized.');

    await vscode.commands.executeCommand('syncServers.cloak', uri(local, 'notes.txt'));
    assert.equal(lastMessage(), 'notes.txt is already cloaked.');

    await vscode.commands.executeCommand('syncServers.uncloak', uri(local, 'notes.txt'));
    assert.deepEqual(api.model.site(site.id)?.cloaking.paths, ['drafts']);

    await vscode.commands.executeCommand('syncServers.uncloak', uri(local, 'drafts/next.html'));
    assert.match(lastMessage(), /inside the cloaked folder drafts/);
    await vscode.commands.executeCommand('syncServers.uncloak', uri(local, 'art/cover.psd'));
    assert.match(lastMessage(), /cloaked by a pattern; change the patterns in Site Settings/);

    await api.model.setActive(site.id);
    prompter.answer('drafts');
    await vscode.commands.executeCommand('syncServers.uncloak');
    assert.deepEqual(api.model.site(site.id)?.cloaking.paths, []);
  });

  test('a global pattern set from the command line marks files cloaked, and Global Cloaking Patterns... adds and removes them', async () => {
    const { site, local } = await newSite();
    write(local, 'docs/Shortcut.lnk', 'link');
    write(local, 'index.html', 'home');
    await api.model.setActive(site.id);
    try {
      const added = syncServers('cloak', '--global', '*.lnk');
      assert.equal(added.status, 0, added.stderr);
      await api.model.reload();
      assert.deepEqual(api.model.globalPatterns, ['*.lnk']);
      await api.marks.refresh();
      assert.equal(api.marks.markOf(uri(local, 'docs/Shortcut.lnk'))?.badge, '⊘');
      await vscode.commands.executeCommand('syncServers.uncloak', uri(local, 'docs/Shortcut.lnk'));
      assert.match(lastMessage(), /cloaked by a global pattern/);

      await api.model.registry().update(site.id, (draft) => {
        draft.cloaking.useGlobalPatterns = false;
      });
      api.model.refresh();
      await api.marks.refresh();
      assert.notEqual(api.marks.markOf(uri(local, 'docs/Shortcut.lnk'))?.badge, '⊘', 'the site stopped using the global patterns');

      prompter.answer({ add: true }, '.git/', undefined);
      await vscode.commands.executeCommand('syncServers.globalCloaking');
      assert.deepEqual(api.model.globalPatterns, ['*.lnk', '.git/']);
      const listed = syncServers('cloak', '--global', '--json');
      assert.deepEqual((JSON.parse(listed.stdout) as { patterns: string[] }).patterns, ['*.lnk', '.git/'], 'the command line lists them');
    } finally {
      prompter.answer({ remove: '*.lnk' }, REMOVE, { remove: '.git/' }, REMOVE, undefined);
      await vscode.commands.executeCommand('syncServers.globalCloaking');
    }
    assert.deepEqual(api.model.globalPatterns, []);
  });

  test('Remote Files lists the active site Remote server with its marks, and opens, gets and deletes', async () => {
    const { site, local, remote } = await newSite();
    write(local, 'index.html', 'home');
    write(local, 'css/site.css', 'body {}');
    await syncPut(site);
    write(remote, 'extra.html', 'only on the server');
    await api.model.setActive(site.id);
    api.remoteFiles.refresh();

    const top = (await api.remoteFiles.getChildren()) as RemoteNode[];
    assert.deepEqual(top.map((node) => [node.name, node.type]), [
      ['css', 'dir'],
      ['extra.html', 'file'],
      ['index.html', 'file'],
    ]);
    const extra = top.find((node) => node.name === 'extra.html');
    assert.ok(extra);
    assert.match(String((await api.remoteFiles.getTreeItem(extra)).description), /↓ new on the server$/);
    const css = top[0];
    assert.ok(css);
    assert.deepEqual(((await api.remoteFiles.getChildren(css)) as RemoteNode[]).map((node) => node.path), ['css/site.css']);

    await vscode.commands.executeCommand('syncServers.remote.openReadOnly', extra);
    const shown = vscode.window.activeTextEditor?.document;
    assert.equal(shown?.uri.scheme, REMOTE_SCHEME);
    assert.equal(shown.getText(), 'only on the server');

    await vscode.commands.executeCommand('syncServers.get', extra);
    assert.equal(read(local, 'extra.html'), 'only on the server');

    const index = top.find((node) => node.name === 'index.html');
    prompter.answer(undefined);
    await vscode.commands.executeCommand('syncServers.remote.delete', index);
    assert.equal(read(remote, 'index.html'), 'home', 'cancelled: kept');
    prompter.answer(DELETE_ON_SERVER);
    await vscode.commands.executeCommand('syncServers.remote.delete', index);
    assert.equal(read(remote, 'index.html'), undefined);
    assert.equal(read(local, 'index.html'), 'home', 'the local copy is kept');

    const bare = await api.model.registry().add({ name: `Explorer ${String(count)} without servers`, localRoot: folder(`bare-${String(count)}`) });
    api.model.refresh();
    await api.model.setActive(bare.id);
    assert.deepEqual(await api.remoteFiles.getChildren(), [], 'no Remote server, no rows: the view shows its welcome');
  });

  test('saving a file in a site puts it once to the server that uploads on save', async () => {
    const { local, remote } = await newSite({ uploadOnSave: true });
    write(local, 'index.html', 'v1');
    const file = uri(local, 'index.html');
    await edit(file, 'v2');
    await edit(file, 'v3');
    await waitFor('the upload', () => read(remote, 'index.html') === 'v3');
    await quiet();
    assert.equal(uploads('index.html'), 1, 'two quick saves, one upload');

    await edit(file, 'v4');
    await waitFor('the second upload', () => read(remote, 'index.html') === 'v4');
    await quiet();
    assert.equal(uploads('index.html'), 2);
  });

  test('saving a cloaked or sensitive file puts nothing', async () => {
    const { local, remote } = await newSite({ uploadOnSave: true, patterns: ['.psd'] });
    write(local, 'art/cover.psd', 'art');
    write(local, '.env', 'EXAMPLE=1');
    await edit(uri(local, 'art/cover.psd'), 'art 2');
    await edit(uri(local, '.env'), 'EXAMPLE=2');
    await quiet();
    assert.equal(read(remote, 'art/cover.psd'), undefined);
    assert.equal(read(remote, '.env'), undefined);
    const held = api.logRecords.filter((record) => record.message.startsWith('Not uploaded on save:')).map((record) => record.message);
    assert.ok(held.includes('Not uploaded on save: it is cloaked'));
    assert.ok(held.includes('Not uploaded on save: it matches the sensitive pattern ".env"'));
  });

  test('the Testing server gets saved files when only its Upload on save is on', async () => {
    const { local, remote, testing } = await newSite({ testing: true });
    write(local, 'index.html', 'v1');
    await edit(uri(local, 'index.html'), 'for testing');
    await waitFor('the push to Testing', () => read(testing, 'index.html') === 'for testing');
    await quiet();
    assert.equal(read(remote, 'index.html'), undefined, 'the Remote server does not upload on save');
  });

  test('the upload on save switch stops every upload on save', async () => {
    const { local, remote } = await newSite({ uploadOnSave: true });
    write(local, 'index.html', 'v1');
    const settings = vscode.workspace.getConfiguration('syncServers');
    await settings.update('uploadOnSave.enabled', false, vscode.ConfigurationTarget.Global);
    try {
      await edit(uri(local, 'index.html'), 'v2');
      await quiet();
      assert.equal(read(remote, 'index.html'), undefined);
    } finally {
      await settings.update('uploadOnSave.enabled', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test('an untrusted workspace never uploads on save, and asks before Put or Synchronize write to a server', async () => {
    const { site, local, remote } = await newSite({ uploadOnSave: true });
    write(local, 'index.html', 'v1');
    api.useTrust(false);
    try {
      await edit(uri(local, 'index.html'), 'v2');
      await quiet();
      assert.equal(read(remote, 'index.html'), undefined);
      assert.ok(api.logRecords.some((record) => record.message === 'Not uploaded on save: the workspace is in Restricted Mode'));

      prompter.answer(undefined);
      await vscode.commands.executeCommand('syncServers.put', uri(local, 'index.html'));
      const asked = prompter.asked.at(-1)?.question;
      assert.ok(asked !== undefined && 'buttons' in asked);
      assert.deepEqual(asked.buttons, [PUT_ANYWAY]);
      assert.equal(read(remote, 'index.html'), undefined);

      prompter.answer('put', false, undefined);
      await vscode.commands.executeCommand('syncServers.synchronize', { kind: 'site', site });
      await vscode.commands.executeCommand('syncServers.preview.synchronize');
      assert.equal(read(remote, 'index.html'), undefined);

      prompter.answer(SYNCHRONIZE_ANYWAY);
      await vscode.commands.executeCommand('syncServers.preview.synchronize');
      assert.equal(read(remote, 'index.html'), 'v2', 'a person who says so can still write');
    } finally {
      api.useTrust(undefined);
    }
  });
});
