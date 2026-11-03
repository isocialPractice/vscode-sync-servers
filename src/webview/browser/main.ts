/**
 * The Site Settings webview. Every message from the extension is checked
 * against its schema and dropped when it does not match; every message sent
 * back is checked the same way on the other side.
 */
import './zod-jitless.ts';
import { toWebviewSchema, type FromWebview } from '../../shared/messages.ts';
import { receive, update, type Action, type State } from '../state.ts';
import { view } from '../view.ts';
import type { VNode } from '../vnode.ts';
import { actionOf, create, patch } from './dom.ts';

interface VsCodeApi {
  postMessage(message: FromWebview): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const root = document.getElementById('app');
let state: State | undefined;
let tree: VNode | undefined;
let dom: Node | undefined;

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function render(focusProblem: boolean, focusId?: string): void {
  if (state === undefined || root === null) {
    return;
  }
  const focused = document.activeElement?.id;
  const next = view(state);
  if (tree === undefined || dom === undefined) {
    dom = create(next);
    root.replaceChildren(dom);
  } else {
    dom = patch(root, dom, tree, next);
  }
  tree = next;
  const target = focusProblem
    ? document.querySelector<HTMLElement>('[aria-invalid="true"]')
    : document.getElementById(focusId ?? focused ?? '');
  if (target !== null && target !== document.activeElement) {
    target.focus();
  }
}

function report(text: string): void {
  vscode.postMessage({ type: 'error', text: text.slice(0, 4000) });
}

function guarded(work: () => void): void {
  try {
    work();
  } catch (error) {
    report(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
  }
}

function dispatch(action: Action, value: string | boolean | undefined): void {
  guarded(() => {
    if (state === undefined) {
      return;
    }
    const result = update(state, action, value, newId);
    state = result.state;
    for (const message of result.messages) {
      vscode.postMessage(message);
    }
    render(result.focusProblem, action.type === 'tab' ? `tab-${action.tab}` : undefined);
  });
}

function valueOf(element: HTMLElement): string | boolean | undefined {
  if (element instanceof HTMLInputElement) {
    return element.type === 'checkbox' ? element.checked : element.value;
  }
  if (element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
    return element.value;
  }
  return undefined;
}

if (root !== null) {
  root.addEventListener('click', (event) => {
    const found = actionOf(event.target, 'click');
    if (found !== undefined && !(found.element instanceof HTMLButtonElement && found.element.disabled)) {
      dispatch(found.action as Action, undefined);
    }
  });
  for (const type of ['input', 'change'] as const) {
    root.addEventListener(type, (event) => {
      const found = actionOf(event.target, type);
      if (found !== undefined) {
        dispatch(found.action as Action, valueOf(found.element));
      }
    });
  }
  root.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      return;
    }
    const found = actionOf(event.target, 'keydown');
    if (found !== undefined) {
      event.preventDefault();
      dispatch(found.action as Action, undefined);
    }
  });
}

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    dispatch({ type: 'save' }, undefined);
  }
});

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const parsed = toWebviewSchema.safeParse(event.data);
  if (!parsed.success) {
    return;
  }
  guarded(() => {
    const result = receive(state, parsed.data);
    state = result.state;
    render(result.focusProblem);
  });
});

window.addEventListener('error', (event) => {
  report(event.message);
});

document.addEventListener('securitypolicyviolation', (event) => {
  report(`The page's Content-Security-Policy blocked ${event.violatedDirective}: ${event.blockedURI}`);
});

vscode.postMessage({ type: 'ready' });
