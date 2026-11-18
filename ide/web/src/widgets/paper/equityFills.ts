// The equity chart's fills beneath its line, as the candle charts fill a trade (tradeBoxes.ts): what fees
// and funding took, as a band between equity before them and the line, flat in a faint grey with a fine
// rim along its far edge, so the line reads as the foot of a raised strip (vibe-trading's band); and
// the open profit and loss, the stretch between the balance (equity less the open profit) and the line
// wherever they part, in the profit colour where equity is above the balance and the loss colour where
// below, over the band; on request, beneath them all, an equal-weight buy and hold of the run's contracts as a
// fine line over an area that fades from it to nothing at the plot's foot. All of it inside the plot
// (equityZones.ts).
import type { AutoscaleInfo, IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, LogicalRange,
  SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";
import type { Reading } from "../../model/equityReadings";
import type { EquityPoint } from "./equityLayers";
import { perColumn } from "./equityPlace";
import { inPlot, toEdges, type Plot } from "./equityZones";

export type FillsLook = { up: string; down: string; costs: string; rim: string };
/** The buy and hold's line and its area's colour at the line (`#rrggbbaa`). */
export type HoldLook = { line: string; area: string };
type Scope = Parameters<Parameters<Parameters<IPrimitivePaneRenderer["draw"]>[0]["useBitmapCoordinateSpace"]>[0]>[0];
type Range = AutoscaleInfo["priceRange"];
const HOLD_BAND = 0.28;  // the most a coarser outer band for the buy and hold adds above or below equity's own span

export class EquityFills implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private redraw: (() => void) | null = null;
  private points: readonly EquityPoint[] = [];
  private balances: (number | null)[] = [];
  private befores: (number | null)[] = [];
  private holds: (number | null)[] = [];
  private look: FillsLook | null = null;
  private hold: HoldLook | null = null;

  /** `plot`: where they are drawn (equityZones.ts). */
  constructor(private readonly plot: () => Plot) {}

  /** The points, their readings, the colours and, when it is drawn, the buy and hold's. */
  set(points: readonly EquityPoint[], readings: ReadonlyMap<number, Reading>, look: FillsLook, hold: HoldLook | null): void {
    const at = (p: EquityPoint) => readings.get(p.minute ?? p.time);
    Object.assign(this, { points, look, hold, balances: points.map((p) => at(p)?.balance ?? null), befores: points.map((p) => at(p)?.before ?? null),
                          holds: hold === null ? [] : points.map((p) => at(p)?.hold ?? null) });
    this.series?.applyOptions({});
    this.redraw?.();
  }

  /** Equity's range in view (`range`, over `view`, widened for equity before costs by at most its own span) and
   *  the buy and hold's bounds in view. */
  private bounds(range: NonNullable<Range>, from: number, to: number) {
    const span = Math.max(range.maxValue - range.minValue, 1);
    let hiEq = range.maxValue, loEq = range.minValue, hiHold = -Infinity, loHold = Infinity;
    for (let i = Math.max(0, Math.floor(from)); i <= Math.min(this.points.length - 1, Math.ceil(to)); i++) {
      const b = this.befores[i], h = this.holds[i];
      if (b != null) { hiEq = Math.max(hiEq, Math.min(b, range.maxValue + span)); loEq = Math.min(loEq, Math.max(b, range.minValue - span)); }
      if (h != null) { hiHold = Math.max(hiHold, h); loHold = Math.min(loHold, h); }
    }
    const eqSpan = Math.max(hiEq - loEq, 1), band = eqSpan * HOLD_BAND;
    const topRoom = hiHold > hiEq ? Math.min(hiHold - hiEq, band) : 0;
    const botRoom = loHold < loEq ? Math.min(loEq - loHold, band) : 0;
    return { loEq, hiEq, loHold, hiHold, topRoom, botRoom };
  }

  /** Equity's range in view widened for costs and, while the buy and hold runs past it, by at most `HOLD_BAND`
   *  of equity's span each way for the coarser outer bands that hold its peaks and troughs. */
  reach(range: Range, view: LogicalRange | null): Range {
    if (!view || !range) return range;
    const { loEq, hiEq, topRoom, botRoom } = this.bounds(range, view.from, view.to);
    return { minValue: loEq - botRoom, maxValue: hiEq + topRoom };
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>): void { Object.assign(this, { chart, series, redraw: requestUpdate }); }
  detached(): void { Object.assign(this, { chart: null, series: null, redraw: null }); }
  paneViews(): readonly IPrimitivePaneView[] {
    return [{ zOrder: () => "bottom", renderer: () => ({ draw: (target) => target.useBitmapCoordinateSpace((s) => {
      const { context: c, bitmapSize: { width }, verticalPixelRatio: vr } = s;
      inPlot(c, this.plot(), width, vr, () => { this.holding(s); this.draw(s); });
    }) }) }];
  }

  /** Where the points in view fall (four a pixel column at most), in device px. */
  private placing({ verticalPixelRatio: vr, horizontalPixelRatio: hr }: Scope) {
    const { chart, series, look, points } = this, range = chart?.timeScale().getVisibleLogicalRange();
    if (!chart || !series || !look || !range || points.length < 2) return null;
    const time = chart.timeScale(), Y = (v: number) => (series.priceToCoordinate(v) ?? Number.NaN) * vr;
    const X = (i: number) => (time.logicalToCoordinate(i as Logical) ?? Number.NaN) * hr;
    return { look, X, Y, from: Math.max(0, Math.floor(range.from) - 1), to: Math.min(points.length - 1, Math.ceil(range.to) + 1) };
  }

  /** The buy and hold's area: 1:1 with the value axis across equity's own range (so crossings and which is ahead
   *  stay true), and scaled into the coarser `HOLD_BAND` bands above `hiEq` and below `loEq` where it runs
   *  further, so its peaks and troughs stay whole without flattening the equity line. */
  private holding(s: Scope): void {
    const at = this.placing(s), { context: c, horizontalPixelRatio: hr, verticalPixelRatio: vr } = s;
    if (!at || !this.hold) return;
    const { X, Y, from, to } = at, plot = this.plot(), hold = perColumn(from, to, X, (i) => this.holds[i]!, (i) => this.holds[i] != null);
    if (hold.length < 2) return;
    let lo = Infinity, hi = -Infinity;
    for (let i = from; i <= to; i++) { const p = this.points[i]; if (p && !p.down) { lo = Math.min(lo, p.value); hi = Math.max(hi, p.value); } }
    const { loEq, hiEq, loHold, hiHold, topRoom, botRoom } = this.bounds({ minValue: lo, maxValue: hi }, from, to);
    const mapHold = (v: number) => (v > hiEq && hiHold > hiEq ? hiEq + ((v - hiEq) / (hiHold - hiEq)) * topRoom
      : v < loEq && loHold < loEq ? loEq - ((loEq - v) / (loEq - loHold)) * botRoom : v);
    const top = Math.round(plot.top * vr), foot = Math.round(plot.bottom * vr), ys = hold.map((i) => Y(mapHold(this.holds[i]!)));
    const line = new Path2D();
    hold.forEach((i, k) => line[k ? "lineTo" : "moveTo"](X(i), ys[k]!));
    const area = new Path2D(line);
    area.lineTo(X(hold.at(-1)!), foot); area.lineTo(X(hold[0]!), foot); area.closePath();
    const g = c.createLinearGradient(0, Math.max(top, ys.reduce((min, y) => (y < min ? y : min), foot - 1)), 0, foot);
    g.addColorStop(0, this.hold.area); g.addColorStop(1, `${this.hold.area.slice(0, 7)}00`);
    c.fillStyle = g; c.fill(area);
    Object.assign(c, { strokeStyle: this.hold.line, lineWidth: Math.max(1, Math.floor(hr)), lineJoin: "round" });
    c.stroke(line);
  }

  /** Over the points in view: the costs' band and its rim, then the open profit's band, filled flat twice: clipped above the balance, then below it. The
   *  bands and the rim fade into the plot's edges (equityZones), where a fee-heavy run's costs are cut. */
  private draw(s: Scope): void {
    const at = this.placing(s), { context: c, verticalPixelRatio: vr, horizontalPixelRatio: hr, bitmapSize } = s;
    if (!at) return;
    const { look, X, Y, from, to } = at, plot = this.plot(), points = this.points, value = (i: number) => points[i]!.value;
    // A path along `edge` through `shown`, and back along the line through `under`.
    const band = (shown: number[], edge: (i: number) => number, under: number[]) => {
      const path = new Path2D();
      shown.forEach((i, k) => path[k ? "lineTo" : "moveTo"](X(i), Y(edge(i))));
      [...under].reverse().forEach((i) => path.lineTo(X(i), Y(value(i))));
      path.closePath();
      return path;
    };

    const priced = (i: number) => this.befores[i] !== null, before = (i: number) => this.befores[i]!;
    const top = perColumn(from, to, X, before, priced), line = perColumn(from, to, X, value, priced);
    if (top.length > 1) {
      c.fillStyle = toEdges(c, plot, vr, look.costs);
      c.fill(band(top, before, line));
      const rim = new Path2D(), w = Math.max(1, Math.floor(hr));
      top.forEach((i, k) => rim[k ? "lineTo" : "moveTo"](X(i), Math.round(Y(before(i))) + w / 2));
      Object.assign(c, { strokeStyle: toEdges(c, plot, vr, look.rim), lineWidth: w, lineJoin: "round" });
      c.stroke(rim);
    }

    const shown = perColumn(from, to, X, value, (i) => this.balances[i] !== null);
    if (shown.length < 2) return;
    const base = (i: number) => this.balances[i]!, open = band(shown, base, shown), above = new Path2D(), below = new Path2D();
    for (const clip of [above, below]) shown.forEach((i, k) => clip[k ? "lineTo" : "moveTo"](X(i), Y(base(i))));
    const x0 = X(shown[0]!), x1 = X(shown.at(-1)!);
    above.lineTo(x1, 0); above.lineTo(x0, 0); above.closePath();
    below.lineTo(x1, bitmapSize.height); below.lineTo(x0, bitmapSize.height); below.closePath();
    for (const [clip, colour] of [[above, look.up], [below, look.down]] as const) { c.save(); c.clip(clip); c.fillStyle = toEdges(c, plot, vr, colour); c.fill(open); c.restore(); }
  }
}
