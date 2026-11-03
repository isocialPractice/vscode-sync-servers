// The Site Settings page's HTML, Content-Security-Policy and stylesheet, and
// the live count of cloaked files.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { countCloaked } from '../../src/cloak-count.ts';
import { contentSecurityPolicy, escapeHtml, settingsPage } from '../../src/settings/html.ts';
import { readText } from '../helpers/files.ts';

const source = 'https://file+.vscode-resource.vscode-cdn.net';

test('the Content-Security-Policy allows the page its own files and its one script only', () => {
  assert.equal(
    contentSecurityPolicy(source, 'abc123'),
    `default-src 'none'; style-src ${source}; script-src 'nonce-abc123'; img-src ${source} data:; font-src ${source}`,
  );
});

test('the page has one script, carrying the nonce, and escapes the site name', () => {
  const html = settingsPage({
    cspSource: source,
    nonce: 'abc123',
    styleUri: `${source}/media/site-settings.css`,
    scriptUri: `${source}/media/dist/site-settings.js`,
    title: 'Site Settings: <My Site> & "Co"',
  });
  assert.equal(html.match(/<script/g)?.length, 1);
  assert.match(html, /<script nonce="abc123" src="[^"]+site-settings\.js"><\/script>/);
  assert.match(html, /<title>Site Settings: &#60;My Site&#62; &#38; &#34;Co&#34;<\/title>/);
  assert.doesNotMatch(html, /\sstyle=|\son[a-z]+=/i);
  assert.equal(escapeHtml(`'`), '&#39;');
});

const css = readText('media/site-settings.css').replace(/\/\*[\s\S]*?\*\//g, '');

test('the stylesheet takes every colour from the theme', () => {
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, 'no hex colours');
  assert.doesNotMatch(css, /\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklch|color-mix)\(/i, 'no colour functions');
  assert.doesNotMatch(css, /:\s*(?:white|black|red|green|blue|gray|grey|yellow|orange)\b/i, 'no named colours');
  for (const [, name] of css.matchAll(/var\((--[\w-]+)/g)) {
    assert.match(name ?? '', /^--(?:ss|vscode)-/, `${String(name)} is a token or a theme variable`);
  }
});

test('every kind of control has rest, hover, active, focus and disabled states', () => {
  for (const control of ['button.primary', 'button.secondary', '.nav-item', '.tab']) {
    const escaped = control.replace('.', '\\.');
    assert.match(css, new RegExp(`(?:^|\\n|,\\s*)${escaped}\\s*[,{]`), `${control} at rest`);
    assert.match(css, new RegExp(`${escaped}:hover`), `${control} on hover`);
    assert.match(css, new RegExp(`${escaped}:active`), `${control} pressed`);
  }
  assert.match(css, /button:disabled\s*{[^}]*cursor: not-allowed/, 'disabled buttons');
  assert.match(css, /button\.primary:disabled\s*{\s*background: var\(--ss-accent\);/, 'a disabled primary button ignores the pointer');
  assert.match(css, /button\.secondary:disabled\s*{\s*background: var\(--ss-secondary\);/, 'a disabled secondary button ignores the pointer');
  assert.match(css, /:focus-visible\s*{/, 'focus, for every control');
  assert.match(css, /body\.vscode-high-contrast \.tab:hover/, 'a dashed edge on hover in high contrast themes');
});

test('the stylesheet keeps spacing on the 4 px grid and has a visible focus ring, high contrast edges and reduced motion', () => {
  for (const [, size] of css.matchAll(/--ss-space-\d+:\s*(\d+)px/g)) {
    assert.equal(Number(size) % 4, 0);
  }
  assert.match(css, /:focus-visible\s*{[^}]*outline: 1px solid var\(--ss-focus\)/);
  assert.match(css, /body\.vscode-high-contrast /);
  assert.match(css, /body\.vscode-high-contrast-light /);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(max-width: 40rem\)/, 'one column when narrow, as at 200 % zoom');
});

test('the cloak count counts cloaked files and folders, and stops at its limit', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sync-servers-cloak-'));
  mkdirSync(path.join(root, 'img'));
  mkdirSync(path.join(root, 'node_modules', 'demo'), { recursive: true });
  mkdirSync(path.join(root, 'drafts'));
  for (const file of ['index.html', 'img/hero.psd', 'img/logo.psd', 'img/logo.png', 'node_modules/demo/index.js', 'drafts/notes.txt']) {
    writeFileSync(path.join(root, file), 'x');
  }
  const cloaking = { enabled: true, patterns: ['.psd', 'node_modules/'], paths: ['drafts'] };
  assert.deepEqual(await countCloaked(root, cloaking), { enabled: true, files: 2, folders: 2, complete: true });
  assert.deepEqual(await countCloaked(root, { ...cloaking, enabled: false }), { enabled: false, files: 0, folders: 0, complete: true });
  assert.equal((await countCloaked(root, cloaking, { limit: 2 })).complete, false);
  const aborted = new AbortController();
  aborted.abort();
  assert.equal((await countCloaked(root, cloaking, { signal: aborted.signal })).complete, false);
});

test('the cloak count includes the global patterns, unless the site turns them off', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sync-servers-cloak-'));
  mkdirSync(path.join(root, '.git'));
  mkdirSync(path.join(root, 'notes'));
  for (const file of ['index.html', '.git/HEAD', 'notes/Shortcut.lnk']) {
    writeFileSync(path.join(root, file), 'x');
  }
  const cloaking = { enabled: true, patterns: [], paths: [] };
  const globalPatterns = ['.git/', '*.lnk'];
  assert.deepEqual(await countCloaked(root, cloaking, { globalPatterns }), { enabled: true, files: 1, folders: 1, complete: true });
  assert.deepEqual(await countCloaked(root, { ...cloaking, useGlobalPatterns: false }, { globalPatterns }), { enabled: true, files: 0, folders: 0, complete: true });
});
