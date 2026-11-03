/**
 * A description of the page as plain data. The view builds it without a
 * DOM, so tests can read labels and ARIA attributes; `browser/dom.ts` turns
 * it into elements and patches them in place.
 */

/** Attribute values; `false` and `undefined` leave the attribute out. */
export type AttrValue = string | number | boolean | undefined;
/** The attributes of a node. `value` and `checked` are set as properties. */
export type Attrs = Readonly<Record<string, AttrValue>>;

/** An element. */
export interface VNode {
  readonly tag: string;
  readonly attrs: Attrs;
  readonly children: readonly Child[];
}

/** An element or a piece of text. Text is always inserted as text, never as HTML. */
export type Child = VNode | string;

type ChildInput = Child | readonly ChildInput[] | false | null | undefined;

function flatten(children: readonly ChildInput[], into: Child[]): Child[] {
  for (const child of children) {
    if (child === false || child === null || child === undefined) {
      continue;
    }
    if (typeof child === 'string' || !Array.isArray(child)) {
      into.push(child as Child);
    } else {
      flatten(child as readonly ChildInput[], into);
    }
  }
  return into;
}

/** Builds a node; `false`, `null` and `undefined` children are left out, arrays are flattened. */
export function h(tag: string, attrs: Attrs = {}, ...children: ChildInput[]): VNode {
  return { tag, attrs, children: flatten(children, []) };
}

/** Every node of a tree, depth first, for tests. */
export function* walk(node: Child): Generator<VNode> {
  if (typeof node === 'string') {
    return;
  }
  yield node;
  for (const child of node.children) {
    yield* walk(child);
  }
}

/** The text of a node and its children. */
export function textOf(node: Child): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('');
}
