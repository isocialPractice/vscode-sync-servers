// The manifest's contributions agree with the identifiers the code uses, and
// the version agrees across the files that carry it.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { CATEGORY, COMMANDS, CONTEXT, EXTENSION_ID, PREVIEW_COMMANDS, REMOTE_COMMANDS, SETTINGS, VIEW_CONTAINER, VIEWS } from '../../src/contributions.ts';
import { ROOT, readJson, readText } from '../helpers/files.ts';

interface Manifest {
  name: string;
  displayName: string;
  publisher: string;
  version: string;
  main: string;
  icon: string;
  engines: { vscode: string };
  capabilities: {
    untrustedWorkspaces: { supported: string; description: string; restrictedConfigurations: string[] };
    virtualWorkspaces: boolean;
  };
  contributes: {
    viewsContainers: { activitybar: { id: string; title: string; icon: string }[] };
    views: Record<string, { id: string; name: string; icon?: string; when?: string }[]>;
    viewsWelcome: { view: string; contents: string; when?: string }[];
    commands: { command: string; title: string; category: string; icon?: string }[];
    menus: Record<string, { command: string }[]>;
    configuration: { title: string; properties: Record<string, { default: unknown; scope?: string }> };
  };
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

const manifest = readJson('package.json') as Manifest;
const contributed = new Set(manifest.contributes.commands.map((command) => command.command));

test('the identity matches the plan for the extension', () => {
  assert.equal(manifest.name, 'vscode-sync-servers');
  assert.equal(manifest.displayName, 'Sync Servers');
  assert.equal(manifest.publisher, 'isocialPractice');
  assert.equal(`${manifest.publisher}.${manifest.name}`, EXTENSION_ID);
  assert.equal(manifest.main, './out/extension.js');
  assert.equal(manifest.capabilities.untrustedWorkspaces.supported, 'limited');
  assert.equal(manifest.capabilities.virtualWorkspaces, false);
});

test('VS Code 1.101 is the floor, the first release whose extension host runs Node.js 22', () => {
  assert.equal(manifest.engines.vscode, '^1.101.0');
  assert.equal(manifest.engines.vscode, `^${manifest.devDependencies['@types/vscode'] ?? ''}`, 'the API types match the floor');
});

test('the engine is an exact version from npm; zod, for the webview messages, is the only other dependency', () => {
  assert.match(manifest.dependencies['@isocialpractice/cmd-sync-servers'] ?? '', /^\d+\.\d+\.\d+$/);
  assert.deepEqual(Object.keys(manifest.dependencies), ['@isocialpractice/cmd-sync-servers', 'zod']);
  const lock = readJson('package-lock.json') as { packages: Record<string, { version?: string; resolved?: string; integrity?: string; link?: boolean }> };
  const engine = lock.packages['node_modules/@isocialpractice/cmd-sync-servers'];
  assert.equal(engine?.version, manifest.dependencies['@isocialpractice/cmd-sync-servers'], 'package-lock.json installs the version package.json names');
  assert.match(engine?.resolved ?? '', /^https:\/\/registry\.npmjs\.org\//, 'the engine comes from the npm registry, not a folder');
  assert.ok(engine?.integrity !== undefined && engine.link !== true, 'the engine is checked by its integrity hash');
});

test('every command is contributed under the Sync Servers category, in order', () => {
  assert.deepEqual(
    manifest.contributes.commands.map(({ command, title }) => ({ id: command, title })),
    [...COMMANDS, ...PREVIEW_COMMANDS, ...REMOTE_COMMANDS].map(({ id, title }) => ({ id, title })),
  );
  for (const command of manifest.contributes.commands) {
    assert.equal(command.category, CATEGORY, command.command);
    if (command.icon !== undefined) {
      assert.match(command.icon, /^\$\([a-z-]+\)$/, `${command.command} uses a codicon`);
    }
  }
});

test('the Sync Preview commands are in the palette only while a preview is open', () => {
  const palette = new Map(manifest.contributes.menus.commandPalette?.map((item) => [item.command, (item as { when?: string }).when]) ?? []);
  for (const { id } of PREVIEW_COMMANDS) {
    assert.match(palette.get(id) ?? '', /^syncServers\.preview(?:Pending|Active)$/, id);
  }
  for (const { id } of REMOTE_COMMANDS) {
    assert.equal(palette.get(id), 'focusedView == syncServers.remoteFiles', id);
  }
  for (const { id } of COMMANDS) {
    assert.equal(palette.has(id), false, `${id} is always in the palette`);
  }
});

test('the Explorer and editor menus show only for files of the active site', () => {
  for (const menu of ['explorer/context', 'editor/context', 'editor/title/context']) {
    const items = (manifest.contributes.menus[menu] ?? []) as { command: string; when?: string }[];
    assert.ok(items.length > 0, menu);
    for (const item of items) {
      assert.match(item.when ?? '', /^syncServers\.workspaceIsSite && resourceScheme == file\b/, `${menu}: ${item.command}`);
    }
  }
});

test('menus name contributed commands only', () => {
  for (const [menu, items] of Object.entries(manifest.contributes.menus)) {
    for (const item of items) {
      assert.ok(contributed.has(item.command), `${menu}: ${item.command}`);
    }
  }
});

test('the activity bar container holds the Sites, Remote Files and Sync Preview views', () => {
  const [container, ...others] = manifest.contributes.viewsContainers.activitybar;
  assert.deepEqual(others, []);
  assert.equal(container?.id, VIEW_CONTAINER);
  assert.equal(container.title, 'Sync Servers');
  assert.ok(existsSync(path.join(ROOT, container.icon)), container.icon);
  assert.deepEqual(Object.keys(manifest.contributes.views), [VIEW_CONTAINER]);
  const views = manifest.contributes.views[VIEW_CONTAINER] ?? [];
  assert.deepEqual(
    views.map(({ id, name }) => [id, name]),
    [
      [VIEWS.sites, 'Sites'],
      [VIEWS.remoteFiles, 'Remote Files'],
      [VIEWS.preview, 'Sync Preview'],
    ],
  );
  assert.equal(views.find((view) => view.id === VIEWS.preview)?.when, CONTEXT.previewActive);
  assert.deepEqual(
    views.filter((view) => view.id !== VIEWS.preview).map((view) => view.when),
    [undefined, undefined],
  );
});

test('each view has welcome content, and the Sites view offers Add Site', () => {
  const welcome = manifest.contributes.viewsWelcome;
  assert.deepEqual([...new Set(welcome.map((entry) => entry.view))], Object.values(VIEWS));
  assert.match(welcome[0]?.contents ?? '', /\[Add Site\]\(command:syncServers\.addSite\)/);
  for (const { view, contents } of welcome) {
    for (const [, command] of contents.matchAll(/\(command:([\w.]+)\)/g)) {
      assert.ok(contributed.has(command ?? ''), `${view}: ${String(command)}`);
    }
  }
});

test('the settings and their defaults', () => {
  const { title, properties } = manifest.contributes.configuration;
  assert.equal(title, 'Sync Servers');
  assert.deepEqual(
    Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, value.default])),
    SETTINGS,
  );
});

test('a workspace can neither move the list of sites nor loosen the guards in Restricted Mode', () => {
  const { properties } = manifest.contributes.configuration;
  assert.equal(properties['syncServers.configDir']?.scope, 'machine');
  assert.deepEqual(manifest.capabilities.untrustedWorkspaces.restrictedConfigurations, [
    'syncServers.uploadOnSave.enabled',
    'syncServers.confirmDeletes',
  ]);
});

test('the version agrees in package.json, package-lock.json and the changelog', () => {
  const lock = readJson('package-lock.json') as { version: string; packages: Record<string, { version?: string }> };
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages['']?.version, manifest.version);
  const changelog = readText('CHANGELOG.md');
  const released = /^## \[(\d[^\]]*)\] - (\d{4}-\d{2}-\d{2})$/m.exec(changelog);
  assert.equal(released?.[1], manifest.version, 'the newest changelog heading');
  assert.ok(changelog.includes(`\n[${manifest.version}]: https://github.com/isocialPractice/vscode-sync-servers/`));
});

test('.vscodeignore leaves out everything but the shipped files', () => {
  const rules = readText('.vscodeignore')
    .split(/\r?\n/)
    .filter((line) => line !== '' && !line.startsWith('#'));
  assert.deepEqual(rules, [
    '**',
    '!out/extension.js',
    '!media/**',
    '!package.json',
    '!README.md',
    '!CHANGELOG.md',
    '!LICENSE',
    '!THIRD_PARTY_NOTICES.md',
  ]);
});

test('the Marketplace icon is a 128 x 128 PNG and the activity bar icon a 24 x 24 SVG', () => {
  const png = readFileSync(path.join(ROOT, manifest.icon));
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
  assert.equal(png.subarray(12, 16).toString('latin1'), 'IHDR');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [128, 128]);
  assert.match(readText('media/sync-servers.svg'), /viewBox="0 0 24 24"/);
});
