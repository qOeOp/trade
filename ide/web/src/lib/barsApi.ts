// A contract's daily LAST bars (`market bars --timeframe 1d`) from the page's own server under /api/bars,
// whole UTC days at a market day (ide/research_graph/serve.py), as candles; the product's refusal
// comes back as its { code, message }.
import type { Candle } from "./bars";
import { getJson, type Unread } from "./transport";

type Bars = { bars: { columns: string[]; rows: (string | number)[][] } };

/** `symbol`'s daily bars from UTC day `start` to `end` (left out) at market day `at`: the candles; the product's
 *  refusal; or no bars served here. */
export async function fetchBars(symbol: string, start: string, end: string, at: string): Promise<{ kind: "bars"; candles: Candle[] } | Unread> {
  const read = await getJson<Bars>(`/api/bars?${new URLSearchParams({ symbol, timeframe: "1d", start, end, at })}`);
  if (read.kind !== "ready" || !read.body.bars) return read.kind === "ready" ? { kind: "absent", message: "no bars" } : read;
  const bars = read.body.bars, c = Object.fromEntries(bars.columns.map((name, i) => [name, i])) as Record<string, number>, n = (v: string | number | undefined) => Number(v);
  return { kind: "bars", candles: bars.rows.map((r) => ({ time: n(r[c.ts_open_ms!]) / 1000, open: n(r[c.open!]), high: n(r[c.high!]), low: n(r[c.low!]), close: n(r[c.close!]), volume: n(r[c.volume!]) })) };
}
