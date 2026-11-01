// The candle chart itself, driven outside React so that panning and zooming never re-render the page:
// one chart with the contract's candles, its volume beneath them in the same pane (candleSeries.ts), the
// run's trades (candleTrading.ts). The period is the controller's own (candleView.ts), changed once a pan or
// zoom has settled (a wheel zoom past what the period can show, on the next frame) with the moment under the
// pointer kept in place (viewAnchor.ts), a span just shown (a day picked, a stretch's name clicked) shown
// again; the candles are regrouped and drawn again in the same task, so no frame shows the old view over the
// new candles; the view comes back when the chart mounts again for the same run and contract. The legend
// reads two atoms: the period, and the candle under the pointer (else the last) with the close before it, or
// the offline stretch under it. First may come the backtest's day candles, not regrouped, or blank days
// (backtestCandles.ts). Events, tooltips and clicks are candleNotes.ts's, the backtest's cycles too; the
// stretches' names and first view candleStretches.ts's. The value axis fits what is shown; the view stops at
// the first candle, a few right of the newest and, zooming out, at all of them (candleView.ts).
import type { IPriceLine, UTCTimestamp } from "lightweight-charts";
import { candleOpen, candles as gather, extend, type Candle } from "../../lib/bars";
import type { JournalLine } from "../../lib/paperApi";
import { atom } from "../../state/atom";
import type { Down } from "./downLook";
import { AxisTicks } from "./axisTicks";
import type { Lead } from "./backtestCandles";
import { candleAt, candleDowns, onScale, slotsFor } from "./candleDown";
import { CandleNotes } from "./candleNotes";
import { candleSeries } from "./candleSeries";
import { CandleStretches, type CandleSpan } from "./candleStretches";
import { drawTrading, type Parts, type Trading } from "./candleTrading";
import { afterFonts, chartLook, priceFormat, seriesColors } from "./chartTheme";
import { fence, firstPeriod, fitAll, periodFor, recall, remember, reshow, respaced, showFrom, showSpan, wholePeriod, widest, dayFloor } from "./candleView";
import { Levels } from "./levels";
import { showStretch } from "./stretchKeys";
import { TradeMarks } from "./tradeMarks";
import { restore, spacing, timeAt, whenSettled } from "./viewAnchor";
import type { VolumeBar } from "./volumeBars";

export type { Trading };
const at = (t: number) => t as UTCTimestamp;

export class CandleController {
  /** The period in minutes, 0 until the first bars. */
  readonly period = atom(0);
  readonly legend = atom<{ candle: Candle | null; previous: number | null; offline: Down | null; day: boolean }>({ candle: null, previous: null, offline: null, day: false });
  readonly notes = new CandleNotes(() => this.times);
  readonly stretches = new CandleStretches(() => this.parts?.chart ?? null, () => this.times);
  private lead: Lead | null = null; private days = 0; private leading = 0;  // the backtest's; its candles in `data`, its places
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
    const { chart, candles, volume } = candleSeries(element, () => { const { orders, held } = this.trading; return [...orders.map((o) => o.price), ...(held ? [held.average] : [])]; });
    const levels = new Levels(), marks = new TradeMarks(() => levels.chips());
    candles.attachPrimitive(marks); candles.attachPrimitive(levels); candles.attachPrimitive(this.stretches.captions);
    const notes = this.notes.attach(candles, levels);
    chart.subscribeClick((param) => {
      const k = param.point ? this.stretches.captions.at(param.point.x, param.point.y) : null;
      if (k === null) notes.click(String(param.hoveredObjectId ?? "")); else { showStretch(this.stretches.spans[k]!); this.fitStretch(k); }
    });
    const ticks = new AxisTicks(chart, [candles], { clear: 18, tags: () => levels.tags(), marks: () => [...notes.onAxis(), ...this.stretches.captions.onAxis()],
      base: () => { const places = Math.max(0, this.trading.places); return priceFormat(places, Math.max(0, places - 2)); } });
    chart.subscribeCrosshairMove((param) => {
      this.hover = param.logical === undefined || !param.point ? null : Math.round(param.logical);
      this.showLegend();
      ticks.cross(param.point?.x ?? null, param.point?.y ?? null);
      notes.hover(String(param.hoveredObjectId ?? ""), param.point ?? null);
    });
    this.parts = { chart, candles, volume, marks, levels, ticks };
    // A zoom that takes the candles out of their band regroups them at once, not once it settles.
    const step = () => this.period.get() * 60, time = chart.timeScale();
    this.release = whenSettled(element, time, (x) => this.settle(x), () => step() > 0 && periodFor(spacing(time), step()) !== step());
    this.fenced = fence(time, () => this.times.length);
    this.restyle();
    afterFonts(() => this.restyle());
    if (this.bars.length || this.lead) this.setBars(this.bars);
  }

  destroy(): void {
    const time = this.parts?.chart.timeScale();
    if (time) remember(this.key, this.period.get(), time.getVisibleLogicalRange(), this.times.length);
    this.release?.(); this.notes.destroy(); this.parts?.chart.remove();
    Object.assign(this, { parts: null, release: null, host: null, fenced: null, lines: new Map(), data: [], gathered: { n: 0, last: null } }); this.period.set(0);
  }

  /** The paper runs' bars and the backtest's stretch before them (`lead`), together, so the first view sees both. */
  setBars(bars: readonly JournalLine[], lead: Lead | null = this.lead): void {
    const anew = lead !== this.lead;
    Object.assign(this, { bars, lead }); if (anew) this.notes.cycles(lead?.cycles ?? [], seriesColors(this.dark).cycles);
    const p = this.parts;
    if (!p || (!bars.length && !this.lead)) return;
    if (!this.period.get()) {
      // The view this contract last had, else the first view, else all; by the bars (a minute each).
      const saved = recall(this.key), span = this.stretches.firstSpan(bars) ?? bars.length * 60, time = p.chart.timeScale();
      const step = saved ? saved.minutes * 60 : firstPeriod(span, time.width() || (this.host?.clientWidth ?? 0));
      this.period.set(step / 60);
      this.draw(true);
      const view = this.stretches.firstView();  // a span (show()), kept as the period settles
      if (saved) reshow(time, saved, this.times.length); else if (view) this.show(view.from, view.to + step); else fitAll(time, this.times.length, step, this.floor(this.times[0], step));
      return;
    }
    this.draw(anew);
  }

  setTrading(trading: Trading): void {
    const places = trading.places !== this.trading.places, restarted = trading.restarts !== this.trading.restarts;
    this.trading = trading; if (places) this.restyle();
    if (restarted) this.draw(true); else this.drawTrading();
  }

  setTheme(dark: boolean): void { this.dark = dark; this.restyle(); this.draw(true); }
  setStretches(spans: readonly CandleSpan[]): void { this.stretches.set(spans, seriesColors(this.dark).captions); }
  /** The stretch `k` in view; all of them. */
  fitStretch(k: number): void { const s = this.stretches.spans[k]; if (s) this.show(s.from, s.to + this.period.get() * 60); }
  whole(): void {  // all in view, at the period that fits them
    const p = this.parts, step = this.period.get() * 60, next = p ? wholePeriod(this.bars.length * 60, this.leading, p.chart.timeScale().width()) : 0;
    if (!p || !step) return; if (next !== step) { this.period.set(next / 60); this.draw(true); }
    fitAll(p.chart.timeScale(), this.times.length, next, this.floor(this.times[0], next));
  }

  /** The open position's whole stretch in view, from the candle it opened in (ms). */
  showPosition(openedMs: number): void { if (this.parts && this.data.length) showFrom(this.parts.chart, this.times, candleOpen(openedMs * 1e6, this.period.get())); }

  /** The span from `from` to `to` (s, `to` left out) in view; the period follows once it settles, the span with it. */
  show(from: number, to: number): void { this.span = { from, to }; if (this.parts) showSpan(this.parts.chart.timeScale(), this.times, from, to - this.period.get() * 60, this.floor(from)); }
  /** The narrowest a candle may settle at in a view from `from` (s): LO px where it holds days (dayFloor). */
  private floor = (from = 0, step = this.period.get() * 60) => dayFloor(step, this.leading > 0 && from < (this.times[this.leading] ?? Infinity));
  /** A span around `ms` forty candles either side. */
  showAround(ms: number): void { const span = this.period.get() * 60 * 40, t = Math.floor(ms / 1000); this.show(t - span, t + span); }

  private restyle(): void {
    const p = this.parts; if (!p) return;
    const c = seriesColors(this.dark); p.chart.applyOptions(chartLook()); this.stretches.set(this.stretches.spans, c.captions); this.notes.cycles(this.lead?.cycles ?? [], c.cycles);
    p.candles.applyOptions({ upColor: c.up, downColor: c.down, wickUpColor: c.up, wickDownColor: c.down });
    p.ticks.refresh();
  }

  /** The candles at the period from the bars: `all` sets them anew, else only the last few change (the
   *  bars that came since folded into them, when the bars they hold are still the first of these). */
  private draw(all: boolean): void {
    const p = this.parts, minutes = this.period.get(), { n, last } = this.gathered; if (!p || !minutes) return;
    const grows = !all && n > 0 && n <= this.bars.length && this.bars[n - 1] === last;
    // The backtest's day candles, or blank days, before the first of the paper runs'.
    const fresh = grows ? null : gather(this.bars, minutes), head = fresh ? (this.lead?.candles ?? []).filter((k) => k.time < (fresh[0]?.time ?? Infinity)) : [];
    const next = fresh ? [...head, ...fresh] : extend(this.data, this.bars.slice(n), minutes), old = this.data, c = seriesColors(this.dark);
    const empty = (this.lead?.blanks ?? []).filter((t) => t < (next[0]?.time ?? Infinity));
    const downs = candleDowns(next, this.trading.restarts, minutes), scale = onScale(next, downs, minutes, this.least), slots = [...empty, ...scale.blanks], blanks = slots.join();
    if (fresh) Object.assign(this, { days: head.length, leading: head.length + empty.length });
    this.gathered = { n: this.bars.length, last: this.bars.at(-1) ?? null };
    const volume = (k: Candle): VolumeBar => ({ time: at(k.time), value: k.volume, color: k.close >= k.open ? c.upVolume : c.downVolume });
    if (!all && blanks === this.blanks && old.length && next.length >= old.length && next[old.length - 1]?.time === old.at(-1)!.time) {
      for (const k of next.slice(old.length - 1)) { p.candles.update({ ...k, time: at(k.time) }); p.volume.update(volume(k)); }
    } else {
      p.candles.setData([...next.map((k) => ({ ...k, time: at(k.time) })), ...slots.map((t) => ({ time: at(t) }))].sort((a, b) => a.time - b.time));
      p.volume.setData(next.map(volume));
    }
    Object.assign(this, { data: next, times: empty.length ? [...empty, ...scale.times] : scale.times, downs, blanks });
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
    const anchor = x ?? time.width() / 2, t = timeAt(time, this.times, step, anchor), range = time.getVisibleLogicalRange();
    // Days narrower than their floor widen to it, the time under `x` kept: what no longer fits scrolls.
    const floor = this.floor(this.times[Math.max(0, Math.floor(range?.from ?? 0))], next);
    this.span = null; if (next === step && least === this.least) { if (w < floor && t !== null) restore(time, this.times, step, t, anchor, floor); this.fenced?.(); p.ticks.refresh(); return; }
    this.period.set(next / 60); this.least = least;
    time.applyOptions({ maxBarSpacing: widest(next) });
    this.draw(true);
    // A span just shown (show()) is shown again: kept by a moment, an offline stretch's blanks would move it.
    if (span) showSpan(time, this.times, span.from, span.to - next, floor); else if (t !== null) restore(time, this.times, next, t, anchor, Math.max(floor, respaced(w, range, this.leading, step, next)));
    // The legend follows the candle now under the pointer, not the index it had before the regrouping.
    const l = x === null ? null : time.coordinateToLogical(x);
    this.hover = l === null ? null : Math.round(l);
    this.showLegend();
    p.ticks.refresh();
  }

  private drawTrading(): void {
    const p = this.parts, minutes = this.period.get();
    if (p && minutes) drawTrading(p, this.notes, this.trading, { minutes, data: this.data, bars: this.bars, downs: this.downs, dark: this.dark, lines: this.lines });
  }

  /** The candle under the pointer, else the last; over a blank, the offline stretch it is in. */
  private showLegend(): void {
    const t = this.hover === null ? undefined : this.times[this.hover], at = t === undefined ? -1 : candleAt(this.data, t);
    const offline = at < 0 && t !== undefined ? (this.downs.find((d) => t > d.from && t < d.to) ?? null) : null, i = offline ? -1 : at < 0 ? this.data.length - 1 : at;
    const candle = this.data[i] ?? null, previous = this.data[i - 1]?.close ?? null, now = this.legend.get(), day = i >= 0 && i < this.days;
    if (now.candle !== candle || now.previous !== previous || now.offline !== offline) this.legend.set({ candle, previous, offline, day });
  }
}
