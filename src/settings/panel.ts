import { randomBytes } from 'node:crypto';
import { DEFAULT_GUARD_PATTERNS, isSyncError, serverSchema, type Server, type Site } from '@isocialpractice/cmd-sync-servers';
import * as vscode from 'vscode';
import { countCloaked } from '../cloak-count.ts';
import { decisionsBetween, openProbe } from '../commands/probe.ts';
import type { Services } from '../commands/services.ts';
import { SECRET_KINDS } from '../commands/sites.ts';
import { errorText } from '../error-text.ts';
import { ALLOW_DELETES, ROOT_DELETES_QUESTION } from '../flows/add-site.ts';
import { pickRemoteRoot } from '../flows/remote-root.ts';
import { realPathOf } from '../real-path.ts';
import { fromWebviewSchema, toWebviewSchema, type Decisions, type FromWebview, type PickTarget, type ToWebview } from '../shared/messages.ts';
import type { ServerData, SiteData } from '../shared/site-data.ts';
import { sameData } from '../webview/state.ts';
import { settingsPage } from './html.ts';
import { checkSave, pinProblem, type Granted } from './save-check.ts';

/** The buttons of the questions the panel asks. */
export const DISCARD = 'Discard Changes';
export const SAVE_ANYWAY = 'Save Anyway';
export const RELOAD = 'Reload';

const COUNT_DELAY_MS = 250;

function data(site: Site): SiteData {
  return structuredClone<SiteData>(site);
}

/**
 * One Site Settings panel. It owns the site as it was when the form loaded,
 * so a save can tell when the command line changed the site meanwhile.
 */
export class SiteSettingsPanel implements vscode.Disposable {
  /** Every message sent to the webview, kept only while VS Code runs the tests. */
  readonly posted: ToWebview[] = [];
  readonly siteId: string;
  readonly #services: Services;
  readonly #panel: vscode.WebviewPanel;
  readonly #record: boolean;
  readonly #editServerId: string | undefined;
  #snapshot: Site;
  /** Host keys and certificates trusted on connection from this panel, by server id: the only new pins a save accepts. */
  readonly #granted = new Map<string, Granted>();
  #countTimer: NodeJS.Timeout | undefined;
  #countAbort: AbortController | undefined;
  /** The cloaking last counted, so a change to the global patterns counts it again. */
  #lastCount: Site['cloaking'] | undefined;
  /** The global cloaking patterns the form shows. */
  #globalPatterns: readonly string[] = [];
  #disposed = false;

  constructor(services: Services, extensionUri: vscode.Uri, site: Site, options: { record: boolean; editServerId?: string; onDispose: () => void }) {
    this.siteId = site.id;
    this.#services = services;
    this.#snapshot = site;
    this.#record = options.record;
    this.#editServerId = options.editServerId;
    const media = vscode.Uri.joinPath(extensionUri, 'media');
    this.#panel = vscode.window.createWebviewPanel('syncServers.siteSettings', `Site Settings: ${site.name}`, vscode.ViewColumn.Active, {
      enableScripts: true,
      enableCommandUris: false,
      localResourceRoots: [media],
      retainContextWhenHidden: true,
    });
    this.#panel.iconPath = vscode.Uri.joinPath(media, 'sync-servers.svg');
    const webview = this.#panel.webview;
    webview.html = settingsPage({
      cspSource: webview.cspSource,
      nonce: randomBytes(16).toString('base64'),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(media, 'site-settings.css')).toString(),
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(media, 'dist', 'site-settings.js')).toString(),
      title: `Site Settings: ${site.name}`,
    });
    webview.onDidReceiveMessage((message: unknown) => {
      void this.receive(message);
    });
    const watching = services.model.onDidChange(() => {
      this.#globalsChanged();
    });
    this.#panel.onDidDispose(() => {
      this.#disposed = true;
      this.#stopCounting();
      watching.dispose();
      options.onDispose();
    });
  }

  /** Brings the panel to the front. */
  reveal(): void {
    this.#panel.reveal();
  }

  /** Handles a message from the webview. Anything that does not match its schema is dropped. */
  async receive(raw: unknown): Promise<void> {
    const parsed = fromWebviewSchema.safeParse(raw);
    if (!parsed.success) {
      this.#services.logger.warn('Dropped a message from Site Settings that does not match its schema', {
        siteId: this.siteId,
        issues: parsed.error.issues.length,
      });
      return;
    }
    const message: FromWebview = parsed.data;
    switch (message.type) {
      case 'ready':
        await this.#load();
        return;
      case 'error':
        this.#services.logger.error('The Site Settings page reported a problem', { siteId: this.siteId, problem: message.text });
        return;
      case 'save':
        await this.#save(message.site);
        return;
      case 'cancel':
        await this.#cancel(message.dirty);
        return;
      case 'browse':
        await this.#browse(message.target, message.server);
        return;
      case 'test':
        await this.#test(message.serverId, message.server);
        return;
      case 'setPassword':
      case 'forgetPassword':
        await this.#password(message.type, message.serverId);
        return;
      case 'countCloaked':
        this.#scheduleCount(message.cloaking);
        return;
      case 'editGlobalPatterns':
        await vscode.commands.executeCommand('syncServers.globalCloaking');
        return;
    }
  }

  #post(message: ToWebview): void {
    if (this.#disposed) {
      return;
    }
    if (this.#record) {
      // A message the webview would drop is a bug; the tests fail on it.
      toWebviewSchema.parse(message);
      this.posted.push(message);
    }
    void this.#panel.webview.postMessage(message);
  }

  async #passwordState(site: Site): Promise<Record<string, boolean>> {
    const state: Record<string, boolean> = {};
    for (const server of site.servers) {
      let saved = false;
      for (const kind of SECRET_KINDS) {
        saved = saved || (await this.#services.credentials.get({ siteId: site.id, serverId: server.id, kind })) !== undefined;
      }
      state[server.id] = saved;
    }
    return state;
  }

  #current(): Site | undefined {
    return this.#services.model.site(this.siteId);
  }

  async #load(): Promise<void> {
    const site = this.#current() ?? this.#snapshot;
    this.#snapshot = site;
    this.#globalPatterns = this.#services.model.globalPatterns;
    this.#post({
      type: 'load',
      site: data(site),
      passwordSaved: await this.#passwordState(site),
      builtInGuard: [...DEFAULT_GUARD_PATTERNS],
      globalPatterns: [...this.#globalPatterns],
      ...(this.#editServerId === undefined || !site.servers.some((server) => server.id === this.#editServerId) ? {} : { editServerId: this.#editServerId }),
    });
  }

  async #save(draft: SiteData): Promise<void> {
    const { model, prompter, logger, credentials } = this.#services;
    const current = this.#current();
    if (current === undefined) {
      this.#post({ type: 'problems', problems: [], message: 'Not saved: the site is no longer in your list of sites.' });
      return;
    }
    if (!sameData(current, this.#snapshot)) {
      const choice = await prompter().modal({
        message: `"${current.name}" was changed outside this form since it opened.`,
        detail: 'Save over those changes, or reload the form with them and lose the changes made here.',
        buttons: [SAVE_ANYWAY, RELOAD],
        warning: true,
      });
      if (choice === RELOAD) {
        await this.#load();
        return;
      }
      if (choice !== SAVE_ANYWAY) {
        this.#post({ type: 'problems', problems: [], message: 'Not saved.' });
        return;
      }
    }
    const check = checkSave(draft, current, model.sites, undefined, this.#granted);
    if (check.kind === 'refused') {
      logger.warn('Dropped a change from Site Settings that the form cannot make', { siteId: this.siteId, reason: check.reason });
      this.#post({ type: 'problems', problems: [], message: 'Not saved: the change was refused.' });
      return;
    }
    if (check.kind === 'problems') {
      const count = check.problems.length;
      this.#post({
        type: 'problems',
        problems: [...check.problems],
        message: `Not saved: ${count === 1 ? '1 problem needs' : `${String(count)} problems need`} fixing.`,
      });
      return;
    }
    const saved = await model.registry().replace(this.siteId, check.site);
    for (const server of current.servers.filter((before) => !saved.servers.some((after) => after.id === before.id))) {
      for (const kind of SECRET_KINDS) {
        await credentials.delete({ siteId: saved.id, serverId: server.id, kind });
      }
    }
    this.#snapshot = saved;
    this.#panel.title = `Site Settings: ${saved.name}`;
    model.refresh();
    this.#post({ type: 'saved', site: data(saved), passwordSaved: await this.#passwordState(saved), message: `Saved "${saved.name}".` });
  }

  async #cancel(dirty: boolean): Promise<void> {
    if (dirty) {
      const choice = await this.#services.prompter().modal({
        message: `Discard the changes to "${this.#snapshot.name}"?`,
        detail: 'The site keeps the settings it had when it was last saved.',
        buttons: [DISCARD],
        warning: true,
      });
      if (choice !== DISCARD) {
        return;
      }
    }
    this.#panel.dispose();
  }

  /**
   * The server as the form shows it, as the engine reads it, for connecting
   * before it is saved: with a root of "/" when the root is not a path yet,
   * since Browse... picks it. A problem is the first one the engine finds.
   */
  #unsaved(data: ServerData, rootOptional: boolean): Server | string {
    const saved = (this.#current() ?? this.#snapshot).servers.find((candidate) => candidate.id === data.id);
    const pinned = pinProblem(data, saved, this.#granted.get(data.id));
    if (pinned !== undefined) {
      this.#services.logger.warn('Dropped a server from Site Settings that the form cannot make', { siteId: this.siteId, reason: pinned });
      return pinned;
    }
    const remoteRoot = rootOptional && data.protocol !== 'local' && !data.remoteRoot.startsWith('/') ? '/' : data.remoteRoot;
    const parsed = serverSchema.safeParse({ ...data, remoteRoot });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue === undefined ? '' : issue.path.map(String).join('.');
      return `${field === '' ? '' : `${field}: `}${issue?.message ?? 'The server is not valid.'}`;
    }
    return parsed.data;
  }

  #postDecisions(serverId: string, before: Server, after: Server, extra: Decisions = {}): boolean {
    const decisions = { ...decisionsBetween(before, after), ...extra };
    if (Object.keys(decisions).length === 0) {
      return false;
    }
    if (decisions.hostKey !== undefined || decisions.trustedCertificate !== undefined) {
      const granted = this.#granted.get(serverId);
      this.#granted.set(serverId, {
        hostKey: decisions.hostKey ?? granted?.hostKey,
        trustedCertificate: decisions.trustedCertificate ?? granted?.trustedCertificate,
      });
    }
    this.#post({ type: 'decided', serverId, decisions });
    return true;
  }

  async #browseRemoteRoot(target: Extract<PickTarget, { kind: 'remoteRoot' }>, data: ServerData | undefined): Promise<void> {
    const prompter = this.#services.prompter();
    if (data === undefined) {
      return;
    }
    const server = this.#unsaved(data, true);
    if (typeof server === 'string') {
      void prompter.error(`Browse... needs a server it can connect to. ${server}`);
      return;
    }
    const site = this.#snapshot;
    let picked: string | undefined;
    let connected: Server = server;
    try {
      const { probe, server: decided } = await openProbe(this.#services, {
        site: { id: site.id, name: site.name },
        server,
        title: `Connecting to ${server.host ?? ''}`,
        decided: (now) => {
          connected = now;
        },
      });
      connected = decided;
      try {
        const current = data.remoteRoot.startsWith('/') && (await probe.exists(data.remoteRoot)) ? data.remoteRoot : (probe.startingFolder ?? '/');
        picked = await pickRemoteRoot(prompter, probe, current);
      } finally {
        await probe.close();
      }
    } catch (error) {
      this.#postDecisions(target.serverId, server, connected);
      if (!isSyncError(error, 'E_CANCELLED')) {
        void prompter.error(`Could not connect to ${server.host ?? ''}. ${errorText(error)}`);
      }
      return;
    }
    let allowRootDeletes: boolean | undefined;
    if (picked === '/' && data.options.allowRootDeletes !== true) {
      allowRootDeletes = (await prompter.modal(ROOT_DELETES_QUESTION)) === ALLOW_DELETES ? true : undefined;
    }
    this.#postDecisions(target.serverId, server, connected, allowRootDeletes === undefined ? {} : { allowRootDeletes });
    if (picked !== undefined) {
      this.#post({ type: 'picked', target, path: picked });
    }
  }

  async #browse(target: PickTarget, data?: ServerData): Promise<void> {
    if (target.kind === 'remoteRoot') {
      await this.#browseRemoteRoot(target, data);
      return;
    }
    const prompter = this.#services.prompter();
    const site = this.#snapshot;
    const server = target.kind === 'localRoot' ? undefined : site.servers.find((candidate) => candidate.id === target.serverId);
    let picked: string | undefined;
    switch (target.kind) {
      case 'localRoot':
        picked = await prompter.folder({ title: `The local site folder of "${site.name}"`, openLabel: 'Use as Local Site Folder', start: site.localRoot });
        break;
      case 'serverFolder':
        picked = await prompter.folder({ title: 'The folder the server publishes to', openLabel: 'Use as Server Folder', start: server?.remoteRoot });
        break;
      case 'keyFile':
        picked = await prompter.file({ title: 'The private key file', openLabel: 'Use This Key' });
        break;
      case 'caFile':
        picked = await prompter.file({ title: 'The certificate authority file, in PEM form', openLabel: 'Use This File' });
        break;
    }
    if (picked !== undefined) {
      this.#post({ type: 'picked', target, path: picked });
    }
  }

  /**
   * Tests the server as the form shows it, saved or not: connects, signs in
   * and checks the root directory. What the connection decides goes into the
   * form as unsaved changes; nothing is written to sites.json.
   */
  async #test(serverId: string, data: ServerData): Promise<void> {
    const server = this.#unsaved(data, false);
    if (typeof server === 'string') {
      this.#post({ type: 'testResult', serverId, ok: false, text: `Not tested: ${server}` });
      return;
    }
    const site = this.#current() ?? this.#snapshot;
    const saved = site.servers.find((candidate) => candidate.id === serverId);
    const name = server.protocol === 'local' ? server.remoteRoot : (server.host ?? '');
    let connected: Server = server;
    try {
      const { probe, server: decided } = await openProbe(this.#services, {
        site: { id: site.id, name: site.name },
        server,
        title: `Testing ${server.name}`,
        savedServer: saved !== undefined && sameData(saved, data),
        decided: (now) => {
          connected = now;
        },
      });
      connected = decided;
      let found: boolean;
      try {
        // The probe refuses a folder named like a Windows short name, such as
        // RUNNER~1 in a temp path, so a local folder is checked by its real path.
        found = await probe.exists(server.protocol === 'local' ? realPathOf(server.remoteRoot) : server.remoteRoot);
      } finally {
        await probe.close();
      }
      const changed = this.#postDecisions(serverId, server, connected);
      const keep = changed ? ' What the connection decided is in the form; save to keep it.' : '';
      const root = server.remoteRoot;
      let text: string;
      if (server.protocol === 'local') {
        text = found ? `The folder ${root} is there.` : `The folder ${root} was not found. Browse... picks another.`;
      } else {
        text = found
          ? `Connected to ${name}. The root directory ${root} was found.${keep}`
          : `Connected to ${name}, but the root directory ${root} was not found. Browse... picks it from what the server shows.${keep}`;
      }
      this.#services.logger.info('Connection test passed', { siteId: site.id, serverId, protocol: server.protocol, rootFound: found });
      this.#post({ type: 'testResult', serverId, ok: found, text });
    } catch (error) {
      this.#postDecisions(serverId, server, connected);
      const text = isSyncError(error, 'E_CANCELLED') ? 'The test was cancelled.' : `Could not connect to ${name}. ${errorText(error)}`;
      this.#services.logger.error('Connection test failed', { siteId: site.id, serverId, problem: text });
      this.#post({ type: 'testResult', serverId, ok: false, text });
    }
    await this.#serverStateChanged();
  }

  async #password(command: 'setPassword' | 'forgetPassword', serverId: string): Promise<void> {
    const site = this.#current();
    const server = site?.servers.find((candidate) => candidate.id === serverId);
    if (site === undefined || server === undefined) {
      return;
    }
    await vscode.commands.executeCommand(`syncServers.${command}`, { kind: 'server', site, server });
    await this.#serverStateChanged();
  }

  // A test may pin a host key and the password commands change savePassword;
  // the form takes those two fields from the saved site.
  async #serverStateChanged(): Promise<void> {
    const site = this.#current();
    if (site === undefined) {
      return;
    }
    const before = this.#snapshot;
    const merged = structuredClone(before);
    for (const server of merged.servers) {
      const now = site.servers.find((candidate) => candidate.id === server.id);
      if (now === undefined) {
        continue;
      }
      if (now.auth === undefined) {
        delete server.auth;
      } else {
        server.auth = structuredClone(now.auth);
      }
      if (now.options.hostKey === undefined) {
        delete server.options.hostKey;
      } else {
        server.options.hostKey = structuredClone(now.options.hostKey);
      }
    }
    // Only these fields move the snapshot; any other change made elsewhere
    // still shows as a conflict on the next save.
    this.#snapshot = merged;
    this.#post({ type: 'serverState', site: data(merged), passwordSaved: await this.#passwordState(site) });
  }

  /** Tells the form when the global cloaking patterns changed, and counts again with them. */
  #globalsChanged(): void {
    const patterns = this.#services.model.globalPatterns;
    if (patterns.length === this.#globalPatterns.length && patterns.every((pattern, index) => pattern === this.#globalPatterns[index])) {
      return;
    }
    this.#globalPatterns = patterns;
    this.#post({ type: 'globalPatterns', patterns: [...patterns] });
    if (this.#lastCount !== undefined) {
      this.#scheduleCount(this.#lastCount);
    }
  }

  #scheduleCount(cloaking: Site['cloaking']): void {
    this.#stopCounting();
    this.#lastCount = cloaking;
    const controller = new AbortController();
    this.#countAbort = controller;
    this.#countTimer = setTimeout(() => {
      void countCloaked(this.#snapshot.localRoot, cloaking, { signal: controller.signal, globalPatterns: this.#globalPatterns })
        .then((count) => {
          if (!controller.signal.aborted) {
            this.#post({ type: 'cloakCount', ...count });
          }
        })
        .catch((error: unknown) => {
          this.#services.logger.warn('The cloaked files could not be counted', { problem: error instanceof Error ? error.message : String(error) });
        });
    }, COUNT_DELAY_MS);
  }

  #stopCounting(): void {
    clearTimeout(this.#countTimer);
    this.#countAbort?.abort();
  }

  dispose(): void {
    this.#panel.dispose();
  }
}

/** The open Site Settings panels, one per site. */
export class SiteSettings implements vscode.Disposable {
  readonly #panels = new Map<string, SiteSettingsPanel>();
  readonly #services: Services;
  readonly #extensionUri: vscode.Uri;
  readonly #record: boolean;

  constructor(services: Services, extensionUri: vscode.Uri, record: boolean) {
    this.#services = services;
    this.#extensionUri = extensionUri;
    this.#record = record;
  }

  /** Opens the settings of a site, or brings its open panel forward. `serverId` opens that server's editor. */
  open(site: Site, serverId?: string): SiteSettingsPanel {
    const open = this.#panels.get(site.id);
    if (open !== undefined) {
      open.reveal();
      return open;
    }
    const panel = new SiteSettingsPanel(this.#services, this.#extensionUri, site, {
      record: this.#record,
      ...(serverId === undefined ? {} : { editServerId: serverId }),
      onDispose: () => {
        this.#panels.delete(site.id);
      },
    });
    this.#panels.set(site.id, panel);
    return panel;
  }

  /** The open panel of a site. */
  panel(siteId: string): SiteSettingsPanel | undefined {
    return this.#panels.get(siteId);
  }

  dispose(): void {
    for (const panel of this.#panels.values()) {
      panel.dispose();
    }
  }
}
