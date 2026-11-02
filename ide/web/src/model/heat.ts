// The heatmap's colour scale: seven steps from down through grey to up. The grey middle is narrow and each
// side has three steps whose edges suit the metric: a price change in percent, wider the longer its
// window; a funding rate (a fraction per period) around Binance's usual 0.01%; or the open interest's
// 24h change in percent.
import type { Color } from "./market";

export type Step = -3 | -2 | -1 | 0 | 1 | 2 | 3;
const EDGES: Record<Color, readonly [number, number, number]> = {
  change1h: [0.02, 0.2, 0.5],
  change4h: [0.05, 0.4, 1],
  change24h: [0.1, 1, 2.5],
  change7d: [0.3, 2.5, 7],
  funding: [0.0001, 0.0003, 0.001],
  oiChange24h: [1, 5, 15],
};

/** The step of a value: 0 inside the first edge (inclusive for funding's usual rate), then ±1, ±2, ±3. */
export function step(value: number | null, color: Color): Step | null {
  if (value === null) return null;
  const [a, b, c] = EDGES[color], size = Math.abs(value);
  const inner = color === "funding" ? size <= a : size < a;
  const k = inner ? 0 : size < b ? 1 : size < c ? 2 : 3;
  return (value < 0 && k ? -k : k) as Step;
}

const show = (color: Color, v: number) => `${color === "funding" ? +(v * 100).toFixed(3) : v}%`;

/** Each step's range, from −3 to +3, as its legend swatch names it (percent for every metric). */
export function ranges(color: Color): string[] {
  const [a, b, c] = EDGES[color].map((v) => show(color, v));
  return [`below −${c}`, `−${c} to −${b}`, `−${b} to −${a}`, `−${a} to +${a}`, `+${a} to +${b}`, `+${b} to +${c}`, `above +${c}`];
}

/** A step's tile colour role. */
export const fillRole = (k: Step | null) =>
  k === null || k === 0 ? "heat-0" : (`heat-${k > 0 ? "up" : "down"}-${Math.abs(k)}` as `heat-${"up" | "down"}-${1 | 2 | 3}`);

/** A step's ink and badge roles: the text colour on the grey, white on the rest, except light mode's
 *  first steps, which keep the text colour (tokens.css decides by theme). */
export const inkRoles = (k: Step | null) => {
  const n = k === null ? 0 : Math.min(Math.abs(k), 2);
  return n === 0 ? (["heat-ink-0", "heat-badge-0"] as const) : n === 1 ? (["heat-ink-1", "heat-badge-1"] as const) : (["heat-ink", "heat-badge"] as const);
};
