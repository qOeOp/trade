// The equity chart's own layers, drawn as one series primitive on the equity series so they move with
// its scales, after vibe-trading's band chart, each in its band of the pane (equityZones.ts). Beneath the series: the stretches where the run held no
// position, faintly shaded, the rows along the top (equityRows: the shown backtest's years, which way each contract held), and the hovered day's column (the day bars above the exposure's band, `lift`); the value gridlines; the gap between equity
// and the pace it is measured against, flat, in the profit colour where equity is ahead and the loss
// colour where behind, and the pace as a long-dashed line; the drawdown and day bands (equityBands), behind the line as vibe-trading's. Above it the equity line itself (the series draws none):
// a knockout stroke in the island's colour parting it from the fills and casting a deep, soft shadow
// downward, then the line on it, a whole number of device pixels wide, as vibe-trading's. Everything is drawn in device pixels, edges
// snapped, and from the visible points only, thinned to each pixel column's first, lowest, highest and
// last. Over the line, each stretch a chain of runs was offline or no run ran (downLook.ts), opaque the
// pane's height, so nothing drawn from the series runs across it and the line simply stops either side of
// it; only words (the notes' names, the stretches' names) and the closes' arrows draw over it.
import { DAY_S, FEW, dayBars, drawdownRows, frameOf, span, type DayBar, type Frame } from "./equityBands";
import type { Leaning } from "../../model/held";
import type { Restart } from "../../model/paper";
import { downsOf, downTags, drawDown, tagged, widened, type Down, type DownLook } from "./downLook";
import { xAt } from "./equityPlace";
import { dotsEnd, inPlot, toEdges, type Plot } from "./equityZones";
import { NO_ROWS, rowsHead, rowsOver, rowsUnder, type Rows } from "./equityRows";
import type { YearLook } from "./equityYears";
import type { IChartApi, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";

/** A point a minute (or a step), or a backtest's a day (`day`); `down` across a chain's offline stretch
 *  (downLook.ts); `stretch` the index of the stretch it belongs to (equityStretches.ts); `cut` where a
 *  stretch starts anew, not carrying on from the one before it, so the line and its fill break there. */
/** `peak`: the highest equity so far in its stretch; `low`: the lowest from it to its stretch's end. */
export type EquityPoint = { time: number; value: number; peak: number; low: number; pace: number | null; minute?: number; down?: boolean; stretch?: number; cut?: boolean; day?: boolean };
export type EquityLook = { line: string; pace: string; knockout: string; knockoutWidth: number; haze: string; ahead: string; behind: string;
                           ceiling: string; flat: string; column: string; up: string; down: string; upStrong: string; downStrong: string; grid: string; restart: DownLook; rows: YearLook };
export { FEW, type DayBar };
const BLUR = 10, DROP = 6;  // px: the line's shadow's blur and how far down it falls
/** How far (px) the line's knockout and shadow reach above and below it: the value axis keeps this much
 *  room inside the plot (equityApi.ts), so the plot's edge never cuts them. */
export const HALO = { above: 5, below: 16 };
const HELD_GAP = 6, CROWDED = 48;  // px: held stretches nearer than this count as one (no flat shading between); at most one stretch this wide a share

export class EquityLayers implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType> | null = null;
  private chart: IChartApi | null = null;
  private redraw: (() => void) | null = null;
  private points: readonly EquityPoint[] = [];
  private cuts: number[] = [];  // the points' indexes that are `cut`
  private bars: readonly DayBar[] = [];
  private held: readonly Leaning[] = [];
  private picked: number | null = null;
  private hovered: number | null = null;
  private base = 0;
  private worst = 0;
  private look: EquityLook | null = null;
  private ticks: readonly number[] = [];
  private downs: readonly Down[] = [];
  private foot = 0;
  private shown: readonly [number, number] | null = null;
  private rows: Rows = NO_ROWS;

  /** `plot`: where the priced layers are drawn (equityZones.ts). */
  constructor(private readonly plot: () => Plot) {}

  /** The points and the shown stretch's days, the day picked (its start, in seconds), the balance equity
   *  is measured against where it has no pace, the worst drawdown (from every minute), where the shown
   *  stretch held a position and which way (seconds), the colours, the restarts of its chains of runs, the shown
   *  stretch's first and last minute (s; null when there is none) and the rows over the drawdown dots. */
  set(points: readonly EquityPoint[], days: readonly DayBar[], picked: number | null, base: number, worst: number, held: readonly Leaning[], look: EquityLook,
      restarts: readonly Restart[] = [], shown: readonly [number, number] | null = null, rows: Rows = this.rows): void {
    Object.assign(this, { points, bars: days, picked, base, worst, held, look, downs: downsOf(restarts), shown, rows, cuts: points.flatMap((p, i) => (p.cut ? [i] : [])) });
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

  /** Where the drawdown dots start (px from the pane's top), under the rows (equityRows). */
  head(): number { return rowsHead(this.rows); }

  /** Whether the day bars have room at the foot: the shown stretch is long enough for them. */
  days(): boolean { return this.shown !== null && this.shown[1] - this.shown[0] >= FEW && this.bars.length > 0; }

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
    return [view("bottom", (f) => this.under(f)), view("normal", (f) => { this.line(f); this.offline(f); }), view("top", (f) => rowsOver(f, this.rows, this.look!.rows))];
  }

  /** Each offline stretch's tag on the time axis, at its middle. */
  timeAxisPaneViews(): readonly IPrimitivePaneView[] {
    return [downTags(() => tagged(this.placed(), this.chart?.timeScale().width() ?? 0), () => this.look?.restart ?? null)];
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
    const { points, look, shown } = this, days = this.days();
    // The flat stretches shaded: the gaps between held stretches, those nearer than HELD_GAP joined, and
    // either end of the points; none at all while more than one each CROWDED px are in view, where a busy
    // run seen whole would read as a barcode.
    const blocks: [number, number][] = [];
    for (const [from, to] of this.held) {
      const a = f.x(from), b = f.x(to), top = blocks.at(-1);
      if (b < 0 || a > f.w) continue;
      if (top && a - top[1] < HELD_GAP * f.hr) top[1] = b; else blocks.push([a, b]);
    }
    if (points.length && blocks.length <= f.w / (CROWDED * f.hr)) {
      const edges = [f.x(points[0]!.time), ...blocks.flat(), f.x(points.at(-1)!.time)];
      f.c.fillStyle = look!.flat;
      for (let k = 0; k < edges.length; k += 2) { const [a, b] = [edges[k]!, edges[k + 1]!]; if (b - a >= HELD_GAP * f.hr) { const s = span(a, b); f.c.fillRect(s.at, 0, s.len, f.h); } }
    }
    if (days && this.hovered !== null) { const s = span(f.x(this.hovered), f.x(this.hovered + DAY_S)); f.c.fillStyle = look!.column; f.c.fillRect(s.at, 0, s.len, f.h); }
    f.c.fillStyle = look!.grid;
    for (const p of this.ticks) f.c.fillRect(0, Math.round(this.y(p, f.vr)), f.w, Math.max(1, Math.round(f.vr)));
    inPlot(f.c, this.plot(), f.w, f.vr, () => { this.gap(f); this.pace(f); });
    drawdownRows(f, points, this.worst, look!, this.head(), dotsEnd(f.h / f.vr, this.head()));
    rowsUnder(f, points, this.rows, look!);
    if (days) dayBars({ ...f, h: f.h - Math.round(this.foot * f.vr) }, shown!, this.bars, (d) => d === this.picked || d === this.hovered, look!);
  }

  /** Each offline stretch over the line. */
  private offline(f: Frame): void {
    for (const [, a, b] of this.placed()) {
      if (b * f.hr < 0 || a * f.hr > f.w) continue;
      drawDown(f.c, a * f.hr, b * f.hr, 0, f.h, this.look!.restart, f.hr);
    }
  }

  /** The points drawn (`keep`) in runs, a new one wherever a point between two of them is `cut`. */
  private runs(keep: readonly number[]): number[][] {
    const out: number[][] = [];
    keep.forEach((i, k) => { if (!k || this.cuts.some((j) => j > keep[k - 1]! && j <= i)) out.push([]); out.at(-1)!.push(i); });
    return out;
  }

  /** The band between equity and its pace, filled flat twice: clipped above the pace, then below it, each
   *  fading into the plot's edges (equityZones). */
  private gap({ c, vr, h, keep: all, xs }: Frame): void {
    const plot = this.plot(), look = this.look!, ref = (i: number) => this.y(this.points[i]!.pace ?? this.base, vr), val = (i: number) => this.y(this.points[i]!.value, vr);
    for (const keep of this.runs(all)) {
      const band = new Path2D(), above = new Path2D(), below = new Path2D();
      keep.forEach((i, k) => band[k ? "lineTo" : "moveTo"](xs.get(i)!, val(i)));
      [...keep].reverse().forEach((i) => band.lineTo(xs.get(i)!, ref(i)));
      for (const clip of [above, below]) keep.forEach((i, k) => clip[k ? "lineTo" : "moveTo"](xs.get(i)!, ref(i)));
      const x0 = xs.get(keep[0]!)!, x1 = xs.get(keep.at(-1)!)!;
      above.lineTo(x1, 0); above.lineTo(x0, 0); above.closePath();
      below.lineTo(x1, h); below.lineTo(x0, h); below.closePath();
      for (const [clip, colour] of [[above, look.ahead], [below, look.behind]] as const) { c.save(); c.clip(clip); c.fillStyle = toEdges(c, plot, vr, colour); c.fill(band); c.restore(); }
    }
  }

  /** The pace, long-dashed, broken where it has none. */
  private pace({ c, hr, vr, keep: all, xs }: Frame): void {
    const path = new Path2D();
    for (const keep of this.runs(all)) {
      let on = false;
      for (const i of keep) { const v = this.points[i]!.pace; if (v === null) on = false; else { path[on ? "lineTo" : "moveTo"](xs.get(i)!, this.y(v, vr)); on = true; } }
    }
    Object.assign(c, { strokeStyle: this.look!.pace, lineWidth: Math.max(1, Math.floor(hr)) });
    c.setLineDash([6 * hr, 6 * hr]); c.stroke(path); c.setLineDash([]);
  }

  private line(f: Frame): void { inPlot(f.c, this.plot(), f.w, f.vr, () => this.stroke(f)); }

  private stroke({ c, hr, vr, keep, xs }: Frame): void {
    const look = this.look!, path = new Path2D();
    for (const run of this.runs(keep)) run.forEach((i, k) => path[k ? "lineTo" : "moveTo"](xs.get(i)!, this.y(this.points[i]!.value, vr)));
    c.save();
    Object.assign(c, { lineJoin: "round", lineCap: "round", strokeStyle: look.knockout, lineWidth: look.knockoutWidth * hr });
    Object.assign(c, { shadowColor: look.haze, shadowBlur: BLUR * hr, shadowOffsetX: 1 * hr, shadowOffsetY: DROP * vr });
    c.stroke(path);
    Object.assign(c, { shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, strokeStyle: look.line, lineWidth: Math.max(1, Math.round(1.75 * hr)) });
    c.stroke(path);
    c.restore();
  }
}
