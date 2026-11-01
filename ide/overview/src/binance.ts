// Binance USDⓈ-M public market data: the readers of `ticker/24hr` and `premiumIndex` (all symbols in
// one request each), keyed by symbol.

export type Quote = { price: number; change24h: number; volume24h: number };

const num = (v: unknown) => (typeof v === "string" || typeof v === "number") && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;

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
