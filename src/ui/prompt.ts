/**
 * Everything the extension asks a person, as an interface without `vscode`,
 * so the flows that ask can run in unit tests with scripted answers.
 * `VsCodePrompter` is the real one.
 */

/** Returned by a step when the person pressed Back. */
export const BACK = Symbol('back');

/** The type of {@link BACK}. */
export type Back = typeof BACK;

/** The title bar of a step of a multi-step input. */
export interface StepPosition {
  readonly title: string;
  readonly step?: number;
  readonly totalSteps?: number;
}

/** A question answered by typing. */
export interface TextQuestion extends StepPosition {
  readonly prompt: string;
  readonly value?: string;
  /** An example shown in an empty box; never the only label. */
  readonly placeholder?: string;
  /** Hides what is typed. */
  readonly password?: boolean;
  /** The problem with an answer, shown under the box; `undefined` accepts it. */
  readonly validate?: (value: string) => string | undefined;
}

/** One answer of a {@link ChoiceQuestion}. */
export interface Choice<T> {
  readonly label: string;
  readonly description?: string;
  readonly detail?: string;
  readonly value: T;
}

/** A question answered by choosing from a list. */
export interface ChoiceQuestion<T> extends StepPosition {
  readonly placeholder: string;
  readonly choices: readonly Choice<T>[];
  /** The answer highlighted when the list opens. */
  readonly selected?: T;
}

/** A question answered with a folder from the system's folder picker. */
export interface FolderQuestion {
  readonly title: string;
  readonly openLabel: string;
  /** The folder the picker opens in. */
  readonly start?: string;
}

/** A question answered with a file from the system's file picker. */
export interface FileQuestion {
  readonly title: string;
  readonly openLabel: string;
  /** The folder the picker opens in. */
  readonly start?: string;
}

/** A modal message with buttons. Closing it, or Cancel, answers `undefined`. */
export interface ModalQuestion {
  readonly message: string;
  readonly detail?: string;
  readonly buttons: readonly string[];
  /** Drawn as a warning, for anything that cannot be undone or trusts something new. */
  readonly warning?: boolean;
}

/** The answer to a list that also takes typed text: a choice, or what was typed. */
export type ChoiceOrTyped<T> = { readonly choice: T } | { readonly typed: string };

/** How the extension asks and tells. */
export interface Prompter {
  text(question: TextQuestion): Promise<string | Back | undefined>;
  choose<T>(question: ChoiceQuestion<T>): Promise<T | Back | undefined>;
  /** A list whose filter box also takes text: typed text that starts with "/", or matches no choice, is the answer. */
  chooseOrType<T>(question: ChoiceQuestion<T>): Promise<ChoiceOrTyped<T> | Back | undefined>;
  folder(question: FolderQuestion): Promise<string | undefined>;
  file(question: FileQuestion): Promise<string | undefined>;
  modal(question: ModalQuestion): Promise<string | undefined>;
  /** A notification; resolves the action clicked, or `undefined` when it is dismissed. */
  inform(message: string, actions?: readonly string[]): Promise<string | undefined>;
  /** An error notification; resolves the action clicked, or `undefined` when it is dismissed. */
  error(message: string, actions?: readonly string[]): Promise<string | undefined>;
}
