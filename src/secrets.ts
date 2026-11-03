import { CREDENTIAL_SERVICE, secretAccount, type CredentialStore, type SecretRef } from '@isocialpractice/cmd-sync-servers';
import type * as vscode from 'vscode';

/** The SecretStorage key of a secret: `sync-servers/<siteId>/<serverId>/<kind>`. */
export function secretKey(ref: SecretRef): string {
  return `${CREDENTIAL_SERVICE}/${secretAccount(ref)}`;
}

/**
 * The engine's credential store, kept in VS Code's SecretStorage, which the
 * operating system's keychain protects. Secrets never enter a settings file
 * or a webview.
 */
export class SecretStorageStore implements CredentialStore {
  readonly name = "VS Code's secret storage";
  readonly #storage: vscode.SecretStorage;

  constructor(storage: vscode.SecretStorage) {
    this.#storage = storage;
  }

  async get(ref: SecretRef): Promise<string | undefined> {
    return this.#storage.get(secretKey(ref));
  }

  async set(ref: SecretRef, secret: string): Promise<void> {
    await this.#storage.store(secretKey(ref), secret);
  }

  async delete(ref: SecretRef): Promise<boolean> {
    const key = secretKey(ref);
    const had = (await this.#storage.get(key)) !== undefined;
    await this.#storage.delete(key);
    return had;
  }
}
