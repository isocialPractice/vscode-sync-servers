import path from 'node:path';
import { BACK, type Choice, type Prompter } from '../ui/prompt.ts';

/** Where the picker reads folders: a connection to the server, such as the engine's `ServerProbe`. */
export interface FolderSource {
  /** The folders, and the number of files, in an absolute folder. */
  folders(folder: string): Promise<{ readonly path: string; readonly folders: readonly string[]; readonly files: number }>;
  /** True when an absolute folder exists. */
  exists(folder: string): Promise<boolean>;
}

type Row = { readonly kind: 'use' } | { readonly kind: 'up' } | { readonly kind: 'open'; readonly name: string };

/** An absolute folder on the server from what was typed: absolute, or a folder below `current`. */
export function resolveFolder(typed: string, current: string): string {
  const joined = typed.startsWith('/') ? typed : path.posix.join(current, typed);
  const normalized = path.posix.normalize(joined).replace(/(.)\/+$/, '$1');
  return normalized === '' ? '/' : normalized;
}

/**
 * Picks the root directory from what the server shows, in a quick pick
 * titled with the folder shown: Use This Folder accepts it, `..` goes up,
 * and a folder opens. Typing a path that starts with "/", or names a folder
 * below the one shown, goes there once it exists. Escape resolves
 * `undefined`.
 */
export async function pickRemoteRoot(prompter: Prompter, source: FolderSource, start: string, title = 'Root Directory'): Promise<string | undefined> {
  let current = start;
  for (;;) {
    let listing: Awaited<ReturnType<FolderSource['folders']>>;
    try {
      listing = await source.folders(current);
    } catch (error) {
      void prompter.error(`${current} cannot be opened: ${error instanceof Error ? error.message : String(error)}`);
      if (current === '/') {
        return undefined;
      }
      current = '/';
      continue;
    }
    current = listing.path;
    const files = listing.files === 0 ? '' : ` It holds ${String(listing.files)} file${listing.files === 1 ? '' : 's'}.`;
    const choices: Choice<Row>[] = [
      { label: 'Use This Folder', description: current, value: { kind: 'use' } },
      ...(current === '/' ? [] : [{ label: '..', description: 'Up one folder', value: { kind: 'up' } } as const]),
      ...listing.folders.map((name): Choice<Row> => ({ label: `${name}/`, value: { kind: 'open', name } })),
    ];
    const answer = await prompter.chooseOrType<Row>({
      title: `${title}: ${current}`,
      placeholder: `Open a folder, or type a path.${files}`,
      choices,
    });
    if (answer === undefined || answer === BACK) {
      return undefined;
    }
    if ('typed' in answer) {
      const target = resolveFolder(answer.typed, current);
      if (await source.exists(target)) {
        current = target;
      } else {
        void prompter.error(`${target} was not found on the server.`);
      }
      continue;
    }
    const row = answer.choice;
    if (row.kind === 'use') {
      return current;
    }
    current = row.kind === 'up' ? path.posix.dirname(current) : path.posix.join(current, row.name);
  }
}
