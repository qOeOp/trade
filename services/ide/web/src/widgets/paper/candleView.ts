// The candle chart's periods, and which one a view takes. Binance's periods from a minute to a day, no
// two neighbours more than three times apart, so whatever the span some period draws its candles between
// LO and HI px wide (HI is three times LO). The chart never asks the user for one: when a pan or zoom has
// settled with the candles outside that band, it takes the period that brings them nearest TARGET px,
// the moment under the pointer kept where it was (viewAnchor.ts). Within a gesture the candles may
// widen to SPREAD times HI (a gesture's worth of zooming in) but the minute's no wider than HI, so a
// screen always holds plenty of candles. When a run first shows, the period is the one that fits all of
// it at TARGET px or more, a young run's candles HI wide with the newest at the right.
import type { ITimeScaleApi, Time } from "lightweight-charts";
import { stepFor } from "./equityResolution";

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
