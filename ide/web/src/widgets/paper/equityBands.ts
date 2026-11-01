// The equity chart's two bands, behind the line as vibe-trading's: at the top how far equity is below its
// running peak, hanging from the pane's top as a fine dot matrix (scaled so the band's foot is the deeper
// of the run's worst drawdown and 1%, which a short run's small dip never makes look like a crash); at the bottom each day's return as a slim bar on a baseline, the picked or hovered day
// stronger, while three days or more are in view. Both drawn in device pixels with snapped edges, from
// the visible points thinned to each pixel column's first, lowest, highest and last (frameOf).
import type { IChartApi, IPrimitivePaneRenderer, Logical } from "lightweight-charts";
import type { EquityLook, EquityPoint } from "./equityLayers";

export type Frame = { c: CanvasRenderingContext2D; hr: number; vr: number; w: number; h: number; keep: number[]; xs: Map<number, number>; x: (t: number) => number };
export type DayBar = { from: number; ret: number };
type Scope = Parameters<Parameters<Parameters<IPrimitivePaneRenderer["draw"]>[0]["useBitmapCoordinateSpace"]>[0]>[0];

export const DAY_S = 86_400;
export const CEILING = 0.2, BARS = 0.12;   // the drawdown band and the tallest day's bar, as shares of the pane's height
export const FEW = 2 * DAY_S;              // a run shorter than two days has no day bars
const PITCH = 3, DOT = 1;                  // px: the drawdown dots' pitch (both ways) and size
const FEWEST_DAYS = 3, DAY_PX = 3;         // day bars only while this many days are in view, each this wide (px)
const FLOOR = 0.01;                        // the band's foot is at least this deep a drawdown
const BAR_W = 0.3, BAR_MAX = 4;            // a day's bar, as a share of the day's width, and at most this wide (px): slim, as vibe-trading's
export const span = (a: number, b: number) => { const p = Math.round(a), q = Math.round(b); return { at: Math.min(p, q), len: Math.max(1, Math.abs(q - p)) }; };

/** The visible points of `chart`, one to four per pixel column, and where times fall (in device pixels). */
export function frameOf({ context: c, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize }: Scope, chart: IChartApi, points: readonly EquityPoint[]): Frame | null {
  const time = chart.timeScale(), range = time.getVisibleLogicalRange();
  if (points.length < 2 || !range) return null;
  const at = (i: number) => (time.logicalToCoordinate(i as Logical) ?? Number.NaN) * hr;
  const from = Math.max(0, Math.floor(range.from) - 1), to = Math.min(points.length - 1, Math.ceil(range.to) + 1);
  const xs = new Map<number, number>(), keep: number[] = [];
  let column = Number.NaN, bucket: number[] = [];
  const flush = () => {
    if (!bucket.length) return;
    let lo = bucket[0]!, hi = bucket[0]!;
    for (const i of bucket) { if (points[i]!.value < points[lo]!.value) lo = i; if (points[i]!.value > points[hi]!.value) hi = i; }
    keep.push(...[...new Set([bucket[0]!, lo, hi, bucket.at(-1)!])].sort((a, b) => a - b));
    bucket = [];
  };
  for (let i = from; i <= to; i++) {
    const x = at(i), col = Math.round(x);
    xs.set(i, x);
    if (col !== column) { flush(); column = col; }
    bucket.push(i);
  }
  flush();
  // A time's x between the points either side of it, so day edges need not fall on a point.
  const x = (t: number) => {
    let lo = 0, hi = points.length - 1;
    if (t <= points[lo]!.time) return at(lo);
    if (t >= points[hi]!.time) return at(hi);
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (points[mid]!.time <= t) lo = mid; else hi = mid; }
    return at(lo) + ((t - points[lo]!.time) / (points[hi]!.time - points[lo]!.time)) * (at(hi) - at(lo));
  };
  return { c, hr, vr, w: bitmapSize.width, h: bitmapSize.height, keep, xs, x };
}

/** A dot matrix, as vibe-trading's: each column of dots (PITCH apart, counted from the pane's left so a
 *  dot keeps its place as the view moves) reaches down from `top` (px) as far as the deepest drawdown
 *  under it, scaled to the band, one row for any drawdown at all; a point holds until the next. Filled
 *  once with a pattern of one dot a cell. */
export function drawdownRows({ c, hr, vr, w, h, keep, xs }: Frame, points: readonly EquityPoint[], worst: number, look: EquityLook, top = 0): void {
  if (!(worst > 0) || keep.length < 2) return;
  const px = Math.max(2, Math.round(PITCH * hr)), py = Math.max(2, Math.round(PITCH * vr)), band = h * CEILING, scale = Math.max(worst, FLOOR), y0 = Math.ceil((top * vr) / py) * py;
  const cols = Math.ceil(w / px), depth = new Float32Array(cols);
  keep.forEach((i, k) => {
    const d = ((1 - points[i]!.value / points[i]!.peak) / scale) * band, x0 = xs.get(i)!, next = keep[k + 1];
    if (!(d > 0)) return;
    const last = Math.min(cols - 1, Math.floor(((next === undefined ? x0 + px : xs.get(next)!) - 1) / px));
    for (let col = Math.max(0, Math.floor(x0 / px)); col <= last; col++) depth[col] = Math.max(depth[col]!, d);
  });
  const area = new Path2D();
  depth.forEach((d, col) => { if (d > 0) area.rect(col * px, y0, px, Math.ceil(d / py) * py); });
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

/** A day's bar sits mid-way across the part of the day the run covers, its width from a whole day's
 *  across the stretch the days are of (`first` to `last`, s). */
export function dayBars({ c, hr, vr, w: width, h, x }: Frame, [first, last]: readonly [number, number], days: readonly DayBar[], strong: (from: number) => boolean, look: EquityLook): void {
  const most = Math.max(...days.map((d) => Math.abs(d.ret)));
  if (!(most > 0) || !(last > first)) return;
  const dayPx = ((x(last) - x(first)) / (last - first)) * DAY_S;
  if (width / dayPx < FEWEST_DAYS || dayPx < DAY_PX * hr) return;
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
