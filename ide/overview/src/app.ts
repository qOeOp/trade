// The overview's HTTP interface, which `ide.py serve --overview` forwards the page's GETs to:
// GET /api/overview/health (whether the service is up), GET /api/overview/snapshot (every coin with its
// sector, quote, funding, open interest and market cap, and each kind of data's status) and
// GET /api/overview/coin?symbol= (one contract's seven-day line and its coin on each exchange). Nothing
// else exists: other methods are refused, as is a Host other than this service's own.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CoinDetail, Snapshot } from "./store.ts";

export type Reads = { snapshot(): Snapshot; coin(symbol: string): CoinDetail | null };

export function app(hosts: ReadonlySet<string>, reads: Reads) {
  return (request: IncomingMessage, response: ServerResponse) => {
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
    if (path === "/api/overview/coin") {
      const symbol = url.searchParams.get("symbol") ?? "", coin = reads.coin(symbol);
      return coin ? send(200, coin) : send(404, { code: "UNKNOWN_SYMBOL", message: `no contract ${symbol}` });
    }
    return send(404, { code: "NOT_FOUND", message: path });
  };
}
