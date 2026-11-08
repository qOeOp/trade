// A contract's one-minute klines over a window from the Market page's data service (ide/overview,
// `GET /api/overview/minutes`, read from Binance's public klines when asked), as bar lines of the paper
// journal's shape so the paper candle chart draws them: a live run records no bars of its own.
import type { JournalLine } from "./paperApi";

export type FetchedMinutes = { kind: "bars"; bars: JournalLine[] } | { kind: "absent"; message: string };

const MINUTE_NS = 60e9;

/** `symbol`'s minutes opening from `from` up to `to` (ms), each stamped at its close as a paper bar is. */
export async function fetchMinutes(symbol: string, from: number, to: number): Promise<FetchedMinutes> {
  try {
    const query = new URLSearchParams({ symbol, from: String(from), to: String(to) });
    const response = await fetch(`/api/overview/minutes?${query}`, { cache: "no-store" });
    const body = await response.json().catch(() => null) as { minutes?: number[][]; message?: string } | null;
    if (!response.ok || !body?.minutes) return { kind: "absent", message: body?.message ?? `HTTP ${response.status}` };
    return { kind: "bars", bars: body.minutes.map(([open, o, h, l, c, v]) => {
      const close = open! * 1e6 + MINUTE_NS;
      return { kind: "bar", wall_ns: close, ts_event: close, open: o, high: h, low: l, close: c, volume: v };
    }) };
  } catch (error) {
    return { kind: "absent", message: String(error) };
  }
}
