// The real path of a local file, made or not yet, as commands match it to a site.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { realPathOf } from '../../src/real-path.ts';

/** A temp folder, removed after the test. */
function workFolder(t: TestContext): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sync-servers-real-path-'));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

test('a file that exists reads as its real path', (t) => {
  const file = path.join(workFolder(t), 'index.html');
  writeFileSync(file, 'home');
  assert.equal(realPathOf(file), realpathSync.native(file));
});

test('a file not made yet keeps its names on top of the real path of the nearest folder that exists', (t) => {
  const root = workFolder(t);
  const real = realpathSync.native(root);
  assert.equal(realPathOf(path.join(root, 'about.html')), path.join(real, 'about.html'));
  assert.equal(realPathOf(path.join(root, 'css', 'print', 'site.css')), path.join(real, 'css', 'print', 'site.css'));
});

test('a folder reached through a link or junction reads as the folder it stands for', (t) => {
  const root = workFolder(t);
  const target = path.join(root, 'shared');
  mkdirSync(target);
  const link = path.join(root, 'site');
  symlinkSync(target, link, 'junction');
  assert.equal(realPathOf(path.join(link, 'about.html')), path.join(realpathSync.native(target), 'about.html'));
});

test('a path with no folder that resolves is only made absolute', () => {
  const refuse = (): string => {
    throw Object.assign(new Error('not found'), { code: 'ENOENT' });
  };
  assert.equal(realPathOf(path.join('docs', 'index.html'), refuse), path.resolve('docs', 'index.html'));
});
