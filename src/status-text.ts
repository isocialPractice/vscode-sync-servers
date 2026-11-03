import type { Site } from '@isocialpractice/cmd-sync-servers';
import { protocolLabel, serverAddress } from './views/site-rows.ts';

/** Keeps a name such as `$(x)` from being drawn as an icon in the status bar. */
export function escapeIcons(text: string): string {
  return text.replace(/\$\(/g, '\\$(');
}

/** What the status bar shows besides the active site: a run in progress, or something needing attention. */
export interface Activity {
  readonly running?: { readonly site: Site; readonly completed: number; readonly total: number } | undefined;
  readonly attention?: { readonly site: Site; readonly text: string } | undefined;
}

/**
 * The status bar text, tooltip and screen reader label: a run in progress
 * first, then rows waiting for a decision or a failed run, then the active
 * site. `warning` asks for the warning background.
 */
export function statusText(site: Site | undefined, activity: Activity = {}): { text: string; tooltip: string; label: string; warning: boolean } {
  const { running, attention } = activity;
  if (running !== undefined) {
    const progress = `${String(running.completed)} of ${String(running.total)} files`;
    return {
      text: `$(sync~spin) ${escapeIcons(running.site.name)}: ${progress}`,
      tooltip: `Synchronizing ${running.site.name}: ${progress}.`,
      label: `Sync Servers, synchronizing ${running.site.name}, ${progress}`,
      warning: false,
    };
  }
  if (attention !== undefined) {
    return {
      text: `$(warning) ${escapeIcons(attention.site.name)}: ${escapeIcons(attention.text)}`,
      tooltip: `Sync Servers: ${attention.site.name}, ${attention.text}. The Sync Preview shows the files.`,
      label: `Sync Servers, ${attention.site.name}, ${attention.text}`,
      warning: true,
    };
  }
  return { ...siteText(site), warning: false };
}

function siteText(site: Site | undefined): { text: string; tooltip: string; label: string } {
  if (site === undefined) {
    return {
      text: '$(cloud) Sync Servers',
      tooltip: 'Sync Servers: no site is active. Click to choose one.',
      label: 'Sync Servers, no active site',
    };
  }
  const remote = site.servers.find((server) => server.id === site.remoteServerId);
  const remoteName = remote?.name ?? 'No Remote server';
  return {
    text: `$(cloud) ${escapeIcons(site.name)}: ${escapeIcons(remoteName)}`,
    tooltip: [
      `Sync Servers: ${site.name}`,
      remote === undefined ? 'No Remote server' : `Remote server: ${remote.name} (${protocolLabel(remote.protocol)} ${serverAddress(remote)})`,
      'Click for the actions of this site.',
    ].join('\n'),
    label: `Sync Servers, active site ${site.name}, ${remote === undefined ? 'no Remote server' : `Remote server ${remote.name}`}`,
  };
}
