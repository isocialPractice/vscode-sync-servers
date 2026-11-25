import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import type { DreamweaverServerCount } from '@isocialpractice/cmd-sync-servers';
import {
  ALLOW_DELETES,
  askNewSite,
  DREAMWEAVER_PLACEHOLDER,
  foldersOverlap,
  hostProblem,
  NONE_OF_THESE,
  remoteRootProblem,
  sameDreamweaverName,
  shownDreamweaverName,
  siteNameProblem,
  USE_FTP,
  type AddSiteContext,
  type ConnectRequest,
  type ConnectResult,
} from '../../src/flows/add-site.ts';
import { pickRemoteRoot, resolveFolder } from '../../src/flows/remote-root.ts';
import { BACK, type ChoiceQuestion, type TextQuestion } from '../../src/ui/prompt.ts';
import { ScriptedPrompter } from '../helpers/prompter.ts';

const siteFolder = path.join(tmpdir(), 'my-site');
const backupFolder = path.join(tmpdir(), 'my-site-backup');

// The folders the fake server shows; the account opens in /var/www.
const TREE: Readonly<Record<string, readonly string[]>> = {
  '/': ['var'],
  '/var': ['www'],
  '/var/www': ['logs', 'my-site'],
  '/var/www/logs': [],
  '/var/www/my-site': ['css'],
  '/var/www/my-site/css': [],
};

const open = (name: string): unknown => ({ kind: 'open', name });
const USE = { kind: 'use' };
const UP = { kind: 'up' };

const refused: ConnectResult = { ok: false, code: 'E_AUTH', reason: 'rejected', message: 'sftp.example.com did not accept the sign-in for "demo-user".' };
const notFound: ConnectResult = { ok: false, code: 'E_CONNECTION', message: 'The host sftp.example.org was not found.' };

/** Connects to a server that shows {@link TREE}: fails with `failures` first, in order. */
class FakeServer {
  readonly requests: ConnectRequest[] = [];
  readonly #failures: ConnectResult[];
  readonly #decided: Record<string, unknown>;
  closed = 0;

  constructor(failures: readonly ConnectResult[] = [], decided: Record<string, unknown> = {}) {
    this.#failures = [...failures];
    this.#decided = decided;
  }

  context(existingNames: readonly string[] = ['Acme Corp']): AddSiteContext {
    return { existingNames, connect: (request) => this.connect(request) };
  }

  connect(request: ConnectRequest): Promise<ConnectResult> {
    this.requests.push(structuredClone(request));
    const failure = this.#failures.shift();
    if (failure !== undefined) {
      return Promise.resolve(failure);
    }
    return Promise.resolve({
      ok: true,
      connection: {
        server: { ...request.server, ...this.#decided },
        startingFolder: '/var/www',
        folders: (folder) => {
          const folders = TREE[folder];
          return folders === undefined ? Promise.reject(new Error('No such folder.')) : Promise.resolve({ path: folder, folders, files: 2 });
        },
        exists: (folder) => Promise.resolve(folder in TREE),
        close: () => {
          this.closed += 1;
          return Promise.resolve();
        },
      },
    });
  }
}

describe('the answers Add Site accepts', () => {
  test('a site name is needed, at most 120 characters, and new ignoring case', () => {
    assert.equal(siteNameProblem('My Site', ['Acme Corp']), undefined);
    assert.match(siteNameProblem('  ', []) ?? '', /Enter a name/);
    assert.match(siteNameProblem('x'.repeat(121), []) ?? '', /120/);
    assert.equal(siteNameProblem('acme corp', ['Acme Corp']), 'A site named "Acme Corp" already exists.');
  });

  test('Host takes what the engine takes: a host, host:port, user@host and a whole address', () => {
    for (const accepted of ['sftp.example.com', 'sftp.example.com:2222', '[2001:db8::1]:22', '203.0.113.10', 'demo-user@sftp.example.com', 'sftp://sftp.example.com/var/www']) {
      assert.equal(hostProblem(accepted), undefined, accepted);
    }
    for (const refusedHost of ['', 'a b', 'host:0', 'host:70000', '[2001:db8::1']) {
      assert.equal(typeof hostProblem(refusedHost), 'string', refusedHost);
    }
  });

  test('a root directory on a server starts with a slash', () => {
    assert.equal(remoteRootProblem('/var/www/my-site'), undefined);
    assert.match(remoteRootProblem('var/www') ?? '', /starts with "\/"/);
  });

  test('a local server folder can neither hold nor sit inside the site folder', () => {
    assert.equal(foldersOverlap(siteFolder, backupFolder), false);
    assert.equal(foldersOverlap(siteFolder, path.join(siteFolder, 'backup')), true);
    assert.equal(foldersOverlap(path.join(siteFolder, 'public'), siteFolder), true);
    assert.equal(foldersOverlap(siteFolder, siteFolder), true);
  });
});

describe('Add Site', () => {
  test('connects with the answers before saving, picks the root from what the server shows, and keeps the accepted password', async () => {
    const server = new FakeServer();
    const prompter = new ScriptedPrompter(['My Site', siteFolder, 'sftp', 'sftp.example.com:2222', 'demo-user', 'example-password', open('my-site'), USE]);
    const answers = await askNewSite(prompter, server.context());
    assert.deepEqual(server.requests, [
      {
        siteName: 'My Site',
        password: 'example-password',
        server: {
          name: 'sftp.example.com',
          protocol: 'sftp',
          host: 'sftp.example.com',
          port: 2222,
          username: 'demo-user',
          remoteRoot: '/',
          auth: { method: 'password', savePassword: false },
        },
      },
    ]);
    assert.deepEqual(answers, {
      site: {
        name: 'My Site',
        localRoot: siteFolder,
        servers: [
          {
            name: 'sftp.example.com',
            protocol: 'sftp',
            host: 'sftp.example.com',
            port: 2222,
            username: 'demo-user',
            remoteRoot: '/var/www/my-site',
            auth: { method: 'password', savePassword: true },
          },
        ],
      },
      password: 'example-password',
      tested: true,
    });
    assert.equal(server.closed, 1);
    assert.equal(prompter.remaining, 0);
    const asked = prompter.asked.filter((entry) => entry.kind === 'text' || entry.kind === 'choose');
    assert.deepEqual(
      asked.map((entry) => (entry.question as TextQuestion).step),
      [1, 3, 4, 5, 6],
    );
    assert.equal((asked[4]?.question as TextQuestion).password, true);
    const picker = prompter.asked.filter((entry) => entry.kind === 'chooseOrType').map((entry) => entry.question as ChoiceQuestion<unknown>);
    assert.deepEqual(
      picker.map((question) => question.title),
      ['Root Directory: /var/www', 'Root Directory: /var/www/my-site'],
    );
    assert.deepEqual(
      picker[0]?.choices.map((choice) => choice.label),
      ['Use This Folder', '..', 'logs/', 'my-site/'],
    );
  });

  test('the server is named after the host a certificate decision connected to', async () => {
    const server = new FakeServer([], { host: 'server1.hosting.example.net', options: { tls: { servername: 'server1.hosting.example.net' } } });
    const prompter = new ScriptedPrompter(['My Site', siteFolder, 'ftps', '203.0.113.10', 'demo-user@example.com', 'example-password', open('my-site'), USE]);
    const answers = await askNewSite(prompter, server.context());
    const [saved] = answers?.site.servers ?? [];
    assert.equal(saved?.name, 'server1.hosting.example.net');
    assert.equal(saved.host, 'server1.hosting.example.net');
    assert.deepEqual(saved.options,{ tls: { servername: 'server1.hosting.example.net' } });
  });

  test('a whole address fills the protocol, the user and the root directory', async () => {
    const server = new FakeServer();
    const prompter = new ScriptedPrompter(['My Site', siteFolder, 'ftps', 'sftp://demo-user@sftp.example.com/var/www/my-site', 'demo-user', '']);
    const answers = await askNewSite(prompter, server.context());
    assert.equal((prompter.asked[4]?.question as TextQuestion).value, 'demo-user');
    assert.equal(server.requests[0]?.server.protocol, 'sftp');
    assert.equal(server.requests[0].password, undefined);
    assert.equal(answers?.site.servers?.[0]?.remoteRoot, '/var/www/my-site');
    assert.deepEqual(answers.site.servers[0].auth,{ method: 'password', savePassword: false });
    assert.equal(prompter.asked.some((entry) => entry.kind === 'chooseOrType'), false);
  });

  test('a refused sign-in asks for the user and password again, and the accepted ones are kept', async () => {
    const server = new FakeServer([refused]);
    const prompter = new ScriptedPrompter([
      'My Site',
      siteFolder,
      'sftp',
      'sftp.example.com',
      'demo-user',
      'wrong-password',
      'demo-user@example.com',
      'example-password',
      USE,
    ]);
    const answers = await askNewSite(prompter, server.context());
    assert.deepEqual(
      server.requests.map((request) => [request.server.username, request.password]),
      [
        ['demo-user', 'wrong-password'],
        ['demo-user@example.com', 'example-password'],
      ],
    );
    assert.equal(answers?.site.servers?.[0]?.username, 'demo-user@example.com');
    assert.equal(answers.password, 'example-password');
    assert.equal(prompter.shown[0]?.kind, 'error');
  });

  test('after three refusals it offers Try Again, Save Without Testing and Cancel', async () => {
    const server = new FakeServer([refused, refused, refused]);
    const answers = ['demo-user', 'wrong-password'];
    const prompter = new ScriptedPrompter(['My Site', siteFolder, 'sftp', 'sftp.example.com', ...answers, ...answers, ...answers, 'cancel']);
    assert.equal(await askNewSite(prompter, server.context()), undefined);
    const menu = prompter.asked.at(-1)?.question as ChoiceQuestion<unknown>;
    assert.deepEqual(
      menu.choices.map((choice) => choice.label),
      ['Try Again', 'Save Without Testing', 'Cancel'],
    );
    assert.equal(server.requests.length, 3);
  });

  test('a host that is not found offers Change the Host, which connects again', async () => {
    const server = new FakeServer([notFound]);
    const prompter = new ScriptedPrompter(['My Site', siteFolder, 'sftp', 'sftp.example.org', 'demo-user', 'example-password', 'host', 'sftp.example.com', USE]);
    const answers = await askNewSite(prompter, server.context());
    const menu = prompter.asked.find((entry) => entry.kind === 'choose' && (entry.question as ChoiceQuestion<unknown>).title.includes('failed'));
    assert.deepEqual(
      (menu?.question as ChoiceQuestion<unknown>).choices.map((choice) => choice.label),
      ['Change the Host', 'Save Without Testing', 'Cancel'],
    );
    assert.deepEqual(
      server.requests.map((request) => request.server.host),
      ['sftp.example.org', 'sftp.example.com'],
    );
    assert.equal(answers?.site.servers?.[0]?.name, 'sftp.example.com');
    assert.equal(answers.site.servers[0].remoteRoot, '/var/www');
  });

  test('Save Without Testing asks for the root directory and keeps no password', async () => {
    const server = new FakeServer([notFound]);
    const prompter = new ScriptedPrompter(['My Site', siteFolder, 'sftp', 'sftp.example.org', 'demo-user', 'example-password', 'save', '/var/www/my-site']);
    const answers = await askNewSite(prompter, server.context());
    assert.equal(answers?.tested, false);
    assert.equal(answers.password, undefined);
    assert.deepEqual(answers.site.servers?.[0], {
      name: 'sftp.example.org',
      protocol: 'sftp',
      host: 'sftp.example.org',
      username: 'demo-user',
      remoteRoot: '/var/www/my-site',
      auth: { method: 'password', savePassword: false },
    });
  });

  test('Cancel after a failure, or Escape in the picker, adds nothing and closes the connection', async () => {
    const failed = new FakeServer([notFound]);
    assert.equal(await askNewSite(new ScriptedPrompter(['My Site', siteFolder, 'sftp', 'sftp.example.org', '', '', 'cancel']), failed.context()), undefined);
    const connected = new FakeServer();
    assert.equal(await askNewSite(new ScriptedPrompter(['My Site', siteFolder, 'sftp', 'sftp.example.com', '', '', undefined]), connected.context()), undefined);
    assert.equal(connected.closed, 1);
  });

  test('a cancelled connection adds nothing', async () => {
    const server = new FakeServer([{ ok: false, code: 'E_CANCELLED', message: 'Cancelled.' }]);
    assert.equal(await askNewSite(new ScriptedPrompter(['My Site', siteFolder, 'sftp', 'sftp.example.com', '', '']), server.context()), undefined);
  });

  test('a root at the top of the account asks about deletes', async () => {
    const server = new FakeServer();
    const prompter = new ScriptedPrompter(['My Site', siteFolder, 'sftp', 'sftp.example.com', '', '', UP, UP, USE, ALLOW_DELETES]);
    const answers = await askNewSite(prompter, server.context());
    assert.equal(answers?.site.servers?.[0]?.remoteRoot, '/');
    assert.deepEqual(answers.site.servers[0].options, { allowRootDeletes: true });
  });

  test('a local folder server asks for its folder, is named after it, and does not connect', async () => {
    const server = new FakeServer();
    const prompter = new ScriptedPrompter(['My Site', siteFolder, 'local', backupFolder]);
    const answers = await askNewSite(prompter, server.context());
    assert.deepEqual(answers, {
      site: { name: 'My Site', localRoot: siteFolder, servers: [{ name: path.basename(backupFolder), protocol: 'local', remoteRoot: backupFolder }] },
      tested: true,
    });
    assert.equal((prompter.asked[2]?.question as ChoiceQuestion<unknown>).totalSteps, 6);
    assert.equal(server.requests.length, 0);
  });

  test('a local folder inside the site folder is refused and asked again', async () => {
    const prompter = new ScriptedPrompter(['My Site', siteFolder, 'local', path.join(siteFolder, 'backup'), backupFolder]);
    const answers = await askNewSite(prompter, new FakeServer().context());
    assert.equal(answers?.site.servers?.[0]?.remoteRoot, backupFolder);
    assert.equal(prompter.shown[0]?.kind, 'error');
  });

  test('a site with no server yet', async () => {
    const prompter = new ScriptedPrompter(['My Site', siteFolder, 'none']);
    assert.deepEqual(await askNewSite(prompter, new FakeServer().context()), { site: { name: 'My Site', localRoot: siteFolder }, tested: false });
  });

  test('plain FTP needs a second yes, and a dismissed warning asks for the protocol again', async () => {
    const server = new FakeServer();
    const prompter = new ScriptedPrompter(['My Site', siteFolder, 'ftp', undefined, 'ftp', USE_FTP, 'ftp.example.org', '', '', USE]);
    const answers = await askNewSite(prompter, server.context());
    assert.deepEqual(answers?.site.servers?.[0], {
      name: 'ftp.example.org',
      protocol: 'ftp',
      host: 'ftp.example.org',
      remoteRoot: '/var/www',
      auth: { method: 'password', savePassword: false },
      options: { allowInsecure: true },
    });
    assert.deepEqual(server.requests[0]?.server.options, { allowInsecure: true });
    assert.deepEqual(
      prompter.asked.filter((entry) => entry.kind === 'modal').map((entry) => 'warning' in entry.question && entry.question.warning),
      [true, true],
    );
  });

  test('Back returns to the previous step with its answer kept', async () => {
    const otherFolder = path.join(tmpdir(), 'sample-app');
    const prompter = new ScriptedPrompter(['My Site', siteFolder, BACK, otherFolder, 'none']);
    const answers = await askNewSite(prompter, new FakeServer().context());
    assert.equal(answers?.site.localRoot, otherFolder);
    const protocolQuestion = prompter.asked[2]?.question as ChoiceQuestion<unknown>;
    assert.equal(protocolQuestion.selected, 'sftp');
  });

  test('closing the folder picker goes back to the name, which keeps what was typed', async () => {
    const prompter = new ScriptedPrompter(['My Site', undefined, 'Sample App', siteFolder, 'none']);
    const answers = await askNewSite(prompter, new FakeServer().context());
    assert.equal(answers?.site.name, 'Sample App');
    assert.equal((prompter.asked[2]?.question as TextQuestion).value, 'My Site');
  });

  test('Escape at any step before connecting adds nothing and connects nowhere', async () => {
    const server = new FakeServer();
    assert.equal(await askNewSite(new ScriptedPrompter([undefined]), server.context()), undefined);
    assert.equal(await askNewSite(new ScriptedPrompter(['My Site', siteFolder, 'sftp', 'sftp.example.com', undefined]), server.context()), undefined);
    assert.equal(await askNewSite(new ScriptedPrompter(['My Site', siteFolder, 'sftp', 'sftp.example.com', 'demo-user', undefined]), server.context()), undefined);
    assert.equal(server.requests.length, 0);
  });
});

describe('the remote root picker', () => {
  const source = {
    folders: (folder: string) => {
      const folders = TREE[folder];
      return folders === undefined ? Promise.reject(new Error('No such folder.')) : Promise.resolve({ path: folder, folders, files: folder === '/var/www' ? 1 : 0 });
    },
    exists: (folder: string) => Promise.resolve(folder in TREE),
  };

  test('a typed path is absolute, or below the folder shown', () => {
    assert.equal(resolveFolder('/var/www/', '/srv'), '/var/www');
    assert.equal(resolveFolder('my-site', '/var/www'), '/var/www/my-site');
    assert.equal(resolveFolder('..', '/var/www'), '/var');
    assert.equal(resolveFolder('../..', '/var'), '/');
  });

  test('opens folders, goes up, and uses the folder shown', async () => {
    const prompter = new ScriptedPrompter([UP, open('www'), open('my-site'), USE]);
    assert.equal(await pickRemoteRoot(prompter, source, '/var/www'), '/var/www/my-site');
    const first = prompter.asked[0]?.question as ChoiceQuestion<unknown>;
    assert.match(first.placeholder, /It holds 1 file\./);
    assert.equal(first.choices[0]?.description, '/var/www');
  });

  test('a typed path goes there once it exists, and a missing one is refused', async () => {
    const prompter = new ScriptedPrompter([{ typed: '/srv/www' }, { typed: 'my-site/css' }, USE]);
    assert.equal(await pickRemoteRoot(prompter, source, '/var/www'), '/var/www/my-site/css');
    assert.deepEqual(prompter.messages, ['/srv/www was not found on the server.']);
  });

  test('"/" has no way up, and Escape picks nothing', async () => {
    const prompter = new ScriptedPrompter([undefined]);
    assert.equal(await pickRemoteRoot(prompter, source, '/'), undefined);
    assert.deepEqual(
      (prompter.asked[0]?.question as ChoiceQuestion<unknown>).choices.map((choice) => choice.label),
      ['Use This Folder', 'var/'],
    );
  });

  test('a starting folder that cannot be opened falls back to "/"', async () => {
    const prompter = new ScriptedPrompter([USE]);
    assert.equal(await pickRemoteRoot(prompter, source, '/srv'), '/');
    assert.match(prompter.messages[0] ?? '', /\/srv cannot be opened/);
  });
});

describe('Add Site in a folder Dreamweaver synchronized', () => {
  /** A context whose folder holds Dreamweaver's records for these servers. */
  function withRecords(server: FakeServer, names: readonly DreamweaverServerCount[]): { context: AddSiteContext; looked: string[] } {
    const looked: string[] = [];
    return {
      looked,
      context: {
        ...server.context(),
        dreamweaverServers: (localRoot) => {
          looked.push(localRoot);
          return Promise.resolve(names);
        },
      },
    };
  }
  const choices = (prompter: ScriptedPrompter): ChoiceQuestion<unknown>[] =>
    prompter.asked.filter((entry) => entry.kind === 'choose').map((entry) => entry.question as ChoiceQuestion<unknown>);
  const sftpAnswers = ['My Site', siteFolder, 'sftp', 'sftp.example.com', 'demo-user', 'example-password', open('my-site'), USE];

  test('a folder without records asks nothing, and the site leaves them alone', async () => {
    const { context, looked } = withRecords(new FakeServer(), []);
    const prompter = new ScriptedPrompter(sftpAnswers);
    const answers = await askNewSite(prompter, context);
    assert.equal(prompter.remaining, 0);
    assert.deepEqual(looked, [siteFolder]);
    assert.equal(answers?.site.sync, undefined);
    assert.ok(!choices(prompter).some((question) => question.placeholder === DREAMWEAVER_PLACEHOLDER));
  });

  test('records that name the server by its host and root: one question, and the site uses them', async () => {
    const server = new FakeServer();
    const { context } = withRecords(server, [{ server: 'SFTP.example.com//var/www/my-site', files: 212 }]);
    const prompter = new ScriptedPrompter([...sftpAnswers, true]);
    const answers = await askNewSite(prompter, context);
    assert.equal(prompter.remaining, 0);
    const asked = choices(prompter).at(-1);
    assert.equal(asked?.title, 'Add Site');
    assert.equal(asked.placeholder, DREAMWEAVER_PLACEHOLDER);
    assert.deepEqual(
      asked.choices.map((choice) => [choice.label, choice.description]),
      [
        ["Use Dreamweaver's Sync Records", 'The files Dreamweaver last synchronized are in sync from the first preview'],
        ['Do Not Use Them', undefined],
      ],
    );
    assert.deepEqual([asked.step, asked.totalSteps], [7, 7]);
    assert.deepEqual(answers?.site.sync, { dreamweaver: { enabled: true } });
    assert.equal(answers.site.servers?.[0]?.options?.dreamweaverServer, undefined);
    assert.equal(answers.password, 'example-password');
    assert.equal(server.closed, 1);
  });

  test('records of other names ask which one the server is, and the name chosen is kept', async () => {
    const names = [
      { server: '203.0.113.10//var/www/my-site/', files: 212 },
      { server: 'D:/Sites/my-site-testing/', files: 198 },
    ];
    const prompter = new ScriptedPrompter([...sftpAnswers, true, '203.0.113.10//var/www/my-site/']);
    const answers = await askNewSite(prompter, withRecords(new FakeServer(), names).context);
    const which = choices(prompter).at(-1);
    assert.equal(which?.placeholder, 'Which of the servers Dreamweaver synchronized this folder with is sftp.example.com?');
    assert.deepEqual(
      which.choices.map((choice) => [choice.label, choice.description]),
      [
        ['203.0.113.10//var/www/my-site/', '212 files'],
        ['D:/Sites/my-site-testing/', '198 files'],
        [NONE_OF_THESE, undefined],
      ],
    );
    assert.deepEqual([which.step, which.totalSteps], [8, 8]);
    assert.deepEqual(answers?.site.sync, { dreamweaver: { enabled: true } });
    assert.equal(answers.site.servers?.[0]?.options?.dreamweaverServer, '203.0.113.10//var/www/my-site/');

    const none = new ScriptedPrompter([...sftpAnswers, true, null]);
    const unnamed = await askNewSite(none, withRecords(new FakeServer(), names).context);
    assert.deepEqual(unnamed?.site.sync, { dreamweaver: { enabled: true } });
    assert.equal(unnamed.site.servers?.[0]?.options, undefined, 'None of These changes nothing on the server');
  });

  test('Do Not Use Them leaves the site as it was', async () => {
    const prompter = new ScriptedPrompter([...sftpAnswers, false]);
    const answers = await askNewSite(prompter, withRecords(new FakeServer(), [{ server: 'D:/Sites/my-site-testing/', files: 3 }]).context);
    assert.equal(prompter.remaining, 0);
    assert.ok(answers);
    assert.equal(answers.site.sync, undefined);
    assert.equal(answers.site.servers?.[0]?.options, undefined);
  });

  test('Back goes to the step before: the root directory, the folder, or the first question', async () => {
    const remote = new ScriptedPrompter([...sftpAnswers, BACK, open('logs'), USE, true]);
    const moved = await askNewSite(remote, withRecords(new FakeServer(), [{ server: 'sftp.example.com//var/www/logs/', files: 3 }]).context);
    assert.equal(remote.remaining, 0);
    assert.equal(moved?.site.servers?.[0]?.remoteRoot, '/var/www/logs');
    assert.deepEqual(moved.site.sync, { dreamweaver: { enabled: true } });

    const otherFolder = path.join(tmpdir(), 'my-site-testing');
    const built = `${otherFolder.split(path.sep).join('/')}/`;
    const local = new ScriptedPrompter(['My Site', siteFolder, 'local', backupFolder, BACK, otherFolder, true]);
    const folderAnswers = await askNewSite(local, withRecords(new FakeServer(), [{ server: built, files: 3 }]).context);
    assert.equal(local.remaining, 0);
    assert.equal(folderAnswers?.site.servers?.[0]?.remoteRoot, otherFolder);
    assert.deepEqual(folderAnswers.site.sync, { dreamweaver: { enabled: true } });

    const named = new ScriptedPrompter([...sftpAnswers, true, BACK, false]);
    const skipped = await askNewSite(named, withRecords(new FakeServer(), [{ server: 'D:/Sites/my-site-testing/', files: 3 }]).context);
    assert.equal(named.remaining, 0);
    assert.equal(skipped?.site.sync, undefined, 'Back from the names asks the first question again');
  });

  test('a site with no server yet is asked after Protocol, and uses the records without a server name', async () => {
    const { context } = withRecords(new FakeServer(), [{ server: 'D:/Sites/my-site-testing/', files: 3 }]);
    const prompter = new ScriptedPrompter(['My Site', siteFolder, 'none', BACK, 'none', true]);
    const answers = await askNewSite(prompter, context);
    assert.equal(prompter.remaining, 0);
    assert.deepEqual(answers, { site: { name: 'My Site', localRoot: siteFolder, sync: { dreamweaver: { enabled: true } } }, tested: false });
    const asked = choices(prompter);
    assert.deepEqual(
      asked.map((question) => question.placeholder),
      ['Protocol: how to reach the first server', DREAMWEAVER_PLACEHOLDER, 'Protocol: how to reach the first server', DREAMWEAVER_PLACEHOLDER],
    );
    assert.deepEqual([asked[1]?.step, asked[1]?.totalSteps], [4, 4]);
  });

  test('Save Without Testing asks too, and Escape adds nothing and closes the connection', async () => {
    const names = [{ server: 'sftp.example.org//var/www/my-site/', files: 3 }];
    const saved = new ScriptedPrompter(['My Site', siteFolder, 'sftp', 'sftp.example.org', 'demo-user', 'example-password', 'save', '/var/www/my-site', true]);
    const answers = await askNewSite(saved, withRecords(new FakeServer([notFound]), names).context);
    assert.equal(answers?.tested, false);
    assert.deepEqual(answers.site.sync, { dreamweaver: { enabled: true } });

    const server = new FakeServer();
    const escaped = new ScriptedPrompter([...sftpAnswers, undefined]);
    assert.equal(await askNewSite(escaped, withRecords(server, names).context), undefined);
    assert.equal(server.closed, 1);
  });

  test('names are compared as the engine compares them, and shown as plain text', () => {
    assert.equal(sameDreamweaverName('203.0.113.10//public_html/', '203.0.113.10//PUBLIC_HTML'), true);
    assert.equal(sameDreamweaverName('203.0.113.10//public_html/', '203.0.113.10//public_html/old/'), false);
    assert.equal(shownDreamweaverName('$(alert) 203.0.113.10//public_html/'), '\\$(alert) 203.0.113.10//public_html/');
    assert.equal(shownDreamweaverName('a\u202eb\nc'), 'a?b?c');
  });
});
