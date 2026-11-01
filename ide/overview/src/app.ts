// The overview's HTTP interface, which `ide.py serve --overview` forwards the page's GETs to:
// GET /api/overview/health (whether the service is up) and GET /api/overview/snapshot (every coin with
// its sector, quote, funding and market cap, and each kind of data's status). Nothing else exists: other
// methods are refused, as is a Host other than this service's own.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Snapshot } from "./store.ts";

export function app(hosts: ReadonlySet<string>, snapshot: () => Snapshot) {
  return (request: IncomingMessage, response: ServerResponse) => {
    const send = (status: number, body: unknown) => {
      const text = JSON.stringify(body);
      response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
                                   "x-content-type-options": "nosniff", "content-length": Buffer.byteLength(text) });
      response.end(text);
    };
    const path = new URL(request.url ?? "/", "http://overview").pathname;
    if (!hosts.has(request.headers.host ?? "")) return send(403, { code: "FORBIDDEN", message: "requests come through the page's server" });
    if (request.method !== "GET") return send(405, { code: "METHOD_NOT_ALLOWED", message: "the overview only answers GET" });
    if (path === "/api/overview/health") return send(200, { ok: true });
    if (path === "/api/overview/snapshot") return send(200, snapshot());
    return send(404, { code: "NOT_FOUND", message: path });
  };
}
