// Where a moment falls on the equity chart: its x between the points drawn either side of it, and the
// equity there, for the marks the chart's primitives put on its line.
import type { ITimeScaleApi, Logical, Time } from "lightweight-charts";
import type { EquityPoint } from "./equityLayers";

/** The pane x of time `t` (s), between the points either side of it. */
export function xAt(pts: readonly EquityPoint[], time: ITimeScaleApi<Time>, t: number): number | null {
  if (pts.length < 2 || t < pts[0]!.time) return null;
  let lo = 0, hi = pts.length - 1;
  const at = (i: number) => time.logicalToCoordinate(i as Logical) ?? Number.NaN;
  if (t >= pts[hi]!.time) return at(hi);
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid]!.time <= t) lo = mid; else hi = mid; }
  // Between the two points' own places: the chart takes whole indexes only.
  return at(lo) + ((t - pts[lo]!.time) / (pts[hi]!.time - pts[lo]!.time)) * (at(hi) - at(lo));
}

/** The highest and lowest the line is drawn (pane y, `y` of a value) between x0 and x1: the points between and
 *  the line where it crosses either edge. */
export function lineReach(pts: readonly EquityPoint[], time: ITimeScaleApi<Time>, y: (v: number) => number | null, x0: number, x1: number): [number, number] | null {
  const a = time.coordinateToLogical(x0), b = time.coordinateToLogical(x1), last = pts.length - 1;
  if (a === null || b === null || last < 0) return null;
  const at = (l: number) => { const c = Math.max(0, Math.min(last, l)), i = Math.min(Math.floor(c), Math.max(0, last - 1)), f = Math.min(1, c - i);
    return y(pts[i]!.value + (pts[Math.min(last, i + 1)]!.value - pts[i]!.value) * f); };
  const ys = [at(a), at(b)];
  for (let i = Math.max(0, Math.ceil(a)); i <= Math.min(last, Math.floor(b)); i++) ys.push(y(pts[i]!.value));
  const found = ys.filter((v): v is number => v !== null);
  return found.length ? [Math.min(...found), Math.max(...found)] : null;
}

/** The equity at time `t`: the point's at or before it. */
export function valueAt(pts: readonly EquityPoint[], t: number): number | null {
  let lo = 0, hi = pts.length - 1;
  if (!pts.length || t < pts[0]!.time) return null;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (pts[mid]!.time <= t) lo = mid; else hi = mid - 1; }
  return pts[lo]!.value;
}
