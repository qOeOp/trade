// The backtest's stretch on a contract chart (model/backtest.ts): its daily bars (state/backtestBars.ts),
// a candle a day, before the paper runs' candles; without them a blank a day of its trade window, so its
// cycles still have room. Its cycles of the contract are drawn (cycleBand.ts) only while it is the stretch
// shown. A contract it neither has bars of nor traded takes no room.
import type { Candle } from "../../lib/bars";
import type { Backtest, Cycle } from "../../model/backtest";
import { daysOf, type LoadedBars } from "../../state/backtestBars";
import type { CandleSpan } from "./candleStretches";

/** What comes before the paper runs' candles: day candles, or blank days (s); the cycles drawn; its name. */
export type Lead = { candles: Candle[]; blanks: number[]; cycles: Cycle[]; span: CandleSpan };

const DAY_S = 86_400;

/** `symbol`'s stretch of backtest `b` (its trial `trial`), `bars` its daily bars; null when it has none. */
export function leadOf(b: Backtest, trial: number, symbol: string, bars: LoadedBars | null, selected: boolean): Lead | null {
  const cycles = b.cycles.filter((c) => c.symbol === symbol), candles = bars?.kind === "ready" ? bars.candles : [];
  if (!candles.length && !cycles.length) return null;
  const [start, end] = daysOf(b.window).map((d) => Date.parse(`${d}T00:00:00Z`) / 1000) as [number, number];
  const blanks = candles.length ? [] : Array.from({ length: Math.max(1, (end - start) / DAY_S) }, (_, k) => start + k * DAY_S);
  const times = candles.length ? candles.map((k) => k.time) : blanks;
  const said = candles.length ? " · 1d bars" : bars?.kind === "reading" ? "" : " · no bars served";
  return { candles, blanks, cycles: selected ? cycles : [], span: { label: `Backtest · trial ${trial}${said}`, run: null, selected, from: times[0]!, to: times.at(-1)! } };
}
