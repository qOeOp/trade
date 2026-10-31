// A contract's trades as the chart draws them, from its fills: each stretch from flat back to flat is one
// trade, its box from the first entry's candle to the last exit's and from the average entry price to the
// average exit price, with what it made (the price move times the size closed, before fees); the open
// position from its entry candle to the last candle at the last price, with its open P&L. A fill that
// reverses the position closes the trade and opens the next with the rest. Each fill is also an arrow off
// its candle, as TradingView marks a strategy's orders: up below the candle's low for a buy, down above its
// high for a sell, one a candle and side however many fills it holds (the box's edges carry the prices).
// A closed trade also has its run-up and drawdown: the best and the worst price the one-minute bars reached
// from its first entry to its last exit, whatever the period drawn.
import { candleOpen, type Candle } from "../../lib/bars";
import { amount, type JournalLine } from "../../lib/paperApi";
import type { Fill, Held } from "../../model/paper";

export type TradeBox = { from: number; to: number; entry: number; exit: number; long: boolean; pnl: number; open: boolean; best?: number; worst?: number };
export type Arrow = { id: string; time: number; price: number; buy: boolean; opening: boolean };
const EPS = 1e-12;

/** The highest high and lowest low of the one-minute `bars` (oldest first) that overlap `from`–`to` (ms). */
function reach(bars: readonly JournalLine[], from: number, to: number): { high: number; low: number } | null {
  let lo = 0, hi = bars.length, high = -Infinity, low = Infinity;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (Number(bars[mid]!.ts_event) / 1e6 <= from) lo = mid + 1; else hi = mid; }
  for (let i = lo; i < bars.length && Number(bars[i]!.ts_event) / 1e6 - 60_000 < to; i++) {
    high = Math.max(high, amount(bars[i]!.high) ?? -Infinity);
    low = Math.min(low, amount(bars[i]!.low) ?? Infinity);
  }
  return high >= low ? { high, low } : null;
}

/** The boxes, given the held position, the last price, the last candle's time and the one-minute bars. */
export function tradeBoxes(fills: readonly Fill[], minutes: number, held: Held | null, mark: number | null, last: number | null, bars: readonly JournalLine[] = []): TradeBox[] {
  const candle = (ms: number) => candleOpen(ms * 1e6, minutes), boxes: TradeBox[] = [];
  let size = 0, long = true, from = 0, fromMs = 0, inQty = 0, inSum = 0, outQty = 0, outSum = 0;
  for (const f of fills) {
    const dir = f.buy ? 1 : -1;
    let qty = f.qty;
    if (size !== 0 && Math.sign(size) !== dir) {
      const closed = Math.min(qty, Math.abs(size));
      outQty += closed; outSum += closed * f.px; size += dir * closed; qty -= closed;
      if (Math.abs(size) < EPS) {
        size = 0;
        const entry = inSum / inQty, exit = outSum / outQty, r = reach(bars, fromMs, f.ms);
        boxes.push({ from, to: candle(f.ms), entry, exit, long, pnl: (exit - entry) * outQty * (long ? 1 : -1), open: false,
                     ...(r && { best: long ? r.high : r.low, worst: long ? r.low : r.high }) });
      }
    }
    if (qty > EPS) {
      if (size === 0) { long = dir > 0; from = candle(f.ms); fromMs = f.ms; inQty = inSum = outQty = outSum = 0; }
      inQty += qty; inSum += qty * f.px; size += dir * qty;
    }
  }
  if (held && mark !== null && last !== null) {
    const opened = size !== 0 && long === held.long ? from : last;
    const pnl = held.pnl ?? (mark - held.average) * held.quantity * (held.long ? 1 : -1);
    boxes.push({ from: opened, to: last, entry: held.average, exit: mark, long: held.long, pnl, open: true });
  }
  return boxes;
}

export function arrows(fills: readonly Fill[], minutes: number, candles: readonly Candle[]): Arrow[] {
  const byTime = new Map(candles.map((k) => [k.time, k])), seen = new Set<string>();
  return fills.flatMap((f, i) => {
    const time = candleOpen(f.ms * 1e6, minutes), k = byTime.get(time), key = `${time}:${f.buy}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ id: `fill-${i}`, time, price: k ? (f.buy ? k.low : k.high) : f.px, buy: f.buy, opening: f.opening }];
  });
}
