// Packages the extension into out/ with vsce, then fails unless the .vsix
// holds exactly the files below. Run it through `npm run pack:check`, which
// builds first.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const EXPECTED = [
  '[Content_Types].xml',
  'extension.vsixmanifest',
  'extension/LICENSE.txt',
  'extension/THIRD_PARTY_NOTICES.md',
  'extension/changelog.md',
  'extension/media/dist/site-settings.js',
  'extension/media/icon.png',
  'extension/media/site-settings.css',
  'extension/media/sync-servers.svg',
  'extension/out/extension.js',
  'extension/package.json',
  'extension/readme.md',
];

const root = path.resolve(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
const vsix = path.join(root, 'out', `vscode-sync-servers-${version}.vsix`);
const vsce = path.join(root, 'node_modules', '@vscode', 'vsce', 'vsce');
execFileSync(process.execPath, [vsce, 'package', '--no-dependencies', '--out', vsix], { cwd: root, stdio: 'inherit' });

// The names in a zip file's central directory.
function zipEntries(zip: Buffer): string[] {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) {
    throw new Error(`${vsix} is not a zip file.`);
  }
  const count = zip.readUInt16LE(end + 10);
  const names: string[] = [];
  for (let at = zip.readUInt32LE(end + 16), index = 0; index < count; index += 1) {
    if (zip.readUInt32LE(at) !== 0x02014b50) {
      throw new Error(`${vsix} has a damaged central directory.`);
    }
    const nameLength = zip.readUInt16LE(at + 28);
    names.push(zip.toString('utf8', at + 46, at + 46 + nameLength));
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return names.filter((name) => !name.endsWith('/')).sort();
}

const found = zipEntries(readFileSync(vsix));
const unexpected = found.filter((name) => !EXPECTED.includes(name));
const missing = EXPECTED.filter((name) => !found.includes(name));
if (unexpected.length > 0 || missing.length > 0) {
  for (const name of unexpected) {
    console.error(`Not on the allowlist: ${name}`);
  }
  for (const name of missing) {
    console.error(`Missing: ${name}`);
  }
  process.exitCode = 1;
} else {
  console.log(`${path.basename(vsix)} holds exactly the ${String(EXPECTED.length)} allowlisted files.`);
}
