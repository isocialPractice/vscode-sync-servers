import { splitPatterns, type GlobalCloaking } from '@isocialpractice/cmd-sync-servers';
import { BACK, type Choice, type Prompter } from '../ui/prompt.ts';

/** Where the global cloaking patterns are read and saved: the list of sites. */
export interface GlobalPatternsStore {
  /** The patterns as they are now. */
  patterns(): readonly string[];
  /** Changes the patterns and saves them. */
  update(change: (cloaking: GlobalCloaking) => void): Promise<void>;
}

/** The button that removes a global pattern. */
export const REMOVE = 'Remove';

/** The title of every step. */
const TITLE = 'Global Cloaking Patterns';

/** What a row of the list does. */
type Row = { readonly add: true } | { readonly remove: string };

/**
 * Lists the cloaking patterns every site uses before its own, in a quick
 * pick: Add Patterns... asks for new ones, separated by spaces, and choosing
 * a pattern removes it after asking. The list comes back after each change
 * and closes with Escape.
 */
export async function editGlobalPatterns(prompter: Prompter, store: GlobalPatternsStore): Promise<void> {
  for (;;) {
    const patterns = store.patterns();
    const answer = await prompter.choose<Row>({
      title: TITLE,
      placeholder: patterns.length === 0 ? 'No global patterns yet. Every site uses them before its own.' : 'Every site uses these before its own. Choose one to remove it.',
      choices: [
        { label: 'Add Patterns...', description: 'Cloak in every site', value: { add: true } },
        ...patterns.map((pattern): Choice<Row> => ({ label: pattern, value: { remove: pattern } })),
      ],
    });
    if (answer === undefined || answer === BACK) {
      return;
    }
    if ('add' in answer) {
      const typed = await prompter.text({
        title: TITLE,
        prompt: 'Patterns to cloak in every site, separated by spaces: .psd cloaks a suffix, node_modules/ a folder, /drafts/ a folder at the top of each site',
        placeholder: '.git/ node_modules/ Thumbs.db',
        validate: (value) => (splitPatterns(value).length === 0 ? 'Type at least one pattern.' : undefined),
      });
      if (typeof typed !== 'string') {
        continue;
      }
      const added = splitPatterns(typed).filter((pattern, index, all) => !patterns.includes(pattern) && all.indexOf(pattern) === index);
      if (added.length > 0) {
        await store.update((cloaking) => {
          cloaking.patterns.push(...added);
        });
      }
      continue;
    }
    const removed = answer.remove;
    const choice = await prompter.modal({
      message: `Remove the global pattern ${removed}?`,
      detail: 'Every site that uses the global patterns stops cloaking what it matches, unless the site cloaks it too.',
      buttons: [REMOVE],
    });
    if (choice === REMOVE) {
      await store.update((cloaking) => {
        cloaking.patterns = cloaking.patterns.filter((pattern) => pattern !== removed);
      });
    }
  }
}
