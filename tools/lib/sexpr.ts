import type { Vec2 } from './geom.ts';

export type SNode = string | SNode[];

const TOKEN = /\(|\)|"(?:[^"\\]|\\.)*"|[^\s()]+/g;

/** Minimal s-expression reader. A `.kicad_pcb` is one top-level list. */
export function parseSexpr(text: string): SNode[] {
  const stack: SNode[][] = [];
  let current: SNode[] = [];
  for (const [token] of text.matchAll(TOKEN)) {
    if (token === '(') {
      stack.push(current);
      current = [];
    } else if (token === ')') {
      const parent = stack.pop();
      if (!parent) throw new Error('unbalanced closing paren');
      parent.push(current);
      current = parent;
    } else {
      current.push(token.startsWith('"') ? token.slice(1, -1) : token);
    }
  }
  return current;
}

export const isList = (node: SNode | undefined): node is SNode[] => Array.isArray(node);

export const children = (node: SNode[], name: string): SNode[][] =>
  node.filter((child): child is SNode[] => isList(child) && child[0] === name);

export const child = (node: SNode[], name: string): SNode[] | undefined => children(node, name)[0];

/** The two numbers following a node's head, as in `(at 12.5 -3)`. */
export function vec2(node: SNode[] | undefined): Vec2 {
  if (!node) throw new Error('expected a node with two coordinates');
  return [asNumber(node[1]), asNumber(node[2])];
}

/** An optional trailing number, as in the rotation of `(at 12.5 -3 90)`. */
export const numberAt = (node: SNode[] | undefined, index: number): number | undefined => {
  const raw = node?.[index];
  return typeof raw === 'string' ? Number(raw) : undefined;
};

export function asNumber(node: SNode | undefined): number {
  const value = Number(node);
  if (typeof node !== 'string' || !Number.isFinite(value)) throw new Error(`expected a number, got ${String(node)}`);
  return value;
}
