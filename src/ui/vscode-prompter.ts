import * as vscode from 'vscode';
import {
  BACK,
  type Back,
  type ChoiceOrTyped,
  type ChoiceQuestion,
  type FileQuestion,
  type FolderQuestion,
  type ModalQuestion,
  type Prompter,
  type TextQuestion,
} from './prompt.ts';

function backButtons(step: number | undefined): vscode.QuickInputButton[] {
  return step !== undefined && step > 1 ? [vscode.QuickInputButtons.Back] : [];
}

/** Asks through VS Code's own quick inputs, folder picker, modal dialogs and notifications. */
export class VsCodePrompter implements Prompter {
  text(question: TextQuestion): Promise<string | Back | undefined> {
    const input = vscode.window.createInputBox();
    input.title = question.title;
    input.step = question.step;
    input.totalSteps = question.totalSteps;
    input.prompt = question.prompt;
    input.value = question.value ?? '';
    input.placeholder = question.placeholder;
    input.password = question.password ?? false;
    input.ignoreFocusOut = true;
    input.buttons = backButtons(question.step);
    const problem = (value: string): string | undefined => question.validate?.(value);
    return new Promise((resolve) => {
      let finished = false;
      const done = (answer: string | Back | undefined): void => {
        if (!finished) {
          finished = true;
          resolve(answer);
          input.dispose();
        }
      };
      input.onDidChangeValue((value) => {
        input.validationMessage = problem(value);
      });
      input.onDidAccept(() => {
        const message = problem(input.value);
        if (message === undefined) {
          done(input.value);
        } else {
          input.validationMessage = message;
        }
      });
      input.onDidTriggerButton((button) => {
        if (button === vscode.QuickInputButtons.Back) {
          done(BACK);
        }
      });
      input.onDidHide(() => {
        done(undefined);
      });
      input.show();
    });
  }

  choose<T>(question: ChoiceQuestion<T>): Promise<T | Back | undefined> {
    type Item = vscode.QuickPickItem & { readonly value: T };
    const pick = vscode.window.createQuickPick<Item>();
    pick.title = question.title;
    pick.step = question.step;
    pick.totalSteps = question.totalSteps;
    pick.placeholder = question.placeholder;
    pick.ignoreFocusOut = true;
    pick.buttons = backButtons(question.step);
    const items: Item[] = question.choices.map((choice) => ({
      label: choice.label,
      description: choice.description,
      detail: choice.detail,
      value: choice.value,
    }));
    pick.items = items;
    const selected = items.find((item) => item.value === question.selected);
    if (selected !== undefined) {
      pick.activeItems = [selected];
    }
    return new Promise((resolve) => {
      let finished = false;
      const done = (answer: T | Back | undefined): void => {
        if (!finished) {
          finished = true;
          resolve(answer);
          pick.dispose();
        }
      };
      pick.onDidAccept(() => {
        const [item] = pick.selectedItems;
        if (item !== undefined) {
          done(item.value);
        }
      });
      pick.onDidTriggerButton((button) => {
        if (button === vscode.QuickInputButtons.Back) {
          done(BACK);
        }
      });
      pick.onDidHide(() => {
        done(undefined);
      });
      pick.show();
    });
  }

  chooseOrType<T>(question: ChoiceQuestion<T>): Promise<ChoiceOrTyped<T> | Back | undefined> {
    type Item = vscode.QuickPickItem & { readonly value: T };
    const pick = vscode.window.createQuickPick<Item>();
    pick.title = question.title;
    pick.step = question.step;
    pick.totalSteps = question.totalSteps;
    pick.placeholder = question.placeholder;
    pick.ignoreFocusOut = true;
    pick.buttons = backButtons(question.step);
    pick.items = question.choices.map((choice) => ({ label: choice.label, description: choice.description, detail: choice.detail, value: choice.value }));
    return new Promise((resolve) => {
      let finished = false;
      const done = (answer: ChoiceOrTyped<T> | Back | undefined): void => {
        if (!finished) {
          finished = true;
          resolve(answer);
          pick.dispose();
        }
      };
      pick.onDidAccept(() => {
        const typed = pick.value.trim();
        const [item] = pick.selectedItems;
        if (typed.startsWith('/') || (item === undefined && typed !== '')) {
          done({ typed });
        } else if (item !== undefined) {
          done({ choice: item.value });
        }
      });
      pick.onDidTriggerButton((button) => {
        if (button === vscode.QuickInputButtons.Back) {
          done(BACK);
        }
      });
      pick.onDidHide(() => {
        done(undefined);
      });
      pick.show();
    });
  }

  async folder(question: FolderQuestion): Promise<string | undefined> {
    const picked = await vscode.window.showOpenDialog({
      title: question.title,
      openLabel: question.openLabel,
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      ...(question.start === undefined ? {} : { defaultUri: vscode.Uri.file(question.start) }),
    });
    return picked?.[0]?.fsPath;
  }

  async file(question: FileQuestion): Promise<string | undefined> {
    const picked = await vscode.window.showOpenDialog({
      title: question.title,
      openLabel: question.openLabel,
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      ...(question.start === undefined ? {} : { defaultUri: vscode.Uri.file(question.start) }),
    });
    return picked?.[0]?.fsPath;
  }

  async modal(question: ModalQuestion): Promise<string | undefined> {
    const options: vscode.MessageOptions = { modal: true, ...(question.detail === undefined ? {} : { detail: question.detail }) };
    return question.warning === true
      ? vscode.window.showWarningMessage(question.message, options, ...question.buttons)
      : vscode.window.showInformationMessage(question.message, options, ...question.buttons);
  }

  async inform(message: string, actions: readonly string[] = []): Promise<string | undefined> {
    return vscode.window.showInformationMessage(message, ...actions);
  }

  async error(message: string, actions: readonly string[] = []): Promise<string | undefined> {
    return vscode.window.showErrorMessage(message, ...actions);
  }
}
