// Runs inside VS Code: the extension activates, and its views and commands
// register with the workbench.
import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { COMMANDS, EXTENSION_ID, VIEW_CONTAINER, VIEWS } from '../../src/contributions.ts';

suite('Activation', () => {
  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is installed`);
    await extension.activate();
  });

  test('the extension is active', () => {
    assert.equal(vscode.extensions.getExtension(EXTENSION_ID)?.isActive, true);
  });

  test('the extension host runs Node.js 22.14 or later, as the engine needs', () => {
    const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
    assert.ok(major > 22 || (major === 22 && minor >= 14), `VS Code ${vscode.version} runs Node.js ${process.versions.node}`);
  });

  test('every command is registered', async () => {
    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = COMMANDS.filter((command) => !registered.has(command.id)).map((command) => command.id);
    assert.deepEqual(missing, []);
  });

  test('the Sync Servers container opens with the Sites and Remote Files views', async () => {
    await vscode.commands.executeCommand(`workbench.view.extension.${VIEW_CONTAINER}`);
    await vscode.commands.executeCommand(`${VIEWS.sites}.focus`);
    await vscode.commands.executeCommand(`${VIEWS.remoteFiles}.focus`);
  });

  test('Show Log opens the log without an error', async () => {
    await vscode.commands.executeCommand('syncServers.showLog');
  });
});
