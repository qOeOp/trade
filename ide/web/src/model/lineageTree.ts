// The lineage as a tree: parents, children in row order, ancestors, and inline collapsible fold bars
// that group contiguous unpassed versions into one row. Pure; built once per view.
import type { LineageNode, LineageWidget } from "./types";

export type LineageMode = "core" | "all";
type LineageTree = { roots: string[]; parent: ReadonlyMap<string, string>; children: ReadonlyMap<string, string[]> };

export function lineageTree(lineage: { rows: LineageWidget["rows"]; nodes: readonly { id: string }[]; edges: LineageWidget["edges"] }): LineageTree {
  const order = new Map(lineage.rows.map((r) => [r.id, r.row]));
  const parent = new Map(lineage.edges.map((e) => [e.to, e.from]));
  const children = new Map<string, string[]>();
  for (const e of lineage.edges) children.set(e.from, [...(children.get(e.from) ?? []), e.to]);
  const byRow = (a: string, b: string) => (order.get(a) ?? 0) - (order.get(b) ?? 0);
  for (const list of children.values()) list.sort(byRow);
  const roots = lineage.nodes.map((n) => n.id).filter((id) => !parent.has(id)).sort(byRow);
  return { roots, parent, children };
}

export function ancestors(tree: LineageTree, id: string): string[] {
  const out: string[] = [];
  for (let p = tree.parent.get(id); p; p = tree.parent.get(p)) out.unshift(p);
  return out;
}

export function descendants(tree: LineageTree, id: string): number {
  return (tree.children.get(id) ?? []).reduce((n, c) => n + 1 + descendants(tree, c), 0);
}

const isInvalid = (n: LineageNode) => n.role === "precheck_failed" || n.role === "unrun" || n.role === "masked";

export type FoldBar = {
  id: string; parentId: string | null; row: number; x: number;
  expanded: boolean; nodes: readonly LineageNode[]; rangeLabel: string; summary: string;
};

export type CompactedLineage = {
  widget: LineageWidget; foldBars: readonly FoldBar[]; hiddenCount: number; counts: { core: number; all: number };
};

function summarizeFold(nodes: readonly LineageNode[]): { rangeLabel: string; summary: string } {
  const first = nodes[0]!, last = nodes[nodes.length - 1]!;
  const lastRev = last.id.includes("@") ? `@${last.id.split("@")[1]}` : last.id;
  const rangeLabel = nodes.length === 1 ? first.id : `${first.id} … ${lastRev}`;
  let failed = 0, unrun = 0, masked = 0, below = 0;
  for (const n of nodes) {
    if (n.role === "precheck_failed") failed++;
    else if (n.role === "unrun") unrun++;
    else if (n.role === "masked") masked++;
    else below++;
  }
  const parts = [below && `${below} below target`, failed && `${failed} failed`, masked && `${masked} ineligible`, unrun && `${unrun} not run`].filter(Boolean);
  return { rangeLabel, summary: parts.join(" · ") };
}

/** The lineage with contiguous unpassed versions folded into bars ("core"), or whole ("all"). A version passes when
 *  the view model's status says it meets the targets or is recommended, or it is on the recommendation trail; the
 *  first valid version always shows. Shown versions keep their trial on the axis the other views share, and link to
 *  their nearest shown ancestor, or are roots when they have none. */
export function compactLineage(
  lineage: LineageWidget,
  mode: LineageMode = "core",
  selected: string | null = null,
  expanded: ReadonlySet<string> = new Set(),
): CompactedLineage {
  const rawParent = new Map(lineage.edges.map((e) => [e.to, e.from]));
  const trail = new Set(lineage.trail.map((tr) => tr.candidate));
  const sorted = [...lineage.nodes].sort((a, b) => a.row - b.row);
  const valid = new Set(sorted.filter((n) => !isInvalid(n)).map((n) => n.id));
  const firstValid = sorted.find((n) => !isInvalid(n))?.id;
  const passed = new Set<string>(firstValid ? [firstValid] : []);
  for (const n of sorted) if (n.status === "meets_targets" || n.status === "recommended" || n.role === "recommended" || trail.has(n.id)) passed.add(n.id);
  const core = passed.size >= 2 ? passed : valid.size > 0 ? valid : new Set(sorted.map((n) => n.id));

  type Segment = { kind: "node"; node: LineageNode } | { kind: "fold"; id: string; nodes: LineageNode[]; isOpen: boolean };
  const segments: Segment[] = [];
  let buf: LineageNode[] = [];
  const flush = () => {
    if (!buf.length) return;
    if (buf.length === 1 && !isInvalid(buf[0]!)) segments.push({ kind: "node", node: buf[0]! });
    else {
      const id = `fold:${buf[0]!.id}`;
      const isOpen = expanded.has(id) || buf.some((n) => expanded.has(n.id) || n.id === selected);
      segments.push({ kind: "fold", id, nodes: buf, isOpen });
    }
    buf = [];
  };
  for (const n of sorted) {
    if (core.has(n.id)) { flush(); segments.push({ kind: "node", node: n }); } else buf.push(n);
  }
  flush();

  const foldable = segments.reduce((sum, s) => sum + (s.kind === "fold" ? s.nodes.length : 0), 0);
  const counts = { core: lineage.nodes.length - foldable, all: lineage.nodes.length };
  if (mode === "all" || foldable === 0) return { widget: lineage, foldBars: [], hiddenCount: 0, counts };

  const kept = new Set<string>();
  for (const seg of segments) {
    if (seg.kind === "node") kept.add(seg.node.id);
    else if (seg.isOpen) for (const n of seg.nodes) kept.add(n.id);
  }
  const nearestKept = (id: string): string | undefined => {
    for (let p = rawParent.get(id); p; p = rawParent.get(p)) if (kept.has(p)) return p;
    return undefined;
  };

  const nodes: LineageNode[] = [], rows: { id: string; row: number }[] = [], foldBars: FoldBar[] = [];
  const xById = new Map<string, number>();
  let row = 0, lastX = 1;
  const place = (n: LineageNode) => {
    if (n.x != null) { lastX = n.x; xById.set(n.id, n.x); }
    nodes.push({ ...n, row });
    rows.push({ id: n.id, row: row++ });
  };
  for (const seg of segments) {
    if (seg.kind === "node") { place(seg.node); continue; }
    const parentId = nearestKept(seg.nodes[0]!.id) ?? null;
    const parentX = (parentId ? xById.get(parentId) : undefined) ?? lastX;
    foldBars.push({ id: seg.id, parentId, row, x: parentX + 0.35, expanded: seg.isOpen, nodes: seg.nodes, ...summarizeFold(seg.nodes) });
    rows.push({ id: seg.id, row: row++ });
    if (seg.isOpen) for (const n of seg.nodes) place(n);
  }

  const edges = nodes.flatMap((n) => { const from = nearestKept(n.id); return from ? [{ from, to: n.id }] : []; });
  const revisions = lineage.revisions.filter((r) => kept.has(r.from) && kept.has(r.to));
  return { widget: { ...lineage, rows, nodes, edges, revisions }, foldBars, hiddenCount: lineage.nodes.length - kept.size, counts };
}
