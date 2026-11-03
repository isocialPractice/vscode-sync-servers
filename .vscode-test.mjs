// The integration tests, run inside VS Code by `npm run test:integration`:
// once in the current release (label `stable`) and once in 1.101.0, the
// oldest release the extension supports (label `minimum`).
// `npm run test:integration -- --label minimum` runs one of them.
import { defineConfig } from '@vscode/test-cli';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Each run gets its own empty settings folder, so the tests never read or
// write the real list of sites, and one run never sees another's.
const run = (label, version) => ({
  label,
  version,
  files: 'out/test/integration/**/*.test.js',
  launchArgs: ['--disable-extensions'],
  env: { SYNC_SERVERS_HOME: mkdtempSync(join(tmpdir(), `sync-servers-vscode-${label}-`)), SYNC_SERVERS_KEYRING: 'off' },
  mocha: { ui: 'tdd', timeout: 20000 },
});

export default defineConfig([run('stable', 'stable'), run('minimum', '1.101.0')]);
