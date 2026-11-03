/**
 * The Sync Preview's groups and rows as plain data, without `vscode`, so
 * their words, checkboxes and menu tags can be tested.
 */
import type { Action, ItemResult, Observation, PlanItem, SyncResult } from '@isocialpractice/cmd-sync-servers';

/** A group of the preview: an action, the held-back files, or the files that cannot move. */
export type GroupId = 'resolve' | 'put' | 'get' | 'delete-remote' | 'delete-local' | 'skip' | 'guarded' | 'errors';

/** The groups, in the order the eye should take them: decisions first. */
export const GROUPS: readonly { readonly id: GroupId; readonly label: string; readonly icon: string }[] = [
  { id: 'resolve', label: 'Resolve', icon: 'question' },
  { id: 'put', label: 'Put', icon: 'cloud-upload' },
  { id: 'get', label: 'Get', icon: 'cloud-download' },
  { id: 'delete-remote', label: 'Delete remote', icon: 'trash' },
  { id: 'delete-local', label: 'Delete local', icon: 'trash' },
  { id: 'guarded', label: 'Guarded', icon: 'shield' },
  { id: 'skip', label: 'Skip', icon: 'circle-slash' },
  { id: 'errors', label: 'Errors', icon: 'error' },
];

/** What each action does, in words. */
export const ACTION_WORDS: Readonly<Record<Action, string>> = {
  put: 'Put',
  get: 'Get',
  resolve: 'Resolve',
  'delete-remote': 'Delete on server',
  'delete-local': 'Delete local file',
  skip: 'Skip',
  synced: 'Mark synchronized',
};

const ACTION_ICONS: Readonly<Record<Action, string>> = {
  put: 'cloud-upload',
  get: 'cloud-download',
  resolve: 'question',
  'delete-remote': 'trash',
  'delete-local': 'trash',
  skip: 'circle-slash',
  synced: 'pass',
};

/** The group a row belongs to. A held-back file stays in Guarded whatever is chosen for it. */
export function groupOf(item: PlanItem): GroupId {
  if (item.state === 'problem') {
    return 'errors';
  }
  if (item.guarded !== undefined) {
    return 'guarded';
  }
  if (item.action === 'resolve') {
    return 'resolve';
  }
  return item.action === 'skip' || item.action === 'synced' ? 'skip' : item.action;
}

/** A group with its rows. */
export interface Group {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly items: readonly PlanItem[];
}

/** The rows grouped by action, or by folder; empty groups are left out. */
export function groupRows(items: readonly PlanItem[], by: 'action' | 'folder'): Group[] {
  if (by === 'folder') {
    const folders = new Map<string, PlanItem[]>();
    for (const item of items) {
      const slash = item.path.lastIndexOf('/');
      const folder = slash < 0 ? '/' : item.path.slice(0, slash);
      folders.set(folder, [...(folders.get(folder) ?? []), item]);
    }
    return [...folders.entries()]
      .sort(([a], [b]) => (a === '/' ? -1 : b === '/' ? 1 : a.localeCompare(b, 'en')))
      .map(([folder, rows]) => ({ id: `folder:${folder}`, label: folder, icon: 'folder', items: rows }));
  }
  return GROUPS.map((group) => ({ ...group, items: items.filter((item) => groupOf(item) === group.id) })).filter((group) => group.items.length > 0);
}

/** One row as the preview shows it. */
export interface RowView {
  readonly label: string;
  readonly description: string;
  readonly tooltip: string;
  readonly icon: string;
  /** Undefined for rows that cannot be checked: a decision is needed first, or the file cannot move. */
  readonly checkbox: 'checked' | 'unchecked' | undefined;
  /** Space-separated tags the menus' `when` clauses match, such as `row action-resolve can-put can-get`. */
  readonly contextValue: string;
  readonly accessibilityLabel: string;
}

function describeSide(name: string, side: Observation | undefined): string {
  if (side === undefined) {
    return `${name}: none`;
  }
  const time = side.mtimeMs === undefined ? 'time unknown' : `modified ${new Date(side.mtimeMs).toISOString().replace('T', ' ').slice(0, 19)} UTC`;
  return `${name}: ${String(side.size)} bytes, ${time}`;
}

/** The view of a row, given the actions it can take. */
export function rowView(item: PlanItem, allowed: readonly Action[], byFolder: boolean): RowView {
  const problem = item.state === 'problem';
  const decision = item.action === 'resolve';
  const checkbox = problem || decision ? undefined : item.checked === true ? 'checked' : 'unchecked';
  const word = ACTION_WORDS[item.action];
  const status = item.status;
  const description = byFolder || groupOf(item) === 'guarded' || groupOf(item) === 'skip' ? [word, status].filter((part) => part !== '').join(': ') : status;
  const tags = [
    'row',
    `action-${item.action}`,
    ...allowed.map((action) => `can-${action}`),
    ...(item.remote !== undefined ? ['has-remote'] : []),
    ...(item.local !== undefined ? ['has-local'] : []),
  ];
  const state = checkbox === undefined ? (problem ? 'cannot be synchronized' : 'needs a decision') : checkbox;
  return {
    label: item.path,
    description,
    tooltip: [`${word}: ${item.path}`, status, describeSide('Local', item.local), describeSide('Server', item.remote)].filter((line) => line !== '').join('\n'),
    icon: problem ? 'error' : item.guarded !== undefined ? 'shield' : ACTION_ICONS[item.action],
    checkbox,
    contextValue: problem ? 'row problem' : tags.join(' '),
    accessibilityLabel: [word, item.path, state, status].filter((part) => part !== '').join(', '),
  };
}

/** The groups of a finished run: failures first, with their reasons. */
export function resultGroups(result: SyncResult): { readonly id: string; readonly label: string; readonly icon: string; readonly items: readonly ItemResult[] }[] {
  const failed = result.items.filter((item) => item.outcome === 'failed' || item.outcome === 'stale');
  const done = result.items.filter((item) => item.outcome === 'done');
  const notRun = result.items.filter((item) => item.outcome === 'cancelled');
  return [
    { id: 'failed', label: 'Failed', icon: 'error', items: failed },
    { id: 'cancelled', label: 'Not run', icon: 'circle-slash', items: notRun },
    { id: 'done', label: 'Done', icon: 'pass', items: done },
  ].filter((group) => group.items.length > 0);
}

/** The words for one row of a finished run. */
export function resultRow(item: ItemResult): { readonly label: string; readonly description: string; readonly accessibilityLabel: string } {
  const outcome = { done: 'Done', failed: 'Failed', stale: 'Changed since the preview, skipped', skipped: 'Skipped', cancelled: 'Not run' }[item.outcome];
  const reason = item.error?.message ?? '';
  return {
    label: item.path,
    description: reason === '' ? `${ACTION_WORDS[item.action]}: ${outcome}` : reason,
    accessibilityLabel: [ACTION_WORDS[item.action], item.path, outcome, reason].filter((part) => part !== '').join(', '),
  };
}
