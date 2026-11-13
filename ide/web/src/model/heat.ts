// The heatmap's colour scale: seven steps from down through grey to up. The grey middle is narrow and each
// side has three steps whose edges suit the metric: a price change in percent, wider the longer its
// window; a funding rate (a fraction per period) around Binance's usual 0.01%; or the open interest's
// 24h change in percent.
import type { Color } from "./market";

export type Step = -3 | -2 | -1 | 0 | 1 | 2 | 3;
type Edges = readonly [number, number, number];
const EDGES: Record<Color, Edges> = {
  change1h: [0.02, 0.2, 0.5],
  change4h: [0.05, 0.4, 1],
  change24h: [0.1, 1, 2.5],
  change7d: [0.3, 2.5, 7],
  funding: [0.0001, 0.0003, 0.001],
  oiChange24h: [1, 5, 15],
};

/** The step of a value against `edges`: 0 inside the first (`inclusive`: at it too), then ±1, ±2, ±3. */
export function stepOf(value: number | null | undefined, [a, b, c]: Edges, inclusive = false): Step | null {
  if (value == null) return null;
  const size = Math.abs(value), k = (inclusive ? size <= a : size < a) ? 0 : size < b ? 1 : size < c ? 2 : 3;
  return (value < 0 && k ? -k : k) as Step;
}
/** The step of a metric's value, inclusive of funding's usual rate. */
export const step = (value: number | null, color: Color) => stepOf(value, EDGES[color], color === "funding");

/** Each step's range against `edges`, from −3 to +3, as its legend swatch names it, each edge as `show` writes it. */
export function rangesOf(edges: Edges, show: (v: number) => string): string[] {
  const [a, b, c] = edges.map(show);
  return [`below −${c}`, `−${c} to −${b}`, `−${b} to −${a}`, `−${a} to +${a}`, `+${a} to +${b}`, `+${b} to +${c}`, `above +${c}`];
}
/** A metric's ranges, in percent for every metric. */
export const ranges = (color: Color) => rangesOf(EDGES[color], (v) => `${color === "funding" ? +(v * 100).toFixed(3) : v}%`);

/** A step's tile colour role. */
export const fillRole = (k: Step | null) =>
  k === null || k === 0 ? "heat-0" : (`heat-${k > 0 ? "up" : "down"}-${Math.abs(k)}` as `heat-${"up" | "down"}-${1 | 2 | 3}`);

/** A step's ink, badge and badge edge roles: the text colour on the grey, white on the rest, except light mode's
 *  first steps, which keep the text colour (tokens.css decides by theme). */
export const inkRoles = (k: Step | null) => {
  const n = k === null ? 0 : Math.min(Math.abs(k), 2);
  return n === 0 ? (["heat-ink-0", "heat-badge-0", "heat-badge-edge-0"] as const) : n === 1 ? (["heat-ink-1", "heat-badge-1", "heat-badge-edge-1"] as const)
    : (["heat-ink", "heat-badge", "heat-badge-edge"] as const);
};
