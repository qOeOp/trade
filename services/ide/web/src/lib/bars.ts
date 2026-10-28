// One-minute bars from a paper run's journal, gathered into candles of a longer period. Times are UTC
// seconds at each candle's open, as the chart takes them.
import { amount, type JournalLine } from "./paperApi";

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

/** The open, in UTC seconds, of the `minutes` candle a bar stamped `tsNs` (its close) falls in. */
export const candleOpen = (tsNs: number, minutes: number) => {
  const span = minutes * 60;
  return Math.floor((tsNs / 1e9 - 1e-3) / span) * span;
};

type Minute = { time: number; open: number; high: number; low: number; close: number; volume: number } | null;
// Each bar's numbers, read once: a journal line never changes, and the candles are gathered again at every
// period and as bars arrive.
const read = new WeakMap<JournalLine, Minute>();
function minute(bar: JournalLine): Minute {
  let m = read.get(bar);
  if (m === undefined) {
    const o = amount(bar.open), h = amount(bar.high), l = amount(bar.low), c = amount(bar.close);
    m = o == null || h == null || l == null || c == null ? null : { time: Number(bar.ts_event), open: o, high: h, low: l, close: c, volume: amount(bar.volume) ?? 0 };
    read.set(bar, m);
  }
  return m;
}

/** The bars (journal lines of kind "bar") as candles of `minutes`, oldest first. */
export const candles = (bars: readonly JournalLine[], minutes: number): Candle[] => extend([], bars, minutes);

/** `old` (candles of `minutes`) with `bars` that came after the bars they were gathered from folded in: a
 *  new array, the last candle copied before it changes. */
export function extend(old: readonly Candle[], bars: readonly JournalLine[], minutes: number): Candle[] {
  const out = old.slice();
  if (out.length) out[out.length - 1] = { ...out[out.length - 1]! };
  for (const bar of bars) {
    const m = minute(bar);
    if (!m) continue;
    const time = candleOpen(m.time, minutes), top = out[out.length - 1];
    if (top && top.time === time) {
      top.high = Math.max(top.high, m.high);
      top.low = Math.min(top.low, m.low);
      top.close = m.close;
      top.volume += m.volume;
    } else if (!top || time > top.time) {
      out.push({ time, open: m.open, high: m.high, low: m.low, close: m.close, volume: m.volume });
    }
  }
  return out;
}
