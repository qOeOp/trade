import assert from "node:assert/strict";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { app } from "./app.ts";
import { Store } from "./store.ts";

const store = () => { const s = new Store(); s.contracts = [{ symbol: "BTCUSDT", base: "BTC", sector: "PoW" }]; return s; };

type Answer = { status: number; json: () => unknown };
// node:http, since fetch() will not send a Host header of its own.
const get = (port: number, path: string, method: string, host: string) => new Promise<Answer>((resolve, reject) => {
  request({ port, path, method, headers: { host } }, (response) => {
    let body = "";
    response.on("data", (chunk) => (body += chunk)).on("end", () => resolve({ status: response.statusCode ?? 0, json: () => JSON.parse(body) }));
  }).on("error", reject).end();
});

async function serving(run: (call: (path: string, init?: { method?: string; host?: string }) => Promise<Answer>) => Promise<void>) {
  const server: Server = createServer(app(new Set(["127.0.0.1:8768"]), store()));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run((path, init = {}) => get(port, path, init.method ?? "GET", init.host ?? "127.0.0.1:8768"));
  } finally { server.close(); }
}

test("health, the snapshot, a coin and the news answer GET; other methods, paths and hosts are refused", async () => {
  await serving(async (call) => {
    assert.deepEqual((await call("/api/overview/health")).json(), { ok: true });
    const snapshot = (await call("/api/overview/snapshot")).json() as { sectors: string[]; coins: unknown[] };
    assert.equal(snapshot.sectors.at(-1), "Other");
    assert.deepEqual(snapshot.coins, []);
    assert.equal((await call("/api/overview/coin?symbol=BTCUSDT")).status, 200);
    assert.equal(((await call("/api/overview/coin?symbol=BTCUSDT")).json() as { venues: { venue: string }[] }).venues[0]!.venue, "Binance");
    assert.equal((await call("/api/overview/coin?symbol=NOPE")).status, 404);
    assert.deepEqual((await call("/api/overview/news")).json(), { items: [] });
    assert.equal((await call("/api/overview/snapshot", { method: "POST" })).status, 405);
    assert.equal((await call("/api/overview/elsewhere")).status, 404);
    assert.equal((await call("/api/overview/health", { host: "evil.example:8768" })).status, 403);
  });
});
