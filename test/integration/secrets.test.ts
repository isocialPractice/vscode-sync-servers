// Runs inside VS Code: the credential store against VS Code's own
// SecretStorage, which the unit tests replace with a fake.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { SecretRef } from '@isocialpractice/cmd-sync-servers';
import * as vscode from 'vscode';
import { EXTENSION_ID } from '../../src/contributions.ts';
import type { TestApi } from '../../src/extension.ts';

suite('Secret storage', () => {
  test('a secret is kept, read back, and deleted', async () => {
    const api = await vscode.extensions.getExtension<TestApi | undefined>(EXTENSION_ID)?.activate();
    assert.ok(api);
    const ref: SecretRef = { siteId: randomUUID(), serverId: randomUUID(), kind: 'password' };
    const secret = randomBytes(16).toString('hex');
    assert.ok((await api.credentials.get(ref)) === undefined, 'nothing saved yet');
    await api.credentials.set(ref, secret);
    // Compared with assert.ok, so a failure never prints the secret.
    assert.ok((await api.credentials.get(ref)) === secret, 'read back');
    assert.equal(await api.credentials.delete(ref), true);
    assert.equal(await api.credentials.delete(ref), false, 'nothing left to delete');
  });
});
