// The leak scan: public files hold placeholder data only. It reads the
// project documents, the docs site, every source, script and test file, the
// media and the workflows, and fails on an email address outside the example
// domains, a user profile path naming anyone but <user>, an IPv4 address
// outside loopback and the documentation ranges, a hidden control or bidi
// character, and every entry of the git-ignored .claude/leak-denylist.txt
// when this machine has one.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT } from '../helpers/files.ts';

// The .github entries are the ones .gitignore tracks there; anything else in
// .github is local tooling that is never committed.
const FOLDERS = ['docs', 'src', 'test', 'scripts', 'media', '.github/workflows', '.github/ISSUE_TEMPLATE'];
const FILES = [
  '.github/dependabot.yml',
  '.github/PULL_REQUEST_TEMPLATE.md',
  'README.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'DESIGN_LANGUAGE.md',
  'THIRD_PARTY_NOTICES.md',
  'TODO.md',
  'package.json',
  '.vscode-test.mjs',
  '.vscodeignore',
  'eslint.config.mjs',
  'tsconfig.json',
];
const TEXT = /\.(?:ts|mts|js|mjs|json|md|html|css|svg|txt|ya?ml|sh|cmd|bat)$/;
// Licence notices are reproduced as their authors published them, addresses included.
const VERBATIM = new Set(['THIRD_PARTY_NOTICES.md']);

function walk(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((name) => path.join(dir, name))
    .filter((file) => !file.includes(`${path.sep}dist${path.sep}`) && statSync(file).isFile() && TEXT.test(file));
}

// Pages are read as a browser shows them, so &lt;user&gt; is <user>.
const decode = (text: string): string => text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

const SOURCES = [...FILES.map((name) => path.join(ROOT, name)).filter((file) => existsSync(file)), ...FOLDERS.flatMap((folder) => walk(path.join(ROOT, folder)))].map(
  (file) => ({ name: path.relative(ROOT, file), text: decode(readFileSync(file, 'utf8')) }),
);

function findings(pattern: RegExp, allowed: (match: RegExpMatchArray, text: string) => boolean, skip: ReadonlySet<string> = new Set()): string[] {
  const found: string[] = [];
  for (const { name, text } of SOURCES) {
    if (skip.has(name)) {
      continue;
    }
    for (const match of text.matchAll(pattern)) {
      if (!allowed(match, text)) {
        found.push(`${name}: ${match[0]}`);
      }
    }
  }
  return found;
}

test('there are files to scan', () => {
  assert.ok(SOURCES.length > 50);
  assert.ok(SOURCES.some(({ name }) => name.endsWith('index.html')));
});

test('email addresses use example domains only', () => {
  const found = findings(
    /[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})/g,
    (match) => /(?:^|\.)example\.(?:com|org|net)$/.test((match[1] ?? '').toLowerCase()),
    VERBATIM,
  );
  assert.deepEqual(found, []);
});

test('user profile paths name no one but <user>', () => {
  const found = findings(/(?:[A-Za-z]:\\{1,2}Users\\{1,2}|\/Users\/|\/home\/)([^\\/\s"'`,;)]+)/g, (match) => {
    const name = match[1] ?? '';
    return name === '<user>' || /^(?:\$|%)/.test(name);
  });
  assert.deepEqual(found, []);
});

test('IPv4 addresses are loopback or documentation addresses only', () => {
  const found = findings(/(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.])/g, (match) => {
    const octets = match.slice(1, 5).map(Number);
    const [a, b, c] = octets;
    return (
      octets.some((octet) => octet > 255) ||
      a === 127 ||
      octets.every((octet) => octet === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    );
  });
  assert.deepEqual(found, []);
});

test('no file holds invisible control or bidi characters, which can make code read differently from what it does', () => {
  const codes = [
    ...Array.from({ length: 32 }, (_, code) => code).filter((code) => code !== 9 && code !== 10 && code !== 13),
    ...Array.from({ length: 33 }, (_, offset) => 0x7f + offset),
    0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff,
  ];
  const hidden = new RegExp(`[${codes.map((code) => String.fromCharCode(code)).join('').replace(/[\]\\^-]/g, '\\$&')}]`);
  const found = SOURCES.filter(({ name, text }) => hidden.test(text) || (!name.endsWith('.cmd') && !name.endsWith('.bat') && text.includes('\r'))).map(({ name }) => name);
  assert.deepEqual(found, []);
});

test('nothing on the local denylist appears', (context) => {
  const file = path.join(ROOT, '.claude', 'leak-denylist.txt');
  if (!existsSync(file)) {
    context.skip('no .claude/leak-denylist.txt on this machine');
    return;
  }
  const entries = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => line.toLowerCase());
  const found: string[] = [];
  for (const { name, text } of SOURCES) {
    const lower = text.toLowerCase();
    entries.forEach((entry, index) => {
      if (lower.includes(entry)) {
        // The entry itself is never printed: it is private by definition.
        found.push(`${name}: denylist entry ${String(index + 1)}`);
      }
    });
  }
  assert.deepEqual(found, []);
});
