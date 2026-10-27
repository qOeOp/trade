// How finely the equity chart draws the run: one point a minute while that leaves the points at least a
// pixel and a half apart across the span in view, else the finest coarser step that does (each step's point
// sits at the step's start, as a candle does, and is the account at its last minute, its peak the
// running peak to then, so the last is the account now). A short run fills the
// chart minute by minute; a long one, seen whole, is drawn by the hour or the day, and zooming in brings
// the minutes back, so the line never crowds into a thick scribble. A step changes only once the span
// has moved well past its threshold, so a zoom held near one does not flicker between two. The candle
// chart picks its period the same way, its candles a few pixels wide instead.
import type { EquityPoint } from "./equityLayers";

export const STEPS = [60, 300, 900, 1_800, 3_600, 7_200, 14_400, 43_200, 86_400] as const;  // s: 1m 5m 15m 30m 1h 2h 4h 12h 1d
const PX = 1.5;      // px: points no closer than this, dense enough that the line keeps its grain
const FINER = 0.8;   // a finer step is taken only once it fits this share of the points a screen holds

/** The step for `span` seconds in view across `width` px, given the step drawn now, each step at least
 *  `px` wide, from `steps`. */
export function stepFor(span: number, width: number, current: number, px = PX, steps: readonly number[] = STEPS): number {
  const most = Math.max(1, width / px), fits = (s: number, k: number) => span / s <= most * k;
  const finest = steps.find((s) => fits(s, 1)) ?? steps.at(-1)!;
  if (finest >= current) return finest;
  return Math.min(current, steps.find((s) => fits(s, FINER)) ?? current);
}

/** The run's minutes at `step`; `minute` is the minute each point's value is from. */
export function resample(minutes: readonly EquityPoint[], step: number): EquityPoint[] {
  if (step <= STEPS[0]) return minutes as EquityPoint[];
  const out: EquityPoint[] = [];
  minutes.forEach((p, i) => {
    const next = minutes[i + 1], start = Math.floor(p.time / step) * step;
    if (!next || Math.floor(next.time / step) * step !== start) out.push({ ...p, time: start, minute: p.time });
  });
  return out;
}
