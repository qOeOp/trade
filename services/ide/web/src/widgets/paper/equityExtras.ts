// What the Account chart shows beside equity and its layers (equityReadings.ts): the open profit and
// loss as a filled block between the balance and the line (equityFills.ts), equity before fees and funding
// as a fine dotted line (the gap is what costs took), on request an equal-weight buy and hold of the run's
// contracts as a fine dashed line, both kept out of the value axis's fit (so neither costs nor a market
// move can flatten the equity line); and the gross exposure as an indicator in a band of its own along the
// pane's foot (below the day bars), a faint indigo step area on a scale of its own from none to all of
// equity (or more, with leverage), as the candle charts lay volume. The run's events are not flagged here:
// they are in Events, and on each contract's chart.
import { BaselineSeries, LineSeries, LineStyle, LineType, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import type { Reading } from "../../model/equityReadings";
import { EquityFills, type FillsLook } from "./equityFills";
import type { EquityPoint } from "./equityLayers";

export type ExtrasLook = { fills: FillsLook; before: string; hold: string; exposure: string; exposureFill: string };
type Shown = { points: readonly EquityPoint[]; readings: ReadonlyMap<number, Reading>; hold: boolean; look: ExtrasLook };
const BAND = 30;  // px: the exposure's band
const quiet = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };

export class EquityExtras {
  private readonly fills = new EquityFills();
  private s: { before: ISeriesApi<"Line">; hold: ISeriesApi<"Line">; exposure: ISeriesApi<"Baseline"> } | null = null;
  private shown: Shown | null = null;
  private applied = "";

  /** Adds its series to `chart`, its fills to the equity series. */
  attach(chart: IChartApi, equity: ISeriesApi<"Line">): this {
    const line = (style: LineStyle, extra = {}) => chart.addSeries(LineSeries, { ...quiet, lineWidth: 1, lineStyle: style, priceFormat: equity.options().priceFormat, ...extra });
    const off = { autoscaleInfoProvider: () => null };
    const before = line(LineStyle.Dotted, off), hold = line(LineStyle.Dashed, off);
    // Its own scale, hidden, from none to all of equity or the most it reached, fitted to its band (px) at
    // the foot; filled from none up, so a flat stretch shows nothing.
    const exposure = chart.addSeries(BaselineSeries, { ...quiet, lineWidth: 1, lineType: LineType.WithSteps, priceScaleId: "exposure",
      baseValue: { type: "price", price: 0 }, bottomLineColor: "transparent", bottomFillColor1: "transparent", bottomFillColor2: "transparent",
      autoscaleInfoProvider: (base: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
        const h = chart.paneSize(0).height;
        return { priceRange: { minValue: 0, maxValue: Math.max(base()?.priceRange.maxValue ?? 0, 1) }, margins: { above: Math.max(0, h - BAND), below: 0 } };
      } });
    exposure.priceScale().applyOptions({ scaleMargins: { top: 0, bottom: 0 } });
    equity.attachPrimitive(this.fills);
    this.s = { before, hold, exposure };
    return this;
  }

  set(shown: Shown): void {
    const s = this.s, { points, readings, look } = shown;
    this.shown = shown;
    if (!s) return;
    const data = (pick: (r: Reading) => number | null) => points.flatMap((p) => {
      const v = readings.get(p.minute ?? p.time), value = v ? pick(v) : null;
      return value === null ? [] : [{ time: p.time as UTCTimestamp, value }];
    });
    // Options only when they change: each is a full update, and with the step changing faster than the
    // chart draws it would recolour bars that are no longer there.
    const key = [look.before, look.hold, look.exposure, look.exposureFill, shown.hold].join();
    if (key !== this.applied) {
      this.applied = key;
      s.before.applyOptions({ color: look.before });
      s.hold.applyOptions({ color: look.hold, visible: shown.hold });
      s.exposure.applyOptions({ topLineColor: look.exposure, topFillColor1: look.exposureFill, topFillColor2: look.exposureFill });
    }
    this.fills.set(points, readings, look.fills);
    s.before.setData(data((r) => r.before));
    s.hold.setData(data((r) => r.hold));
    s.exposure.setData(data((r) => r.exposure));
  }

  /** How much of the foot the exposure takes (px), for the day bars to sit above. */
  foot(): number { return this.shown?.readings.size ? BAND : 0; }

  destroy(): void { this.s = null; }
}
