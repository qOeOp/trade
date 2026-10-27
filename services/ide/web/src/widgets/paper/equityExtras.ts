// What the Account chart shows beside equity and its layers (equityReadings.ts): the open profit and
// loss as a filled block between the balance and the line (equityFills.ts), equity before fees and funding
// as a fine dotted line (the gap is what costs took), on request an equal-weight buy and hold of the run's
// contracts as a fine dashed line, both kept out of the value axis's fit (so neither costs nor a market
// move can flatten the equity line); the gross exposure as an indicator in a band of its own along the
// pane's foot (above the flags, below the day bars), a faint indigo step area on a scale of its own from
// none to all of equity (or more, with leverage), as the candle charts lay volume; and the run's events as the candle charts' flags along the foot (eventFlags.ts),
// every contract's together. A flag's tooltip lists its events; a click on it opens its line in Events.
import { BaselineSeries, LineSeries, LineStyle, LineType, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { symbolOf, type JournalLine, type Precision } from "../../lib/paperApi";
import type { Reading } from "../../model/equityReadings";
import { atom } from "../../state/atom";
import { highlighted, tradesTab } from "../../state/paperStream";
import { flags, flagTip, gaps, type Tip } from "./candleEvents";
import { EquityFills, type FillsLook } from "./equityFills";
import type { EquityPoint } from "./equityLayers";
import { EventFlags, STRIP, type FlagsLook } from "./eventFlags";

export type ExtrasLook = { fills: FillsLook; before: string; hold: string; exposure: string; exposureFill: string; flags: FlagsLook };
type Shown = { points: readonly EquityPoint[]; readings: ReadonlyMap<number, Reading>; events: readonly JournalLine[];
  digits: ReadonlyMap<string, Precision>; step: number; hold: boolean; look: ExtrasLook };
const BAND = 30;  // px: the exposure's band
const quiet = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };

export class EquityExtras {
  readonly tip = atom<Tip | null>(null);
  private readonly flags = new EventFlags();
  private readonly fills = new EquityFills();
  private s: { before: ISeriesApi<"Line">; hold: ISeriesApi<"Line">; exposure: ISeriesApi<"Baseline"> } | null = null;
  private shown: Shown | null = null;
  private applied = "";

  /** Adds its series to `chart`, its flags to the equity series. */
  attach(chart: IChartApi, equity: ISeriesApi<"Line">): this {
    const line = (style: LineStyle, extra = {}) => chart.addSeries(LineSeries, { ...quiet, lineWidth: 1, lineStyle: style, priceFormat: equity.options().priceFormat, ...extra });
    const off = { autoscaleInfoProvider: () => null };
    const before = line(LineStyle.Dotted, off), hold = line(LineStyle.Dashed, off);
    // Its own scale, hidden, from none to all of equity or the most it reached, fitted to its band (px) above
    // the flags; filled from none up, so a flat stretch shows nothing.
    const exposure = chart.addSeries(BaselineSeries, { ...quiet, lineWidth: 1, lineType: LineType.WithSteps, priceScaleId: "exposure",
      baseValue: { type: "price", price: 0 }, bottomLineColor: "transparent", bottomFillColor1: "transparent", bottomFillColor2: "transparent",
      autoscaleInfoProvider: (base: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
        const strip = this.shown?.events.length ? STRIP : 0, h = chart.paneSize(0).height;
        return { priceRange: { minValue: 0, maxValue: Math.max(base()?.priceRange.maxValue ?? 0, 1) }, margins: { above: Math.max(0, h - strip - BAND), below: strip } };
      } });
    exposure.priceScale().applyOptions({ scaleMargins: { top: 0, bottom: 0 } });
    equity.attachPrimitive(this.fills);
    equity.attachPrimitive(this.flags);
    this.s = { before, hold, exposure };
    return this;
  }

  set(shown: Shown): void {
    const s = this.s, { points, readings, events, step, look } = shown;
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
    const minutes = Math.max(1, step / 60);
    this.flags.set(flags(events, minutes, points.map((p) => p.time)), gaps(events, minutes), look.flags);
  }

  /** The pointer over hover target `id` at `point`, or over nothing. */
  hover(id: string, point: { x: number; y: number } | null): void {
    const pill = this.flags.pill(id), n = this.shown;
    if (!pill || !point || !n) { if (this.tip.get()) this.tip.set(null); return; }
    const same = this.tip.get();
    if (same && same.x === point.x && same.y === point.y) return;
    const digits = new Map(pill.lines.map((l) => [symbolOf(l.instrument_id), n.digits.get(symbolOf(l.instrument_id)) ?? { price: -1, size: -1 }]));
    this.tip.set(flagTip(pill.lines, digits, point.x, point.y));
  }

  /** A click on hover target `id`: a flag opens its newest line in Events. */
  click(id: string): void {
    const line = this.flags.pill(id)?.lines.at(-1);
    if (line) { highlighted.set(line); tradesTab.set("events"); }
  }

  /** How much of the foot the flags and the exposure take (px), for the day bars to sit above. */
  foot(): number { return (this.shown?.events.length ? STRIP : 0) + (this.shown?.readings.size ? BAND : 0); }

  destroy(): void { this.tip.set(null); this.s = null; }
}
