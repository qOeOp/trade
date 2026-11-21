// The equity chart's bands, behind the line as vibe-trading's: at the top which way the run held a position, as
// a track (sideTrack), and the drawdown an entry at each moment would take, from equity then to the lowest it
// reaches later in its stretch, hanging under it as a fine dot matrix (scaled so the band's foot is the deeper
// of the run's worst drawdown, the deepest any entry takes, and 1%, which a short run's small dip never makes look like a crash); at the bottom each day's return as a slim bar on a baseline, the picked or hovered day
// stronger, while three days or more are in view. All drawn in device pixels with snapped edges, from
// the visible points thinned to each pixel column's first, lowest, highest and last (frameOf).
import type { IChartApi, IPrimitivePaneRenderer, Logical, LogicalRange } from "lightweight-charts";
import { DAY_S } from "../../lib/time";
import type { Leaning } from "../../model/held";
import type { EquityLook, EquityPoint } from "./equityLayers";
import { perColumn, xAt } from "./equityPlace";

export type Frame = { c: CanvasRenderingContext2D; hr: number; vr: number; w: number; h: number; keep: number[]; xs: Map<number, number>; x: (t: number) => number };
export type DayBar = { from: number; ret: number };
type Scope = Parameters<Parameters<Parameters<IPrimitivePaneRenderer["draw"]>[0]["useBitmapCoordinateSpace"]>[0]>[0];

export const CEILING = 0.12;  // the drawdown band, as a share of the pane's height
const BARS = 0.08;       // the tallest day's bar, as a share of the pane's height
export const FEW = 2 * DAY_S;              // a run shorter than two days has no day bars
const PITCH = 3, DOT = 1, FLOOR = 0.01;    // px: the drawdown dots' pitch and size; the band's least drawdown
const FEWEST_DAYS = 3, DAY_PX = 3;         // day bars only while this many days are in view, each this wide (px)
const BAR_W = 0.3, BAR_MAX = 4;            // a day's bar, as a share of the day's width, and at most this wide (px): slim, as vibe-trading's
const TRACK_UP = 7, TRACK_H = 3;           // px: the side track's top above the drawdown dots' first row, and its bars' height
export const span = (a: number, b: number) => { const p = Math.round(a), q = Math.round(b); return { at: Math.min(p, q), len: Math.max(1, Math.abs(q - p)) }; };

/** The visible points of `chart`, one to four per pixel column, and where times fall (in device pixels). */
export function frameOf({ context: c, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize }: Scope, chart: IChartApi, points: readonly EquityPoint[]): Frame | null {
  const time = chart.timeScale(), range = time.getVisibleLogicalRange();
  if (points.length < 2 || !range) return null;
  const at = (i: number) => (time.logicalToCoordinate(i as Logical) ?? Number.NaN) * hr;
  const from = Math.max(0, Math.floor(range.from) - 1), to = Math.min(points.length - 1, Math.ceil(range.to) + 1), xs = new Map<number, number>();
  for (let i = from; i <= to; i++) xs.set(i, at(i));
  const keep = perColumn(from, to, (i) => xs.get(i)!, (i) => points[i]!.value);
  // A time's x between the points either side of it, so day edges need not fall on a point.
  const x = (t: number) => (xAt(points, time, Math.max(t, points[0]!.time)) ?? Number.NaN) * hr;
  return { c, hr, vr, w: bitmapSize.width, h: bitmapSize.height, keep, xs, x };
}

/** A dot matrix, as vibe-trading's: each column of dots (PITCH apart, counted from the pane's left so a
 *  dot keeps its place as the view moves) reaches down from `top` (px) as far as the deepest drawdown an
 *  entry under it would take, scaled to the band, one row for any drawdown at all; a point holds until the next. Filled
 *  once with a pattern of one dot a cell. */
export function drawdownRows({ c, hr, vr, w, h, keep, xs }: Frame, points: readonly EquityPoint[], worst: number, look: EquityLook, top = 0): void {
  if (!(worst > 0) || keep.length < 2) return;
  const px = Math.max(2, Math.round(PITCH * hr)), py = Math.max(2, Math.round(PITCH * vr)), band = h * CEILING, scale = Math.max(worst, FLOOR), y0 = Math.ceil((top * vr) / py) * py;
  const cols = Math.ceil(w / px), depth = new Float32Array(cols);
  keep.forEach((i, k) => {
    const d = ((1 - points[i]!.low / points[i]!.value) / scale) * band, x0 = xs.get(i)!, next = keep[k + 1];
    if (!(d > 0)) return;
    const last = Math.min(cols - 1, Math.floor(((next === undefined ? x0 + px : xs.get(next)!) - 1) / px));
    for (let col = Math.max(0, Math.floor(x0 / px)); col <= last; col++) depth[col] = Math.max(depth[col]!, d);
  });
  const area = new Path2D();
  depth.forEach((d, col) => { if (d > 0) area.rect(col * px, y0, px, Math.ceil(d / py) * py); });
  const fill = dots(c, px, py, Math.max(1, Math.round(DOT * hr)), look.ceiling);
  if (fill) { c.fillStyle = fill; c.fill(area); }
}

/** Which way the run held, as a track in the strip between the stretches' names and the drawdown dots
 *  (which start `top` px down), over the time the points span: a flat bar where it held a position, in the
 *  profit colour long and the loss colour short (as the trades' sides elsewhere), in the dots' grey with
 *  both at once, 1 px short where the next starts so a change of side shows; where it held none, only the track's hairline, as the day bars' baseline. Every stretch
 *  drawn however crowded: a busy run's barcode here is its rhythm, and the strip leaves the plot clear. */
export function sideTrack({ c, hr, vr, w, x }: Frame, points: readonly EquityPoint[], held: readonly Leaning[], look: EquityLook, top: number): void {
  const first = points[0], last = points.at(-1);
  if (!first || !last) return;
  const y = Math.round((top - TRACK_UP) * vr), h = Math.max(1, Math.round(TRACK_H * vr)), line = Math.max(1, Math.round(vr)), all = span(x(first.time), x(last.time));
  c.fillStyle = look.grid;
  c.fillRect(all.at, y + Math.floor((h - line) / 2), all.len, line);
  held.forEach(([from, to, long], k) => {
    const a = x(from), b = x(to), gap = held[k + 1]?.[0] === to ? Math.round(hr) : 0;
    if (b < 0 || a > w) return;
    const s = span(a, b);
    c.fillStyle = long === null ? look.ceiling : long ? look.up : look.down;
    c.fillRect(s.at, y, Math.max(1, s.len - gap), h);
  });
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

/** The height (px) the visible drawdown dots reach in a pane `h` px high. */
export function dotsHigh(points: readonly EquityPoint[], worst: number, view: LogicalRange | null, h: number): number {
  if (!(worst > 0) || points.length < 2) return 0;
  const lo = Math.max(0, Math.floor(view?.from ?? 0)), hi = Math.min(points.length - 1, Math.ceil(view?.to ?? points.length - 1));
  let deepest = 0;
  for (let i = lo; i <= hi; i++) { const p = points[i]!; if (!p.down && p.value > 0) deepest = Math.max(deepest, 1 - p.low / p.value); }
  return deepest > 0 ? Math.ceil(((deepest / Math.max(worst, FLOOR)) * h * CEILING) / PITCH) * PITCH : 0;
}

/** The height (px) the tallest visible day bar reaches above `foot` in a pane `h` px high. */
export function barsHigh(points: readonly EquityPoint[], bars: readonly DayBar[], view: LogicalRange | null, h: number, foot: number): number {
  const most = Math.max(0, ...bars.map((d) => Math.abs(d.ret)));
  if (!(most > 0) || !points.length) return 0;
  const lo = Math.max(0, Math.floor(view?.from ?? 0)), hi = Math.min(points.length - 1, Math.ceil(view?.to ?? points.length - 1));
  const t0 = (points[lo]?.time ?? -Infinity) - DAY_S, t1 = (points[hi]?.time ?? Infinity) + DAY_S;
  let vis = 0;
  for (const d of bars) if (d.from >= t0 && d.from <= t1) vis = Math.max(vis, Math.abs(d.ret));
  return vis > 0 ? Math.max(2, Math.ceil((vis / most) * BARS * Math.max(0, h - foot))) : 2;
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
