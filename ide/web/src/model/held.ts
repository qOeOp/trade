// Where a run held a position and which way, as one timeline: the equity chart's track of sides
// (equityBands.ts), its held stretches, and a paper run's time in market.
import { spans, type Fill, type Restart } from "./paper";

/** A stretch a position was held (ms or s, as its source): from, to, and which way, long (true), short
 *  (false) or both at once (null: one contract long while another is short). */
export type Leaning = [number, number, boolean | null];

/** Spans of either side ([from, to, long]) as one timeline, oldest first: where any was held, overlapping
 *  ones joined, split where the side held changes, so two held at once count once. */
export function sidesHeld(spans: readonly (readonly [number, number, boolean])[]): Leaning[] {
  const edges = spans.filter(([x, y]) => y > x).flatMap(([x, y, long]) => [[x, long, 1], [y, long, -1]] as const).sort((p, q) => p[0] - q[0]);
  const out: Leaning[] = [];
  let longs = 0, shorts = 0, open: Leaning | null = null;
  for (let i = 0; i < edges.length;) {
    const t = edges[i]![0];
    for (; i < edges.length && edges[i]![0] === t; i++) { const [, long, d] = edges[i]!; if (long) longs += d; else shorts += d; }
    const side = longs && shorts ? null : longs ? true : shorts ? false : undefined;
    if (open && open[2] === side) continue;
    if (open) open[1] = t;
    open = side === undefined ? null : [t, t, side];
    if (open) out.push(open);
  }
  return out;
}

/** Where any contract held a position between `start` and `end` (ms), and which way: every contract's
 *  spans (an open one running to `end`) as one timeline (sidesHeld). */
export function heldSides(found: readonly Fill[], start: number, end: number, restarts: readonly Restart[] = []): Leaning[] {
  return sidesHeld([...new Set(found.map((f) => f.symbol))].flatMap((s) => spans(found, s, restarts).map(([from, to, long]) => [Math.max(from, start), Math.min(to ?? end, end), long] as const)));
}
