// CoinGecko without a key: each Binance contract's coin id (from CoinGecko's own Binance Futures tickers,
// with a fix for the contracts it maps wrongly) and each coin's market cap, FDV and name.

export type Cap = { name: string; marketCap: number | null; fdv: number | null };

/** Contracts CoinGecko's tickers map to the wrong coin (measured 2026-11-02). */
export const ID_FIXES: Record<string, string> = {
  "1000SHIBUSDT": "shiba-inu", "1000BONKUSDT": "bonk", "1000RATSUSDT": "rats", "1000SATSUSDT": "sats-ordinals",
};
/** Ids per `/coins/markets` request, its largest page. */
export const PAGE = 250;

/** `GET /derivatives/exchanges/binance_futures?include_tickers=unexpired`: contract symbol to coin id. */
export function coinIds(exchange: { tickers?: readonly Record<string, unknown>[] }): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of exchange.tickers ?? []) {
    if (t.contract_type === "perpetual" && typeof t.symbol === "string" && typeof t.coin_id === "string" && t.coin_id) out.set(t.symbol, t.coin_id);
  }
  for (const [symbol, id] of Object.entries(ID_FIXES)) out.set(symbol, id);
  return out;
}

/** The distinct ids in groups of at most PAGE, in a stable order. */
export function pages(ids: Iterable<string>): string[][] {
  const all = [...new Set(ids)].sort();
  const out: string[][] = [];
  for (let i = 0; i < all.length; i += PAGE) out.push(all.slice(i, i + PAGE));
  return out;
}

const amount = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/** `GET /coins/markets?vs_currency=usd&ids=…`: coin id to name, market cap and FDV in USD. */
export function caps(rows: readonly Record<string, unknown>[]): Map<string, Cap> {
  const out = new Map<string, Cap>();
  for (const r of rows) {
    if (typeof r.id === "string") out.set(r.id, { name: typeof r.name === "string" ? r.name : r.id, marketCap: amount(r.market_cap), fdv: amount(r.fully_diluted_valuation) });
  }
  return out;
}
