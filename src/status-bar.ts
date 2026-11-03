import * as vscode from 'vscode';
import { INTERNAL_COMMANDS } from './contributions.ts';
import type { SitesModel } from './sites-model.ts';
import { statusText, type Activity } from './status-text.ts';
import type { Choice, Prompter } from './ui/prompt.ts';

/** The active site and its Remote server, in the status bar. Hidden while there are no sites. */
export class StatusBar implements vscode.Disposable {
  readonly #item = vscode.window.createStatusBarItem('syncServers.status', vscode.StatusBarAlignment.Left, 10);
  readonly #model: SitesModel;
  readonly #activity: () => Activity;
  readonly #subscriptions: vscode.Disposable[];

  constructor(model: SitesModel, activity: { readonly onDidChange: vscode.Event<void>; readonly current: () => Activity }) {
    this.#model = model;
    this.#activity = activity.current;
    this.#item.name = 'Sync Servers';
    this.#item.command = INTERNAL_COMMANDS.statusMenu;
    this.#subscriptions = [
      model.onDidChange(() => {
        this.update();
      }),
      activity.onDidChange(() => {
        this.update();
      }),
    ];
    this.update();
  }

  /** What the item shows now, for tests. */
  get text(): string {
    return this.#item.text;
  }

  /** True while the item has the warning background, for tests. */
  get warning(): boolean {
    return this.#item.backgroundColor !== undefined;
  }

  update(): void {
    if (this.#model.sites.length === 0) {
      this.#item.hide();
      return;
    }
    const { text, tooltip, label, warning } = statusText(this.#model.activeSite, this.#activity());
    this.#item.text = text;
    this.#item.tooltip = tooltip;
    this.#item.accessibilityInformation = { label };
    this.#item.backgroundColor = warning ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    this.#item.show();
  }

  dispose(): void {
    for (const subscription of this.#subscriptions) {
      subscription.dispose();
    }
    this.#item.dispose();
  }
}

/** The menu the status bar item opens: the site's actions, then Switch Site. */
export async function statusMenu(prompter: Prompter, model: SitesModel): Promise<void> {
  const site = model.activeSite;
  const file = vscode.window.activeTextEditor?.document.uri;
  const hasFile = file?.scheme === 'file';
  const choices: Choice<{ command: string; args: unknown[] }>[] = [
    ...(site === undefined
      ? []
      : [
          { label: '$(sync) Synchronize...', value: { command: 'syncServers.synchronize', args: [] } },
          ...(hasFile
            ? [
                { label: '$(cloud-upload) Put Current File', value: { command: 'syncServers.put', args: [file] } },
                { label: '$(cloud-download) Get Current File', value: { command: 'syncServers.get', args: [file] } },
              ]
            : []),
        ]),
    { label: '$(arrow-swap) Switch Site', value: { command: 'syncServers.switchSite', args: [] } },
    ...(site === undefined ? [] : [{ label: '$(gear) Site Settings', value: { command: 'syncServers.siteSettings', args: [] } }]),
  ];
  const answer = await prompter.choose({
    title: site === undefined ? 'Sync Servers' : `Sync Servers: ${site.name}`,
    placeholder: 'Choose an action',
    choices,
  });
  if (typeof answer === 'object') {
    await vscode.commands.executeCommand(answer.command, ...answer.args);
  }
}
