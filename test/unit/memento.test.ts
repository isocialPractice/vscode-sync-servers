// The memory of the Synchronize dialog: what this window wrote is what it reads back.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type * as vscode from 'vscode';
import { WindowMemento } from '../../src/memento.ts';

const KEY = 'syncServers.lastSync.my-site';

/** A global state whose copy can be put back to an older one, as VS Code does when the stored state changes. */
class GlobalState implements vscode.Memento {
  values = new Map<string, unknown>();

  keys(): readonly string[] {
    return [...this.values.keys()];
  }

  get<T>(key: string, defaultValue?: T): T {
    const value = this.values.get(key);
    return (value === undefined ? defaultValue : value) as T;
  }

  update(key: string, value: unknown): Thenable<void> {
    if (value === undefined) {
      this.values.delete(key);
    } else {
      this.values.set(key, value);
    }
    return Promise.resolve();
  }
}

test('the value written last is read back, even when the global state turns back to an older copy', async () => {
  const state = new GlobalState();
  const memory = new WindowMemento(state);
  await memory.update(KEY, { direction: 'put' });
  const older = new Map(state.values);
  await memory.update(KEY, { direction: 'put', range: '1d' });
  assert.deepEqual(state.values.get(KEY), { direction: 'put', range: '1d' }, 'the update reached the global state');
  state.values = older;
  assert.deepEqual(memory.get(KEY), { direction: 'put', range: '1d' });
});

test('a value this window never wrote comes from the global state, or is the default', () => {
  const state = new GlobalState();
  state.values.set(KEY, { direction: 'get' });
  const memory = new WindowMemento(state);
  assert.deepEqual(memory.get(KEY), { direction: 'get' });
  assert.equal(memory.get('syncServers.lastSync.other-site'), undefined);
  assert.equal(memory.get('syncServers.lastSync.other-site', 'none'), 'none');
  assert.deepEqual(memory.keys(), [KEY]);
});

test('a value written as undefined is gone, here and in the global state', async () => {
  const state = new GlobalState();
  const memory = new WindowMemento(state);
  await memory.update(KEY, { direction: 'both' });
  await memory.update(KEY, undefined);
  assert.equal(memory.get(KEY), undefined);
  assert.equal(memory.get(KEY, 'none'), 'none');
  assert.deepEqual(memory.keys(), []);
  assert.equal(state.values.has(KEY), false);
});
