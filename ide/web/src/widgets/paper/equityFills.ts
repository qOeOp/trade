// The equity chart's fills beneath its line, as the candle charts fill a trade (tradeBoxes.ts): what fees
// and funding took, as a band between equity before them and the line, flat in a faint grey with a fine
// rim along its far edge, so the line reads as the foot of a raised strip (vibe-trading's band); and
// the open profit and loss, the stretch between the balance (equity less the open profit) and the line
// wherever they part, in the profit colour where equity is above the balance and the loss colour where
// below, over the band; on request an equal-weight buy and hold of the run's contracts as a fine dashed
// line. All of it inside the plot (equityZones.ts).
import type { AutoscaleInfo, IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, LogicalRange,
  SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";
import type { Reading } from "../../model/equityReadings";
import type { EquityPoint } from "./equityLayers";
import { perColumn } from "./equityPlace";
import { inPlot, toEdges, type Plot } from "./equityZones";

export type FillsLook = { up: string; down: string; costs: string; rim: string };
type Scope = Parameters<Parameters<Parameters<IPrimitivePaneRenderer["draw"]>[0]["useBitmapCoordinateSpace"]>[0]>[0];
type Range = AutoscaleInfo["priceRange"];

export class EquityFills implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private redraw: (() => void) | null = null;
  private points: readonly EquityPoint[] = [];
  private balances: (number | null)[] = [];
  private befores: (number | null)[] = [];
  private holds: (number | null)[] = [];
  private look: FillsLook | null = null;
  private hold: string | null = null;

  /** `plot`: where they are drawn (equityZones.ts). */
  constructor(private readonly plot: () => Plot) {}

  /** The points, their readings, the colours and, when it is drawn, the buy and hold's colour. */
  set(points: readonly EquityPoint[], readings: ReadonlyMap<number, Reading>, look: FillsLook, hold: string | null): void {
    const at = (p: EquityPoint) => readings.get(p.minute ?? p.time);
    Object.assign(this, { points, look, hold, balances: points.map((p) => at(p)?.balance ?? null), befores: points.map((p) => at(p)?.before ?? null),
                          holds: hold === null ? [] : points.map((p) => at(p)?.hold ?? null) });
    this.redraw?.();
  }

  /** Equity's range in view (`range`, over `view`) widened to take in equity before costs, by at most its own
   *  span again, so the band stays in the pane unless costs dwarf the line's own moves. */
  reach(range: Range, view: LogicalRange | null): Range {
    if (!view || !range) return range;
    let hi = range.maxValue, lo = range.minValue;
    for (let i = Math.max(0, Math.floor(view.from)); i <= Math.min(this.points.length - 1, Math.ceil(view.to)); i++) {
      const v = this.befores[i];
      if (v != null) { hi = Math.max(hi, v); lo = Math.min(lo, v); }
    }
    const span = Math.max(range.maxValue - range.minValue, 1);
    return { minValue: Math.max(lo, range.minValue - span), maxValue: Math.min(hi, range.maxValue + span) };
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>): void { Object.assign(this, { chart, series, redraw: requestUpdate }); }
  detached(): void { Object.assign(this, { chart: null, series: null, redraw: null }); }
  paneViews(): readonly IPrimitivePaneView[] {
    return [{ zOrder: () => "bottom", renderer: () => ({ draw: (target) => target.useBitmapCoordinateSpace((s) => inPlot(s.context, this.plot(), s.bitmapSize.width, s.verticalPixelRatio, () => this.draw(s))) }) }];
  }

  /** Over the points in view (four a pixel column at most): the costs' band and its rim, the buy and
   *  hold, then the open profit's band, filled flat twice: clipped above the balance, then below it. The
   *  bands and the rim fade into the plot's edges (equityZones), where a fee-heavy run's costs are cut. */
  private draw({ context: c, verticalPixelRatio: vr, horizontalPixelRatio: hr, bitmapSize }: Scope): void {
    const { chart, series, look, points } = this, range = chart?.timeScale().getVisibleLogicalRange();
    if (!chart || !series || !look || !range || points.length < 2) return;
    const plot = this.plot(), time = chart.timeScale(), Y = (v: number) => (series.priceToCoordinate(v) ?? Number.NaN) * vr;
    const X = (i: number) => (time.logicalToCoordinate(i as Logical) ?? Number.NaN) * hr;
    const from = Math.max(0, Math.floor(range.from) - 1), to = Math.min(points.length - 1, Math.ceil(range.to) + 1);
    const value = (i: number) => points[i]!.value;
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
    const held = (i: number) => this.holds[i] != null, hold = perColumn(from, to, X, (i) => this.holds[i]!, held);
    if (this.hold && hold.length > 1) {
      const path = new Path2D();
      hold.forEach((i, k) => path[k ? "lineTo" : "moveTo"](X(i), Y(this.holds[i]!)));
      Object.assign(c, { strokeStyle: this.hold, lineWidth: Math.max(1, Math.floor(hr)) });
      c.setLineDash([2 * hr, 2 * hr]); c.stroke(path); c.setLineDash([]);
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
