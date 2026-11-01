// How the Paper page's charts mark the time a chain of runs (model/chain.ts) was offline between two runs,
// a Docker or host restart. The stretch gets its own room on the time axis and nothing drawn from the
// series crosses it: it is covered the plot's height by a recessed wash between two hairlines, at least
// MIN px wide (around the true stretch on the equity chart, as blank candles on the candle chart), its length tagged on the time axis as the value axis tags a price
// ("Offline 45m"); under the pointer the chart says when the run stopped, when it started again and why.
import type { ISeriesPrimitiveAxisView } from "lightweight-charts";
import { clockSpan, duration } from "../../lib/format";
import type { Restart } from "../../model/paper";
import { stamp } from "./chartTheme";

export type DownLook = { wash: string; edge: string; text: string; tag: string };
/** An offline stretch on a chart: where it is drawn from and to (s, on the chart's own times), when the
 *  run stopped and the next started (s), and its tag. */
export type Down = { from: number; to: number; stopped: number; started: number; label: string };

export const MIN = 12;  // px: the least width a stretch is drawn

export const downsOf = (restarts: readonly Restart[]): Down[] =>
  restarts.map((r) => ({ from: r.from / 1000, to: r.to / 1000, stopped: r.from / 1000, started: r.to / 1000, label: `Offline ${duration(clockSpan(r.from, r.to))}` }));

/** What the pointer over a stretch is told: the stop, the restart and why. */
export const downRows = (d: Down) => [`Stopped ${stamp(d.stopped * 1000)}`, `Restarted ${stamp(d.started * 1000)}`, "Cause: Docker or host restart"];

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

/** A stretch's tag on the time axis at `x` (px), as the value axis tags a price. */
export const downTag = (x: number, d: Down, look: DownLook): ISeriesPrimitiveAxisView =>
  ({ coordinate: () => x, text: () => d.label, textColor: () => look.text, backColor: () => look.tag, tickVisible: () => false });
