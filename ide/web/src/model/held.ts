// Where a run held a position and which way, as one timeline: the equity chart's track of sides
// (equityBands.ts), one a contract (its lanes), its held stretches, and a paper run's time in market.
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

/** A contract's position: its symbol, from, to (ms or s, as its source) and whether long. */
export type Holding = readonly [string, number, number, boolean];
/** A contract's lane on the equity chart: its symbol and where it held a position, which way (sidesHeld of
 *  its own positions, so a hedge inside one contract still reads as both at once). */
export type Lane = { symbol: string; held: Leaning[] };

/** One lane a contract, by symbol. */
export const lanesOf = (found: readonly Holding[]): Lane[] => [...new Set(found.map(([s]) => s))].sort()
  .map((symbol) => ({ symbol, held: sidesHeld(found.flatMap(([s, x, y, long]) => (s === symbol ? [[x, y, long] as const] : []))) }));

/** Every contract's positions between `start` and `end` (ms), an open one running to `end`. */
export function holdings(found: readonly Fill[], start: number, end: number, restarts: readonly Restart[] = []): Holding[] {
  return [...new Set(found.map((f) => f.symbol))].flatMap((s) => spans(found, s, restarts).map(([from, to, long]) => [s, Math.max(from, start), Math.min(to ?? end, end), long] as const));
}

/** Where any contract held a position between `start` and `end` (ms), and which way: every contract's
 *  positions as one timeline (sidesHeld). */
export const heldSides = (found: readonly Fill[], start: number, end: number, restarts: readonly Restart[] = []): Leaning[] =>
  sidesHeld(holdings(found, start, end, restarts).map(([, x, y, long]) => [x, y, long] as const));

/** A stretch (ms or s, as its source) and how many contracts held a position long and short over it. */
export type Breadth = [number, number, number, number];

/** How many of the lanes' contracts held long and short at once, oldest first, a stretch a change of count;
 *  a contract holding both at once counts each way. Where none held, no stretch. */
export function breadthOf(lanes: readonly Lane[]): Breadth[] {
  const edges = lanes.flatMap((l) => l.held.flatMap(([x, y, long]) => [[x, long, 1], [y, long, -1]] as const)).sort((p, q) => p[0] - q[0]);
  const out: Breadth[] = [];
  let longs = 0, shorts = 0, open: Breadth | null = null;
  for (let i = 0; i < edges.length;) {
    const t = edges[i]![0];
    for (; i < edges.length && edges[i]![0] === t; i++) { const [, long, d] = edges[i]!; if (long !== false) longs += d; if (long !== true) shorts += d; }
    if (open && open[2] === longs && open[3] === shorts) continue;
    if (open) open[1] = t;
    open = longs || shorts ? [t, t, longs, shorts] : null;
    if (open) out.push(open);
  }
  return out;
}
