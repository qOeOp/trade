// The lineage as a tree: parents, children in row order, ancestors. Pure; built once per view.
import type { LineageWidget } from "./types";

export type LineageTree = {
  roots: string[];
  parent: ReadonlyMap<string, string>;
  children: ReadonlyMap<string, string[]>;
};

export function lineageTree(lineage: LineageWidget): LineageTree {
  const order = new Map(lineage.rows.map((r) => [r.id, r.row]));
  const parent = new Map(lineage.edges.map((e) => [e.to, e.from]));
  const children = new Map<string, string[]>();
  for (const e of lineage.edges) children.set(e.from, [...(children.get(e.from) ?? []), e.to]);
  const byRow = (a: string, b: string) => (order.get(a) ?? 0) - (order.get(b) ?? 0);
  for (const list of children.values()) list.sort(byRow);
  const roots = lineage.nodes.map((n) => n.id).filter((id) => !parent.has(id)).sort(byRow);
  return { roots, parent, children };
}

/** The ancestors of `id`, root first. */
export function ancestors(tree: LineageTree, id: string): string[] {
  const out: string[] = [];
  for (let p = tree.parent.get(id); p; p = tree.parent.get(p)) out.unshift(p);
  return out;
}

/** How many versions descend from `id`. */
export function descendants(tree: LineageTree, id: string): number {
  return (tree.children.get(id) ?? []).reduce((n, c) => n + 1 + descendants(tree, c), 0);
}
