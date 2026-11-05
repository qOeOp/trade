// The whole market, beyond the perpetuals: total market cap and Bitcoin's share (CoinGecko), the Fear &
// Greed Index (alternative.me), the supply of USD stablecoins (DefiLlama), Bitcoin's premium on Coinbase
// and in Korea over Binance, Bitcoin options on Deribit, and an altcoin season index of our own: how many
// of the largest coins beat Bitcoin over 90 days. Changes and premiums are in percent.
import { num } from "./num.ts";

type Rows = readonly Record<string, unknown>[];
type Klines = readonly (readonly unknown[])[];
const usdOf = (v: unknown) => (v && typeof v === "object" ? num((v as Record<string, unknown>).peggedUSD) : null);

export type Options = {
  /** Open interest in USD at the index price, calls and puts. */
  oi: number;
  /** Puts' open interest over calls'. */
  putCall: number | null;
  /** The nearest Friday expiry (`YYYY-MM-DD`, 08:00 UTC) and the strike that pays its holders least. */
  maxPain: { expiry: string; strike: number } | null;
};
export type Global = {
  marketCap: number | null; marketCapChange24h: number | null; btcShare: number | null;
  fearGreed: { value: number; label: string } | null;
  /** USD stablecoins in circulation, and the change over a week of those reported a week ago. */
  stablecoins: { supply: number; change7d: number | null } | null;
  coinbasePremium: number | null; koreaPremium: number | null;
  options: Options | null;
  /** Deribit's implied volatility index of Bitcoin (DVOL), its last hourly close. */
  dvol: number | null;
  /** Of `coins` among the largest with 90 days of history, the share in percent that rose more than Bitcoin. */
  altseason: { index: number; coins: number } | null;
};
export const EMPTY: Global = { marketCap: null, marketCapChange24h: null, btcShare: null, fearGreed: null, stablecoins: null,
                               coinbasePremium: null, koreaPremium: null, options: null, dvol: null, altseason: null };

/** CoinGecko `GET /global`. */
export function cap(body: { data?: Record<string, unknown> }): Pick<Global, "marketCap" | "marketCapChange24h" | "btcShare"> {
  const d = body.data ?? {};
  const pick = (v: unknown, key: string) => (v && typeof v === "object" ? num((v as Record<string, unknown>)[key]) : null);
  return { marketCap: pick(d.total_market_cap, "usd"), marketCapChange24h: num(d.market_cap_change_percentage_24h_usd), btcShare: pick(d.market_cap_percentage, "btc") };
}

/** alternative.me `GET /fng/?limit=1`. */
export function fearGreed(body: { data?: Rows }): Global["fearGreed"] {
  const d = body.data?.[0], value = num(d?.value);
  return value === null || typeof d?.value_classification !== "string" ? null : { value, label: d.value_classification };
}

/** DefiLlama `GET /stablecoins`: the USD-pegged coins' circulation now, and its change over a week among
 *  the coins that report one (a coin without last week's figure would read as growth). */
export function stablecoins(body: { peggedAssets?: Rows }): Global["stablecoins"] {
  const usd = (body.peggedAssets ?? []).filter((a) => a.pegType === "peggedUSD");
  if (!usd.length) return null;
  let supply = 0, now = 0, before = 0;
  for (const a of usd) {
    const c = usdOf(a.circulating) ?? 0, w = usdOf(a.circulatingPrevWeek);
    supply += c;
    if (w) { now += c; before += w; }
  }
  return { supply, change7d: before ? (now / before - 1) * 100 : null };
}

/** Coinbase's BTC-USD over Binance's BTCUSDT in dollars (Tether at Kraken's USDT/USD), in percent. */
export function coinbasePremium(coinbase: { price?: unknown }, binance: { price?: unknown }, kraken: { result?: Record<string, { c?: unknown[] }> }): number | null {
  const usd = num(coinbase.price), usdt = num(binance.price), tether = num(Object.values(kraken.result ?? {})[0]?.c?.[0]);
  return usd && usdt && tether ? (usd / (usdt * tether) - 1) * 100 : null;
}

/** Upbit's BTC over Binance's, both in Tether (Upbit's KRW-BTC over its KRW-USDT), in percent. */
export function koreaPremium(upbit: Rows, binance: { price?: unknown }): number | null {
  const krw = (market: string) => num(upbit.find((r) => r.market === market)?.trade_price);
  const btc = krw("KRW-BTC"), tether = krw("KRW-USDT"), usdt = num(binance.price);
  return btc && tether && usdt ? (btc / tether / usdt - 1) * 100 : null;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** `6NOV26` as `2026-11-06`. */
function expiryDate(code: string): string | null {
  const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(code), month = m ? MONTHS.indexOf(m[2]!) : -1;
  return m && month >= 0 ? new Date(Date.UTC(2000 + Number(m[3]), month, Number(m[1]))).toISOString().slice(0, 10) : null;
}

type Option = { expiry: string; strike: number; put: boolean; oi: number };

/** The strike at which an expiry's options pay their holders least: calls below it and puts above it
 *  finish in the money. */
export function maxPain(options: readonly Option[]): number | null {
  let best: number | null = null, least = Infinity;
  for (const at of [...new Set(options.map((o) => o.strike))].sort((a, b) => a - b)) {
    const paid = options.reduce((sum, o) => sum + o.oi * Math.max(0, o.put ? o.strike - at : at - o.strike), 0);
    if (paid < least) { least = paid; best = at; }
  }
  return best;
}

/** Deribit `GET public/get_book_summary_by_currency?currency=BTC&kind=option`. */
export function options(body: { result?: Rows }): Options | null {
  const rows = body.result ?? [];
  const read: Option[] = rows.flatMap((r) => {
    const [, code, strike, side] = typeof r.instrument_name === "string" ? r.instrument_name.split("-") : [];
    const expiry = expiryDate(code ?? ""), k = num(strike), oi = num(r.open_interest);
    return expiry && k !== null && oi !== null && (side === "C" || side === "P") ? [{ expiry, strike: k, put: side === "P", oi }] : [];
  });
  const index = num(rows.find((r) => num(r.estimated_delivery_price) !== null)?.estimated_delivery_price);
  if (!read.length || index === null) return null;
  const calls = read.filter((o) => !o.put).reduce((s, o) => s + o.oi, 0), puts = read.filter((o) => o.put).reduce((s, o) => s + o.oi, 0);
  const friday = [...new Set(read.map((o) => o.expiry))].sort().find((e) => new Date(`${e}T00:00:00Z`).getUTCDay() === 5);
  const strike = friday ? maxPain(read.filter((o) => o.expiry === friday)) : null;
  return { oi: (calls + puts) * index, putCall: calls ? puts / calls : null, maxPain: friday && strike !== null ? { expiry: friday, strike } : null };
}

/** Deribit `GET public/get_volatility_index_data`: the last row's close. */
export function dvol(body: { result?: { data?: Klines } }): number | null {
  return num(body.result?.data?.at(-1)?.[4]);
}

/** How many days back the index compares. */
export const SEASON_DAYS = 90;

/** A coin's change over the window of its daily klines (Binance, `limit=SEASON_DAYS + 1`): the last close
 *  over the first; null without the whole window. */
export function seasonChange(klines: Klines): number | null {
  if (klines.length < SEASON_DAYS + 1) return null;
  const first = num(klines[0]?.[4]), last = num(klines.at(-1)?.[4]);
  return first && last ? last / first - 1 : null;
}

/** Of the coins' changes (null: too young), the share in percent above Bitcoin's. */
export function altseason(btc: number | null, changes: readonly (number | null)[]): Global["altseason"] {
  const known = changes.filter((c): c is number => c !== null);
  return btc === null || !known.length ? null : { index: Math.round((known.filter((c) => c > btc).length / known.length) * 100), coins: known.length };
}
