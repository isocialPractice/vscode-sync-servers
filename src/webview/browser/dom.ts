/**
 * Turns the view's plain data into elements and patches them in place, so
 * the field being typed in is never replaced and keeps its caret. Text is
 * always set as text, never parsed as HTML.
 */
import type { Attrs, Child } from '../vnode.ts';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'circle']);
// Set as properties after the children exist, so a select finds its option.
const PROPERTIES = new Set(['value', 'checked']);

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function setProperties(element: Element, attrs: Attrs): void {
  if ('value' in attrs) {
    const control = element as FormControl;
    const value = attrs.value === undefined || attrs.value === false ? '' : String(attrs.value);
    if (control.value !== value) {
      control.value = value;
    }
  }
  if ('checked' in attrs) {
    const input = element as HTMLInputElement;
    if (input.checked !== (attrs.checked === true)) {
      input.checked = attrs.checked === true;
    }
  }
}

function setAttributes(element: Element, before: Attrs, after: Attrs): void {
  for (const key of Object.keys(before)) {
    if (!PROPERTIES.has(key) && (after[key] === undefined || after[key] === false)) {
      element.removeAttribute(key);
    }
  }
  for (const [key, value] of Object.entries(after)) {
    if (PROPERTIES.has(key) || value === undefined || value === false) {
      continue;
    }
    const text = value === true ? '' : String(value);
    if (element.getAttribute(key) !== text) {
      element.setAttribute(key, text);
    }
  }
}

/** Creates the elements of a node. */
export function create(node: Child): Node {
  if (typeof node === 'string') {
    return document.createTextNode(node);
  }
  const element = SVG_TAGS.has(node.tag) ? document.createElementNS(SVG_NAMESPACE, node.tag) : document.createElement(node.tag);
  setAttributes(element, {}, node.attrs);
  for (const child of node.children) {
    element.append(create(child));
  }
  setProperties(element, node.attrs);
  return element;
}

/** Brings `dom`, drawn from `before`, up to `after`; returns the node now in its place. */
export function patch(parent: Node, dom: Node, before: Child, after: Child): Node {
  if (typeof before === 'string' || typeof after === 'string' || before.tag !== after.tag || before.attrs.id !== after.attrs.id) {
    if (typeof before === 'string' && typeof after === 'string') {
      if (before !== after) {
        dom.textContent = after;
      }
      return dom;
    }
    const fresh = create(after);
    parent.replaceChild(fresh, dom);
    return fresh;
  }
  const element = dom as Element;
  setAttributes(element, before.attrs, after.attrs);
  const nodes = [...element.childNodes];
  after.children.forEach((child, index) => {
    const old = before.children[index];
    const node = nodes[index];
    if (old === undefined || node === undefined) {
      element.append(create(child));
    } else {
      patch(element, node, old, child);
    }
  });
  for (const extra of nodes.slice(after.children.length)) {
    extra.remove();
  }
  setProperties(element, after.attrs);
  return element;
}

/** The view's actions are kept as JSON in `data-on-<event>` attributes. */
export function actionOf(target: EventTarget | null, event: string): { element: HTMLElement; action: unknown } | undefined {
  if (!(target instanceof Element)) {
    return undefined;
  }
  const element = target.closest(`[data-on-${event}]`);
  const json = element?.getAttribute(`data-on-${event}`);
  if (!(element instanceof HTMLElement) || json === null || json === undefined) {
    return undefined;
  }
  return { element, action: JSON.parse(json) as unknown };
}
