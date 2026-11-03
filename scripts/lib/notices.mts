// Builds THIRD_PARTY_NOTICES.md from the packages esbuild put into
// out/extension.js, reading each package's own licence file.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** The part of an esbuild metafile this module reads. */
export interface BundleMeta {
  readonly inputs: Readonly<Record<string, unknown>>;
}

/** A package with code in the bundle. */
export interface BundledPackage {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly licenseText: string;
}

interface PackageJson {
  readonly name?: string;
  readonly version?: string;
  readonly license?: string;
  // The older form, which ssh2 still uses.
  readonly licenses?: readonly { readonly type?: string }[];
}

// LICENSE, LICENSE.md, LICENSE-MIT, COPYING and the like.
const LICENSE_FILE = /^(?:licen[cs]e|copying)(?:[-.][\w.-]+)?$/i;

function readPackageJson(dir: string): PackageJson {
  return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as PackageJson;
}

/** The folder of the package a bundled file belongs to. */
export function packageDir(file: string): string {
  const parts = file.split(path.sep);
  const at = parts.lastIndexOf('node_modules');
  if (at >= 0) {
    const scoped = parts[at + 1]?.startsWith('@') === true;
    return parts.slice(0, at + (scoped ? 3 : 2)).join(path.sep);
  }
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, 'package.json')) && readPackageJson(dir).name !== undefined) {
      return dir;
    }
    if (path.dirname(dir) === dir) {
      throw new Error(`No package.json above ${file}.`);
    }
  }
}

function licenseText(dir: string, name: string): string {
  const file = readdirSync(dir).sort().find((entry) => LICENSE_FILE.test(entry));
  if (file === undefined) {
    throw new Error(`${name} has no licence file; add its notice by hand.`);
  }
  return readFileSync(path.join(dir, file), 'utf8').replace(/\r\n?/g, '\n').trim();
}

/** The inputs of several bundles as one. */
export function mergeMeta(...metas: readonly BundleMeta[]): BundleMeta {
  return { inputs: Object.assign({}, ...metas.map((meta) => meta.inputs)) as Record<string, unknown> };
}

/** Every package other than the extension itself with a file in the bundle, sorted by name. */
export function bundledPackages(meta: BundleMeta, root: string): BundledPackage[] {
  const found = new Map<string, BundledPackage>();
  for (const input of Object.keys(meta.inputs)) {
    const dir = packageDir(path.resolve(root, input));
    if (path.relative(root, dir) === '' || found.has(dir)) {
      continue;
    }
    const manifest = readPackageJson(dir);
    const name = manifest.name ?? path.basename(dir);
    found.set(dir, {
      name,
      version: manifest.version ?? 'unknown',
      license: manifest.license ?? manifest.licenses?.map((entry) => entry.type ?? '?').join(' OR ') ?? 'as stated below',
      licenseText: licenseText(dir, name),
    });
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/** The text of THIRD_PARTY_NOTICES.md for these packages. */
export function renderNotices(packages: readonly BundledPackage[]): string {
  const sections = packages.map(
    (pkg) => `## ${pkg.name} ${pkg.version}\n\nLicence: ${pkg.license}\n\n\`\`\`text\n${pkg.licenseText}\n\`\`\`\n`,
  );
  return [
    '# Third-Party Notices',
    '',
    'The extension ships as two bundled files, `out/extension.js` and the Site',
    'Settings script `media/dist/site-settings.js`, which include the code of',
    'the packages below. Each package\'s licence is reproduced in full.',
    '`npm run notices` writes this file from the bundles, and a unit test fails',
    'when it is out of date.',
    '',
    ...sections,
  ].join('\n');
}
