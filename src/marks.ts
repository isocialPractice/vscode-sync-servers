/**
 * The marks on files in the Explorer and the Remote Files view, worked out
 * from what is already known: the site's cloaking, the sync records written
 * by the last synchronization, and the files the last preview found changed
 * on both sides. Nothing here asks a server.
 */
import { lstatSync, realpathSync, statSync, type Stats } from 'node:fs';
import { isInside, siteCloak, siteGuard, type Observation, type Site, type SyncRecord } from '@isocialpractice/cmd-sync-servers';

/**
 * Why a saved file is not put on save, or `undefined` when it goes to the
 * servers that upload on save. `globalPatterns` are the cloaking patterns
 * every site uses before its own.
 */
export function holdBack(site: Site, relative: string, globalPatterns: readonly string[] = []): string | undefined {
  if (siteCloak(site, process.platform, globalPatterns).isCloaked(relative, false)) {
    return 'it is cloaked';
  }
  const pattern = siteGuard(site).match(relative);
  return pattern === undefined ? undefined : `it matches the sensitive pattern "${pattern}"`;
}

/** A mark: a badge of at most two characters, its tooltip, a word for the view, and how it is coloured. */
export interface Mark {
  readonly badge: string;
  readonly tooltip: string;
  readonly word: string;
  /** `dim` for cloaked items, `warning` for files that need a decision. */
  readonly tone: 'dim' | 'warning' | 'normal';
}

/** What is known about one file or folder. */
export interface MarkInput {
  readonly side: 'local' | 'remote';
  readonly cloaked: boolean;
  /** The last preview found it changed on both sides. */
  readonly conflict: boolean;
  /** What this side holds now; `undefined` for a folder. */
  readonly observed: Observation | undefined;
  /** The sync record of the path, if it has one. */
  readonly record: SyncRecord | undefined;
  /** False until the site and server have been synchronized once, so nothing is marked as new before then. */
  readonly everSynced: boolean;
  /** How far server times may move and still count as equal. */
  readonly toleranceMs: number;
}

export const CLOAKED_MARK: Mark = { badge: '⊘', tooltip: 'Cloaked: never synchronized.', word: 'cloaked', tone: 'dim' };
export const CONFLICT_MARK: Mark = {
  badge: '!',
  tooltip: 'Changed locally and on the server since the last sync. Synchronize to choose which copy to keep.',
  word: 'needs a decision',
  tone: 'warning',
};

/** True when two observations of a file differ in size, or in time by more than the tolerance. */
export function differs(now: Observation, then: Observation, toleranceMs: number): boolean {
  if (now.size !== then.size) {
    return true;
  }
  return now.mtimeMs !== undefined && then.mtimeMs !== undefined && Math.abs(now.mtimeMs - then.mtimeMs) > toleranceMs;
}

/** The mark of a file or folder, or `undefined` when it has none. */
export function markFor(input: MarkInput): Mark | undefined {
  if (input.cloaked) {
    return CLOAKED_MARK;
  }
  if (input.conflict) {
    return CONFLICT_MARK;
  }
  if (input.observed === undefined || !input.everSynced) {
    return undefined;
  }
  const local = input.side === 'local';
  if (input.record === undefined) {
    return local
      ? { badge: '↑', tooltip: 'Added since the last sync. Put uploads it.', word: 'new', tone: 'normal' }
      : { badge: '↓', tooltip: 'Added on the server since the last sync. Get downloads it.', word: 'new on the server', tone: 'normal' };
  }
  // As the engine does: a local file is held to its record exactly, server times get the tolerance.
  const then = local ? input.record.local : input.record.remote;
  if (!differs(input.observed, then, local ? 0 : input.toleranceMs)) {
    return undefined;
  }
  return local
    ? { badge: '↑', tooltip: 'Changed since the last sync. Put uploads it.', word: 'changed', tone: 'normal' }
    : { badge: '↓', tooltip: 'Changed on the server since the last sync. Get downloads it.', word: 'changed on the server', tone: 'normal' };
}

/** True when the site follows the symbolic link at `file` of its local folder, as its synchronization does. */
function followsLink(site: Pick<Site, 'localRoot' | 'sync'>, file: string): boolean {
  switch (site.sync.symlinks) {
    case 'skip':
      return false;
    case 'follow':
      return true;
    default:
      try {
        return isInside(realpathSync.native(site.localRoot), realpathSync.native(file));
      } catch {
        return false;
      }
  }
}

/**
 * The entry at `file` of a site's local folder as the site's synchronization
 * sees it: a symbolic link the site follows is the file or folder it points
 * to, so it carries that file's mark; any other entry, a broken link
 * included, is itself. `undefined` when nothing is there.
 */
export function localEntry(site: Pick<Site, 'localRoot' | 'sync'>, file: string): Stats | undefined {
  let info: Stats;
  try {
    info = lstatSync(file);
  } catch {
    return undefined;
  }
  if (!info.isSymbolicLink() || !followsLink(site, file)) {
    return info;
  }
  try {
    return statSync(file);
  } catch {
    return info;
  }
}
