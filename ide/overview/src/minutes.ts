// One contract's one-minute klines over a window, read from Binance when asked (`GET /fapi/v1/klines`,
// 1500 a page): what a live run's chart draws, since Live records no bars of its own. A window that has
// ended is kept, the last few asked for; one still running is read again each time.
import type { Host } from "./fetching.ts";

/** [open time ms, open, high, low, close, volume], oldest first; the last may still be forming. */
export type Minute = [number, number, number, number, number, number];
/** The longest window one request may ask for: three days. */
export const MAX_MINUTES = 3 * 24 * 60;
const PAGE = 1500, MINUTE_MS = 60_000, KEPT = 32;

export class Minutes {
  private kept = new Map<string, Minute[]>();
  private host: Pick<Host, "json">; private now: () => number;
  constructor(host: Pick<Host, "json">, now: () => number = Date.now) { this.host = host; this.now = now; }

  /** `symbol`'s minutes opening from `from` up to `to` (ms, left out). */
  async read(symbol: string, from: number, to: number): Promise<Minute[]> {
    const key = `${symbol}:${from}:${to}`, done = to + MINUTE_MS <= this.now(), kept = this.kept.get(key);
    if (kept) return kept;
    const out: Minute[] = [];
    for (let at = from; at < to;) {
      // As many as the window still holds: Binance weighs a request by its limit (2 under 500, 10 over 1000).
      const limit = Math.min(PAGE, Math.ceil((to - at) / MINUTE_MS));
      const rows = await this.host.json<unknown[][]>(`/fapi/v1/klines?symbol=${symbol}&interval=1m&startTime=${at}&endTime=${to - 1}&limit=${limit}`);
      for (const r of rows) out.push([Number(r[0]), Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4]), Number(r[5])]);
      if (rows.length < limit) break;
      at = Number(rows.at(-1)![0]) + MINUTE_MS;
    }
    if (done) {
      this.kept.set(key, out);
      if (this.kept.size > KEPT) this.kept.delete(this.kept.keys().next().value!);
    }
    return out;
  }
}
