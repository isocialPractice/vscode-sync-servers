import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { siteCloak, type Site } from '@isocialpractice/cmd-sync-servers';

/** How much of the local folder the cloaking settings cloak. */
export interface CloakCount {
  readonly enabled: boolean;
  /** Files cloaked one by one or by a pattern, outside cloaked folders. */
  readonly files: number;
  /** Cloaked folders, each counted once, whatever they hold. */
  readonly folders: number;
  /** False when the count stopped at the limit or was cancelled, so the real numbers are higher. */
  readonly complete: boolean;
}

/** Options of {@link countCloaked}. */
export interface CountOptions {
  /** The most entries to look at. Default 20,000. */
  readonly limit?: number;
  readonly signal?: AbortSignal;
  readonly platform?: NodeJS.Platform;
  /** The cloaking patterns every site uses before its own, unless `cloaking.useGlobalPatterns` is false. */
  readonly globalPatterns?: readonly string[];
}

/**
 * Counts what cloaking hides in a local folder, for the live count under the
 * patterns. Cloaked folders are not opened; links are not followed.
 */
export async function countCloaked(root: string, cloaking: Site['cloaking'], options: CountOptions = {}): Promise<CloakCount> {
  const cloak = siteCloak({ cloaking }, options.platform, options.globalPatterns);
  if (!cloak.enabled) {
    return { enabled: false, files: 0, folders: 0, complete: true };
  }
  const limit = options.limit ?? 20_000;
  let files = 0;
  let folders = 0;
  let seen = 0;
  const queue = [''];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (options.signal?.aborted === true) {
      return { enabled: true, files, folders, complete: false };
    }
    let entries;
    try {
      entries = await readdir(path.join(root, next), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      seen += 1;
      if (seen > limit) {
        return { enabled: true, files, folders, complete: false };
      }
      const relative = next === '' ? entry.name : `${next}/${entry.name}`;
      if (entry.isDirectory()) {
        if (cloak.isCloaked(relative, true)) {
          folders += 1;
        } else {
          queue.push(relative);
        }
      } else if (entry.isFile() && cloak.isCloaked(relative, false)) {
        files += 1;
      }
    }
  }
  return { enabled: true, files, folders, complete: true };
}
