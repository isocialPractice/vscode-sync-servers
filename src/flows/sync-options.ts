import { DEFAULT_RANGE, DIRECTION_TITLES, formatRange, parseRange, RANGE_TEXT, RANGE_TITLE, type Direction, type TimeRange } from '@isocialpractice/cmd-sync-servers';
import { BACK, type Choice, type Prompter } from '../ui/prompt.ts';

/** The answers of the Synchronize dialog. */
export interface SyncChoice {
  /** The whole site, or the files chosen in the Explorer. */
  readonly scope: 'site' | 'selection';
  readonly direction: Direction;
  /** The delete option, worded for the direction. */
  readonly deleteOrphans: boolean;
  /**
   * The time range as the engine writes it, such as `2d`, when Put files from
   * a time range was chosen. The direction is then `put`, and nothing is
   * deleted.
   */
  readonly range?: string;
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

/** The description of Put files from a time range in the list of directions. */
export const RANGE_DESCRIPTION = 'Only the files created or modified lately';

/** The example the range box shows when it is emptied. */
export const RANGE_PLACEHOLDER = '1d or 24h';

/** The range an answer of the range box stands for: an empty or blank answer is the default; `undefined` for text that is not a range. */
export function readRange(answer: string): TimeRange | undefined {
  const text = answer.trim();
  return parseRange(text === '' ? DEFAULT_RANGE : text);
}

/** The problem with an answer of the range box, or `undefined` when it is a range or empty. */
export function rangeProblem(answer: string): string | undefined {
  return readRange(answer) === undefined ? `Enter ${RANGE_TEXT.format}.` : undefined;
}

/** A direction, or Put files from a time range. */
type Way = Direction | 'range';

const DIRECTIONS: readonly Direction[] = ['put', 'get', 'both'];

/**
 * Asks the three questions of Dreamweaver's Synchronize dialog: what to
 * synchronize (only when files were chosen in the Explorer), which way, and
 * whether to delete files the other side does not have. Put files from a
 * time range, the first way, asks for the range instead of the delete
 * option. Back returns to the previous question; Escape cancels.
 */
export async function askSync(prompter: Prompter, context: SyncAskContext): Promise<SyncChoice | undefined> {
  const title = `Synchronize ${context.siteName}`;
  const askScope = context.selection > 0;
  const total = askScope ? 3 : 2;
  const last = context.last;
  const lastRange = typeof last?.range === 'string' ? readRange(last.range) : undefined;
  let scope: SyncChoice['scope'] = askScope ? (last?.scope ?? 'selection') : 'site';
  let way: Way = lastRange === undefined ? (last?.direction ?? 'put') : 'range';
  let deleteOrphans = last?.deleteOrphans ?? false;
  let range = lastRange === undefined ? DEFAULT_RANGE : formatRange(lastRange);
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
    const choices: Choice<Way>[] = [
      { label: RANGE_TITLE, description: RANGE_DESCRIPTION, value: 'range' },
      ...DIRECTIONS.map((value) => ({ label: DIRECTION_TITLES[value], value })),
    ];
    const answer = await prompter.choose({ title, step: total - 1, totalSteps: total, placeholder: 'Direction', choices, selected: way });
    if (answer === undefined || answer === BACK) {
      return answer;
    }
    way = answer;
    return 'next';
  });
  steps.push(async () => {
    if (way === 'range') {
      const answer = await prompter.text({
        title,
        step: total,
        totalSteps: total,
        prompt: RANGE_TEXT.question,
        value: range,
        placeholder: RANGE_PLACEHOLDER,
        validate: rangeProblem,
      });
      if (answer === undefined || answer === BACK) {
        return answer;
      }
      const typed = readRange(answer);
      if (typed === undefined) {
        return undefined;
      }
      range = formatRange(typed);
      return 'next';
    }
    const direction = way;
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
  return way === 'range' ? { scope, direction: 'put', deleteOrphans: false, range } : { scope, direction: way, deleteOrphans };
}
