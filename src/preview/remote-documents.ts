import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { REMOTE_SCHEME } from '../contributions.ts';

/**
 * Read-only documents holding a server's copy of a file, or a summary of
 * both copies. The text is kept in memory while the document is open; the
 * temporary download is removed as soon as it has been read.
 */
export class RemoteDocuments implements vscode.TextDocumentContentProvider, vscode.Disposable {
  readonly #texts = new Map<string, string>();
  readonly #subscriptions: vscode.Disposable[];

  constructor() {
    this.#subscriptions = [
      vscode.workspace.registerTextDocumentContentProvider(REMOTE_SCHEME, this),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (document.uri.scheme === REMOTE_SCHEME) {
          this.#texts.delete(document.uri.toString());
        }
      }),
    ];
  }

  /** A new document whose path ends like the file, so the editor picks its language. */
  add(label: string, filePath: string, text: string): vscode.Uri {
    const uri = vscode.Uri.from({ scheme: REMOTE_SCHEME, path: `/${label}/${filePath}`, query: randomUUID() });
    this.#texts.set(uri.toString(), text);
    return uri;
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.#texts.get(uri.toString()) ?? 'This copy is no longer held. Run Compare with Remote again.';
  }

  /** How many documents are held, for tests. */
  get size(): number {
    return this.#texts.size;
  }

  dispose(): void {
    for (const subscription of this.#subscriptions) {
      subscription.dispose();
    }
    this.#texts.clear();
  }
}
