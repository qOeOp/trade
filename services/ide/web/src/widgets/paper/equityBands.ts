// The equity chart's two bands, behind the line as vibe-trading's: at the top how far equity is below its
// running peak, hanging from the pane's top as a matrix of short dashes (scaled so the band's foot is
// the deeper of the run's worst drawdown and 2%, which a short run's small dip never makes look like a
// crash); at the bottom each day's return as a slim bar on a baseline, the picked or hovered day
// stronger, while three days or more are in view. Both drawn in device pixels with snapped edges.
import type { EquityLook, EquityPoint } from "./equityLayers";

export type Frame = { c: CanvasRenderingContext2D; hr: number; vr: number; w: number; h: number; keep: number[]; xs: Map<number, number>; x: (t: number) => number };
export type DayBar = { from: number; ret: number };

export const DAY_S = 86_400;
export const CEILING = 0.16, BARS = 0.12;  // the drawdown band and the tallest day's bar, as shares of the pane's height
export const FEW = 2 * DAY_S;              // a run shorter than two days has neither stripes nor day bars
const ROW = 4, ROW_THICK = 1;              // the drawdown dashes' row pitch and weight (px)
const CELL = 7, MAX_CELL = 24, DASH = 0.7; // a dash column's width bounds (px), and the dash's share of it
const FEWEST_DAYS = 3;                     // day bars only while this many days are in view
const FLOOR = 0.02;                        // the band's foot is at least this deep a drawdown
const BAR_W = 0.3, BAR_MAX = 4;            // a day's bar, as a share of the day's width, and at most this wide (px): slim, as vibe-trading's
export const span = (a: number, b: number) => { const p = Math.round(a), q = Math.round(b); return { at: Math.min(p, q), len: Math.max(1, Math.abs(q - p)) }; };

/** A matrix of short dashes, as vibe-trading's: the points in columns of a few each (one point a column
 *  once a point is CELL wide), counted from the run's first so a column keeps its points as the view
 *  moves; each column's dashes reach down as far as its deepest drawdown, scaled to the band. */
export function drawdownRows({ c, hr, vr, w, h, keep, xs }: Frame, points: readonly EquityPoint[], worst: number, look: EquityLook): void {
  if (!(worst > 0) || keep.length < 2) return;
  const scale = Math.max(worst, FLOOR), band = (h / vr) * CEILING, thick = Math.max(1, Math.round(ROW_THICK * vr));
  const first = keep[0]!, spacing = (xs.get(keep.at(-1)!)! - xs.get(first)!) / Math.max(1, keep.at(-1)! - first);
  const per = Math.max(1, Math.ceil((CELL * hr) / spacing)), dash = Math.max(hr, Math.round(Math.min(MAX_CELL * hr, per * spacing) * DASH));
  const depth = new Map<number, number>();
  for (const i of keep) { const g = Math.floor(i / per); depth.set(g, Math.max(depth.get(g) ?? 0, ((1 - points[i]!.value / points[i]!.peak) / scale) * band)); }
  c.fillStyle = look.ceiling;
  for (const [g, d] of depth) {
    const left = Math.round(xs.get(first)! + (g * per + (per - 1) / 2 - first) * spacing - dash / 2);
    if (left < 0 || left + dash > w) continue;
    for (let row = 0; row * ROW + ROW / 2 <= d; row++) c.fillRect(left, Math.round(row * ROW * vr), dash, thick);
  }
}

/** A day's bar sits mid-way across the part of the day the run covers, its width from a whole day's. */
export function dayBars({ c, hr, vr, w: width, h, x }: Frame, points: readonly EquityPoint[], days: readonly DayBar[], strong: (from: number) => boolean, look: EquityLook): void {
  const most = Math.max(...days.map((d) => Math.abs(d.ret)));
  if (!(most > 0)) return;
  const first = points[0]!.time, last = points.at(-1)!.time, dayPx = ((x(last) - x(first)) / (last - first)) * DAY_S;
  if (width / dayPx < FEWEST_DAYS) return;
  const w = Math.max(hr, Math.min(BAR_MAX * hr, dayPx * BAR_W)), r = Math.min(hr, w / 2), base = Math.max(1, Math.round(vr));
  c.fillStyle = look.grid;
  c.fillRect(0, h - base, width, base);
  for (const d of days) {
    const mid = (x(d.from) + x(d.from + DAY_S)) / 2, s = span(mid - w / 2, mid + w / 2);
    const tall = Math.max(1, Math.round((Math.abs(d.ret) / most) * BARS * h)), loud = strong(d.from);
    c.fillStyle = d.ret >= 0 ? (loud ? look.upStrong : look.up) : (loud ? look.downStrong : look.down);
    c.beginPath();
    c.roundRect(s.at, h - base - tall, s.len, tall, [r, r, 0, 0]);
    c.fill();
  }
}
