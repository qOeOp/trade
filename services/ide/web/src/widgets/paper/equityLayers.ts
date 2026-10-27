// The equity chart's own layers, drawn as one series primitive on the equity series so they move with
// its scales, after vibe-trading's band chart. Beneath the series: the stretches where the run held any
// position, faintly shaded, and the hovered day's column (the day bars above the event flags' strip, `lift`); the value gridlines; the gap between equity
// and the pace it is measured against, flat, in the profit colour where equity is ahead and the loss
// colour where behind; the drawdown and day bands (equityBands), behind the line as vibe-trading's. Above it the equity line itself (the series draws none):
// a knockout stroke in the island's colour parting it from the fills and casting a deep, soft shadow
// downward, then the line on it, a whole number of device pixels wide, as vibe-trading's. Everything is drawn in device pixels, edges
// snapped, and from the visible points only, thinned to each pixel column's first, lowest, highest and
// last.
import { CEILING, BARS, DAY_S, FEW, dayBars, drawdownRows, span, type DayBar, type Frame } from "./equityBands";
import type { IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";

export type EquityPoint = { time: number; value: number; peak: number; pace: number | null; minute?: number };
export type EquityLook = { line: string; knockout: string; knockoutWidth: number; haze: string; ahead: string; behind: string;
                           ceiling: string; held: string; column: string; up: string; down: string; upStrong: string; downStrong: string; grid: string };
export { BARS, CEILING, FEW, type DayBar };
const HELD_GAP = 6, CROWDED = 48;  // px: held stretches nearer than this are shaded as one; at most one stretch this wide a share
type Scope = Parameters<Parameters<Parameters<IPrimitivePaneRenderer["draw"]>[0]["useBitmapCoordinateSpace"]>[0]>[0];

export class EquityLayers implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType> | null = null;
  private chart: IChartApi | null = null;
  private redraw: (() => void) | null = null;
  private points: readonly EquityPoint[] = [];
  private days: readonly DayBar[] = [];
  private held: readonly [number, number][] = [];
  private picked: number | null = null;
  private hovered: number | null = null;
  private base = 0;
  private worst = 0;
  private look: EquityLook | null = null;
  private ticks: readonly number[] = [];
  private foot = 0;

  /** The run's points and days, the day picked (its start, in seconds), the balance equity is measured
   *  against where it has no pace, the run's worst drawdown (from every minute), where it held a
   *  position (seconds) and the colours. */
  set(points: readonly EquityPoint[], days: readonly DayBar[], picked: number | null, base: number, worst: number, held: readonly [number, number][], look: EquityLook): void {
    Object.assign(this, { points, days, picked, base, worst, held, look });
    this.redraw?.();
  }

  /** The day under the pointer (its start, in seconds), or null. */
  hover(day: number | null): void {
    if (day === this.hovered) return;
    this.hovered = day;
    this.redraw?.();
  }

  /** How much of the pane's foot (px) the day bars stand above: the event flags' strip. */
  lift(px: number): void { if (px !== this.foot) { this.foot = px; this.redraw?.(); } }

  /** The prices the value axis labels, each given a gridline. */
  grid(prices: readonly number[]): void {
    if (prices.length === this.ticks.length && prices.every((p, i) => p === this.ticks[i])) return;
    this.ticks = prices;
    this.redraw?.();
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>): void { Object.assign(this, { chart, series, redraw: requestUpdate }); }
  detached(): void { Object.assign(this, { chart: null, series: null, redraw: null }); }
  paneViews(): readonly IPrimitivePaneView[] {
    const view = (zOrder: "bottom" | "normal", paint: (f: Frame) => void): IPrimitivePaneView =>
      ({ zOrder: () => zOrder, renderer: () => ({ draw: (target) => target.useBitmapCoordinateSpace((scope) => { const f = this.frame(scope); if (f) paint(f); }) }) });
    return [view("bottom", (f) => this.under(f)), view("normal", (f) => this.line(f))];
  }

  /** The visible points, one to four per pixel column, and where times fall (in device pixels). */
  private frame({ context: c, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize }: Scope): Frame | null {
    const { chart, look, points } = this;
    if (!chart || !look || points.length < 2) return null;
    const time = chart.timeScale(), range = time.getVisibleLogicalRange();
    if (!range) return null;
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

  private y(price: number, vr: number) { return (this.series?.priceToCoordinate(price) ?? Number.NaN) * vr; }

  private under(f: Frame): void {
    const { points, look } = this, days = points.at(-1)!.time - points[0]!.time >= FEW;
    f.c.fillStyle = look!.held;
    // Stretches nearer than HELD_GAP joined; none at all while more than one each CROWDED px are in view,
    // where a busy run seen whole would read as a barcode.
    const blocks: [number, number][] = [];
    for (const [from, to] of this.held) {
      const a = f.x(from), b = f.x(to), top = blocks.at(-1);
      if (b < 0 || a > f.w) continue;
      if (top && a - top[1] < HELD_GAP * f.hr) top[1] = b; else blocks.push([a, b]);
    }
    if (blocks.length <= f.w / (CROWDED * f.hr)) for (const [a, b] of blocks) { const s = span(a, b); f.c.fillRect(s.at, 0, s.len, f.h); }
    if (days && this.hovered !== null) { const s = span(f.x(this.hovered), f.x(this.hovered + DAY_S)); f.c.fillStyle = look!.column; f.c.fillRect(s.at, 0, s.len, f.h); }
    f.c.fillStyle = look!.grid;
    for (const p of this.ticks) f.c.fillRect(0, Math.round(this.y(p, f.vr)), f.w, Math.max(1, Math.round(f.vr)));
    this.gap(f);
    drawdownRows(f, points, this.worst, look!);
    if (days) dayBars({ ...f, h: f.h - Math.round(this.foot * f.vr) }, points, this.days, (d) => d === this.picked || d === this.hovered, look!);
  }

  /** The band between equity and its pace, filled flat twice: clipped above the pace, then below it. */
  private gap({ c, vr, h, keep, xs }: Frame): void {
    const look = this.look!, ref = (i: number) => this.y(this.points[i]!.pace ?? this.base, vr), val = (i: number) => this.y(this.points[i]!.value, vr);
    const band = new Path2D(), above = new Path2D(), below = new Path2D();
    keep.forEach((i, k) => band[k ? "lineTo" : "moveTo"](xs.get(i)!, val(i)));
    [...keep].reverse().forEach((i) => band.lineTo(xs.get(i)!, ref(i)));
    for (const clip of [above, below]) keep.forEach((i, k) => clip[k ? "lineTo" : "moveTo"](xs.get(i)!, ref(i)));
    const x0 = xs.get(keep[0]!)!, x1 = xs.get(keep.at(-1)!)!;
    above.lineTo(x1, 0); above.lineTo(x0, 0); above.closePath();
    below.lineTo(x1, h); below.lineTo(x0, h); below.closePath();
    for (const [clip, colour] of [[above, look.ahead], [below, look.behind]] as const) { c.save(); c.clip(clip); c.fillStyle = colour; c.fill(band); c.restore(); }
  }

  private line({ c, hr, vr, keep, xs }: Frame): void {
    const look = this.look!, path = new Path2D();
    keep.forEach((i, k) => path[k ? "lineTo" : "moveTo"](xs.get(i)!, this.y(this.points[i]!.value, vr)));
    c.save();
    Object.assign(c, { lineJoin: "round", lineCap: "round", strokeStyle: look.knockout, lineWidth: look.knockoutWidth * hr });
    Object.assign(c, { shadowColor: look.haze, shadowBlur: 10 * hr, shadowOffsetX: 1 * hr, shadowOffsetY: 6 * vr });
    c.stroke(path);
    Object.assign(c, { shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, strokeStyle: look.line, lineWidth: Math.max(1, Math.round(1.75 * hr)) });
    c.stroke(path);
    c.restore();
  }
}
