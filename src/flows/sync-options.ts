import { DIRECTION_TITLES, type Direction } from '@isocialpractice/cmd-sync-servers';
import { BACK, type Choice, type Prompter } from '../ui/prompt.ts';

/** The answers of the Synchronize dialog. */
export interface SyncChoice {
  /** The whole site, or the files chosen in the Explorer. */
  readonly scope: 'site' | 'selection';
  readonly direction: Direction;
  /** The delete option, worded for the direction. */
  readonly deleteOrphans: boolean;
}

/** What the dialog needs to know before it asks. */
export interface SyncAskContext {
  readonly siteName: string;
  /** How many files and folders were chosen in the Explorer; 0 asks no scope question. */
  readonly selection: number;
  /** The answers given last time for this site, preselected. */
  readonly last?: Partial<SyncChoice> | undefined;
}

/** The delete option as Dreamweaver words it for each direction. */
export function deleteLabel(direction: Direction): string {
  return direction === 'get' ? 'Delete local files not on remote server' : 'Delete remote files not on local drive';
}

/** The other answer to the delete question. */
export function keepLabel(direction: Direction): string {
  return direction === 'get' ? 'Keep local files that are not on the remote server' : 'Keep remote files that are not on the local drive';
}

const DIRECTIONS: readonly Direction[] = ['put', 'get', 'both'];

/**
 * Asks the three questions of Dreamweaver's Synchronize dialog: what to
 * synchronize (only when files were chosen in the Explorer), which way, and
 * whether to delete files the other side does not have. Back returns to the
 * previous question; Escape cancels.
 */
export async function askSync(prompter: Prompter, context: SyncAskContext): Promise<SyncChoice | undefined> {
  const title = `Synchronize ${context.siteName}`;
  const askScope = context.selection > 0;
  const total = askScope ? 3 : 2;
  let scope: SyncChoice['scope'] = askScope ? (context.last?.scope ?? 'selection') : 'site';
  let direction: Direction = context.last?.direction ?? 'put';
  let deleteOrphans = context.last?.deleteOrphans ?? false;
  const steps: (() => Promise<'next' | typeof BACK | undefined>)[] = [];
  if (askScope) {
    steps.push(async () => {
      const answer = await prompter.choose<SyncChoice['scope']>({
        title,
        step: 1,
        totalSteps: total,
        placeholder: 'Synchronize',
        choices: [
          { label: `Entire '${context.siteName}' Site`, value: 'site' },
          {
            label: 'Selected Local Files Only',
            description: `${String(context.selection)} chosen in the Explorer`,
            value: 'selection',
          },
        ],
        selected: scope,
      });
      if (answer === undefined || answer === BACK) {
        return answer;
      }
      scope = answer;
      return 'next';
    });
  }
  steps.push(async () => {
    const choices: Choice<Direction>[] = DIRECTIONS.map((value) => ({ label: DIRECTION_TITLES[value], value }));
    const answer = await prompter.choose({ title, step: total - 1, totalSteps: total, placeholder: 'Direction', choices, selected: direction });
    if (answer === undefined || answer === BACK) {
      return answer;
    }
    direction = answer;
    return 'next';
  });
  steps.push(async () => {
    const answer = await prompter.choose({
      title,
      step: total,
      totalSteps: total,
      placeholder: 'Files that are only on the other side',
      choices: [
        { label: keepLabel(direction), value: false },
        { label: deleteLabel(direction), description: 'Listed in the preview; never-synchronized files start unchecked', value: true },
      ],
      selected: deleteOrphans,
    });
    if (answer === undefined || answer === BACK) {
      return answer;
    }
    deleteOrphans = answer;
    return 'next';
  });
  for (let index = 0; index < steps.length; ) {
    const step = steps[index];
    const result = step === undefined ? undefined : await step();
    if (result === undefined) {
      return undefined;
    }
    index = result === BACK ? Math.max(0, index - 1) : index + 1;
  }
  return { scope, direction, deleteOrphans };
}
