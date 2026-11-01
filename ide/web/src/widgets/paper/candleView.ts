// The candle chart's periods, and which one a view takes. Binance's periods from a minute to a day, no
// two neighbours more than three times apart, so whatever the span some period draws its candles between
// LO and HI px wide (HI is three times LO). The chart never asks the user for one: when a pan or zoom has
// settled with the candles outside that band, it takes the period that brings them nearest TARGET px,
// the moment under the pointer kept where it was (viewAnchor.ts). Within a gesture the candles may
// widen to SPREAD times HI (a gesture's worth of zooming in) but the minute's no wider than HI, so a
// screen always holds plenty of candles. When a run first shows, the period is the one that fits all of
// it at TARGET px or more, a young run's candles HI wide with the newest at the right.
import type { IChartApi, ITimeScaleApi, LogicalRange, Time } from "lightweight-charts";
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

/** The period at which `span` seconds of candles after `lead` places (the backtest's days) fit `width` px at
 *  TARGET px a place, else the longest. */
export const wholePeriod = (span: number, lead: number, width: number): number => PERIODS.find((s) => (lead + span / s) * TARGET <= width) ?? PERIODS.at(-1)!;

/** The narrowest (px) a candle settles at: a day's, which no longer period can widen (the backtest's
 *  days, or the candles at a day's period), LO px, so what does not fit scrolls; any other, none. */
export const dayFloor = (step: number, days: boolean) => (step >= PERIODS.at(-1)! || days ? LO : 0);

/** The whole run in view, `n` candles of `step` seconds, none narrower than `least` px: the newest of them
 *  where they do not all fit. */
export function fitAll(time: ITimeScaleApi<Time>, n: number, step: number, least = 0): void {
  time.applyOptions({ maxBarSpacing: widest(step) });
  const w = time.width() / (n + time.options().rightOffset);
  if (w > HI || w < least) { time.applyOptions({ barSpacing: w > HI ? HI : least }); time.scrollToRealTime(); }
  else time.fitContent();
}

/** The spacing (px) that keeps as much in view, `w` px apart over `range` now, once the places past the
 *  first `lead` (the backtest's days, not regrouped) go from `step` seconds a candle to `next`. */
export function respaced(w: number, range: LogicalRange | null, lead: number, step: number, next: number): number {
  const all = range ? range.to - range.from : 0, days = Math.max(0, Math.min(all, lead - (range?.from ?? 0))), after = days + ((all - days) * step) / next;
  return all > 0 && after > 0 ? (w * all) / after : (w * next) / step;
}

/** The view kept on the candles (`count()` of them): a pan stops at the first (the chart's own fixLeftEdge)
 *  and the time scale's right offset (in candles) right of the newest, there and then rather than springing
 *  back once it settles (a young run's candles stay where the chart puts them, from the left); a zoom out
 *  stops once they and that room fill the pane, each at least `least` px wide (a line's points may be
 *  narrower than a pixel: its layers draw a few a pixel column). Returns what sets that least spacing
 *  again, for when the candles change. */
export function fence(time: ITimeScaleApi<Time>, count: () => number, least = 1): () => void {
  const room = () => time.options().rightOffset;
  time.subscribeVisibleLogicalRangeChange(() => {
    const most = Math.max(room(), time.width() / (spacing(time) || 1) - count());
    if (time.scrollPosition() > most + 0.01) time.scrollToPosition(most, false);
  });
  return () => {
    const w = time.width();
    if (w) time.applyOptions({ minBarSpacing: Math.min(time.options().maxBarSpacing, Math.max(least, w / (count() + room()))) });
  };
}

/** The candles (their places on the time scale, `times`) from the one opening at `from` (s) to the newest in view, with room either side, the
 *  value axis fitting them again. */
export function showFrom(chart: IChartApi, times: readonly number[], from: number): void {
  const n = times.length, i = Math.max(0, times.findIndex((t) => t >= from));
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

/** The span from `from` to `to` (s, both candles in it) in view, and the room right of the newest when it
 *  holds the newest (`times`, the candles' places); its end alone where it does not fit at `least` px a candle. */
export function showSpan(time: ITimeScaleApi<Time>, times: readonly number[], from: number, to: number, least = 0): void {
  // Set by the candles' places at once: a visible range by time is applied a frame later.
  const b = times.filter((t) => t <= to).length - 1, fits = least ? Math.floor(time.width() / least) : Infinity;
  const a = Math.max(times.findIndex((t) => t >= from), b - fits + 1);
  if (a >= 0 && b >= a) time.setVisibleLogicalRange({ from: a, to: b === times.length - 1 ? b + time.options().rightOffset : b });
}

/** The view `saved` again over `n` candles of its period, moved on by the candles since if it showed the newest. */
export function reshow(time: ITimeScaleApi<Time>, saved: Saved, n: number): void {
  time.applyOptions({ maxBarSpacing: widest(saved.minutes * 60) });
  const shift = saved.to >= saved.n - 1 ? n - saved.n : 0;
  time.setVisibleLogicalRange({ from: saved.from + shift, to: saved.to + shift });
}
