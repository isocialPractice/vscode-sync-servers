// Sites and servers for tests, built through the engine's own schema so
// every default is filled in.
import { randomUUID } from 'node:crypto';
import { siteSchema, type Site } from '@isocialpractice/cmd-sync-servers';
import type { SiteData } from '../../src/shared/site-data.ts';

/** A site with an SFTP Remote server, an FTPS Testing server and a local folder server. */
export function sampleSite(localRoot: string, backupFolder: string): Site {
  const production = randomUUID();
  const staging = randomUUID();
  return siteSchema.parse({
    id: randomUUID(),
    name: 'My Site',
    localRoot,
    remoteServerId: production,
    testingServerId: staging,
    servers: [
      { id: production, name: 'Production', protocol: 'sftp', host: 'sftp.example.com', username: 'demo-user', remoteRoot: '/var/www/my-site' },
      { id: staging, name: 'Staging', protocol: 'ftps', host: 'staging.example.com', remoteRoot: '/' },
      { id: randomUUID(), name: 'Backup', protocol: 'local', remoteRoot: backupFolder },
    ],
  });
}

/** A site as the form holds it. */
export function asData(site: Site): SiteData {
  return structuredClone<SiteData>(site);
}
