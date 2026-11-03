import { homedir } from 'node:os';
import type { Server, Site } from '@isocialpractice/cmd-sync-servers';
import * as vscode from 'vscode';
import { INTERNAL_COMMANDS } from '../contributions.ts';
import type { SitesModel } from '../sites-model.ts';
import { serverRow, siteRow, type Row } from './site-rows.ts';

/** A row of the Sites view: a site, one of its servers, or why the list cannot be read. */
export type SitesNode =
  | { readonly kind: 'site'; readonly site: Site }
  | { readonly kind: 'server'; readonly site: Site; readonly server: Server }
  | { readonly kind: 'problem'; readonly message: string };

/** True when a command argument is a row of the Sites view. */
export function isSitesNode(value: unknown): value is SitesNode {
  return typeof value === 'object' && value !== null && 'kind' in value && ['site', 'server', 'problem'].includes(String(value.kind));
}

function treeItem(row: Row, expanded: boolean): vscode.TreeItem {
  const state = !row.expandable
    ? vscode.TreeItemCollapsibleState.None
    : expanded
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed;
  const item = new vscode.TreeItem(row.label, state);
  item.id = row.id;
  item.description = row.description;
  item.tooltip = row.tooltip;
  item.iconPath = new vscode.ThemeIcon(row.icon);
  item.contextValue = row.contextValue;
  item.accessibilityInformation = { label: row.accessibilityLabel };
  return item;
}

/** The Sites view: every site of the master list, with its servers under it. */
export class SitesView implements vscode.TreeDataProvider<SitesNode>, vscode.Disposable {
  readonly #model: SitesModel;
  readonly #home = homedir();
  readonly #changed = new vscode.EventEmitter<SitesNode | undefined>();
  readonly #subscription: vscode.Disposable;

  readonly onDidChangeTreeData = this.#changed.event;

  constructor(model: SitesModel) {
    this.#model = model;
    this.#subscription = model.onDidChange(() => {
      this.#changed.fire(undefined);
    });
  }

  getChildren(node?: SitesNode): SitesNode[] {
    if (node === undefined) {
      const { problem } = this.#model;
      return problem === undefined ? this.#model.sites.map((site) => ({ kind: 'site', site })) : [{ kind: 'problem', message: problem }];
    }
    return node.kind === 'site' ? node.site.servers.map((server) => ({ kind: 'server', site: node.site, server })) : [];
  }

  getParent(node: SitesNode): SitesNode | undefined {
    return node.kind === 'server' ? { kind: 'site', site: node.site } : undefined;
  }

  getTreeItem(node: SitesNode): vscode.TreeItem {
    switch (node.kind) {
      case 'site': {
        const active = node.site.id === this.#model.activeSiteId;
        return treeItem(siteRow(node.site, active, this.#home), active);
      }
      case 'server':
        return treeItem(serverRow(node.site, node.server), false);
      case 'problem': {
        const item = new vscode.TreeItem('The list of sites cannot be read');
        const [first = ''] = node.message.split('\n');
        item.description = first;
        item.tooltip = `${node.message}\n\nFix sites.json, or restore sites.json.bak beside it. The list reloads when the file is saved.`;
        item.iconPath = new vscode.ThemeIcon('error');
        item.contextValue = 'problem';
        item.accessibilityInformation = { label: `Error: the list of sites cannot be read. ${node.message}` };
        if (this.#model.paths !== undefined) {
          item.command = { command: INTERNAL_COMMANDS.openSitesFile, title: 'Open sites.json' };
        }
        return item;
      }
    }
  }

  dispose(): void {
    this.#subscription.dispose();
    this.#changed.dispose();
  }
}
