// The equity chart's open profit and loss as a filled block in place of a balance line, as the candle
// charts fill a trade (tradeBoxes.ts): the stretch between the balance (equity less the open profit) and
// the equity line, wherever they part, in the profit colour where equity is above the balance and the loss
// colour where below, drawn beneath the line.
import type { IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";
import type { Reading } from "../../model/equityReadings";
import type { EquityPoint } from "./equityLayers";
import { perColumn } from "./equityPlace";

export type FillsLook = { up: string; down: string };
type Scope = Parameters<Parameters<Parameters<IPrimitivePaneRenderer["draw"]>[0]["useBitmapCoordinateSpace"]>[0]>[0];

export class EquityFills implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private redraw: (() => void) | null = null;
  private points: readonly EquityPoint[] = [];
  private balances: (number | null)[] = [];
  private look: FillsLook | null = null;

  set(points: readonly EquityPoint[], readings: ReadonlyMap<number, Reading>, look: FillsLook): void {
    Object.assign(this, { points, look, balances: points.map((p) => readings.get(p.minute ?? p.time)?.balance ?? null) });
    this.redraw?.();
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>): void { Object.assign(this, { chart, series, redraw: requestUpdate }); }
  detached(): void { Object.assign(this, { chart: null, series: null, redraw: null }); }
  paneViews(): readonly IPrimitivePaneView[] {
    return [{ zOrder: () => "bottom", renderer: () => ({ draw: (target) => target.useBitmapCoordinateSpace((s) => this.draw(s)) }) }];
  }

  /** The band between equity and the balance over the points in view (four a pixel column at most), filled
   *  flat twice: clipped above the balance, then below it. */
  private draw({ context: c, verticalPixelRatio: vr, horizontalPixelRatio: hr, bitmapSize }: Scope): void {
    const { chart, series, look, points } = this, range = chart?.timeScale().getVisibleLogicalRange();
    if (!chart || !series || !look || !range || points.length < 2) return;
    const time = chart.timeScale(), Y = (v: number) => (series.priceToCoordinate(v) ?? Number.NaN) * vr;
    const X = (i: number) => (time.logicalToCoordinate(i as Logical) ?? Number.NaN) * hr;
    const from = Math.max(0, Math.floor(range.from) - 1), to = Math.min(points.length - 1, Math.ceil(range.to) + 1);
    const shown = perColumn(from, to, X, (i) => points[i]!.value, (i) => this.balances[i] !== null);
    if (shown.length < 2) return;
    const band = new Path2D(), above = new Path2D(), below = new Path2D(), base = (i: number) => Y(this.balances[i]!);
    shown.forEach((i, k) => band[k ? "lineTo" : "moveTo"](X(i), Y(points[i]!.value)));
    [...shown].reverse().forEach((i) => band.lineTo(X(i), base(i)));
    for (const clip of [above, below]) shown.forEach((i, k) => clip[k ? "lineTo" : "moveTo"](X(i), base(i)));
    const x0 = X(shown[0]!), x1 = X(shown.at(-1)!);
    above.lineTo(x1, 0); above.lineTo(x0, 0); above.closePath();
    below.lineTo(x1, bitmapSize.height); below.lineTo(x0, bitmapSize.height); below.closePath();
    for (const [clip, colour] of [[above, look.up], [below, look.down]] as const) { c.save(); c.clip(clip); c.fillStyle = colour; c.fill(band); c.restore(); }
  }
}
