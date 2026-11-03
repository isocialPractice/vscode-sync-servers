// Writes THIRD_PARTY_NOTICES.md from out/extension.meta.json, which
// `npm run build` writes. Run it through `npm run notices`.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { bundledPackages, mergeMeta, renderNotices, type BundleMeta } from './lib/notices.mts';

const root = path.resolve(import.meta.dirname, '..');
const read = (name: string): BundleMeta => JSON.parse(readFileSync(path.join(root, 'out', name), 'utf8')) as BundleMeta;
const packages = bundledPackages(mergeMeta(read('extension.meta.json'), read('webview.meta.json')), root);
writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), renderNotices(packages));
console.log(`THIRD_PARTY_NOTICES.md lists ${String(packages.length)} package(s): ${packages.map((pkg) => pkg.name).join(', ')}.`);
