// The candle chart itself, driven outside React so that panning and zooming never re-render the page:
// one chart with the contract's candles, its volume beneath them in the same pane (volumeBars.ts), the
// run's trades (tradeMarks.ts) and its levels (levels.ts, with the orders' dashed lines). The period is
// the controller's own (candleView.ts), changed only once a pan or zoom has settled and with the moment
// under the pointer kept in place (viewAnchor.ts); the candles are regrouped and drawn again in the same
// task, so no frame shows the old view over the new candles. The legend reads two atoms: the period, and
// the candle under the pointer (else the last) with the close before it. The run's events, the tooltips,
// what a click on an arrow or a flag opens and the countdown are candleNotes.ts's; a click on a pinned
// level's chip brings the levels back into view.
import { CandlestickSeries, createChart, LineStyle, type AutoscaleInfo, type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { candleOpen, candles as gather, type Candle } from "../../lib/bars";
import type { JournalLine } from "../../lib/paperApi";
import type { Fill, Held, PriceLine } from "../../model/paper";
import { atom } from "../../state/atom";
import { AxisTicks } from "./axisTicks";
import { CandleNotes } from "./candleNotes";
import { afterFonts, chartLook, chartOptions, priceFormat, seriesColors } from "./chartTheme";
import { chartLevels, lastLevel } from "./chartLevels";
import { firstPeriod, fitAll, periodFor, widest } from "./candleView";
import { Levels } from "./levels";
import { arrows, tradeBoxes } from "./tradeBoxes";
import { TradeMarks } from "./tradeMarks";
import { restore, spacing, timeAt, whenSettled } from "./viewAnchor";
import { VolumeBars, type VolumeBar } from "./volumeBars";

export type Trading = { fills: readonly Fill[]; orders: readonly PriceLine[]; held: Held | null; places: number; size: number; events: readonly JournalLine[]; live: boolean };
type Parts = { chart: IChartApi; candles: ISeriesApi<"Candlestick">; volume: ISeriesApi<"Custom", UTCTimestamp, VolumeBar>; marks: TradeMarks; levels: Levels; ticks: AxisTicks };
const at = (t: number) => t as UTCTimestamp;
const ROOM = 0.15;  // the most of the pane left empty right of the newest candle once a view settles

export class CandleController {
  /** The period in minutes, 0 until the first bars. */
  readonly period = atom(0);
  readonly legend = atom<{ candle: Candle | null; previous: number | null }>({ candle: null, previous: null });
  readonly notes = new CandleNotes();
  private parts: Parts | null = null;
  private lines = new Map<string, IPriceLine>();
  private bars: readonly JournalLine[] = [];
  private data: Candle[] = [];
  private hover: number | null = null;
  private trading: Trading = { fills: [], orders: [], held: null, places: 2, size: 0, events: [], live: false };
  private dark = false;
  private release: (() => void) | null = null; private host: HTMLElement | null = null;

  mount(element: HTMLElement): void {
    this.host = element;
    const chart = createChart(element, chartOptions());
    // Added first so the candles draw over it; its scale fills the pane's lowest fifth but the events' strip.
    const volume = chart.addCustomSeries(new VolumeBars(), { priceScaleId: "", priceLineVisible: false, lastValueVisible: false,
      autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => { const found = base(); return found?.priceRange ? { ...found, priceRange: { ...found.priceRange, minValue: 0 } } : found; } }) as Parts["volume"];
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0.045 } });  // the events' strip under it (eventFlags.ts)
    // The last price's tag is the levels' own (levels.ts); the series' would follow the last candle in view.
    // Its line sparsely dotted, unlike the orders' dashes.
    const candles = chart.addSeries(CandlestickSeries, { borderVisible: false, lastValueVisible: false, priceLineStyle: LineStyle.SparseDotted,
      autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => {
        const found = base(), { orders, held } = this.trading, prices = [...orders.map((o) => o.price), ...(held ? [held.average] : [])];
        if (!found?.priceRange || !prices.length) return found;
        return { ...found, priceRange: { minValue: Math.min(found.priceRange.minValue, ...prices), maxValue: Math.max(found.priceRange.maxValue, ...prices) } };
      } });
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.23 }, entireTextOnly: true });
    const levels = new Levels(), marks = new TradeMarks(() => levels.chips());
    candles.attachPrimitive(marks); candles.attachPrimitive(levels);
    const notes = this.notes.attach(candles, levels);
    chart.subscribeClick((param) => {
      const id = String(param.hoveredObjectId ?? "");
      if (id.startsWith("level:")) chart.priceScale("right").applyOptions({ autoScale: true }); else notes.click(id);
    });
    const ticks = new AxisTicks(chart, [candles], { clear: 18, tags: () => levels.tags(),
      base: () => { const places = Math.max(0, this.trading.places); return priceFormat(places, Math.max(0, places - 2)); } });
    chart.subscribeCrosshairMove((param) => {
      this.hover = param.logical === undefined || !param.point ? null : Math.round(param.logical);
      this.showLegend();
      ticks.cross(param.point?.x ?? null, param.point?.y ?? null);
      notes.hover(String(param.hoveredObjectId ?? ""), param.point ?? null);
    });
    this.parts = { chart, candles, volume, marks, levels, ticks };
    this.release = whenSettled(element, chart.timeScale(), (x) => this.settle(x));
    this.restyle();
    afterFonts(() => this.restyle());
    if (this.bars.length) this.setBars(this.bars);
  }

  destroy(): void {
    this.release?.(); this.notes.destroy(); this.parts?.chart.remove();
    Object.assign(this, { parts: null, release: null, host: null, lines: new Map(), data: [] });
    this.period.set(0);
  }

  setBars(bars: readonly JournalLine[]): void {
    this.bars = bars;
    const p = this.parts;
    if (!p || !bars.length) return;
    if (!this.period.get()) {
      const span = (Number(bars.at(-1)!.ts_event) - Number(bars[0]!.ts_event)) / 1e9, step = firstPeriod(span, p.chart.timeScale().width() || (this.host?.clientWidth ?? 0));
      this.period.set(step / 60);
      this.draw(true);
      fitAll(p.chart.timeScale(), this.data.length, step);
      return;
    }
    this.draw(false);
  }

  setTrading(trading: Trading): void {
    const places = trading.places !== this.trading.places;
    this.trading = trading;
    if (places) this.restyle();
    this.drawTrading();
  }

  setTheme(dark: boolean): void {
    this.dark = dark;
    this.restyle();
    this.draw(true);
  }

  /** The open position's whole stretch in view, from the candle it opened in (ms). */
  showPosition(openedMs: number): void {
    const p = this.parts, n = this.data.length;
    if (!p || !n) return;
    const from = candleOpen(openedMs * 1e6, this.period.get()), i = Math.max(0, this.data.findIndex((k) => k.time >= from));
    p.chart.timeScale().setVisibleLogicalRange({ from: i - Math.max(8, (n - i) * 0.25), to: n - 1 + 6 });
    p.chart.priceScale("right").applyOptions({ autoScale: true });
  }

  /** The span from `from` to `to` (s) in view; the period follows once it settles. */
  show(from: number, to: number): void { this.parts?.chart.timeScale().setVisibleRange({ from: at(from), to: at(to) }); }
  /** A span around `ms` forty candles either side. */
  showAround(ms: number): void { const span = this.period.get() * 60 * 40, t = Math.floor(ms / 1000); this.show(t - span, t + span); }

  private restyle(): void {
    const p = this.parts;
    if (!p) return;
    const c = seriesColors(this.dark); p.chart.applyOptions(chartLook());
    p.candles.applyOptions({ upColor: c.up, downColor: c.down, wickUpColor: c.up, wickDownColor: c.down });
    p.ticks.refresh();
  }

  /** The candles at the period from the bars: `all` sets them anew, else only the last few change. */
  private draw(all: boolean): void {
    const p = this.parts, minutes = this.period.get();
    if (!p || !minutes) return;
    const next = gather(this.bars, minutes), old = this.data, c = seriesColors(this.dark);
    const volume = (k: Candle): VolumeBar => ({ time: at(k.time), value: k.volume, color: k.close >= k.open ? c.upVolume : c.downVolume });
    if (!all && old.length && next.length >= old.length && next[old.length - 1]?.time === old.at(-1)!.time) {
      for (const k of next.slice(old.length - 1)) { p.candles.update({ ...k, time: at(k.time) }); p.volume.update(volume(k)); }
    } else {
      p.candles.setData(next.map((k) => ({ ...k, time: at(k.time) })));
      p.volume.setData(next.map(volume));
    }
    this.data = next;
    this.drawTrading();
    this.showLegend();
  }

  /** Once the view has settled: a period whose candles sit better, the time under `x` kept there (else
   *  only the space right of the newest candle kept within ROOM); the ticks written anew either way. */
  private settle(x: number | null): void {
    const p = this.parts, step = this.period.get() * 60;
    if (!p || !step || !this.data.length) return;
    const time = p.chart.timeScale(), w = spacing(time), next = periodFor(w, step), room = (time.width() / (w || 1)) * ROOM;
    if (next === step) { if (time.scrollPosition() > room) time.scrollToPosition(room, false); p.ticks.refresh(); return; }
    const anchor = x ?? time.width() / 2, t = timeAt(time, this.data.map((k) => k.time), step, anchor);
    this.period.set(next / 60);
    time.applyOptions({ maxBarSpacing: widest(next) });
    this.draw(true);
    if (t !== null) restore(time, this.data.map((k) => k.time), next, t, anchor, (w * next) / step);
    // The legend follows the candle now under the pointer, not the index it had before the regrouping.
    const l = x === null ? null : time.coordinateToLogical(x);
    this.hover = l === null ? null : Math.round(l);
    this.showLegend();
    p.ticks.refresh();
  }

  private drawTrading(): void {
    const p = this.parts, minutes = this.period.get();
    if (!p || !minutes) return;
    const { fills, orders, held, places, size, events, live } = this.trading, c = seriesColors(this.dark), last = this.data.at(-1) ?? null, mark = last?.close ?? null;
    const boxes = tradeBoxes(fills, minutes, held, mark, last?.time ?? null, this.bars);
    p.marks.set(boxes, arrows(fills, minutes, this.data), c.marks);
    this.notes.set({ events, fills, boxes, minutes, times: this.data.map((k) => k.time), places, size, live, lastBar: this.bars.length ? Number(this.bars.at(-1)!.ts_event) / 1e6 : null, look: c.flags });
    const levels = chartLevels({ orders, held, mark, places, size, c }), lined = levels.filter((l) => l.line);
    for (const [id, line] of this.lines) if (!lined.some((l) => l.id === id)) { p.candles.removePriceLine(line); this.lines.delete(id); }
    for (const level of lined) {
      // An order's own dashed line; its tag is the levels' own, stacked with the others.
      const options = { price: level.price, color: level.color, lineWidth: 1 as const, lineStyle: LineStyle.Dashed, title: "", axisLabelVisible: false };
      const line = this.lines.get(level.id);
      if (line) line.applyOptions(options); else this.lines.set(level.id, p.candles.createPriceLine(options));
    }
    p.levels.set(levels, { island: c.island, font: c.font }, lastLevel(last, places, c, this.dark));
    p.ticks.writePrices();
    p.ticks.hold(`↑ ${priceFormat(Math.max(0, places)).formatter((last?.high ?? 0) * 1.1)}`);
  }

  private showLegend(): void {
    const i = this.hover !== null && this.hover >= 0 && this.hover < this.data.length ? this.hover : this.data.length - 1;
    const candle = this.data[i] ?? null, previous = this.data[i - 1]?.close ?? null, now = this.legend.get();
    if (now.candle !== candle || now.previous !== previous) this.legend.set({ candle, previous });
  }
}
