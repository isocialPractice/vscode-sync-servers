// The Synchronize dialog with its time range, the Sync Preview's heading
// and rows, the messages of a comparison with nothing to run, the summary
// shown for a binary file, and the status bar during and after a run.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { parseRange, RANGE_TEXT, RANGE_TITLE, type Action, type PlanItem, type SyncResult, type TimeRange } from '@isocialpractice/cmd-sync-servers';
import { askSync, deleteLabel, keepLabel, RANGE_DESCRIPTION, RANGE_PLACEHOLDER, rangeProblem } from '../../src/flows/sync-options.ts';
import { binarySummary, isBinary, MAX_DIFF_BYTES } from '../../src/preview/compare-text.ts';
import { groupOf, groupRows, resultGroups, resultRow, rowView } from '../../src/preview/rows.ts';
import { statusText } from '../../src/status-text.ts';
import { nothingToRun, previewHeading } from '../../src/sync-text.ts';
import { BACK, type ChoiceQuestion, type TextQuestion } from '../../src/ui/prompt.ts';
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
      ['Put files from a time range', 'Put newer files to remote', 'Get newer files from remote', 'Get and put newer files'],
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

describe('Put files from a time range in the Synchronize dialog', () => {
  /** The questions a dialog asked, by kind. */
  function questions(prompter: ScriptedPrompter): { ways: ChoiceQuestion<unknown>[]; boxes: TextQuestion[] } {
    return {
      ways: prompter.asked.filter((entry) => entry.kind === 'choose').map((entry) => entry.question as ChoiceQuestion<unknown>),
      boxes: prompter.asked.filter((entry) => entry.kind === 'text').map((entry) => entry.question as TextQuestion),
    };
  }

  test('the time range is the first of four ways, labelled as the engine labels it', async () => {
    const prompter = new ScriptedPrompter([undefined]);
    assert.equal(await askSync(prompter, { siteName: 'My Site', selection: 0 }), undefined);
    const [way] = questions(prompter).ways;
    assert.ok(way);
    assert.deepEqual(
      way.choices.map((choice) => choice.value),
      ['range', 'put', 'get', 'both'],
    );
    const [first] = way.choices;
    assert.ok(first);
    assert.equal(first.label, RANGE_TITLE);
    assert.equal(RANGE_TITLE, 'Put files from a time range');
    assert.equal(first.description, RANGE_DESCRIPTION);
    assert.equal(RANGE_DESCRIPTION, 'Only the files created or modified lately');
  });

  test('the way highlighted is Put newer files the first time, then the last way given, or the range when the last choice had one', async () => {
    const highlighted = async (last?: Parameters<typeof askSync>[1]['last']): Promise<unknown> => {
      const prompter = new ScriptedPrompter([undefined]);
      await askSync(prompter, { siteName: 'My Site', selection: 0, last });
      return questions(prompter).ways[0]?.selected;
    };
    assert.equal(await highlighted(), 'put');
    assert.equal(await highlighted({ direction: 'get', deleteOrphans: false }), 'get');
    assert.equal(await highlighted({ scope: 'site', direction: 'put', deleteOrphans: false, range: '2d' }), 'range');
  });

  test('the range and 2d: a Put without deletes, and no delete question', async () => {
    const prompter = new ScriptedPrompter(['range', '2d']);
    assert.deepEqual(await askSync(prompter, { siteName: 'My Site', selection: 0 }), { scope: 'site', direction: 'put', deleteOrphans: false, range: '2d' });
    const { ways, boxes } = questions(prompter);
    assert.equal(ways.length, 1, 'only the way was chosen from a list');
    const [box] = boxes;
    assert.ok(box);
    assert.equal(box.title, 'Synchronize My Site');
    assert.deepEqual([box.step, box.totalSteps], [2, 2]);
    assert.equal(box.prompt, RANGE_TEXT.question);
    assert.equal(box.prompt, 'Put files created or modified in the last');
  });

  test('an empty or blank answer is 1d; the box holds 1d the first time and the last range after; its placeholder is 1d or 24h', async () => {
    for (const answer of ['', '   ']) {
      assert.equal((await askSync(new ScriptedPrompter(['range', answer]), { siteName: 'My Site', selection: 0 }))?.range, '1d');
    }
    const first = new ScriptedPrompter(['range', '01d']);
    assert.equal((await askSync(first, { siteName: 'My Site', selection: 0 }))?.range, '1d', 'the range is kept as the engine writes it');
    assert.equal(questions(first).boxes[0]?.value, '1d');
    assert.equal(questions(first).boxes[0]?.placeholder, '1d or 24h');
    assert.equal(RANGE_PLACEHOLDER, '1d or 24h');
    const again = new ScriptedPrompter(['range', '1w']);
    assert.equal((await askSync(again, { siteName: 'My Site', selection: 0, last: { direction: 'put', deleteOrphans: false, range: '2d' } }))?.range, '1w');
    assert.equal(questions(again).boxes[0]?.value, '2d');
  });

  test('the box refuses what is not a range with the format sentence, and takes the four units', async () => {
    const prompter = new ScriptedPrompter(['range', undefined]);
    assert.equal(await askSync(prompter, { siteName: 'My Site', selection: 0 }), undefined);
    assert.equal(questions(prompter).boxes[0]?.validate, rangeProblem);
    const refused = `Enter ${RANGE_TEXT.format}.`;
    assert.equal(refused, 'Enter a number and a unit: m for minutes, h for hours, d for days or w for weeks, such as 90m, 24h, 2d or 1w.');
    for (const answer of ['2M', '2 d', '0d', '--help', 'abc', '/?', '2d 3h']) {
      assert.equal(rangeProblem(answer), refused, answer);
    }
    for (const answer of ['90m', '24h', '1.5h', '2d', '1w', ' 2d ', '', ' ']) {
      assert.equal(rangeProblem(answer), undefined, answer);
    }
  });

  test('Back from the range returns to the ways; Escape there cancels', async () => {
    const back = new ScriptedPrompter(['range', BACK, 'get', false]);
    assert.deepEqual(await askSync(back, { siteName: 'My Site', selection: 0 }), { scope: 'site', direction: 'get', deleteOrphans: false });
    assert.deepEqual(
      back.asked.map((entry) => entry.kind),
      ['choose', 'text', 'choose', 'choose'],
    );
    assert.equal(questions(back).ways[1]?.selected, 'range', 'the way returned to is the one chosen');
    assert.equal(await askSync(new ScriptedPrompter(['range', undefined]), { siteName: 'My Site', selection: 0 }), undefined);
  });

  test('with an Explorer selection there are three steps, and the range keeps the scope chosen first', async () => {
    const prompter = new ScriptedPrompter(['selection', 'range', '1w']);
    assert.deepEqual(await askSync(prompter, { siteName: 'My Site', selection: 3 }), { scope: 'selection', direction: 'put', deleteOrphans: false, range: '1w' });
    const { ways, boxes } = questions(prompter);
    assert.deepEqual(
      [...ways, ...boxes].map((question) => [question.step, question.totalSteps]),
      [
        [1, 3],
        [2, 3],
        [3, 3],
      ],
    );
  });
});

describe('the messages of a comparison and the Sync Preview heading', () => {
  function range(text: string): TimeRange {
    const parsed = parseRange(text);
    assert.ok(parsed, text);
    return parsed;
  }

  test('the heading names the direction, or the range a plan was made from', () => {
    assert.equal(previewHeading('My Site', 'Production', 'put'), 'My Site and Production: Put newer files to remote');
    assert.equal(previewHeading('My Site', 'Production', 'both'), 'My Site and Production: Get and put newer files');
    assert.equal(previewHeading('My Site', 'Production', 'put', range('2d')), 'My Site and Production: Put files from the last 2 days');
    assert.equal(previewHeading('My Site', 'Production', 'put', range('1d')), 'My Site and Production: Put files from the last day');
  });

  test('nothing to run says the site is in sync, or that nothing of the range needs putting', () => {
    assert.equal(nothingToRun('My Site', 'Production', 3), '"My Site" and Production are in sync. 3 files compared.');
    assert.equal(nothingToRun('My Site', 'Production', 1), '"My Site" and Production are in sync. 1 file compared.');
    assert.equal(nothingToRun('My Site', 'Production', 3, range('2d')), 'Nothing from the last 2 days needs putting to Production. 3 files compared.');
    assert.equal(nothingToRun('My Site', 'Production', 1, range('90m')), 'Nothing from the last 90 minutes needs putting to Production. 1 file compared.');
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
