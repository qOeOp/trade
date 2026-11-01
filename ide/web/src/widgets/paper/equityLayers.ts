// The equity chart's own layers, drawn as one series primitive on the equity series so they move with
// its scales, after vibe-trading's band chart. Beneath the series: the stretches where the run held any
// position, faintly shaded, and the hovered day's column (the day bars above the exposure's band, `lift`); the value gridlines; the gap between equity
// and the pace it is measured against, flat, in the profit colour where equity is ahead and the loss
// colour where behind; the drawdown and day bands (equityBands), behind the line as vibe-trading's. Above it the equity line itself (the series draws none):
// a knockout stroke in the island's colour parting it from the fills and casting a deep, soft shadow
// downward, then the line on it, a whole number of device pixels wide, as vibe-trading's. Everything is drawn in device pixels, edges
// snapped, and from the visible points only, thinned to each pixel column's first, lowest, highest and
// last. Over everything, each stretch a chain of runs was offline (downLook.ts), opaque, so nothing drawn
// from the series runs across it, the line ending either side of it in a dot.
import { CEILING, BARS, DAY_S, FEW, dayBars, drawdownRows, frameOf, span, type DayBar, type Frame } from "./equityBands";
import type { Restart } from "../../model/paper";
import { downsOf, downTag, drawDown, tagged, widened, type Down, type DownLook } from "./downLook";
import { xAt } from "./equityPlace";
import type { IChartApi, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, ISeriesPrimitiveAxisView, SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";

/** A point a minute (or a step), or a backtest's a day (`day`); `down` across a chain's offline stretch
 *  (downLook.ts); `stretch` the index of the stretch it belongs to (equityStretches.ts); `cut` where a
 *  stretch starts anew, not carrying on from the one before it, so the line and its fill break there. */
export type EquityPoint = { time: number; value: number; peak: number; pace: number | null; minute?: number; down?: boolean; stretch?: number; cut?: boolean; day?: boolean };
export type EquityLook = { line: string; knockout: string; knockoutWidth: number; haze: string; ahead: string; behind: string;
                           ceiling: string; held: string; column: string; up: string; down: string; upStrong: string; downStrong: string; grid: string; restart: DownLook };
export { BARS, CEILING, FEW, type DayBar };
const HELD_GAP = 6, CROWDED = 48, END = 2;  // px: held stretches nearer than this are shaded as one; at most one stretch this wide a share; the line's end dot's radius

export class EquityLayers implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType> | null = null;
  private chart: IChartApi | null = null;
  private redraw: (() => void) | null = null;
  private points: readonly EquityPoint[] = [];
  private cuts: number[] = [];  // the points' indexes that are `cut`
  private days: readonly DayBar[] = [];
  private held: readonly [number, number][] = [];
  private picked: number | null = null;
  private hovered: number | null = null;
  private base = 0;
  private worst = 0;
  private look: EquityLook | null = null;
  private ticks: readonly number[] = [];
  private downs: readonly Down[] = [];
  private foot = 0;
  private shown: readonly [number, number] | null = null;
  private top = 0;

  /** The points and the shown stretch's days, the day picked (its start, in seconds), the balance equity
   *  is measured against where it has no pace, the worst drawdown (from every minute), where the shown
   *  stretch held a position (seconds), the colours, the restarts of its chains of runs, the shown
   *  stretch's first and last minute (s; null when there is none) and how far down (px) the drawdown
   *  band starts, under the stretches' names. */
  set(points: readonly EquityPoint[], days: readonly DayBar[], picked: number | null, base: number, worst: number, held: readonly [number, number][], look: EquityLook,
      restarts: readonly Restart[] = [], shown: readonly [number, number] | null = null, top = 0): void {
    Object.assign(this, { points, days, picked, base, worst, held, look, downs: downsOf(restarts), shown, top, cuts: points.flatMap((p, i) => (p.cut ? [i] : [])) });
    this.redraw?.();
  }

  /** The day under the pointer (its start, in seconds), or null. */
  hover(day: number | null): void {
    if (day === this.hovered) return;
    this.hovered = day;
    this.redraw?.();
  }

  /** How much of the pane's foot (px) the day bars stand above: the exposure's band. */
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
    const view = (zOrder: "bottom" | "normal" | "top", paint: (f: Frame) => void): IPrimitivePaneView =>
      ({ zOrder: () => zOrder, renderer: () => ({ draw: (target) => target.useBitmapCoordinateSpace((scope) => { const f = this.chart && this.look ? frameOf(scope, this.chart, this.points) : null; if (f) paint(f); }) }) });
    return [view("bottom", (f) => this.under(f)), view("normal", (f) => this.line(f)), view("top", (f) => this.offline(f))];
  }

  /** Each offline stretch's tag on the time axis, at its middle. */
  timeAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    const look = this.look?.restart;
    return look ? tagged(this.placed(), this.chart?.timeScale().width() ?? 0).map(({ d, x }) => downTag(x, d, look)) : [];
  }

  /** The tags on the time axis: where they sit (px) and what they say. */
  onAxis(): { x: number; text: string }[] { return tagged(this.placed(), this.chart?.timeScale().width() ?? 0).map(({ d, x }) => ({ x, text: d.label })); }

  /** The offline stretch drawn under pane x (px), if any. */
  offlineAt(x: number): Down | null { return this.placed().find(([, a, b]) => x >= a && x <= b)?.[0] ?? null; }

  /** Each offline stretch with where it is drawn (px), widened; none under a pixel wide as zoomed now (a
   *  pause of minutes in a view of years), which the line does not show either. */
  private placed(): [Down, number, number][] {
    const time = this.chart?.timeScale();
    return time ? this.downs.flatMap((d) => { const a = xAt(this.points, time, d.from), b = xAt(this.points, time, d.to); return a === null || b === null || b - a < 1 ? [] : [[d, ...widened(a, b)]]; }) : [];
  }

  private y(price: number, vr: number) { return (this.series?.priceToCoordinate(price) ?? Number.NaN) * vr; }

  private under(f: Frame): void {
    const { points, look, shown } = this, days = shown !== null && shown[1] - shown[0] >= FEW;
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
    drawdownRows(f, points, this.worst, look!, this.top);
    if (days) dayBars({ ...f, h: f.h - Math.round(this.foot * f.vr) }, shown!, this.days, (d) => d === this.picked || d === this.hovered, look!);
  }

  /** Each offline stretch over all else, and a dot where the line meets it either side, centred on its
   *  hairline as drawn (whole device px), so the line ends in it. */
  private offline(f: Frame): void {
    const look = this.look!;
    for (const [, a, b] of this.placed()) {
      if (b * f.hr < 0 || a * f.hr > f.w) continue;
      drawDown(f.c, a * f.hr, b * f.hr, 0, f.h, look.restart, f.hr);
      f.c.fillStyle = look.line;
      const line = Math.max(1, Math.floor(f.hr));
      for (const x of [Math.round(a * f.hr) + line / 2, Math.round(b * f.hr) - line / 2]) {
        const y = this.lineY(f, x);
        if (y !== null) { f.c.beginPath(); f.c.arc(x, y, END * f.hr, 0, 2 * Math.PI); f.c.fill(); }
      }
    }
  }

  /** Where the line is drawn at `x` (device px), between the kept points either side; null past its ends. */
  private lineY({ keep, xs, vr }: Frame, x: number): number | null {
    const k = keep.findIndex((i) => xs.get(i)! >= x), i = keep[k - 1], j = keep[k];
    if (i === undefined || j === undefined) return null;
    const x0 = xs.get(i)!, y0 = this.y(this.points[i]!.value, vr), y1 = this.y(this.points[j]!.value, vr);
    return y0 + ((y1 - y0) * (x - x0)) / (xs.get(j)! - x0 || 1);
  }

  /** The points drawn (`keep`) in runs, a new one wherever a point between two of them is `cut`. */
  private runs(keep: readonly number[]): number[][] {
    const out: number[][] = [];
    keep.forEach((i, k) => { if (!k || this.cuts.some((j) => j > keep[k - 1]! && j <= i)) out.push([]); out.at(-1)!.push(i); });
    return out;
  }

  /** The band between equity and its pace, filled flat twice: clipped above the pace, then below it. */
  private gap({ c, vr, h, keep: all, xs }: Frame): void {
    const look = this.look!, ref = (i: number) => this.y(this.points[i]!.pace ?? this.base, vr), val = (i: number) => this.y(this.points[i]!.value, vr);
    for (const keep of this.runs(all)) {
      const band = new Path2D(), above = new Path2D(), below = new Path2D();
      keep.forEach((i, k) => band[k ? "lineTo" : "moveTo"](xs.get(i)!, val(i)));
      [...keep].reverse().forEach((i) => band.lineTo(xs.get(i)!, ref(i)));
      for (const clip of [above, below]) keep.forEach((i, k) => clip[k ? "lineTo" : "moveTo"](xs.get(i)!, ref(i)));
      const x0 = xs.get(keep[0]!)!, x1 = xs.get(keep.at(-1)!)!;
      above.lineTo(x1, 0); above.lineTo(x0, 0); above.closePath();
      below.lineTo(x1, h); below.lineTo(x0, h); below.closePath();
      for (const [clip, colour] of [[above, look.ahead], [below, look.behind]] as const) { c.save(); c.clip(clip); c.fillStyle = colour; c.fill(band); c.restore(); }
    }
  }

  private line({ c, hr, vr, keep, xs }: Frame): void {
    const look = this.look!, path = new Path2D();
    for (const run of this.runs(keep)) run.forEach((i, k) => path[k ? "lineTo" : "moveTo"](xs.get(i)!, this.y(this.points[i]!.value, vr)));
    c.save();
    Object.assign(c, { lineJoin: "round", lineCap: "round", strokeStyle: look.knockout, lineWidth: look.knockoutWidth * hr });
    Object.assign(c, { shadowColor: look.haze, shadowBlur: 10 * hr, shadowOffsetX: 1 * hr, shadowOffsetY: 6 * vr });
    c.stroke(path);
    Object.assign(c, { shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, strokeStyle: look.line, lineWidth: Math.max(1, Math.round(1.75 * hr)) });
    c.stroke(path);
    c.restore();
  }
}
