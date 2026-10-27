// One-minute bars from a paper run's journal, gathered into candles of a longer period. Times are UTC
// seconds at each candle's open, as the chart takes them.
import { amount, type JournalLine } from "./paperApi";

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

/** The open, in UTC seconds, of the `minutes` candle a bar stamped `tsNs` (its close) falls in. */
export const candleOpen = (tsNs: number, minutes: number) => {
  const span = minutes * 60;
  return Math.floor((tsNs / 1e9 - 1e-3) / span) * span;
};

/** The bars (journal lines of kind "bar") as candles of `minutes`, oldest first. */
export function candles(bars: readonly JournalLine[], minutes: number): Candle[] {
  const out: Candle[] = [];
  for (const bar of bars) {
    const time = candleOpen(Number(bar.ts_event), minutes);
    const o = amount(bar.open), h = amount(bar.high), l = amount(bar.low), c = amount(bar.close), v = amount(bar.volume) ?? 0;
    if (o == null || h == null || l == null || c == null) continue;
    const top = out[out.length - 1];
    if (top && top.time === time) {
      top.high = Math.max(top.high, h);
      top.low = Math.min(top.low, l);
      top.close = c;
      top.volume += v;
    } else if (!top || time > top.time) {
      out.push({ time, open: o, high: h, low: l, close: c, volume: v });
    }
  }
  return out;
}
