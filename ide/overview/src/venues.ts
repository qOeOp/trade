// The other exchanges' USDT perpetuals (Hyperliquid's USDC ones), each from its whole-market endpoints
// (one request each, no key):
// open interest in USD, the funding rate of the current period and how many hours that period lasts,
// keyed by coin so a Binance contract finds its counterparts (coinKey).
import { num } from "./num.ts";

export type Market = { oi: number | null; funding: number | null; intervalHours: number | null };
export const VENUES = ["Bybit", "OKX", "Bitget", "Gate", "Hyperliquid"] as const;
export type Venue = (typeof VENUES)[number];

type Rows = readonly Record<string, unknown>[];
const times = (...vs: (number | null)[]) => (vs.every((v) => v !== null) ? vs.reduce((a, b) => a! * b!, 1) : null);
const HOUR_MS = 3_600_000;

/** Contract sizes written into a symbol, before (1000PEPE, 1MBABYDOGE) or after (SHIB1000) the coin. */
const SIZES = ["1000000", "10000", "1000", "1M"];

/** The coin a contract's base trades, its size multiplier dropped: 1000PEPE, PEPE and SHIB1000's SHIB. */
export function coinKey(base: string): string {
  for (const size of SIZES) {
    if (base.length > size.length + 1 && base.startsWith(size)) return base.slice(size.length);
    if (base.length > size.length + 1 && base.endsWith(size)) return base.slice(0, -size.length);
  }
  return base;
}

/** Each coin's market; of two contracts on the same coin (PEPE and 1000PEPE) the one with more open interest. */
function byCoin(entries: Iterable<[string, Market]>): Map<string, Market> {
  const out = new Map<string, Market>();
  for (const [base, market] of entries) {
    const key = coinKey(base), had = out.get(key);
    if (!had || (market.oi ?? 0) > (had.oi ?? 0)) out.set(key, market);
  }
  return out;
}

/** Bybit `GET /v5/market/tickers?category=linear`: USDT contracts only (USDC ones end in PERP). */
export function bybit(rows: Rows): Map<string, Market> {
  return byCoin(rows.flatMap((r) => typeof r.symbol === "string" && r.symbol.endsWith("USDT") && !r.symbol.includes("-")
    ? [[r.symbol.slice(0, -4), { oi: num(r.openInterestValue), funding: num(r.fundingRate), intervalHours: num(r.fundingIntervalHour) }]] : []));
}

/** OKX `GET /api/v5/public/open-interest?instType=SWAP` and `public/funding-rate?instId=ANY`; the period is
 *  the time from the last funding to the coming one. */
export function okx(interest: Rows, funding: Rows): Map<string, Market> {
  const rates = new Map(funding.map((r) => [r.instId, r]));
  return byCoin(interest.flatMap((r) => {
    if (typeof r.instId !== "string" || !r.instId.endsWith("-USDT-SWAP")) return [];
    const f = rates.get(r.instId), at = num(f?.fundingTime), before = num(f?.prevFundingTime);
    return [[r.instId.split("-")[0]!, { oi: num(r.oiUsd), funding: num(f?.fundingRate), intervalHours: at && before ? (at - before) / HOUR_MS : null }]];
  }));
}

/** Bitget `GET /api/v2/mix/market/tickers?productType=USDT-FUTURES` (open interest in coins, times the mark
 *  price) and its `contracts` (the funding period). */
export function bitget(tickers: Rows, contracts: Rows): Map<string, Market> {
  const hours = new Map(contracts.map((c) => [c.symbol, num(c.fundInterval)]));
  return byCoin(tickers.flatMap((r) => typeof r.symbol === "string" && r.symbol.endsWith("USDT")
    ? [[r.symbol.slice(0, -4), { oi: times(num(r.holdingAmount), num(r.markPrice)), funding: num(r.fundingRate), intervalHours: hours.get(r.symbol) ?? null }]] : []));
}

/** Gate `GET /api/v4/futures/usdt/tickers` (open interest in contracts, times coins per contract and the
 *  mark price) and its `contracts` (the funding period in seconds). */
export function gate(tickers: Rows, contracts: Rows): Map<string, Market> {
  const seconds = new Map(contracts.map((c) => [c.name, num(c.funding_interval)]));
  return byCoin(tickers.flatMap((r) => {
    if (typeof r.contract !== "string" || !r.contract.endsWith("_USDT")) return [];
    const s = seconds.get(r.contract);
    return [[r.contract.slice(0, -5), { oi: times(num(r.total_size), num(r.quanto_multiplier), num(r.mark_price)), funding: num(r.funding_rate), intervalHours: s ? s / 3600 : null }]];
  }));
}

/** Hyperliquid's `info` query `metaAndAssetCtxs`: the listed perpetuals and, in the same order, each one's
 *  open interest in coins (times the mark price) and its funding rate, which it pays every hour. Delisted
 *  ones are left out; a `k` before the coin (kPEPE) means a thousand of it. */
export function hyperliquid(answer: unknown): Map<string, Market> {
  const [meta, contexts] = Array.isArray(answer) ? answer as [{ universe?: Rows }, Rows] : [{}, []];
  return byCoin((meta.universe ?? []).flatMap((u, i) => {
    const c = contexts[i];
    if (typeof u.name !== "string" || u.isDelisted || !c) return [];
    return [[u.name.replace(/^k(?=[A-Z])/, ""), { oi: times(num(c.openInterest), num(c.markPx)), funding: num(c.funding), intervalHours: 1 }]];
  }));
}
