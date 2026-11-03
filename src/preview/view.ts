import path from 'node:path';
import type { ItemResult, PlanItem } from '@isocialpractice/cmd-sync-servers';
import * as vscode from 'vscode';
import type { PreviewController } from './controller.ts';
import { groupRows, resultGroups, resultRow, rowView } from './rows.ts';

/** A node of the Sync Preview: a group, a row of the plan, or a row of a finished run. */
export type PreviewNode =
  | { readonly kind: 'group'; readonly id: string; readonly label: string; readonly icon: string; readonly rows: readonly PreviewNode[] }
  | { readonly kind: 'row'; readonly item: PlanItem }
  | { readonly kind: 'result'; readonly item: ItemResult };

/** True when a command argument is a row of the Sync Preview. */
export function isPreviewRow(value: unknown): value is Extract<PreviewNode, { kind: 'row' }> {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'row' && 'item' in value;
}

/**
 * The Sync Preview: every file with a difference, grouped by what will
 * happen to it, with a native checkbox on each row that can run.
 */
export class PreviewView implements vscode.TreeDataProvider<PreviewNode>, vscode.Disposable {
  readonly #controller: PreviewController;
  readonly #changed = new vscode.EventEmitter<PreviewNode | undefined>();
  readonly #subscriptions: vscode.Disposable[] = [];
  #view: vscode.TreeView<PreviewNode> | undefined;

  readonly onDidChangeTreeData = this.#changed.event;

  constructor(controller: PreviewController) {
    this.#controller = controller;
    this.#subscriptions.push(
      controller.onDidChange(() => {
        this.#changed.fire(undefined);
        this.#describe();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('syncServers.preview.groupBy')) {
          this.#changed.fire(undefined);
        }
      }),
    );
  }

  /** Connects the tree view, for its heading, summary, badge and checkboxes. */
  attach(view: vscode.TreeView<PreviewNode>): void {
    this.#view = view;
    this.#subscriptions.push(
      view.onDidChangeCheckboxState((event) => {
        for (const [node, state] of event.items) {
          if (node.kind === 'row') {
            this.#controller.setChecked([node.item.id], state === vscode.TreeItemCheckboxState.Checked);
          }
        }
      }),
    );
    this.#describe();
  }

  /** The rows chosen in the view, for commands run from the palette. */
  selectedRows(): PlanItem[] {
    return (this.#view?.selection ?? []).flatMap((node) => (node.kind === 'row' ? [node.item] : node.kind === 'group' ? rowsOf(node) : []));
  }

  #describe(): void {
    const view = this.#view;
    if (view === undefined) {
      return;
    }
    const pending = this.#controller.pending;
    view.message = this.#controller.heading() || undefined;
    view.description = pending?.plan.summaryLine();
    const resolve = pending?.plan.summary.resolve ?? 0;
    view.badge = resolve > 0 ? { value: resolve, tooltip: `${String(resolve)} ${resolve === 1 ? 'file needs' : 'files need'} a decision` } : undefined;
  }

  getChildren(node?: PreviewNode): PreviewNode[] {
    if (node !== undefined) {
      return node.kind === 'group' ? [...node.rows] : [];
    }
    const pending = this.#controller.pending;
    if (pending !== undefined) {
      const by = vscode.workspace.getConfiguration('syncServers').get<'action' | 'folder'>('preview.groupBy', 'action');
      return groupRows(pending.plan.items, by).map((group) => ({
        kind: 'group',
        id: group.id,
        label: group.label,
        icon: group.icon,
        rows: group.items.map((item) => ({ kind: 'row', item })),
      }));
    }
    const finished = this.#controller.finished;
    return finished === undefined
      ? []
      : resultGroups(finished.result).map((group) => ({
          kind: 'group',
          id: `result:${group.id}`,
          label: group.label,
          icon: group.icon,
          rows: group.items.map((item) => ({ kind: 'result', item })),
        }));
  }

  getTreeItem(node: PreviewNode): vscode.TreeItem {
    if (node.kind === 'group') {
      const item = new vscode.TreeItem(
        `${node.label} (${String(node.rows.length)})`,
        node.id === 'result:done' || node.id === 'skip' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded,
      );
      item.id = `group:${node.id}`;
      item.iconPath = new vscode.ThemeIcon(node.icon);
      item.contextValue = 'group';
      item.accessibilityInformation = { label: `${node.label}, ${String(node.rows.length)} ${node.rows.length === 1 ? 'file' : 'files'}` };
      return item;
    }
    const pending = this.#controller.pending;
    const root = pending?.site.localRoot ?? this.#controller.finished?.site.localRoot;
    if (node.kind === 'result') {
      const row = resultRow(node.item);
      const item = new vscode.TreeItem(row.label);
      item.id = `result:${String(node.item.id)}`;
      item.description = row.description;
      item.tooltip = row.accessibilityLabel;
      item.iconPath = new vscode.ThemeIcon(node.item.outcome === 'done' ? 'pass' : node.item.outcome === 'cancelled' ? 'circle-slash' : 'error');
      item.contextValue = 'result';
      item.accessibilityInformation = { label: row.accessibilityLabel };
      return item;
    }
    const by = vscode.workspace.getConfiguration('syncServers').get<'action' | 'folder'>('preview.groupBy', 'action');
    const row = rowView(node.item, this.#controller.allowed(node.item.id), by === 'folder');
    const item = new vscode.TreeItem(row.label);
    item.id = `row:${String(node.item.id)}`;
    item.description = row.description;
    item.tooltip = row.tooltip;
    item.iconPath = new vscode.ThemeIcon(row.icon);
    item.contextValue = row.contextValue;
    item.accessibilityInformation = { label: row.accessibilityLabel };
    if (row.checkbox !== undefined) {
      item.checkboxState = row.checkbox === 'checked' ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
    }
    if (root !== undefined && node.item.local !== undefined) {
      item.resourceUri = vscode.Uri.file(path.join(root, ...node.item.path.split('/')));
    }
    return item;
  }

  dispose(): void {
    for (const subscription of this.#subscriptions) {
      subscription.dispose();
    }
    this.#changed.dispose();
  }
}

function rowsOf(group: Extract<PreviewNode, { kind: 'group' }>): PlanItem[] {
  return group.rows.flatMap((row) => (row.kind === 'row' ? [row.item] : []));
}
