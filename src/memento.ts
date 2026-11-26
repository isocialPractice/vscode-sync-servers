/**
 * A Memento that keeps the values written through it in this window and
 * reads them from there first. VS Code replaces an extension's copy of its
 * global state with the stored one whenever that changes, so a read right
 * after an update can return an older value. The value written last is the
 * one read, and every update still reaches the global state.
 */
import type * as vscode from 'vscode';

export class WindowMemento implements vscode.Memento {
  readonly #base: vscode.Memento;
  readonly #written = new Map<string, unknown>();

  constructor(base: vscode.Memento) {
    this.#base = base;
  }

  keys(): readonly string[] {
    return [...new Set([...this.#base.keys(), ...this.#written.keys()])].filter((key) => this.get(key) !== undefined);
  }

  /** The value, or `defaultValue` when there is none, as `vscode.Memento` gives it. */
  get<T>(key: string, defaultValue?: T): T {
    const value = this.#written.has(key) ? this.#written.get(key) : this.#base.get(key);
    return (value === undefined ? defaultValue : value) as T;
  }

  update(key: string, value: unknown): Thenable<void> {
    this.#written.set(key, value);
    return this.#base.update(key, value);
  }
}
