// How the Runs page's charts mark the time a chain of runs (model/chain.ts) was paused or offline between
// two runs (model/ending.ts), and the time between two chains of the paper stretch when no run ran
// (state/stretches.ts), from one's stop to the next one's start. The stretch gets its own room on the time axis and nothing drawn from the
// series crosses it: it is covered by a recessed wash between two hairlines (on the equity chart from under
// the stretches' names and the drawdown dots down, which run on over it), at least
// MIN px wide (around the true stretch on the equity chart, as blank candles on the candle chart), its length tagged on the time axis as the value axis tags a price
// ("Paused 3h", "Offline 45m", "No run 7d"); under the pointer the chart says what happened at the stop and when, and
// when the next run took over.
import type { ISeriesPrimitiveAxisView } from "lightweight-charts";
import { brief, clockSpan } from "../../lib/format";
import type { Restart } from "../../model/paper";
import { stamp } from "./chartTheme";

export type DownLook = { wash: string; edge: string; text: string; tag: string };
/** An offline stretch on a chart: where it is drawn from and to (s, on the chart's own times), when the
 *  run stopped and the next started (s), and its tag. */
export type Down = { from: number; to: number; stopped: number; started: number; label: string; lead: string; resumed: string };

export const MIN = 12;  // px: the least width a stretch is drawn
const GAP = { paused: "Paused", offline: "Offline", idle: "No run" } as const;

export const downsOf = (restarts: readonly Restart[]): Down[] =>
  restarts.map((r) => ({ from: r.from / 1000, to: r.to / 1000, stopped: r.from / 1000, started: r.to / 1000,
                         label: `${GAP[r.gap]} ${brief(clockSpan(r.from, r.to))}`, lead: r.lead, resumed: r.resumed }));

/** What the pointer over a stretch is told after its tag: what happened at the stop and when, and when the
 *  next run took over: (Paused 3h ·) by you 31 Oct, 04:20 · continued 31 Oct, 07:20. */
export const downRows = (d: Down) => [`${d.lead} ${stamp(d.stopped * 1000)} · ${d.resumed} ${stamp(d.started * 1000)}`];

/** The times (s) a stretch takes on a chart whose points are `step` seconds apart: one a step after the
 *  last point (`times`, oldest first) at or before its stop up to the first point after its start; and
 *  where that gives fewer than `least`, `least` spread evenly between the two points. */
export function downSlots(times: readonly number[], downs: readonly Down[], step: number, least = 0): number[] {
  return downs.flatMap((d) => {
    const before = times.filter((t) => t <= d.from).at(-1), after = times.find((t) => t >= d.to && t > (before ?? -Infinity));
    if (before === undefined || after === undefined) return [];
    const out: number[] = [];
    for (let t = before + step; t < after; t += step) out.push(t);
    return out.length >= least ? out : Array.from({ length: least }, (_, j) => before + Math.round(((after - before) * (j + 1)) / (least + 1)));
  });
}

/** From `l` to `r` (px) widened about its middle to at least MIN px at `ratio` px a CSS px. */
export function widened(l: number, r: number, ratio = 1): [number, number] {
  const least = MIN * ratio, mid = (l + r) / 2;
  return r - l >= least ? [l, r] : [mid - least / 2, mid + least / 2];
}

/** One stretch from `l` to `r` (device px, widened already) over the plot from `top`, `h` tall: the wash
 *  and its two hairlines. */
export function drawDown(c: CanvasRenderingContext2D, l: number, r: number, top: number, h: number, look: DownLook, hr: number): void {
  const line = Math.max(1, Math.floor(hr)), a = Math.round(l), b = Math.round(r);
  c.fillStyle = look.wash; c.fillRect(a, top, b - a, h);
  c.fillStyle = look.edge; c.fillRect(a, top, line, h); c.fillRect(b - line, top, line, h);
}

/** The stretches drawn from `a` to `b` (px) whose tag, at the middle, falls on a time axis `width` px wide:
 *  the chart would pin one off it to its edge. */
export const tagged = (placed: readonly [Down, number, number][], width: number) =>
  placed.flatMap(([d, a, b]) => ((a + b) / 2 >= 0 && (a + b) / 2 <= width ? [{ d, x: (a + b) / 2 }] : []));

/** A stretch's tag on the time axis at `x` (px), as the value axis tags a price. */
export const downTag = (x: number, d: Down, look: DownLook): ISeriesPrimitiveAxisView =>
  ({ coordinate: () => x, text: () => d.label, textColor: () => look.text, backColor: () => look.tag, tickVisible: () => false });
