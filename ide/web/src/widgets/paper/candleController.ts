// The candle chart itself, driven outside React so that panning and zooming never re-render the page:
// one chart with the contract's candles, its volume beneath them in the same pane (volumeBars.ts), the
// run's trades (tradeMarks.ts) and its levels (levels.ts, with the orders' dashed lines). The period is
// the controller's own (candleView.ts), changed once a pan or zoom has settled (a wheel zoom past what the
// period can show, on the next frame) with the moment under the pointer kept in place (viewAnchor.ts), a span just shown (a day picked) shown again;
// the candles are regrouped and drawn again in the same task, so no frame shows the old view over the
// new candles; the view comes back when the chart mounts again for the same run and contract. The legend reads two atoms: the period, and
// the candle under the pointer (else the last) with the close before it, or the offline stretch under it. The run's events, the tooltips,
// what a click on an arrow or a flag opens and the countdown are candleNotes.ts's. The value axis always
// fits what is shown (it cannot be dragged to scale), and the view never leaves the candles: it stops at
// the first one, a few candles right of the newest and, zooming out, at the whole run (candleView.ts).
import { CandlestickSeries, createChart, LineStyle, type AutoscaleInfo, type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { candleOpen, candles as gather, extend, type Candle } from "../../lib/bars";
import type { JournalLine } from "../../lib/paperApi";
import type { Fill, Held, PriceLine, Restart } from "../../model/paper";
import { atom } from "../../state/atom";
import type { Down } from "./downLook";
import { AxisTicks } from "./axisTicks";
import { candleAt, candleDowns, onScale, slotsFor } from "./candleDown";
import { CandleNotes } from "./candleNotes";
import { afterFonts, chartLook, chartOptions, priceFormat, seriesColors } from "./chartTheme";
import { chartLevels, lastLevel, orderLines } from "./chartLevels";
import { fence, firstPeriod, fitAll, periodFor, recall, remember, reshow, showFrom, widest } from "./candleView";
import { Levels } from "./levels";
import { arrows, tradeBoxes } from "./tradeBoxes";
import { TradeMarks } from "./tradeMarks";
import { restore, spacing, timeAt, whenSettled } from "./viewAnchor";
import { VolumeBars, type VolumeBar } from "./volumeBars";

export type Trading = { fills: readonly Fill[]; orders: readonly PriceLine[]; held: Held | null; places: number; size: number; events: readonly JournalLine[]; live: boolean; restarts: readonly Restart[] };
type Parts = { chart: IChartApi; candles: ISeriesApi<"Candlestick">; volume: ISeriesApi<"Custom", UTCTimestamp, VolumeBar>; marks: TradeMarks; levels: Levels; ticks: AxisTicks };
const at = (t: number) => t as UTCTimestamp;

export class CandleController {
  /** The period in minutes, 0 until the first bars. */
  readonly period = atom(0);
  readonly legend = atom<{ candle: Candle | null; previous: number | null; offline: Down | null }>({ candle: null, previous: null, offline: null });
  readonly notes = new CandleNotes();
  private parts: Parts | null = null;
  private lines = new Map<string, IPriceLine>(); private bars: readonly JournalLine[] = [];
  // The candles, their places on the time scale and the blanks among them, at least `least` a stretch (candleDown.ts).
  private data: Candle[] = []; private times: number[] = []; private downs: Down[] = []; private blanks = ""; private least = 0; private span: { from: number; to: number } | null = null;
  private trading: Trading = { fills: [], orders: [], held: null, places: 2, size: 0, events: [], live: false, restarts: [] };
  private dark = false; private hover: number | null = null;
  private release: (() => void) | null = null; private host: HTMLElement | null = null; private fenced: (() => void) | null = null;
  private key = ""; private gathered: { n: number; last: JournalLine | null } = { n: 0, last: null };  // the bars the candles hold

  /** On `element`, its view kept under `key` (the run and contract) for the next mount of the same. */
  mount(element: HTMLElement, key: string): void {
    Object.assign(this, { host: element, key });
    const chart = createChart(element, chartOptions());
    chart.applyOptions({ handleScale: { axisPressedMouseMove: { time: true, price: false } } });
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
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.23 }, entireTextOnly: true });  // the gaps' bands start at its top (eventFlags.ts)
    const levels = new Levels(), marks = new TradeMarks(() => levels.chips());
    candles.attachPrimitive(marks); candles.attachPrimitive(levels);
    const notes = this.notes.attach(candles, levels);
    chart.subscribeClick((param) => notes.click(String(param.hoveredObjectId ?? "")));
    const ticks = new AxisTicks(chart, [candles], { clear: 18, tags: () => levels.tags(), marks: () => notes.onAxis(),
      base: () => { const places = Math.max(0, this.trading.places); return priceFormat(places, Math.max(0, places - 2)); } });
    chart.subscribeCrosshairMove((param) => {
      this.hover = param.logical === undefined || !param.point ? null : Math.round(param.logical);
      this.showLegend();
      ticks.cross(param.point?.x ?? null, param.point?.y ?? null);
      notes.hover(String(param.hoveredObjectId ?? ""), param.point ?? null);
    });
    this.parts = { chart, candles, volume, marks, levels, ticks };
    // A zoom that takes the candles out of their band regroups them at once, not once it settles.
    const step = () => this.period.get() * 60;
    this.release = whenSettled(element, chart.timeScale(), (x) => this.settle(x), () => step() > 0 && periodFor(spacing(chart.timeScale()), step()) !== step());
    this.fenced = fence(chart.timeScale(), () => this.times.length);
    this.restyle();
    afterFonts(() => this.restyle());
    if (this.bars.length) this.setBars(this.bars);
  }

  destroy(): void {
    const time = this.parts?.chart.timeScale();
    if (time) remember(this.key, this.period.get(), time.getVisibleLogicalRange(), this.times.length);
    this.release?.(); this.notes.destroy(); this.parts?.chart.remove();
    Object.assign(this, { parts: null, release: null, host: null, fenced: null, lines: new Map(), data: [], gathered: { n: 0, last: null } });
    this.period.set(0);
  }

  setBars(bars: readonly JournalLine[]): void {
    this.bars = bars;
    const p = this.parts;
    if (!p || !bars.length) return;
    if (!this.period.get()) {
      // The view this contract had when it last showed, else the whole run.
      const saved = recall(this.key), span = (Number(bars.at(-1)!.ts_event) - Number(bars[0]!.ts_event)) / 1e9;
      const step = saved ? saved.minutes * 60 : firstPeriod(span, p.chart.timeScale().width() || (this.host?.clientWidth ?? 0));
      this.period.set(step / 60);
      this.draw(true);
      if (saved) reshow(p.chart.timeScale(), saved, this.times.length); else fitAll(p.chart.timeScale(), this.times.length, step);
      return;
    }
    this.draw(false);
  }

  setTrading(trading: Trading): void {
    const places = trading.places !== this.trading.places, restarted = trading.restarts !== this.trading.restarts;
    this.trading = trading; if (places) this.restyle();
    if (restarted) this.draw(true); else this.drawTrading();
  }

  setTheme(dark: boolean): void { this.dark = dark; this.restyle(); this.draw(true); }

  /** The open position's whole stretch in view, from the candle it opened in (ms). */
  showPosition(openedMs: number): void { if (this.parts && this.data.length) showFrom(this.parts.chart, this.times, candleOpen(openedMs * 1e6, this.period.get())); }

  /** The span from `from` to `to` (s, `to` left out) in view; the period follows once it settles, the span with it. */
  show(from: number, to: number): void { this.span = { from, to }; this.parts?.chart.timeScale().setVisibleRange({ from: at(from), to: at(to - this.period.get() * 60) }); }
  /** A span around `ms` forty candles either side. */
  showAround(ms: number): void { const span = this.period.get() * 60 * 40, t = Math.floor(ms / 1000); this.show(t - span, t + span); }

  private restyle(): void {
    const p = this.parts;
    if (!p) return;
    const c = seriesColors(this.dark); p.chart.applyOptions(chartLook());
    p.candles.applyOptions({ upColor: c.up, downColor: c.down, wickUpColor: c.up, wickDownColor: c.down });
    p.ticks.refresh();
  }

  /** The candles at the period from the bars: `all` sets them anew, else only the last few change (the
   *  bars that came since folded into them, when the bars they hold are still the first of these). */
  private draw(all: boolean): void {
    const p = this.parts, minutes = this.period.get(), { n, last } = this.gathered;
    if (!p || !minutes) return;
    const grows = !all && n > 0 && n <= this.bars.length && this.bars[n - 1] === last;
    const next = grows ? extend(this.data, this.bars.slice(n), minutes) : gather(this.bars, minutes), old = this.data, c = seriesColors(this.dark);
    const downs = candleDowns(next, this.trading.restarts, minutes), scale = onScale(next, downs, minutes, this.least), blanks = scale.blanks.join();
    this.gathered = { n: this.bars.length, last: this.bars.at(-1) ?? null };
    const volume = (k: Candle): VolumeBar => ({ time: at(k.time), value: k.volume, color: k.close >= k.open ? c.upVolume : c.downVolume });
    if (!all && blanks === this.blanks && old.length && next.length >= old.length && next[old.length - 1]?.time === old.at(-1)!.time) {
      for (const k of next.slice(old.length - 1)) { p.candles.update({ ...k, time: at(k.time) }); p.volume.update(volume(k)); }
    } else {
      p.candles.setData([...next.map((k) => ({ ...k, time: at(k.time) })), ...scale.blanks.map((t) => ({ time: at(t) }))].sort((a, b) => a.time - b.time));
      p.volume.setData(next.map(volume));
    }
    Object.assign(this, { data: next, times: scale.times, downs, blanks });
    this.fenced?.();
    this.drawTrading();
    this.showLegend();
  }

  /** Once the view has settled: a period whose candles sit better, or the blanks an offline stretch needs
   *  at the spacing, the time under `x` kept there; the ticks written anew either way. */
  private settle(x: number | null): void {
    const p = this.parts, step = this.period.get() * 60;
    if (!p || !step || !this.data.length) return;
    const time = p.chart.timeScale(), w = spacing(time), next = periodFor(w, step), least = this.trading.restarts.length ? slotsFor((w * next) / step) : 0, span = this.span;
    this.span = null; if (next === step && least === this.least) { this.fenced?.(); p.ticks.refresh(); return; }
    const anchor = x ?? time.width() / 2, t = timeAt(time, this.times, step, anchor);
    this.period.set(next / 60); this.least = least;
    time.applyOptions({ maxBarSpacing: widest(next) });
    this.draw(true);
    // A span just shown (show()) is shown again: kept by a moment, an offline stretch's blanks would move it.
    if (span) time.setVisibleRange({ from: at(span.from), to: at(span.to - next) }); else if (t !== null) restore(time, this.times, next, t, anchor, (w * next) / step);
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
    const boxes = tradeBoxes(fills, minutes, held, mark, last?.time ?? null, this.bars, this.trading.restarts);
    p.marks.set(boxes, arrows(fills, minutes, this.data), c.marks);
    this.notes.set({ events, fills, boxes, minutes, times: this.data.map((k) => k.time), downs: this.downs, places, size, live, lastBar: this.bars.length ? Number(this.bars.at(-1)!.ts_event) / 1e6 : null, look: c.flags });
    const levels = chartLevels({ orders, held, mark, places, size, c });
    orderLines(p.candles, this.lines, levels);
    p.levels.set(levels, { island: c.island, font: c.font }, lastLevel(last, places, c, this.dark));
    p.ticks.writePrices();
    p.ticks.hold(`↑ ${priceFormat(Math.max(0, places)).formatter((last?.high ?? 0) * 1.1)}`);
  }

  /** The candle under the pointer, else the last; over a blank, the offline stretch it is in. */
  private showLegend(): void {
    const t = this.hover === null ? undefined : this.times[this.hover], at = t === undefined ? -1 : candleAt(this.data, t);
    const offline = at < 0 && t !== undefined ? (this.downs.find((d) => t > d.from && t < d.to) ?? null) : null, i = offline ? -1 : at < 0 ? this.data.length - 1 : at;
    const candle = this.data[i] ?? null, previous = this.data[i - 1]?.close ?? null, now = this.legend.get();
    if (now.candle !== candle || now.previous !== previous || now.offline !== offline) this.legend.set({ candle, previous, offline });
  }
}
