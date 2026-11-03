// Bundles the extension and the cmd-sync-servers engine into one CommonJS
// file with esbuild.
//
//   node scripts/build.mts               out/extension.js, with a source map
//   node scripts/build.mts --production  out/extension.js as it is packaged
//   node scripts/build.mts --watch       rebuilds on every change, for F5
//   node scripts/build.mts --tests       also bundles test/**/*.test.ts into out/test/
//   node scripts/build.mts --docs-tests  only the documentation checks, test/docs/
//
// It also bundles the Site Settings page's script into media/dist/, and
// writes out/extension.meta.json and out/webview.meta.json, the lists of
// every file each bundle includes, which `npm run notices` and the unit
// tests read.
import { build, context, type BuildOptions, type Plugin } from 'esbuild';
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const production = args.has('--production');
const watch = args.has('--watch');
const tests = args.has('--tests');
const root = path.resolve(import.meta.dirname, '..');

// `vscode` comes from the extension host. ssh2's optional native pieces,
// cpu-features and its sshcrypto.node binding, stay out of the bundle, so
// ssh2 takes its JavaScript path on every platform.
const EXTERNAL = ['vscode', 'cpu-features', '*.node'];

// The OS keyring is the command line's credential store. The extension keeps
// secrets in VS Code's SecretStorage and never loads it.
const noKeyring: Plugin = {
  name: 'no-keyring',
  setup(builder) {
    builder.onResolve({ filter: /keyring/ }, ({ path: request, importer }) =>
      /@napi-rs\/keyring|credentials\/keyring/.test(request)
        ? { errors: [{ text: `${request}, imported by ${importer}, is the command line's credential store and is never bundled.` }] }
        : undefined,
    );
  },
};

// The engine and the extension pin the same zod release, which a unit test
// checks, so every import of zod resolves from the extension's own folder
// and the bundle carries one copy.
const oneZod: Plugin = {
  name: 'one-zod',
  setup(builder) {
    builder.onResolve({ filter: /^zod(?:\/|$)/ }, async ({ path: request, kind, resolveDir, pluginData }) => {
      if (resolveDir === root || (pluginData as { oneZod?: boolean } | undefined)?.oneZod === true) {
        return undefined;
      }
      const resolved = await builder.resolve(request, { kind, resolveDir: root, pluginData: { oneZod: true } });
      return resolved.errors.length > 0 ? { errors: resolved.errors } : { path: resolved.path };
    });
  },
};

// Lines the background problem matcher of .vscode/tasks.json reads.
const watchLog: Plugin = {
  name: 'watch-log',
  setup(builder) {
    builder.onStart(() => {
      console.log('[watch] build started');
    });
    builder.onEnd((result) => {
      for (const { text, location } of result.errors) {
        const where = location === null ? '' : `${location.file}:${String(location.line)}:${String(location.column + 1)}: `;
        console.error(`${where}error: ${text}`);
      }
      console.log('[watch] build finished');
    });
  },
};

const shared: BuildOptions = {
  absWorkingDir: root,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  external: EXTERNAL,
  logLevel: watch ? 'silent' : 'warning',
  plugins: watch ? [noKeyring, oneZod, watchLog] : [noKeyring, oneZod],
};

const extension: BuildOptions = {
  ...shared,
  entryPoints: ['src/extension.ts'],
  outfile: 'out/extension.js',
  sourcemap: production ? false : 'linked',
  metafile: true,
};

// The Site Settings page's one script, loaded from media/ under its
// Content-Security-Policy. It never reaches Node.js or VS Code's API.
const webview: BuildOptions = {
  absWorkingDir: root,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  entryPoints: ['src/webview/browser/main.ts'],
  outfile: 'media/dist/site-settings.js',
  metafile: true,
  logLevel: watch ? 'silent' : 'warning',
  plugins: watch ? [watchLog] : [],
};

function testEntries(): string[] {
  return readdirSync(path.join(root, 'test'), { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.test.ts'))
    .map((file) => path.join('test', file).split(path.sep).join('/'))
    .sort();
}

if (args.has('--docs-tests')) {
  // The documentation checks only, which need neither the engine nor the extension's bundle.
  rmSync(path.join(root, 'out', 'test', 'docs'), { recursive: true, force: true });
  const docsResult = await build({
    ...shared,
    entryPoints: testEntries().filter((entry) => entry.startsWith('test/docs/')),
    outdir: 'out/test',
    outbase: 'test',
    sourcemap: 'inline',
  });
  if (docsResult.warnings.length > 0) {
    process.exitCode = 1;
  }
} else if (watch) {
  await (await context(extension)).watch();
  await (await context(webview)).watch();
} else {
  rmSync(path.join(root, 'out'), { recursive: true, force: true });
  rmSync(path.join(root, 'media', 'dist'), { recursive: true, force: true });
  const result = await build(extension);
  writeFileSync(path.join(root, 'out', 'extension.meta.json'), `${JSON.stringify(result.metafile, null, 2)}\n`);
  const page = await build(webview);
  writeFileSync(path.join(root, 'out', 'webview.meta.json'), `${JSON.stringify(page.metafile, null, 2)}\n`);
  let warnings = result.warnings.length + page.warnings.length;
  if (tests) {
    const testResult = await build({ ...shared, entryPoints: testEntries(), outdir: 'out/test', outbase: 'test', sourcemap: 'inline', metafile: false });
    warnings += testResult.warnings.length;
  }
  if (warnings > 0) {
    console.error(`The build gave ${String(warnings)} warning(s).`);
    process.exitCode = 1;
  }
}
