import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GlobalCloaking } from '@isocialpractice/cmd-sync-servers';
import { editGlobalPatterns, REMOVE, type GlobalPatternsStore } from '../../src/flows/global-cloaking.ts';
import { BACK, type ChoiceQuestion, type TextQuestion } from '../../src/ui/prompt.ts';
import { ScriptedPrompter } from '../helpers/prompter.ts';

/** The global patterns in memory, counting the saves. */
class Store implements GlobalPatternsStore {
  list: string[];
  saves = 0;
  constructor(list: string[]) {
    this.list = list;
  }
  patterns(): readonly string[] {
    return this.list;
  }
  update(change: (cloaking: GlobalCloaking) => void): Promise<void> {
    const draft = { patterns: [...this.list] };
    change(draft);
    this.list = draft.patterns;
    this.saves += 1;
    return Promise.resolve();
  }
}

test('global patterns are added, separated by spaces, and removed after asking; Escape closes the list', async () => {
  const store = new Store(['.git/']);
  const prompter = new ScriptedPrompter([
    { add: true },
    'node_modules/  .git/ *.lnk node_modules/',
    { remove: '.git/' },
    undefined,
    { remove: '.git/' },
    REMOVE,
    { add: true },
    undefined,
    undefined,
  ]);
  await editGlobalPatterns(prompter, store);
  assert.deepEqual(store.list, ['node_modules/', '*.lnk']);
  assert.equal(store.saves, 2, 'a removal that was not confirmed saves nothing');
  assert.equal(prompter.remaining, 0);
  const first = prompter.asked[0]?.question as ChoiceQuestion<unknown>;
  assert.equal(first.title, 'Global Cloaking Patterns');
  assert.deepEqual(first.choices.map((choice) => choice.label), ['Add Patterns...', '.git/']);
  const box = prompter.asked[1]?.question as TextQuestion;
  assert.equal(box.validate?.('   '), 'Type at least one pattern.');
  const removal = prompter.asked[3]?.question as { message: string; buttons: readonly string[] };
  assert.equal(removal.message, 'Remove the global pattern .git/?');
  const last = prompter.asked.at(-1)?.question as ChoiceQuestion<unknown>;
  assert.deepEqual(last.choices.map((choice) => choice.label), ['Add Patterns...', 'node_modules/', '*.lnk']);
});

test('patterns already there save nothing, and Back closes the list', async () => {
  const store = new Store(['.git/']);
  const prompter = new ScriptedPrompter([{ add: true }, '.git/', BACK]);
  await editGlobalPatterns(prompter, store);
  assert.deepEqual([store.list, store.saves], [['.git/'], 0]);
  const empty = new Store([]);
  const asked = new ScriptedPrompter([undefined]);
  await editGlobalPatterns(asked, empty);
  assert.match((asked.asked[0]?.question as ChoiceQuestion<unknown>).placeholder, /No global patterns yet/);
});
