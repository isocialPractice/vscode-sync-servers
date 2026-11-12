import { realpathSync } from 'node:fs';
import path from 'node:path';

/**
 * The real path of `file`, through the nearest of its folders that exists:
 * the names that do not exist yet, such as a file Get is about to download,
 * stay on top of that folder's real path. A symbolic link on the way, such
 * as macOS's `/var` for `/private/var`, or a Windows short name such as
 * `RUNNER~1`, then reads as the folder it stands for, as the engine reads a
 * site's local root. A path with no folder that resolves is only made
 * absolute.
 */
export function realPathOf(file: string, resolve: (file: string) => string = realpathSync.native): string {
  const absolute = path.resolve(file);
  const missing: string[] = [];
  for (let current = absolute; ; ) {
    try {
      return path.join(resolve(current), ...missing);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return absolute;
      }
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}
