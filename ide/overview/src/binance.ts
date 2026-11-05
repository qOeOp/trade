// Binance USDⓈ-M public market data, keyed by symbol: the readers of `ticker/24hr`, `premiumIndex` and
// `fundingInfo` (all symbols in one request each), and of the per-contract open interest history, klines
// and long/short ratio.
import { num } from "./num.ts";

export type Quote = { price: number; change24h: number; volume24h: number };


/** `GET /fapi/v1/ticker/24hr`: last price, the rolling 24h change in percent and quote volume in USDT. */
export function quotes(rows: readonly Record<string, unknown>[]): Map<string, Quote> {
  const out = new Map<string, Quote>();
  for (const r of rows) {
    const price = num(r.lastPrice), change24h = num(r.priceChangePercent), volume24h = num(r.quoteVolume);
    if (typeof r.symbol === "string" && price !== null && change24h !== null && volume24h !== null) out.set(r.symbol, { price, change24h, volume24h });
  }
  return out;
}

/** `GET /fapi/v1/premiumIndex`: the funding rate of the current period, as a fraction. */
export function fundingRates(rows: readonly Record<string, unknown>[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const rate = num(r.lastFundingRate);
    if (typeof r.symbol === "string" && rate !== null) out.set(r.symbol, rate);
  }
  return out;
}

const time = (v: unknown) => num(v) ?? 0;

export type Interest = { oi: number; oiChange24h: number | null };
const DAY_MS = 86_400_000;

/** `GET /futures/data/openInterestHist?period=5m&limit=289`: the open interest in USDT at its last five
 *  minutes, and its change in percent from 24 hours before (null while the history is shorter). */
export function interest(rows: readonly Record<string, unknown>[]): Interest | null {
  const last = rows.at(-1), first = rows[0];
  const now = num(last?.sumOpenInterestValue), then = num(first?.sumOpenInterestValue);
  if (now === null) return null;
  const day = time(last?.timestamp) - time(first?.timestamp) >= DAY_MS - 10 * 60_000;
  return { oi: now, oiChange24h: day && then ? (now / then - 1) * 100 : null };
}

/** The closes an hour, four hours and seven days back, each within a kline of it: the snapshot measures
 *  the price's change in each window from these against the latest quote. */
export type Moves = { back1h: number | null; back4h: number | null; back7d: number | null };
/** Hourly closes of the last seven days: [open time in seconds, close]. */
export type Line = [number, number][];
const close = (k: readonly unknown[] | undefined) => num(k?.[4]);

/** `klines` at 5m (limit 49) and 1h (limit 169), the last kline of each the one still forming: the closes
 *  the windows start from, and the hourly closes for the coin's seven-day line. */
export function moves(fiveMinute: readonly (readonly unknown[])[], hourly: readonly (readonly unknown[])[]): Moves & { line: Line } {
  const back = (ks: readonly (readonly unknown[])[], n: number) => (ks.length > n ? close(ks[ks.length - 1 - n]) : null);
  const line: Line = hourly.flatMap((k) => { const c = close(k); return c === null ? [] : [[Math.floor(time(k[0]) / 1000), c] as [number, number]]; });
  return { back1h: back(fiveMinute, 12), back4h: back(fiveMinute, 48), back7d: back(hourly, 168), line };
}

/** The change in percent from `back` to `price`; null without a close to start from. */
export const change = (price: number, back: number | null | undefined) => (back ? (price / back - 1) * 100 : null);

/** `GET /futures/data/globalLongShortAccountRatio?period=5m&limit=1`: accounts long over accounts short. */
export const longShort = (rows: readonly Record<string, unknown>[]) => num(rows.at(-1)?.longShortRatio);

/** `GET /fapi/v1/fundingInfo`: the contracts whose funding period is not the usual eight hours. */
export function fundingIntervals(rows: readonly Record<string, unknown>[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) { const h = num(r.fundingIntervalHours); if (typeof r.symbol === "string" && h) out.set(r.symbol, h); }
  return out;
}
