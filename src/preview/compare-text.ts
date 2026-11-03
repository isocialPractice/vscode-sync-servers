import { createHash } from 'node:crypto';

/** One copy of a file, read for a comparison. */
export interface ComparedCopy {
  readonly bytes: Buffer;
  readonly mtimeMs: number | undefined;
}

/** Files larger than this are summarized instead of shown in a diff. */
export const MAX_DIFF_BYTES = 5 * 1024 * 1024;

/** True when a copy should not be shown as text: it holds a NUL byte near its start, or is too large. */
export function isBinary(copy: ComparedCopy | undefined): boolean {
  if (copy === undefined) {
    return false;
  }
  return copy.bytes.length > MAX_DIFF_BYTES || copy.bytes.subarray(0, 8000).includes(0);
}

function describe(name: string, copy: ComparedCopy | undefined): string {
  if (copy === undefined) {
    return `${name}: no copy`;
  }
  const time = copy.mtimeMs === undefined ? 'time unknown' : `modified ${new Date(copy.mtimeMs).toISOString().replace('T', ' ').slice(0, 19)} UTC`;
  const hash = createHash('sha256').update(copy.bytes).digest('hex');
  return `${name}: ${String(copy.bytes.length)} bytes, ${time}, SHA-256 ${hash}`;
}

/** The text shown instead of a diff for a binary or very large file: sizes, times and hashes. */
export function binarySummary(filePath: string, serverName: string, local: ComparedCopy | undefined, remote: ComparedCopy | undefined): string {
  const same = local !== undefined && remote !== undefined && local.bytes.equals(remote.bytes);
  const verdict =
    local === undefined || remote === undefined ? 'Only one side has the file.' : same ? 'The two copies are identical.' : 'The two copies differ.';
  return [
    `${filePath}: the local copy and the copy on ${serverName}`,
    '',
    describe('Local', local),
    describe(serverName, remote),
    '',
    verdict,
    '',
  ].join('\n');
}
