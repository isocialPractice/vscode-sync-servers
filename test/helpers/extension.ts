// For integration tests, which run inside VS Code: the extension's test API,
// the sync-servers command line as a child process, and waiting.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import type { SecretRef } from '@isocialpractice/cmd-sync-servers';
import * as vscode from 'vscode';
import { EXTENSION_ID } from '../../src/contributions.ts';
import type { TestApi } from '../../src/extension.ts';
import { ROOT } from './files.ts';

const CLI = path.join(ROOT, 'node_modules', '@isocialpractice', 'cmd-sync-servers', 'out', 'cli', 'main.js');

/** A site as `sync-servers sites --json` lists it. */
export interface ListedSite {
  readonly id: string;
  readonly name: string;
  readonly remoteServer: { readonly name: string } | null;
}

/** Activates the extension and returns its test API, after checking it uses a test settings folder. */
export async function testApi(): Promise<TestApi> {
  const extension = vscode.extensions.getExtension<TestApi | undefined>(EXTENSION_ID);
  assert.ok(extension);
  const api = await extension.activate();
  assert.ok(api, 'the extension returns its test API when VS Code runs its tests');
  const home = process.env.SYNC_SERVERS_HOME ?? '';
  assert.notEqual(home, '', 'the tests run with SYNC_SERVERS_HOME set');
  assert.equal(api.model.paths?.configDir, path.resolve(home), 'the extension uses the test folder, never the real list');
  return api;
}

/** Runs the sync-servers command line on the extension host's own Node.js, with the same settings folder. */
export function syncServers(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SYNC_SERVERS_KEYRING: 'off' },
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** The sites `sync-servers sites --json` lists. */
export function listedSites(): ListedSite[] {
  const result = syncServers('sites', '--json');
  assert.equal(result.status, 0, result.stderr);
  return (JSON.parse(result.stdout) as { sites: ListedSite[] }).sites;
}

/** Waits until `check` holds, failing after `timeoutMs`. */
export async function waitFor(what: string, check: () => boolean, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${what}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Waits until a deleted secret reads as gone. SecretStorage can answer a read
 * made straight after a delete with the old value for a moment.
 */
export async function secretGone(api: TestApi, ref: SecretRef): Promise<void> {
  const start = Date.now();
  while ((await api.credentials.get(ref)) !== undefined) {
    assert.ok(Date.now() - start < 5000, 'the saved secret is deleted');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
