/**
 * The identifiers the manifest contributes. `package.json` declares the same
 * ones; a unit test fails when the two disagree.
 */

/** The extension's identifier, `<publisher>.<name>`. */
export const EXTENSION_ID = 'isocialPractice.vscode-sync-servers';

/** The palette category every command is listed under. */
export const CATEGORY = 'Sync Servers';

/** The activity bar container holding the three views. */
export const VIEW_CONTAINER = 'syncServers';

/** The views of the container, in the order they are drawn. */
export const VIEWS = {
  sites: 'syncServers.sites',
  remoteFiles: 'syncServers.remoteFiles',
  preview: 'syncServers.preview',
} as const;

/** Context keys set by the extension and read by `when` clauses. */
export const CONTEXT = {
  previewActive: 'syncServers.previewActive',
  /** A plan waits in the preview; false while it shows the result of a run. */
  previewPending: 'syncServers.previewPending',
  hasSites: 'syncServers.hasSites',
  hasActiveSite: 'syncServers.hasActiveSite',
  activeSiteHasRemote: 'syncServers.activeSiteHasRemote',
  /** Every folder of the workspace is inside the active site's local folder, so Explorer menus act on it. */
  workspaceIsSite: 'syncServers.workspaceIsSite',
} as const;

/** Commands the extension registers for its own buttons, not listed in the palette. */
export const INTERNAL_COMMANDS = {
  statusMenu: 'syncServers.statusMenu',
  openSitesFile: 'syncServers.openSitesFile',
} as const;

/** One command of the palette. */
export interface CommandInfo {
  readonly id: string;
  readonly title: string;
}

/** Every command, in palette order. */
export const COMMANDS = [
  { id: 'syncServers.addSite', title: 'Add Site' },
  { id: 'syncServers.siteSettings', title: 'Site Settings' },
  { id: 'syncServers.removeSite', title: 'Remove Site' },
  { id: 'syncServers.switchSite', title: 'Switch Site' },
  { id: 'syncServers.openSiteFolder', title: 'Open Site Folder' },
  { id: 'syncServers.synchronize', title: 'Synchronize...' },
  { id: 'syncServers.put', title: 'Put' },
  { id: 'syncServers.get', title: 'Get' },
  { id: 'syncServers.compareWithRemote', title: 'Compare with Remote' },
  { id: 'syncServers.cloak', title: 'Cloak' },
  { id: 'syncServers.uncloak', title: 'Uncloak' },
  { id: 'syncServers.globalCloaking', title: 'Global Cloaking Patterns...' },
  { id: 'syncServers.testConnection', title: 'Test Connection' },
  { id: 'syncServers.setPassword', title: 'Set Password...' },
  { id: 'syncServers.forgetPassword', title: 'Forget Password' },
  { id: 'syncServers.resetSyncInformation', title: 'Reset Sync Information' },
  { id: 'syncServers.showLog', title: 'Show Log' },
] as const satisfies readonly CommandInfo[];

/** The identifier of one of the extension's commands. */
export type CommandId = (typeof COMMANDS)[number]['id'];

/**
 * The Sync Preview's commands: its title buttons and row actions. They are in
 * the palette only while a preview is waiting, and act on the rows chosen in
 * the view when run from there.
 */
export const PREVIEW_COMMANDS = [
  { id: 'syncServers.preview.synchronize', title: 'Synchronize Checked Files' },
  { id: 'syncServers.preview.checkAll', title: 'Check All' },
  { id: 'syncServers.preview.uncheckAll', title: 'Uncheck All' },
  { id: 'syncServers.preview.useLocal', title: 'Use Local' },
  { id: 'syncServers.preview.useRemote', title: 'Use Remote' },
  { id: 'syncServers.preview.skip', title: 'Skip' },
  { id: 'syncServers.preview.markSynchronized', title: 'Mark Synchronized' },
  { id: 'syncServers.preview.deleteRemote', title: 'Delete on Server' },
  { id: 'syncServers.preview.deleteLocal', title: 'Delete Local File' },
  { id: 'syncServers.preview.close', title: 'Close Preview' },
] as const satisfies readonly CommandInfo[];

/** The identifier of one of the Sync Preview's commands. */
export type PreviewCommandId = (typeof PREVIEW_COMMANDS)[number]['id'];

/** The Remote Files view's commands, in the palette while the view has focus. */
export const REMOTE_COMMANDS = [
  { id: 'syncServers.remote.refresh', title: 'Refresh Remote Files' },
  { id: 'syncServers.remote.openReadOnly', title: 'Open Read-Only' },
  { id: 'syncServers.remote.delete', title: 'Delete on Server' },
] as const satisfies readonly CommandInfo[];

/** The identifier of one of the Remote Files view's commands. */
export type RemoteCommandId = (typeof REMOTE_COMMANDS)[number]['id'];

/** The scheme of the read-only documents that hold a server's copy of a file. */
export const REMOTE_SCHEME = 'sync-servers-remote';

/** The settings, with their defaults. */
export const SETTINGS = {
  'syncServers.configDir': '',
  'syncServers.uploadOnSave.enabled': true,
  'syncServers.preview.groupBy': 'action',
  'syncServers.confirmDeletes': true,
  'syncServers.decorations.enabled': true,
} as const;
