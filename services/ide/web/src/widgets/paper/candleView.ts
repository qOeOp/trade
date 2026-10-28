// The candle chart's periods, and which one a view takes. Binance's periods from a minute to a day, no
// two neighbours more than three times apart, so whatever the span some period draws its candles between
// LO and HI px wide (HI is three times LO). The chart never asks the user for one: when a pan or zoom has
// settled with the candles outside that band, it takes the period that brings them nearest TARGET px,
// the moment under the pointer kept where it was (viewAnchor.ts). Within a gesture the candles may
// widen to SPREAD times HI (a gesture's worth of zooming in) but the minute's no wider than HI, so a
// screen always holds plenty of candles. When a run first shows, the period is the one that fits all of
// it at TARGET px or more, a young run's candles HI wide with the newest at the right.
import type { IChartApi, ITimeScaleApi, LogicalRange, Time } from "lightweight-charts";
import type { Candle } from "../../lib/bars";
import { stepFor } from "./equityResolution";
import { spacing } from "./viewAnchor";

export const PERIODS = [60, 180, 300, 900, 1_800, 3_600, 7_200, 14_400, 21_600, 43_200, 86_400] as const;  // s: 1m 3m 5m 15m 30m 1h 2h 4h 6h 12h 1d
const LO = 4, HI = 12, TARGET = 7, SPREAD = 3;  // px, px, px, times

/** The widest a candle of `step` seconds may be while the user zooms. */
export const widest = (step: number) => (step === PERIODS[0] ? HI : HI * SPREAD);

/** The period (s) for candles `w` px wide at `step`: the same while they lie between LO and HI, else
 *  the one that brings them nearest TARGET. */
export function periodFor(w: number, step: number): number {
  if (w >= LO && w <= HI) return step;
  const near = (s: number) => Math.abs(Math.log((w * s) / step / TARGET));
  return PERIODS.reduce((best, s) => (near(s) < near(best) ? s : best), step);
}

/** The period that fits `span` seconds into `width` px at TARGET px a candle or more. */
export const firstPeriod = (span: number, width: number) => stepFor(span, width, 0, TARGET, PERIODS);

/** The whole run in view, `n` candles of `step` seconds. */
export function fitAll(time: ITimeScaleApi<Time>, n: number, step: number): void {
  time.applyOptions({ maxBarSpacing: widest(step) });
  if (time.width() / (n + time.options().rightOffset) > HI) { time.applyOptions({ barSpacing: HI }); time.scrollToRealTime(); }
  else time.fitContent();
}

/** The view kept on the candles (`count()` of them): a pan stops at the first (the chart's own fixLeftEdge)
 *  and the time scale's right offset (in candles) right of the newest, there and then rather than springing
 *  back once it settles (a young run's candles stay where the chart puts them, from the left); a zoom out
 *  stops once they and that room fill the pane. Returns what sets that least spacing again, for when the candles change. */
export function fence(time: ITimeScaleApi<Time>, count: () => number): () => void {
  const room = () => time.options().rightOffset;
  time.subscribeVisibleLogicalRangeChange(() => {
    const most = Math.max(room(), time.width() / (spacing(time) || 1) - count());
    if (time.scrollPosition() > most + 0.01) time.scrollToPosition(most, false);
  });
  return () => {
    const w = time.width();
    if (w) time.applyOptions({ minBarSpacing: Math.min(time.options().maxBarSpacing, Math.max(1, w / (count() + room()))) });
  };
}

/** The candles from the one opening at `from` (s) to the newest in view, with room either side, the
 *  value axis fitting them again. */
export function showFrom(chart: IChartApi, data: readonly Candle[], from: number): void {
  const n = data.length, i = Math.max(0, data.findIndex((k) => k.time >= from));
  chart.timeScale().setVisibleLogicalRange({ from: i - Math.max(8, (n - i) * 0.25), to: n - 1 + 6 });
  chart.priceScale("right").applyOptions({ autoScale: true });
}

type Saved = { minutes: number; from: number; to: number; n: number };
const views = new Map<string, Saved>();

/** Keeps under `key` where a chart looked: its period (minutes) and its logical range over `n` candles. */
export function remember(key: string, minutes: number, range: LogicalRange | null, n: number): void {
  if (key && minutes && range && n) views.set(key, { minutes, from: range.from, to: range.to, n });
}
export const recall = (key: string): Saved | undefined => views.get(key);

/** The view `saved` again over `n` candles of its period, moved on by the candles since if it showed the newest. */
export function reshow(time: ITimeScaleApi<Time>, saved: Saved, n: number): void {
  time.applyOptions({ maxBarSpacing: widest(saved.minutes * 60) });
  const shift = saved.to >= saved.n - 1 ? n - saved.n : 0;
  time.setVisibleLogicalRange({ from: saved.from + shift, to: saved.to + shift });
}
