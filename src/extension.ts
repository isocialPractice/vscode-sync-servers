import path from 'node:path';
import { createLogger, memorySink, VERSION as ENGINE_VERSION, type CredentialStore, type LogRecord } from '@isocialpractice/cmd-sync-servers';
import * as vscode from 'vscode';
import { cloak, globalCloaking, uncloak } from './commands/cloak.ts';
import { deleteOnServer, openReadOnly } from './commands/remote.ts';
import { addSite, openSiteFolder, openSitesFile, removeSite, switchSite } from './commands/sites.ts';
import { forgetPassword, resetSyncInformation, setPassword, testConnection } from './commands/servers.ts';
import { chooseSite, guarded, requireSites, type Services } from './commands/services.ts';
import { compareWithRemote, setRowAction, synchronize, transfer, type SyncServices } from './commands/sync.ts';
import {
  COMMANDS,
  CONTEXT,
  INTERNAL_COMMANDS,
  PREVIEW_COMMANDS,
  REMOTE_COMMANDS,
  VIEWS,
  type CommandId,
  type PreviewCommandId,
  type RemoteCommandId,
} from './contributions.ts';
import { ExplorerMarks } from './explorer-marks.ts';
import { RemoteFilesView } from './remote/remote-files.ts';
import { UploadOnSave } from './upload-on-save.ts';
import { PreviewController } from './preview/controller.ts';
import { RemoteDocuments } from './preview/remote-documents.ts';
import { PreviewView } from './preview/view.ts';
import { createHost } from './host.ts';
import { channelSink } from './log.ts';
import { SecretStorageStore } from './secrets.ts';
import { SiteSettings } from './settings/panel.ts';
import { SitesModel } from './sites-model.ts';
import { StatusBar, statusMenu } from './status-bar.ts';
import type { Prompter } from './ui/prompt.ts';
import { VsCodePrompter } from './ui/vscode-prompter.ts';
import { isSitesNode, SitesView } from './views/sites-view.ts';

/** True when every folder of the workspace is inside the active site's local folder. */
function workspaceIsSite(model: SitesModel): boolean {
  const site = model.activeSite;
  const folders = (vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === 'file');
  return (
    site !== undefined &&
    folders.length > 0 &&
    folders.every((folder) => {
      const relative = path.relative(site.localRoot, folder.uri.fsPath);
      return !relative.startsWith('..') && !path.isAbsolute(relative);
    })
  );
}

/**
 * What the integration tests reach, returned by `activate` only when VS Code
 * runs the extension's tests. It is not an API for other extensions.
 */
export interface TestApi {
  readonly model: SitesModel;
  readonly sitesView: SitesView;
  readonly statusBar: StatusBar;
  readonly siteSettings: SiteSettings;
  readonly preview: PreviewController;
  readonly previewView: PreviewView;
  readonly remoteDocuments: RemoteDocuments;
  readonly marks: ExplorerMarks;
  readonly remoteFiles: RemoteFilesView;
  readonly uploadOnSave: UploadOnSave;
  readonly credentials: CredentialStore;
  /** Every record written to the log, as the log shows it: already redacted. */
  readonly logRecords: readonly LogRecord[];
  /** Answers every question with this prompter instead of VS Code's own UI; `undefined` restores it. */
  usePrompter(prompter: Prompter | undefined): void;
  /**
   * Acts as if the workspace were trusted or not; `undefined` follows VS
   * Code again. VS Code's test runner always trusts the workspace.
   */
  useTrust(trusted: boolean | undefined): void;
}

/** Starts the extension: the log, the list of sites, the views, the status bar and every command. */
export async function activate(context: vscode.ExtensionContext): Promise<TestApi | undefined> {
  const channel = vscode.window.createOutputChannel('Sync Servers', { log: true });
  const testing = context.extensionMode === vscode.ExtensionMode.Test;
  const memory = memorySink();
  const logger = createLogger({ level: 'debug', sinks: testing ? [channelSink(channel), memory] : [channelSink(channel)] });
  context.subscriptions.push(channel, { dispose: () => { logger.close(); } });
  const { version } = context.extension.packageJSON as { version: string };
  logger.info(`Sync Servers ${version}, engine ${ENGINE_VERSION}`);

  const realPrompter = new VsCodePrompter();
  let prompter: Prompter = realPrompter;
  const credentials = new SecretStorageStore(context.secrets);
  const model = new SitesModel({
    logger,
    workspaceState: context.workspaceState,
    requireIsolatedHome: testing,
  });
  const host = createHost({
    credentials,
    prompter: () => prompter,
    logger,
    registry: () => {
      try {
        return model.registry();
      } catch {
        return undefined;
      }
    },
    onSaved: () => {
      model.refresh();
    },
  });
  let trust: boolean | undefined;
  const services: Services = {
    model,
    host,
    credentials,
    logger,
    prompter: () => prompter,
    showLog: () => {
      channel.show();
    },
    trusted: () => trust ?? vscode.workspace.isTrusted,
  };
  const preview = new PreviewController(services);
  const previewView = new PreviewView(preview);
  const previewTree = vscode.window.createTreeView(VIEWS.preview, { treeDataProvider: previewView, canSelectMany: true, manageCheckboxStateManually: true });
  previewView.attach(previewTree);
  const remoteDocuments = new RemoteDocuments();
  const sync: SyncServices = { ...services, preview, previewView, remoteDocuments, memory: context.globalState };
  const sitesView = new SitesView(model);
  const statusBar = new StatusBar(model, { onDidChange: preview.onDidChange, current: () => ({ running: preview.running, attention: preview.attention }) });
  const marks = new ExplorerMarks(model, preview);
  const remoteFiles = new RemoteFilesView(services, preview);
  const remoteTree = vscode.window.createTreeView(VIEWS.remoteFiles, { treeDataProvider: remoteFiles, showCollapseAll: true });
  const uploadOnSave = new UploadOnSave(services);
  context.subscriptions.push(
    model,
    sitesView,
    statusBar,
    preview,
    previewView,
    previewTree,
    remoteDocuments,
    marks,
    remoteFiles,
    remoteTree,
    uploadOnSave,
    vscode.window.createTreeView(VIEWS.sites, { treeDataProvider: sitesView, showCollapseAll: true }),
    model.onDidChange(() => {
      void vscode.commands.executeCommand('setContext', CONTEXT.hasSites, model.sites.length > 0);
      void vscode.commands.executeCommand('setContext', CONTEXT.hasActiveSite, model.activeSite !== undefined);
      void vscode.commands.executeCommand('setContext', CONTEXT.workspaceIsSite, workspaceIsSite(model));
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('syncServers.configDir')) {
        void model.open();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      model.refresh();
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      logger.info('The workspace is trusted now: upload on save is on for its sites');
    }),
  );
  void vscode.commands.executeCommand('setContext', CONTEXT.previewActive, false);
  void vscode.commands.executeCommand('setContext', CONTEXT.previewPending, false);

  const siteSettings = new SiteSettings(services, context.extensionUri, testing);
  context.subscriptions.push(siteSettings);
  const handlers: Record<CommandId, (arg: unknown, extra: unknown) => Promise<void>> = {
    'syncServers.synchronize': (arg, extra) => synchronize(sync, arg, extra),
    'syncServers.put': (arg, extra) => transfer(sync, 'put', arg, extra),
    'syncServers.get': (arg, extra) => transfer(sync, 'get', arg, extra),
    'syncServers.compareWithRemote': (arg) => compareWithRemote(sync, arg),
    'syncServers.cloak': (arg, extra) => cloak(services, arg, extra),
    'syncServers.uncloak': (arg, extra) => uncloak(services, arg, extra),
    'syncServers.globalCloaking': () => globalCloaking(services),
    'syncServers.addSite': () => addSite(services),
    'syncServers.siteSettings': async (arg) => {
      if (!requireSites(services)) {
        return;
      }
      const site = await chooseSite(services, arg, 'Choose the site whose settings to open');
      if (site !== undefined) {
        siteSettings.open(site, isSitesNode(arg) && arg.kind === 'server' ? arg.server.id : undefined);
      }
    },
    'syncServers.removeSite': (arg) => removeSite(services, arg),
    'syncServers.switchSite': (arg) => switchSite(services, arg),
    'syncServers.openSiteFolder': (arg) => openSiteFolder(services, arg),
    'syncServers.testConnection': (arg) => testConnection(services, arg),
    'syncServers.setPassword': (arg) => setPassword(services, arg),
    'syncServers.forgetPassword': (arg) => forgetPassword(services, arg),
    'syncServers.resetSyncInformation': (arg) => resetSyncInformation(services, arg),
    'syncServers.showLog': () => {
      channel.show();
      return Promise.resolve();
    },
  };
  for (const command of COMMANDS) {
    context.subscriptions.push(vscode.commands.registerCommand(command.id, guarded(services, command.title, handlers[command.id])));
  }
  const previewHandlers: Record<PreviewCommandId, (arg: unknown, extra: unknown) => Promise<void>> = {
    'syncServers.preview.synchronize': async () => {
      await preview.run();
    },
    'syncServers.preview.checkAll': () => {
      preview.setAllChecked(true);
      return Promise.resolve();
    },
    'syncServers.preview.uncheckAll': () => {
      preview.setAllChecked(false);
      return Promise.resolve();
    },
    'syncServers.preview.useLocal': (arg, extra) => setRowAction(sync, 'put', arg, extra),
    'syncServers.preview.useRemote': (arg, extra) => setRowAction(sync, 'get', arg, extra),
    'syncServers.preview.skip': (arg, extra) => setRowAction(sync, 'skip', arg, extra),
    'syncServers.preview.markSynchronized': (arg, extra) => setRowAction(sync, 'synced', arg, extra),
    'syncServers.preview.deleteRemote': (arg, extra) => setRowAction(sync, 'delete-remote', arg, extra),
    'syncServers.preview.deleteLocal': (arg, extra) => setRowAction(sync, 'delete-local', arg, extra),
    'syncServers.preview.close': () => preview.close(),
  };
  for (const command of PREVIEW_COMMANDS) {
    context.subscriptions.push(vscode.commands.registerCommand(command.id, guarded(services, command.title, previewHandlers[command.id])));
  }
  const remoteHandlers: Record<RemoteCommandId, (arg: unknown, extra: unknown) => Promise<void>> = {
    'syncServers.remote.refresh': () => {
      remoteFiles.refresh();
      return Promise.resolve();
    },
    'syncServers.remote.openReadOnly': (arg) => openReadOnly(sync, remoteFiles, arg, remoteTree.selection),
    'syncServers.remote.delete': (arg) => deleteOnServer(sync, remoteFiles, arg, remoteTree.selection),
  };
  for (const command of REMOTE_COMMANDS) {
    context.subscriptions.push(vscode.commands.registerCommand(command.id, guarded(services, command.title, remoteHandlers[command.id])));
  }
  context.subscriptions.push(
    vscode.commands.registerCommand(INTERNAL_COMMANDS.statusMenu, guarded(services, 'Sync Servers', () => statusMenu(prompter, model))),
    vscode.commands.registerCommand(INTERNAL_COMMANDS.openSitesFile, guarded(services, 'Open sites.json', () => openSitesFile(services))),
  );

  await model.open();

  if (!testing) {
    return undefined;
  }
  return {
    model,
    sitesView,
    statusBar,
    siteSettings,
    preview,
    previewView,
    remoteDocuments,
    marks,
    remoteFiles,
    uploadOnSave,
    credentials,
    logRecords: memory.records,
    usePrompter: (next) => {
      prompter = next ?? realPrompter;
    },
    useTrust: (trusted) => {
      trust = trusted;
    },
  };
}
