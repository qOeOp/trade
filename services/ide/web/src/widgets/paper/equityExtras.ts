// What the Account chart shows beside equity and its layers (equityReadings.ts): on the equity pane the
// balance as a fine step line (the gap to equity is the open profit), equity before fees and funding as a
// fine dotted line (the gap is what costs took), on request an equal-weight buy and hold of the run's
// contracts as a fine dashed line, both kept out of the value axis's fit (so neither costs nor a market
// move can flatten the equity line),
// and the run's events as the candle charts' flags along the foot (eventFlags.ts), every contract's
// together; below, a pane of shares of equity: the gross exposure as an indigo area and the margin in use
// as a grey line, its label and values (under the pointer, else the last) at its top left. A flag's
// tooltip lists its events; a click on it opens its line in Events.
import { AreaSeries, LineSeries, LineStyle, LineType, type IChartApi, type IPrimitivePaneView, type ISeriesApi, type ISeriesPrimitive,
  type SeriesAttachedParameter, type Time, type UTCTimestamp } from "lightweight-charts";
import { symbolOf, type JournalLine, type Precision } from "../../lib/paperApi";
import type { Reading } from "../../model/equityReadings";
import { atom } from "../../state/atom";
import { highlighted, tradesTab } from "../../state/paperStream";
import { flags, flagTip, gaps, type Tip } from "./candleEvents";
import type { EquityPoint } from "./equityLayers";
import { EventFlags, STRIP, type FlagsLook } from "./eventFlags";

export type ExtrasLook = { balance: string; before: string; hold: string; exposure: string; exposureFill: string; margin: string;
  text: string; value: string; island: string; font: string; flags: FlagsLook };
type Shown = { points: readonly EquityPoint[]; readings: ReadonlyMap<number, Reading>; events: readonly JournalLine[];
  digits: ReadonlyMap<string, Precision>; step: number; hold: boolean; look: ExtrasLook };
const EXPOSURE_PANE = 0.3;  // the exposure pane's height, as a share of the equity pane's
// A share as 4.2% below a tenth, else 82%.
const percent = (r: number) => `${Math.abs(r) < 0.1 && r !== 0 ? (r * 100).toFixed(1) : Math.round(r * 100)}%`;
const share = { type: "custom" as const, minMove: 0.0001, formatter: percent, tickmarksFormatter: (prices: readonly number[]) => prices.map(percent) };
const quiet = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };

/** The exposure pane's label and its values, at the pane's top left. */
class PaneLabel implements ISeriesPrimitive<Time> {
  private redraw: (() => void) | null = null;
  private parts: { text: string; color: string; swatch?: string }[] = [];
  private look: ExtrasLook | null = null;
  set(parts: PaneLabel["parts"], look: ExtrasLook): void { Object.assign(this, { parts, look }); this.redraw?.(); }
  attached({ requestUpdate }: SeriesAttachedParameter<Time>): void { this.redraw = requestUpdate; }
  detached(): void { this.redraw = null; }
  paneViews(): readonly IPrimitivePaneView[] {
    return [{ zOrder: () => "top", renderer: () => ({ draw: (target) => target.useBitmapCoordinateSpace(({ context: c, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      const look = this.look;
      if (!look) return;
      c.font = look.font.replace(/(\d+)px/, (_, n: string) => `${Number(n) * vr}px`);
      c.textBaseline = "middle";
      let x = 8 * hr;
      const y = 12 * vr, width = this.parts.reduce((w, p) => w + c.measureText(p.text).width + (p.swatch ? 16 * hr : 0) + 10 * hr, 0);
      c.fillStyle = look.island;
      c.fillRect(4 * hr, 3 * vr, width, 18 * vr);
      for (const p of this.parts) {
        if (p.swatch) { c.fillStyle = p.swatch; c.fillRect(x, y - hr, 12 * hr, 2 * hr); x += 16 * hr; }
        c.fillStyle = p.color;
        c.fillText(p.text, x, y + vr);
        x += c.measureText(p.text).width + 10 * hr;
      }
    }) }) }];
  }
}

export class EquityExtras {
  readonly tip = atom<Tip | null>(null);
  private readonly flags = new EventFlags();
  private readonly label = new PaneLabel();
  private s: { balance: ISeriesApi<"Line">; before: ISeriesApi<"Line">; hold: ISeriesApi<"Line">; exposure: ISeriesApi<"Area">; margin: ISeriesApi<"Line"> } | null = null;
  private shown: Shown | null = null;
  private hovered: number | null = null;

  /** Adds its series to `chart`, its flags to the equity series. */
  attach(chart: IChartApi, equity: ISeriesApi<"Line">): this {
    const line = (style: LineStyle, extra = {}) => chart.addSeries(LineSeries, { ...quiet, lineWidth: 1, lineStyle: style, priceFormat: equity.options().priceFormat, ...extra });
    const off = { autoscaleInfoProvider: () => null };
    const balance = line(LineStyle.Solid, { lineType: LineType.WithSteps }), before = line(LineStyle.Dotted, off), hold = line(LineStyle.Dashed, off);
    const floor = { autoscaleInfoProvider: (base: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
      const r = base();
      return { priceRange: { minValue: 0, maxValue: Math.max(r?.priceRange.maxValue ?? 0, 0.05) } };
    } };
    const exposure = chart.addSeries(AreaSeries, { ...quiet, lineWidth: 1, priceFormat: share, ...floor }, 1);
    const margin = chart.addSeries(LineSeries, { ...quiet, lineWidth: 2, priceFormat: share, ...floor }, 1);
    exposure.priceScale().applyOptions({ scaleMargins: { top: 0.3, bottom: 0 }, entireTextOnly: true });
    chart.panes()[1]?.setStretchFactor(EXPOSURE_PANE);
    equity.attachPrimitive(this.flags);
    exposure.attachPrimitive(this.label);
    this.s = { balance, before, hold, exposure, margin };
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
    s.balance.applyOptions({ color: look.balance });
    s.before.applyOptions({ color: look.before });
    s.hold.applyOptions({ color: look.hold, visible: shown.hold });
    s.exposure.applyOptions({ lineColor: look.exposure, topColor: look.exposureFill, bottomColor: look.exposureFill });
    s.margin.applyOptions({ color: look.margin });
    s.balance.setData(data((r) => r.balance));
    s.before.setData(data((r) => r.before));
    s.hold.setData(data((r) => r.hold));
    s.exposure.setData(data((r) => r.exposure));
    s.margin.setData(data((r) => r.margin));
    const minutes = Math.max(1, step / 60);
    this.flags.set(flags(events, minutes, points.map((p) => p.time)), gaps(events, minutes), look.flags);
    this.labelAt(this.hovered);
  }

  /** The point under the pointer (its index), for the pane's values. */
  point(index: number | null): void { if (index !== this.hovered) { this.hovered = index; this.labelAt(index); } }

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

  /** How much of the foot the flags take (px), for the day bars to sit above. */
  foot(): number { return this.shown?.events.length ? STRIP : 0; }

  destroy(): void { this.tip.set(null); this.s = null; }

  private labelAt(index: number | null): void {
    const n = this.shown;
    if (!n) return;
    const p = n.points[index ?? n.points.length - 1], r = p ? n.readings.get(p.minute ?? p.time) : undefined, look = n.look;
    this.label.set([
      { text: "Gross exposure", color: look.text, swatch: look.exposure }, { text: r?.exposure != null ? percent(r.exposure) : "–", color: look.value },
      { text: "Margin in use", color: look.text, swatch: look.margin }, { text: r?.margin != null ? percent(r.margin) : "–", color: look.value },
    ], look);
  }
}
