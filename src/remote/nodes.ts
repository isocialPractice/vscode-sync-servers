import type * as vscode from 'vscode';

/** An entry of the Remote Files view: a file or folder on the active site's Remote server. */
export interface RemoteNode {
  readonly kind: 'remote';
  readonly siteId: string;
  /** The site-relative path, `/`-separated. */
  readonly path: string;
  readonly name: string;
  readonly type: 'file' | 'dir' | 'symlink' | 'other';
  readonly size: number;
  readonly mtimeMs: number | undefined;
  /** Where the entry lives in the site's local folder. */
  readonly local: vscode.Uri;
}

/** True when a command argument is an entry of the Remote Files view. */
export function isRemoteNode(value: unknown): value is RemoteNode {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'remote' && 'path' in value && 'local' in value;
}
