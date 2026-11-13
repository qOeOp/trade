// The overview's HTTP interface, which `ide.py serve --overview` forwards the page's GETs to:
// GET /api/overview/health (whether the service is up), GET /api/overview/snapshot (every coin with its
// sector, quote, funding, open interest and market cap, and each kind of data's status) and
// GET /api/overview/coin?symbol= (one contract's seven-day line and its coin on each exchange) and
// GET /api/overview/news (the last week's headlines with the contracts each names) and
// GET /api/overview/minutes?symbol=&from=&to= (a listed contract's one-minute klines, from and to in ms,
// at most three days, read from Binance on request: a live run's chart). Nothing else exists: other methods are refused, as is a Host other than this service's own.
import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "./fetching.ts";
import { MAX_MINUTES, type Minute } from "./minutes.ts";
import type { CoinDetail, NewsItem, Snapshot } from "./store.ts";

export type Reads = { snapshot(): Snapshot; coin(symbol: string): CoinDetail | null; news(): NewsItem[] };
export type Minutes = { read(symbol: string, from: number, to: number): Promise<Minute[]> };

export function app(hosts: ReadonlySet<string>, reads: Reads, minutes: Minutes) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    const send = (status: number, body: unknown) => {
      const text = JSON.stringify(body);
      response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
                                   "x-content-type-options": "nosniff", "content-length": Buffer.byteLength(text) });
      response.end(text);
    };
    const url = new URL(request.url ?? "/", "http://overview"), path = url.pathname;
    if (!hosts.has(request.headers.host ?? "")) return send(403, { code: "FORBIDDEN", message: "requests come through the page's server" });
    if (request.method !== "GET") return send(405, { code: "METHOD_NOT_ALLOWED", message: "the overview only answers GET" });
    if (path === "/api/overview/health") return send(200, { ok: true });
    if (path === "/api/overview/snapshot") return send(200, reads.snapshot());
    if (path === "/api/overview/news") return send(200, { items: reads.news() });
    if (path === "/api/overview/coin") {
      const symbol = url.searchParams.get("symbol") ?? "", coin = reads.coin(symbol);
      return coin ? send(200, coin) : send(404, { code: "UNKNOWN_SYMBOL", message: `no contract ${symbol}` });
    }
    if (path === "/api/overview/minutes") {
      const q = url.searchParams, symbol = q.get("symbol") ?? "", from = Number(q.get("from")), to = Number(q.get("to"));
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from || to - from > MAX_MINUTES * 60_000)
        return send(400, { code: "BAD_REQUEST", message: `from and to are ms, to after from, at most ${MAX_MINUTES} minutes apart` });
      if (!reads.coin(symbol)) return send(404, { code: "UNKNOWN_SYMBOL", message: `no contract ${symbol}` });
      // Read first, answer after: a failure while answering is not Binance's and must not answer twice.
      let read: Minute[];
      try { read = await minutes.read(symbol, from, to); } catch (error) {
        return send(502, { code: "UPSTREAM", message: error instanceof HttpError ? error.message : "Binance did not answer" });
      }
      return send(200, { minutes: read });
    }
    return send(404, { code: "NOT_FOUND", message: path });
  };
}
