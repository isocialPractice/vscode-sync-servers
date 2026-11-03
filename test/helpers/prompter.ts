// A Prompter that answers from a script, for tests of the flows and commands.
import { BACK, type Back, type ChoiceOrTyped, type ChoiceQuestion, type FileQuestion, type FolderQuestion, type ModalQuestion, type Prompter, type TextQuestion } from '../../src/ui/prompt.ts';

/** One question the script was asked. */
export interface Asked {
  readonly kind: 'text' | 'choose' | 'chooseOrType' | 'folder' | 'file' | 'modal';
  readonly question: TextQuestion | ChoiceQuestion<unknown> | FolderQuestion | FileQuestion | ModalQuestion;
}

/** One notification shown. */
export interface Shown {
  readonly kind: 'inform' | 'error';
  readonly message: string;
  readonly actions: readonly string[];
}

/**
 * Answers each question with the next scripted answer, in order. A text
 * answer that the question's own validation refuses fails the test, as does
 * a question with no answer left.
 */
export class ScriptedPrompter implements Prompter {
  readonly asked: Asked[] = [];
  readonly shown: Shown[] = [];
  readonly #answers: unknown[];
  readonly #replies: (string | undefined)[] = [];

  constructor(answers: readonly unknown[] = []) {
    this.#answers = [...answers];
  }

  /** Adds answers to the end of the script. */
  answer(...answers: unknown[]): this {
    this.#answers.push(...answers);
    return this;
  }

  /** Clicks these actions on the next notifications, in order; notifications after them are dismissed. */
  reply(...actions: (string | undefined)[]): this {
    this.#replies.push(...actions);
    return this;
  }

  /** The answers not used yet. */
  get remaining(): number {
    return this.#answers.length;
  }

  /** The messages shown so far. */
  get messages(): string[] {
    return this.shown.map((entry) => entry.message);
  }

  #next(kind: Asked['kind'], question: Asked['question']): unknown {
    this.asked.push({ kind, question });
    if (this.#answers.length === 0) {
      const title = 'title' in question ? question.title : question.message;
      throw new Error(`The script has no answer for the ${kind} question "${title}".`);
    }
    return this.#answers.shift();
  }

  text(question: TextQuestion): Promise<string | Back | undefined> {
    const answer = this.#next('text', question);
    if (typeof answer === 'string') {
      const problem = question.validate?.(answer);
      if (problem !== undefined) {
        return Promise.reject(new Error(`"${question.prompt}" refused the scripted answer: ${problem}`));
      }
    }
    return Promise.resolve(answer as string | Back | undefined);
  }

  choose<T>(question: ChoiceQuestion<T>): Promise<T | Back | undefined> {
    return Promise.resolve(this.#next('choose', question as ChoiceQuestion<unknown>) as T | Back | undefined);
  }

  /** A scripted answer is `{ choice }`, `{ typed }`, BACK or `undefined`; a plain value stands for `{ choice: value }`. */
  chooseOrType<T>(question: ChoiceQuestion<T>): Promise<ChoiceOrTyped<T> | Back | undefined> {
    const answer = this.#next('chooseOrType', question);
    if (answer === undefined || answer === BACK || (typeof answer === 'object' && answer !== null && ('choice' in answer || 'typed' in answer))) {
      return Promise.resolve(answer as ChoiceOrTyped<T> | Back | undefined);
    }
    return Promise.resolve({ choice: answer as T });
  }

  folder(question: FolderQuestion): Promise<string | undefined> {
    return Promise.resolve(this.#next('folder', question) as string | undefined);
  }

  file(question: FileQuestion): Promise<string | undefined> {
    return Promise.resolve(this.#next('file', question) as string | undefined);
  }

  modal(question: ModalQuestion): Promise<string | undefined> {
    return Promise.resolve(this.#next('modal', question) as string | undefined);
  }

  inform(message: string, actions: readonly string[] = []): Promise<string | undefined> {
    this.shown.push({ kind: 'inform', message, actions });
    return Promise.resolve(this.#replies.shift());
  }

  error(message: string, actions: readonly string[] = []): Promise<string | undefined> {
    this.shown.push({ kind: 'error', message, actions });
    return Promise.resolve(this.#replies.shift());
  }
}
