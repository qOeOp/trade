// The equity chart's two bands, behind the line as vibe-trading's: at the top how far equity is below its
// running peak, hanging from the pane's top as a fine dot matrix (scaled so the band's foot is the deeper
// of the run's worst drawdown and 1%, which a short run's small dip never makes look like a crash); at the bottom each day's return as a slim bar on a baseline, the picked or hovered day
// stronger, while three days or more are in view. Both drawn in device pixels with snapped edges.
import type { EquityLook, EquityPoint } from "./equityLayers";

export type Frame = { c: CanvasRenderingContext2D; hr: number; vr: number; w: number; h: number; keep: number[]; xs: Map<number, number>; x: (t: number) => number };
export type DayBar = { from: number; ret: number };

export const DAY_S = 86_400;
export const CEILING = 0.3, BARS = 0.12;   // the drawdown band and the tallest day's bar, as shares of the pane's height
export const FEW = 2 * DAY_S;              // a run shorter than two days has no day bars
const PITCH = 3, DOT = 1;                  // px: the drawdown dots' pitch (both ways) and size
const FEWEST_DAYS = 3;                     // day bars only while this many days are in view
const FLOOR = 0.01;                        // the band's foot is at least this deep a drawdown
const BAR_W = 0.3, BAR_MAX = 4;            // a day's bar, as a share of the day's width, and at most this wide (px): slim, as vibe-trading's
export const span = (a: number, b: number) => { const p = Math.round(a), q = Math.round(b); return { at: Math.min(p, q), len: Math.max(1, Math.abs(q - p)) }; };

/** A dot matrix, as vibe-trading's: each column of dots (PITCH apart, counted from the pane's left so a
 *  dot keeps its place as the view moves) reaches down as far as the deepest drawdown under it, scaled to
 *  the band, one row for any drawdown at all; a point holds until the next. Filled once with a pattern of
 *  one dot a cell. */
export function drawdownRows({ c, hr, vr, w, h, keep, xs }: Frame, points: readonly EquityPoint[], worst: number, look: EquityLook): void {
  if (!(worst > 0) || keep.length < 2) return;
  const px = Math.max(2, Math.round(PITCH * hr)), py = Math.max(2, Math.round(PITCH * vr)), band = h * CEILING, scale = Math.max(worst, FLOOR);
  const cols = Math.ceil(w / px), depth = new Float32Array(cols);
  keep.forEach((i, k) => {
    const d = ((1 - points[i]!.value / points[i]!.peak) / scale) * band, x0 = xs.get(i)!, next = keep[k + 1];
    if (!(d > 0)) return;
    const last = Math.min(cols - 1, Math.floor(((next === undefined ? x0 + px : xs.get(next)!) - 1) / px));
    for (let col = Math.max(0, Math.floor(x0 / px)); col <= last; col++) depth[col] = Math.max(depth[col]!, d);
  });
  const area = new Path2D();
  depth.forEach((d, col) => { if (d > 0) area.rect(col * px, 0, px, Math.ceil(d / py) * py); });
  const fill = dots(c, px, py, Math.max(1, Math.round(DOT * hr)), look.ceiling);
  if (fill) { c.fillStyle = fill; c.fill(area); }
}

/** A pattern of one `dot` square at the top left of each `px` by `py` cell, kept per size and colour. */
const patterns = new Map<string, CanvasPattern | null>();
function dots(c: CanvasRenderingContext2D, px: number, py: number, dot: number, colour: string): CanvasPattern | null {
  const key = [px, py, dot, colour].join();
  if (!patterns.has(key)) {
    const cell = document.createElement("canvas"), g = cell.getContext("2d");
    Object.assign(cell, { width: px, height: py });
    if (g) { g.fillStyle = colour; g.fillRect(0, 0, dot, dot); }
    patterns.set(key, g && c.createPattern(cell, "repeat"));
  }
  return patterns.get(key)!;
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
