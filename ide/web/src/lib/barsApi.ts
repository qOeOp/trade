// A contract's daily LAST bars (`market bars --timeframe 1d`) from the page's own server under /api/bars,
// whole UTC days at a full market commit (ide/research_graph/serve.py), as candles; the product's refusal
// comes back as its { code, message }.
import type { Candle } from "./bars";
import type { Fetched } from "./trialApi";

type Bars = { bars: { columns: string[]; rows: (string | number)[][] } };
/** The candles; the product's refusal; or no bars served here. */
export type FetchedBars = { kind: "bars"; candles: Candle[] } | Exclude<Fetched, { kind: "report" }>;

// The page's server's own failures, as against the product's refusals.
const SERVED = new Set(["PRODUCT_UNAVAILABLE", "PRODUCT_FAILED", "BAD_REQUEST", "NOT_FOUND"]);

/** `symbol`'s daily bars from UTC day `start` to `end` (left out) at market commit `at`. */
export async function fetchBars(symbol: string, start: string, end: string, at: string): Promise<FetchedBars> {
  try {
    const query = new URLSearchParams({ symbol, timeframe: "1d", start, end, at });
    const response = await fetch(`/api/bars?${query}`, { cache: "no-store" });
    const body = await response.json().catch(() => null) as (Bars & { code?: string; message?: string }) | null;
    if (response.ok && body?.bars) {
      const c = Object.fromEntries(body.bars.columns.map((name, i) => [name, i])) as Record<string, number>, n = (v: string | number | undefined) => Number(v);
      const candles = body.bars.rows.map((r) => ({ time: n(r[c.ts_open_ms!]) / 1000, open: n(r[c.open!]), high: n(r[c.high!]), low: n(r[c.low!]), close: n(r[c.close!]), volume: n(r[c.volume!]) }));
      return { kind: "bars", candles };
    }
    if (body?.code && !SERVED.has(body.code)) return { kind: "refused", code: body.code, message: body.message ?? "" };
    return { kind: "absent", message: body?.message ?? `HTTP ${response.status}` };
  } catch (error) {
    return { kind: "absent", message: String(error) };
  }
}
