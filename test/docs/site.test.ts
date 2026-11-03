// The documentation site: complete pages, links that resolve, every command
// and setting listed, and colours that meet WCAG AA.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT } from '../helpers/files.ts';

const docs = path.join(ROOT, 'docs');
const site = path.join(ROOT, '_site');
/** The en dash and the em dash, which no page uses. */
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

const PAGES = [
  'index.html',
  'getting-started.html',
  'site-settings.html',
  'synchronize.html',
  'files-and-cloaking.html',
  'upload-on-save.html',
  'commands-and-settings.html',
  'security-and-trust.html',
  'troubleshooting.html',
];

function read(name: string): string {
  return readFileSync(path.join(docs, name), 'utf8');
}

function ids(html: string): Set<string> {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1] ?? ''));
}

function links(html: string): string[] {
  return [...html.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((match) => match[1] ?? '');
}

/** The text a browser shows for a piece of HTML. */
function shown(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

test('docs/ holds every page of the site, and nothing unexpected', () => {
  assert.deepEqual(readdirSync(docs).filter((name) => name.endsWith('.html')).sort(), [...PAGES].sort());
  assert.deepEqual(readdirSync(path.join(docs, 'assets')), ['site.css']);
});

for (const name of PAGES) {
  test(`${name} is a complete page: language, policy, title, one h1, navigation and no scripts`, () => {
    const html = read(name);
    assert.match(html, /^<!doctype html>\n<html lang="en">/);
    assert.match(html, /<meta charset="utf-8">/);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    assert.match(
      html,
      /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'">/,
    );
    assert.match(html, /<title>[^<]+<\/title>/);
    assert.match(html, /<meta name="description" content="[^"]+">/);
    assert.match(html, /<link rel="stylesheet" href="assets\/site\.css">/);
    assert.equal(html.match(/<h1[\s>]/g)?.length, 1, 'one h1');
    assert.match(html, /<main id="main">/);
    assert.match(html, /<a class="skip" href="#main">/);
    assert.match(html, new RegExp(`<a href="${name.replace('.', '\\.')}" aria-current="page">`));
    assert.equal(html.match(/aria-current="page"/g)?.length, 1, 'one current page');
    assert.doesNotMatch(html, /<script|\son[a-z]+="|\sstyle="|javascript:/i, 'no scripts, handlers or inline styles');
    assert.doesNotMatch(html, /<link[^>]+href="https?:/i, 'no third-party stylesheets or fonts');
    assert.doesNotMatch(html, DASHES, 'no en or em dashes');
    for (const table of html.matchAll(/<table>[\s\S]*?<\/table>/g)) {
      assert.match(table[0], /<caption>[^<]+<\/caption>/, 'every table has a caption');
      assert.match(table[0], /<th scope="col">/, 'every table has column headers');
    }
  });

  test(`${name} lists every page in the same order`, () => {
    const navigation = /<nav aria-label="Pages">([\s\S]*?)<\/nav>/.exec(read(name))?.[1] ?? '';
    assert.deepEqual(links(navigation), PAGES);
  });

  test(`${name} links only to pages, anchors and files that exist, and to HTTPS`, () => {
    const html = read(name);
    for (const link of links(html)) {
      if (/^https:\/\//.test(link)) {
        continue;
      }
      assert.doesNotMatch(link, /^[a-z]+:/i, `${link}: only https links leave the site`);
      const [target = '', fragment] = link.split('#');
      if (target === '') {
        assert.ok(fragment !== undefined && ids(html).has(fragment), `${name}: #${fragment ?? ''} has no target`);
        continue;
      }
      assert.ok(existsSync(path.join(docs, target)), `${name}: ${link} does not exist`);
      if (fragment !== undefined) {
        assert.ok(ids(read(target)).has(fragment), `${name}: ${link} has no such anchor`);
      }
    }
  });
}

test('ids are unique on every page', () => {
  for (const name of PAGES) {
    const all = [...read(name).matchAll(/\sid="([^"]+)"/g)].map((match) => match[1] ?? '');
    assert.deepEqual(all, [...new Set(all)], `${name} repeats an id`);
  }
});

test('the commands and settings page lists every contributed command and setting', () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    contributes: { commands: { title: string }[]; configuration: { properties: Record<string, unknown> } };
  };
  const text = shown(read('commands-and-settings.html'));
  for (const { title } of manifest.contributes.commands) {
    assert.ok(text.includes(title), title);
  }
  for (const setting of Object.keys(manifest.contributes.configuration.properties)) {
    assert.ok(text.includes(setting), setting);
  }
});

test('the README is the front door: under 300 lines, pointing at the site', () => {
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.ok(readme.split('\n').length < 300, 'README.md has 300 lines or more');
  assert.ok(readme.length < 30_000, 'README.md has 30,000 characters or more');
  assert.ok(readme.includes('https://isocialpractice.github.io/vscode-sync-servers/'));
  assert.doesNotMatch(readme, DASHES, 'no en or em dashes');
});

// WCAG 2.2 contrast of the colour pairs the stylesheet uses.
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

test('every text and background pair of the stylesheet meets WCAG AA', () => {
  const css = readFileSync(path.join(docs, 'assets', 'site.css'), 'utf8');
  const colors = new Map([...css.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6});/g)].map((match) => [match[1] ?? '', match[2] ?? '']));
  const color = (name: string): string => {
    const value = colors.get(name);
    assert.ok(value !== undefined, `--${name} is not a six-digit colour`);
    return value;
  };
  const pairs: readonly (readonly [string, string])[] = [
    ['text', 'bg'],
    ['text', 'surface'],
    ['text', 'secondary'],
    ['text', 'warn-bg'],
    ['muted', 'bg'],
    ['muted', 'surface'],
    ['primary', 'bg'],
    ['primary', 'surface'],
    ['primary', 'secondary'],
    ['primary-strong', 'surface'],
    ['code-text', 'code-bg'],
    ['warn-text', 'warn-bg'],
  ];
  for (const [foreground, background] of pairs) {
    const ratio = contrast(color(foreground), color(background));
    assert.ok(ratio >= 4.5, `--${foreground} on --${background} is ${ratio.toFixed(2)}:1, below 4.5:1`);
  }
  for (const background of ['bg', 'surface', 'secondary']) {
    const ratio = contrast(color('focus'), color(background));
    assert.ok(ratio >= 3, `the focus ring on --${background} is ${ratio.toFixed(2)}:1, below 3:1`);
  }
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(css, /@import|url\(/, 'no imported stylesheets, fonts or images');
});

test('the assembled site holds the pages, when built', (context) => {
  if (!existsSync(path.join(site, 'index.html'))) {
    context.skip('run npm run docs:site to build _site/');
    return;
  }
  for (const name of [...PAGES, 'assets/site.css']) {
    assert.equal(readFileSync(path.join(site, name), 'utf8'), readFileSync(path.join(docs, name), 'utf8'), name);
  }
});
