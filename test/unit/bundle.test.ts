// What esbuild put into out/extension.js and media/dist/site-settings.js,
// read from the metafiles the build writes.
import assert from 'node:assert/strict';
import { builtinModules } from 'node:module';
import { test } from 'node:test';
import { bundledPackages, mergeMeta, renderNotices, type BundleMeta } from '../../scripts/lib/notices.mts';
import { ROOT, readJson, readText } from '../helpers/files.ts';

interface Meta extends BundleMeta {
  outputs: Record<string, { imports: { path: string; external?: boolean }[] }>;
}

const extension = readJson('out/extension.meta.json') as Meta;
const webview = readJson('out/webview.meta.json') as Meta;
const builtins = new Set(builtinModules);

test('neither bundle includes the OS keyring', () => {
  for (const input of Object.keys(mergeMeta(extension, webview).inputs)) {
    assert.doesNotMatch(input, /@napi-rs[\\/]keyring|credentials[\\/]keyring/);
  }
});

test('the extension loads nothing at run time but VS Code, Node.js and the optional ssh2 natives', () => {
  const external = extension.outputs['out/extension.js']?.imports.filter((entry) => entry.external === true) ?? [];
  assert.ok(external.some((entry) => entry.path === 'vscode'));
  for (const { path } of external) {
    const allowed = path === 'vscode' || path === 'cpu-features' || path.endsWith('.node') || builtins.has(path.replace(/^node:/, ''));
    assert.ok(allowed, path);
  }
});

test('the Site Settings script loads nothing at all, and never reaches the engine or Node.js', () => {
  const output = webview.outputs['media/dist/site-settings.js'];
  assert.ok(output);
  assert.deepEqual(output.imports, []);
  for (const input of Object.keys(webview.inputs)) {
    assert.doesNotMatch(input, /cmd-sync-servers|^\.\.\/out\//, input);
  }
});

test('the engine and the extension share one zod release, so the bundle carries one copy', () => {
  const ours = (readJson('package.json') as { dependencies: Record<string, string> }).dependencies.zod;
  const engine = (readJson('node_modules/@isocialpractice/cmd-sync-servers/package.json') as { dependencies: Record<string, string> }).dependencies.zod;
  assert.equal(ours, engine);
  const copies = new Set(
    Object.keys(extension.inputs)
      .filter((input) => input.includes('node_modules/zod/'))
      .map((input) => input.slice(0, input.indexOf('node_modules/zod/'))),
  );
  assert.equal(copies.size, 1);
});

test('THIRD_PARTY_NOTICES.md lists every bundled package; `npm run notices` rewrites it', () => {
  const packages = bundledPackages(mergeMeta(extension, webview), ROOT);
  assert.ok(packages.some((pkg) => pkg.name === '@isocialpractice/cmd-sync-servers'));
  assert.ok(packages.some((pkg) => pkg.name === 'ssh2'));
  assert.ok(packages.some((pkg) => pkg.name === 'zod'));
  assert.equal(readText('THIRD_PARTY_NOTICES.md'), renderNotices(packages));
});
