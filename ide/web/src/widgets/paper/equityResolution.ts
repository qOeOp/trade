// How finely the equity chart draws the run: one point a minute while that leaves the points at least a
// pixel and a half apart across the span in view, else the finest coarser step that does (each step's point
// sits at the step's start, as a candle does, and is the account at its last minute, its peak the
// running peak to then, so the last is the account now). A short run fills the
// chart minute by minute; a long one, seen whole, is drawn by the hour or the day, and zooming in brings
// the minutes back, so the line never crowds into a thick scribble. A step changes only once the span
// has moved well past its threshold, so a zoom held near one does not flicker between two. The candle
// chart picks its period the same way, its candles a few pixels wide instead.
import type { Restart } from "../../model/paper";
import { downsOf, downSlots } from "./downLook";
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

/** The run's minutes at `step`; `minute` is the minute each point's value is from. A step that ends in a
 *  chain's offline stretch (withDowns) takes its last minute before it, so the run before the restart is drawn
 *  to its end. */
export function resample(minutes: readonly EquityPoint[], step: number): EquityPoint[] {
  if (step <= STEPS[0]) return minutes as EquityPoint[];
  const out: EquityPoint[] = [];
  let up: EquityPoint | null = null;  // the step's last minute not down
  minutes.forEach((p, i) => {
    const next = minutes[i + 1], start = Math.floor(p.time / step) * step;
    if (!p.down) up = p;
    if (next && Math.floor(next.time / step) * step === start) return;
    const shown: EquityPoint = p.down && up ? up : p;
    out.push({ ...shown, time: start, minute: shown.time });
    up = null;
  });
  return out;
}

const YEAR_S = 365 * 86_400;

/** Each minute of `path` ([ns, equity]) as a point: its running peak from `starting` and the pace a minimum
 *  `annual` return asks for, compounding from `start` (ms; else the first minute); one point a second. */
export function equityMinutes(path: readonly (readonly [number, number])[], starting: number, start: number | null, annual: number | null): EquityPoint[] {
  let peak = starting;
  const t0 = start === null ? Math.floor((path[0]?.[0] ?? 0) / 1e9) : start / 1000;
  return path.map(([ns, value]) => {
    peak = Math.max(peak, value);
    const time = Math.floor(ns / 1e9);
    return { time, value, peak, pace: annual === null ? null : starting * (1 + annual) ** ((time - t0) / YEAR_S) };
  }).filter((p, i, all) => i === all.length - 1 || all[i + 1]!.time > p.time);
}

/** `minutes` with a point a minute across each stretch a chain was offline between its runs (downLook.ts),
 *  marked `down`, holding the equity before it. */
export function withDowns(minutes: readonly EquityPoint[], restarts: readonly Restart[]): EquityPoint[] {
  const slots = restarts.length ? downSlots(minutes.map((p) => p.time), downsOf(restarts), 60) : [];
  if (!slots.length) return minutes as EquityPoint[];
  const out: EquityPoint[] = [];
  let k = 0;
  for (const p of minutes) {
    for (const prev = out.at(-1); k < slots.length && slots[k]! < p.time; k++) if (prev) out.push({ ...prev, time: slots[k]!, minute: undefined, down: true });
    out.push(p);
  }
  return out;
}
