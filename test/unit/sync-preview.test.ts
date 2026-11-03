// The Synchronize dialog, the Sync Preview's rows, the summary shown for a
// binary file, and the status bar during and after a run.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import type { Action, PlanItem, SyncResult } from '@isocialpractice/cmd-sync-servers';
import { askSync, deleteLabel, keepLabel } from '../../src/flows/sync-options.ts';
import { binarySummary, isBinary, MAX_DIFF_BYTES } from '../../src/preview/compare-text.ts';
import { groupOf, groupRows, resultGroups, resultRow, rowView } from '../../src/preview/rows.ts';
import { statusText } from '../../src/status-text.ts';
import { BACK, type ChoiceQuestion } from '../../src/ui/prompt.ts';
import { ScriptedPrompter } from '../helpers/prompter.ts';
import { sampleSite } from '../helpers/sites.ts';

describe('the Synchronize dialog', () => {
  test('without a selection it asks two questions: the direction and the delete option', async () => {
    const prompter = new ScriptedPrompter(['both', true]);
    assert.deepEqual(await askSync(prompter, { siteName: 'My Site', selection: 0 }), { scope: 'site', direction: 'both', deleteOrphans: true });
    const [direction, remove] = prompter.asked.map((entry) => entry.question as ChoiceQuestion<unknown>);
    assert.ok(direction && remove);
    assert.deepEqual(
      direction.choices.map((choice) => choice.label),
      ['Put newer files to remote', 'Get newer files from remote', 'Get and put newer files'],
    );
    assert.equal(direction.title, 'Synchronize My Site');
    assert.deepEqual([direction.step, direction.totalSteps, remove.step], [1, 2, 2]);
    assert.deepEqual(
      remove.choices.map((choice) => choice.label),
      [keepLabel('both'), deleteLabel('both')],
    );
  });

  test('the delete option is worded for the direction, as Dreamweaver words it', () => {
    assert.equal(deleteLabel('put'), 'Delete remote files not on local drive');
    assert.equal(deleteLabel('get'), 'Delete local files not on remote server');
  });

  test('a selection in the Explorer adds the scope question; the last answers are preselected', async () => {
    const prompter = new ScriptedPrompter(['selection', 'get', false]);
    const choice = await askSync(prompter, { siteName: 'My Site', selection: 3, last: { direction: 'get', deleteOrphans: true } });
    assert.deepEqual(choice, { scope: 'selection', direction: 'get', deleteOrphans: false });
    const [scope, direction, remove] = prompter.asked.map((entry) => entry.question as ChoiceQuestion<unknown>);
    assert.ok(scope && direction && remove);
    assert.deepEqual(scope.choices.map((option) => option.label), ["Entire 'My Site' Site", 'Selected Local Files Only']);
    assert.equal(direction.selected, 'get');
    assert.equal(remove.selected, true);
    assert.equal(remove.choices[1]?.label, 'Delete local files not on remote server');
  });

  test('Back returns to the previous question; Escape cancels', async () => {
    const prompter = new ScriptedPrompter(['put', BACK, 'get', false]);
    assert.equal((await askSync(prompter, { siteName: 'My Site', selection: 0 }))?.direction, 'get');
    assert.equal(await askSync(new ScriptedPrompter(['put', undefined]), { siteName: 'My Site', selection: 0 }), undefined);
  });
});

function item(id: number, file: string, action: Action, extra: Partial<PlanItem> = {}): PlanItem {
  return {
    id,
    path: file,
    state: 'local-changed',
    problem: undefined,
    action,
    checked: action === 'resolve' ? undefined : true,
    status: '',
    guarded: undefined,
    local: { size: 10, mtimeMs: Date.UTC(2026, 9, 29, 12) },
    remote: { size: 12, mtimeMs: Date.UTC(2026, 9, 29, 11) },
    neverSynced: false,
    ...extra,
  };
}

const resolveRow = item(1, 'css/site.css', 'resolve', { state: 'both-changed', status: 'Changed locally and on the server since the last sync. Choose Put or Get.' });
const putRow = item(2, 'img/hero.svg', 'put');
const guardedRow = item(3, '.env', 'put', { guarded: '.env', checked: false, status: 'Matches the sensitive pattern ".env". Check to transfer anyway.' });
const orphanRow = item(4, 'old/legacy.html', 'delete-remote', {
  checked: false,
  local: undefined,
  status: 'On the server only and never synchronized. Check to delete it.',
  neverSynced: true,
});
const problemRow = item(5, 'CON.txt', 'skip', { state: 'problem', problem: 'unsafe', checked: undefined, status: 'Name is not valid on this system: reserved device name.' });
const getRow = item(6, 'index.html', 'get');
const rows: PlanItem[] = [resolveRow, putRow, guardedRow, orphanRow, problemRow, getRow];

describe('the Sync Preview rows', () => {
  test('rows are grouped by action, decisions first, with held-back and refused files apart', () => {
    assert.deepEqual(
      groupRows(rows, 'action').map((group) => [group.label, group.items.map((row) => row.id)]),
      [
        ['Resolve', [1]],
        ['Put', [2]],
        ['Get', [6]],
        ['Delete remote', [4]],
        ['Guarded', [3]],
        ['Errors', [5]],
      ],
    );
    assert.equal(groupOf({ ...putRow, action: 'skip' }), 'skip');
  });

  test('rows can be grouped by folder instead', () => {
    assert.deepEqual(
      groupRows(rows, 'folder').map((group) => group.label),
      ['/', 'css', 'img', 'old'],
    );
  });

  test('a row waiting for a decision has no checkbox, and its tags offer what it can take', () => {
    const view = rowView(resolveRow, ['put', 'get', 'skip', 'synced', 'delete-remote', 'delete-local'], false);
    assert.equal(view.checkbox, undefined);
    assert.equal(view.contextValue, 'row action-resolve can-put can-get can-skip can-synced can-delete-remote can-delete-local has-remote has-local');
    assert.match(view.accessibilityLabel, /^Resolve, css\/site\.css, needs a decision, Changed locally/);
    assert.match(view.tooltip, /Local: 10 bytes, modified 2026-10-29 12:00:00 UTC/);
  });

  test('a held-back file is unchecked and says why; a refused name cannot be checked or acted on', () => {
    const guarded = rowView(guardedRow, ['put', 'skip'], false);
    assert.equal(guarded.checkbox, 'unchecked');
    assert.equal(guarded.icon, 'shield');
    assert.equal(guarded.description, 'Put: Matches the sensitive pattern ".env". Check to transfer anyway.');
    const refused = rowView(problemRow, ['skip'], false);
    assert.equal(refused.checkbox, undefined);
    assert.equal(refused.contextValue, 'row problem');
    assert.match(refused.accessibilityLabel, /cannot be synchronized/);
  });

  test('a checked Put row reads as checked to a screen reader', () => {
    assert.equal(rowView(putRow, ['put', 'skip'], false).accessibilityLabel, 'Put, img/hero.svg, checked');
  });

  test('a finished run lists failures first, with their reasons', () => {
    const done = { id: 2, path: 'img/hero.svg', action: 'put', outcome: 'done' } as const;
    const failed = { id: 6, path: 'index.html', action: 'get', outcome: 'failed', error: { code: 'E_REMOTE', message: 'Permission denied.' } } as const;
    const stale = { id: 7, path: 'about.html', action: 'put', outcome: 'stale', error: { code: 'E_STALE_ITEM', message: 'Changed since the preview. Skipped.' } } as const;
    const result: SyncResult = {
      items: [done, failed, stale],
      done: 1,
      failed: 2,
      skipped: 0,
      unresolved: 0,
      cancelled: false,
    };
    assert.deepEqual(
      resultGroups(result).map((group) => [group.label, group.items.length]),
      [
        ['Failed', 2],
        ['Done', 1],
      ],
    );
    assert.equal(resultRow(failed).description, 'Permission denied.');
    assert.equal(resultRow(done).description, 'Put: Done');
  });
});

describe('Compare with Remote for a binary file', () => {
  test('a NUL byte near the start, or a very large file, is not shown as text', () => {
    assert.equal(isBinary({ bytes: Buffer.from('<p>Hello</p>'), mtimeMs: undefined }), false);
    assert.equal(isBinary({ bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]), mtimeMs: undefined }), true);
    assert.equal(isBinary({ bytes: Buffer.alloc(MAX_DIFF_BYTES + 1, 0x41), mtimeMs: undefined }), true);
    assert.equal(isBinary(undefined), false);
  });

  test('the summary gives sizes, times and SHA-256 hashes, and says whether the copies match', () => {
    const bytes = Buffer.from([0, 1, 2, 3]);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const same = binarySummary('img/logo.png', 'Production', { bytes, mtimeMs: undefined }, { bytes, mtimeMs: Date.UTC(2026, 9, 30) });
    assert.match(same, new RegExp(`Local: 4 bytes, time unknown, SHA-256 ${hash}`));
    assert.match(same, /Production: 4 bytes, modified 2026-10-30 00:00:00 UTC/);
    assert.match(same, /The two copies are identical\./);
    assert.match(binarySummary('img/logo.png', 'Production', { bytes, mtimeMs: undefined }, { bytes: Buffer.from([9]), mtimeMs: undefined }), /The two copies differ\./);
  });
});

describe('the status bar', () => {
  const site = sampleSite(path.join(tmpdir(), 'my-site'), path.join(tmpdir(), 'my-site-backup'));

  test('a run in progress shows its count with a spinning icon', () => {
    const shown = statusText(site, { running: { site, completed: 12, total: 37 } });
    assert.equal(shown.text, '$(sync~spin) My Site: 12 of 37 files');
    assert.equal(shown.warning, false);
  });

  test('files waiting for a decision, or a failed run, warn with words beside the icon', () => {
    const shown = statusText(site, { attention: { site, text: '2 need a decision' } });
    assert.equal(shown.text, '$(warning) My Site: 2 need a decision');
    assert.equal(shown.warning, true);
    assert.equal(statusText(site).warning, false);
  });
});
