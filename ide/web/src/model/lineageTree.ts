// The lineage as a tree: parents, children in row order, ancestors, and inline collapsible fold bars
// that group contiguous unpassed strategies into a sleek fold bar row. Pure; built once per view.
import type { LineageNode, LineageWidget, ProgressWidget, ScatterWidget } from "./types";

export type LineageMode = "core" | "valid" | "all";
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
  widget: LineageWidget; mode: LineageMode; foldBars: readonly FoldBar[]; hiddenCount: number;
  counts: { core: number; valid: number; all: number };
  foldedByParent: ReadonlyMap<string, string[]>; keptIds: ReadonlySet<string>; mapX: (x: number) => number;
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

export function compactLineage(
  lineage: LineageWidget,
  modeOrCompact: LineageMode | boolean = "core",
  selected: string | null = null,
  expanded: ReadonlySet<string> = new Set(),
): CompactedLineage {
  const requested: LineageMode = typeof modeOrCompact === "boolean" ? (modeOrCompact ? "core" : "all") : modeOrCompact;
  const rawParent = new Map(lineage.edges.map((e) => [e.to, e.from]));
  const byId = new Map(lineage.nodes.map((n) => [n.id, n]));
  const t = lineage.targets, trailSet = new Set(lineage.trail.map((tr) => tr.candidate));
  const meetsTargets = (n: LineageNode) =>
    !isInvalid(n) && n.reading?.annual_return != null && n.reading?.max_drawdown != null
    && (t?.annual_return == null || n.reading.annual_return >= t.annual_return)
    && (t?.max_drawdown == null || n.reading.max_drawdown <= t.max_drawdown);

  const sortedAll = [...lineage.nodes].sort((a, b) => a.row - b.row);
  const validIds = new Set(sortedAll.filter((n) => !isInvalid(n)).map((n) => n.id));
  const firstValidRoot = sortedAll.find((n) => !isInvalid(n))?.id;
  const passedIds = new Set<string>(firstValidRoot ? [firstValidRoot] : []);
  for (const n of sortedAll) if (meetsTargets(n) || trailSet.has(n.id) || n.role === "recommended") passedIds.add(n.id);

  const effectiveCore = passedIds.size >= 2 ? passedIds : validIds.size > 0 ? validIds : new Set(sortedAll.map((n) => n.id));
  const effectiveValid = validIds.size > 0 ? validIds : new Set(sortedAll.map((n) => n.id));

  type Segment = { kind: "node"; node: LineageNode } | { kind: "fold"; id: string; nodes: LineageNode[]; isOpen: boolean };
  const segments: Segment[] = [];
  let buf: LineageNode[] = [];
  const flush = () => {
    if (!buf.length) return;
    if (buf.length === 1 && !isInvalid(buf[0]!)) {
      segments.push({ kind: "node", node: buf[0]! });
      buf = [];
      return;
    }
    const id = `fold:${buf[0]!.id}`;
    const isOpen = requested === "all" || expanded.has(id) || buf.some((n) => expanded.has(n.id) || n.id === selected);
    segments.push({ kind: "fold", id, nodes: buf, isOpen });
    buf = [];
  };
  for (const n of sortedAll) {
    if (n.id === firstValidRoot) {
      segments.push({ kind: "node", node: n });
    } else if (effectiveCore.has(n.id)) {
      flush();
      segments.push({ kind: "node", node: n });
    } else {
      buf.push(n);
    }
  }
  flush();

  const foldableCount = segments.reduce((sum, s) => sum + (s.kind === "fold" ? s.nodes.length : 0), 0);
  const counts = { core: lineage.nodes.length - foldableCount, valid: effectiveValid.size, all: lineage.nodes.length };

  const kept = new Set<string>();
  for (const seg of segments) {
    if (seg.kind === "node") kept.add(seg.node.id);
    else if (seg.isOpen) for (const n of seg.nodes) kept.add(n.id);
  }
  const hiddenNodes = sortedAll.filter((n) => !kept.has(n.id));
  const hiddenCount = hiddenNodes.length < lineage.nodes.length ? hiddenNodes.length : 0;
  if (requested === "all" || hiddenCount === 0 && segments.every((s) => s.kind === "node")) {
    return { widget: lineage, mode: requested, foldBars: [], hiddenCount: 0, counts, foldedByParent: new Map(), keptIds: new Set(sortedAll.map((n) => n.id)), mapX: (x) => x };
  }

  const nearestKept = (id: string): string | undefined => {
    for (let p = rawParent.get(id); p; p = rawParent.get(p)) if (kept.has(p)) return p;
    return firstValidRoot && kept.has(firstValidRoot) && id !== firstValidRoot ? firstValidRoot : undefined;
  };
  const foldedByParent = new Map<string, string[]>();
  for (const n of hiddenNodes) { const anc = nearestKept(n.id); if (anc) foldedByParent.set(anc, [...(foldedByParent.get(anc) ?? []), n.id]); }

  const keptNodes = sortedAll.filter((n) => kept.has(n.id));
  const nodeAnchors = new Set(keptNodes.flatMap((n) => (n.x == null ? [] : [Math.floor(n.x)])));
  const keptTrials = lineage.trials.filter((tr) => (tr.purpose !== "precheck" && kept.has(tr.candidate)) || nodeAnchors.has(tr.x));
  const uniqueX = [...new Set(keptTrials.map((tr) => tr.x))].sort((a, b) => a - b);
  const xMap = new Map(uniqueX.map((x, i) => [x, i + 1]));
  const mapX = (oldX: number): number => {
    if (!uniqueX.length) return oldX;
    const exact = xMap.get(oldX);
    if (exact !== undefined) return exact;
    if (oldX < uniqueX[0]!) return 1;
    for (let i = 0; i < uniqueX.length - 1; i++) if (oldX > uniqueX[i]! && oldX < uniqueX[i + 1]!) return i + 1.5;
    return uniqueX.length + 0.5;
  };

  const nodes: LineageNode[] = [], rows: { id: string; row: number }[] = [], foldBars: FoldBar[] = [];
  const keptXById = new Map<string, number>();
  let currentRow = 0, lastKeptX = 1;
  for (const seg of segments) {
    if (seg.kind === "node") {
      const mx = seg.node.x == null ? null : mapX(seg.node.x);
      if (mx != null) { lastKeptX = mx; keptXById.set(seg.node.id, mx); }
      nodes.push({ ...seg.node, row: currentRow, x: mx });
      rows.push({ id: seg.node.id, row: currentRow++ });
    } else {
      const parentId = nearestKept(seg.nodes[0]!.id) ?? null;
      const parentX = (parentId ? keptXById.get(parentId) : undefined) ?? lastKeptX;
      foldBars.push({ id: seg.id, parentId, row: currentRow, x: parentX + 0.35, expanded: seg.isOpen, nodes: seg.nodes, ...summarizeFold(seg.nodes) });
      rows.push({ id: seg.id, row: currentRow++ });
      if (seg.isOpen) {
        for (const n of seg.nodes) {
          const mx = n.x == null ? lastKeptX + 0.5 : mapX(n.x);
          if (mx != null) { lastKeptX = mx; keptXById.set(n.id, mx); }
          nodes.push({ ...n, row: currentRow, x: mx });
          rows.push({ id: n.id, row: currentRow++ });
        }
      }
    }
  }

  const edges = nodes.flatMap((n) => { const from = nearestKept(n.id); return from && byId.has(from) ? [{ from, to: n.id }] : []; });
  const revisions = lineage.revisions.filter((r) => kept.has(r.from) && kept.has(r.to));
  const trials = keptTrials.map((tr) => ({ ...tr, x: mapX(tr.x) }));
  const decisions = lineage.decisions.map((d) => ({ ...d, x: mapX(d.x) }));
  const trail = lineage.trail.filter((tr) => kept.has(tr.candidate)).map((tr) => ({ ...tr, x0: tr.x0 == null ? null : mapX(tr.x0), judgments: tr.judgments.map((j) => (j == null ? null : mapX(j))) }));
  const axis = { ...lineage.axis, max: Math.max(1, uniqueX.length), scope_start: lineage.axis.scope_start == null ? null : mapX(lineage.axis.scope_start) };
  return { widget: { ...lineage, axis, rows, nodes, edges, revisions, trials, decisions, trail }, mode: requested, foldBars, hiddenCount, counts, foldedByParent, keptIds: kept, mapX };
}

export function compactProgress(progress: ProgressWidget, compacted: CompactedLineage): ProgressWidget {
  if (compacted.mode === "all" || compacted.hiddenCount === 0) return progress;
  const pts = progress.points.filter((p) => compacted.keptIds.has(p.id));
  const shown = pts.length > 0 ? pts : progress.points;
  return { ...progress, axis: { scope_start: progress.axis.scope_start == null ? null : compacted.mapX(progress.axis.scope_start) }, points: shown.map((p) => ({ ...p, x: compacted.mapX(p.x) })) };
}

export function compactScatter(scatter: ScatterWidget, compacted: CompactedLineage): ScatterWidget {
  if (compacted.mode === "all" || compacted.hiddenCount === 0) return scatter;
  const pts = scatter.points.filter((p) => compacted.keptIds.has(p.id));
  return pts.length > 0 ? { ...scatter, points: pts } : scatter;
}
