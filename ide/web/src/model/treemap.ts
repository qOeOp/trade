// One level of the heatmap as tiles, laid out as vibe-trading does: D3's squarify with ratio 1 on a frame
// stretched 1.35 times in height and pressed back, so tiles lean wide and take lines of text, 2 px apart
// inside a 2 px frame. Areas follow the size metric to EXPONENT (market.ts), and no tile takes more than
// MAX_SHARE of a level, so a level one coin dominates still leaves its neighbours room.
import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";
import { EXPONENT, type Node } from "./market";
import { BORDER, type Tile } from "./ripple/split";

const STRETCH = 1.35, GAP = 2;
export const MAX_SHARE = 0.45;

/** Each node's area weight: compressed, the largest capped at MAX_SHARE of the level. */
export function weights(nodes: readonly Node[]): number[] {
  const w = nodes.map((n) => Math.pow(Math.max(n.size, 0) + 1, EXPONENT));
  const top = Math.max(...w), rest = w.reduce((a, b) => a + b, 0) - top;
  return rest > 0 ? w.map((x) => (x === top ? Math.min(x, (rest * MAX_SHARE) / (1 - MAX_SHARE)) : x)) : w;
}

/** The level's tiles, largest first, "+N more" and Other always last. */
export function layout(nodes: readonly Node[], width: number, height: number): Tile<Node>[] {
  if (!nodes.length || width <= 2 * BORDER || height <= 2 * BORDER) return [];
  const last = (n?: Node) => !!n && (n.kind === "more" || n.name === "Other");
  const w = weights(nodes);
  const root = hierarchy<{ node?: Node; weight?: number; children?: unknown[] }>({ children: nodes.map((node, i) => ({ node, weight: w[i] })) })
    .sum((d) => d.weight ?? 0)
    .sort((a, b) => (last(a.data.node) ? 1 : 0) - (last(b.data.node) ? 1 : 0) || (b.value ?? 0) - (a.value ?? 0));
  treemap<{ node?: Node }>().size([width - 2 * BORDER, (height - 2 * BORDER) * STRETCH]).padding(GAP).tile(treemapSquarify.ratio(1))(root);
  return (root.children ?? []).map((d) => {
    const r = d as typeof d & { x0: number; x1: number; y0: number; y1: number };
    return { data: d.data.node!, x: r.x0 + BORDER, y: r.y0 / STRETCH + BORDER, width: r.x1 - r.x0, height: (r.y1 - r.y0) / STRETCH };
  });
}
