// Reads the repository's files from a test bundled into out/test/.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function findRoot(): string {
  for (let dir = __dirname; ; dir = path.dirname(dir)) {
    const manifest = path.join(dir, 'package.json');
    if (existsSync(manifest) && (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name === 'vscode-sync-servers') {
      return dir;
    }
    if (path.dirname(dir) === dir) {
      throw new Error('The vscode-sync-servers folder was not found above the test.');
    }
  }
}

/** The repository folder. */
export const ROOT = findRoot();

/** The text of a file, by its path from the repository folder. */
export function readText(file: string): string {
  return readFileSync(path.join(ROOT, file), 'utf8');
}

/** A JSON file, by its path from the repository folder. */
export function readJson(file: string): unknown {
  return JSON.parse(readText(file));
}
