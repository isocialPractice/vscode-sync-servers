import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { siteSchema, SyncError, type Site } from '@isocialpractice/cmd-sync-servers';
import { errorText } from '../../src/error-text.ts';
import { escapeIcons, statusText } from '../../src/status-text.ts';
import { serverAddress, serverRow, shortPath, siteRow, takesSecret } from '../../src/views/site-rows.ts';

const home = path.join(tmpdir(), 'home');
const production = randomUUID();
const staging = randomUUID();
const backup = randomUUID();

const site: Site = siteSchema.parse({
  id: randomUUID(),
  name: 'My Site',
  localRoot: path.join(home, 'sites', 'my-site'),
  remoteServerId: production,
  testingServerId: staging,
  servers: [
    { id: production, name: 'Production', protocol: 'sftp', host: 'sftp.example.com', port: 2222, username: 'demo-user', remoteRoot: '/var/www/my-site' },
    { id: staging, name: 'Staging', protocol: 'ftps', host: 'staging.example.com', remoteRoot: '/', auth: { method: 'password' } },
    { id: backup, name: 'Backup', protocol: 'local', remoteRoot: path.join(tmpdir(), 'backup') },
  ],
});
const [productionServer, stagingServer, backupServer] = site.servers;

test('a site row shows its folder under the home folder with ~, and whether it is active', () => {
  const folder = `~${path.sep}${path.join('sites', 'my-site')}`;
  const active = siteRow(site, true, home);
  assert.equal(active.label, 'My Site');
  assert.equal(active.description, `${folder}, active`);
  assert.equal(active.contextValue, 'site active');
  assert.equal(active.icon, 'globe');
  assert.match(active.tooltip, /Remote server: Production \(SFTP sftp\.example\.com:2222\)/);
  assert.match(active.accessibilityLabel, /^My Site, site, active, local folder/);
  const inactive = siteRow(site, false, home);
  assert.equal(inactive.description, folder);
  assert.equal(inactive.contextValue, 'site');
  assert.equal(inactive.id, `site:${site.id}`);
});

test('a server row names its protocol, address and roles', () => {
  assert.ok(productionServer && stagingServer && backupServer);
  const remote = serverRow(site, productionServer);
  assert.equal(remote.description, 'SFTP sftp.example.com:2222  Remote');
  assert.equal(remote.contextValue, 'server sftp remote secret');
  assert.equal(remote.icon, 'server');
  const testing = serverRow(site, stagingServer);
  assert.equal(testing.description, 'FTPS staging.example.com  Testing');
  assert.equal(testing.icon, 'beaker');
  const folder = serverRow(site, backupServer);
  assert.equal(folder.contextValue, 'server local');
  assert.equal(folder.description, `Folder ${backupServer.remoteRoot}`);
});

test('only servers that sign in with a password or a key take a secret', () => {
  assert.ok(productionServer && backupServer);
  assert.equal(takesSecret(productionServer), true);
  assert.equal(takesSecret(backupServer), false);
  assert.equal(takesSecret({ ...productionServer, auth: { method: 'agent', savePassword: false } }), false);
});

test('an IPv6 address is written in brackets', () => {
  assert.ok(productionServer);
  assert.equal(serverAddress({ ...productionServer, host: '2001:db8::1', port: undefined }), '[2001:db8::1]');
});

test('paths outside the home folder are shown in full', () => {
  const outside = path.join(tmpdir(), 'elsewhere');
  assert.equal(shortPath(outside, home), outside);
  assert.equal(shortPath(home, home), '~');
});

test('the status bar names the active site and its Remote server, never drawing a name as an icon', () => {
  assert.equal(statusText(site).text, '$(cloud) My Site: Production');
  assert.equal(statusText(undefined).text, '$(cloud) Sync Servers');
  assert.equal(statusText({ ...site, name: 'Odd $(alert) Name' }).text, '$(cloud) Odd \\$(alert) Name: Production');
  assert.equal(escapeIcons('no icons'), 'no icons');
});

test("a missing password's advice points at Set Password instead of the command line", () => {
  const error = new SyncError(
    'E_AUTH',
    'No password for "My Site: Production". Save one with "sync-servers password set", set SYNC_SERVERS_PASSWORD, or run in a terminal to be asked.',
  );
  assert.equal(errorText(error), 'No password for "My Site: Production". Save it with Set Password..., or enter it when asked.');
  assert.equal(errorText(new SyncError('E_CONNECTION', 'Connection refused.')), 'Connection refused.');
  assert.equal(errorText('plain'), 'plain');
});
