import assert from "node:assert/strict";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { app } from "./app.ts";
import { HttpError } from "./fetching.ts";
import { Minutes } from "./minutes.ts";
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

async function serving(run: (call: (path: string, init?: { method?: string; host?: string }) => Promise<Answer>) => Promise<void>, minutes: Minutes | null = null) {
  const server: Server = createServer(app(new Set(["127.0.0.1:8768"]), store(), minutes));
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

const MIN = 60_000;
/** Binance's klines for a request path, `n` minutes from startTime, never past endTime. */
const klines = (asked: string[], fail = false) => ({ json: async <T>(path: string): Promise<T> => {
  asked.push(path);
  if (fail) throw new HttpError(429, "https://fapi.binance.com answered 429, paused 60 s");
  const q = new URLSearchParams(path.split("?")[1]), from = Number(q.get("startTime")), end = Number(q.get("endTime")), limit = Number(q.get("limit"));
  const rows = [];
  for (let t = from; t <= end && rows.length < limit; t += MIN) rows.push([t, "1", "3", "0.5", "2", "10", t + MIN - 1]);
  return rows as T;
} });

test("a listed contract's minutes come page by page from Binance, an ended window kept; bad windows and symbols are refused", async () => {
  const asked: string[] = [], minutes = new Minutes(klines(asked), () => 4000 * MIN);
  await serving(async (call) => {
    const first = await call(`/api/overview/minutes?symbol=BTCUSDT&from=0&to=${2000 * MIN}`);
    assert.equal(first.status, 200);
    const rows = (first.json() as { minutes: number[][] }).minutes;
    assert.equal(rows.length, 2000);
    assert.deepEqual(rows[1999], [1999 * MIN, 1, 3, 0.5, 2, 10]);
    assert.equal(asked.length, 2, "1500 a page");
    assert.deepEqual(asked.map((p) => new URLSearchParams(p.split("?")[1]).get("limit")), ["1500", "500"], "the second asks only for what is left");
    await call(`/api/overview/minutes?symbol=BTCUSDT&from=0&to=${2000 * MIN}`);
    assert.equal(asked.length, 2, "an ended window is not read again");
    await call(`/api/overview/minutes?symbol=BTCUSDT&from=${3900 * MIN}&to=${4000 * MIN}`);
    await call(`/api/overview/minutes?symbol=BTCUSDT&from=${3900 * MIN}&to=${4000 * MIN}`);
    assert.equal(asked.length, 4, "a window still running is read each time");
    assert.equal((await call(`/api/overview/minutes?symbol=NOPE&from=0&to=${MIN}`)).status, 404);
    for (const q of ["from=5&to=5", "from=x&to=60000", `from=0&to=${3 * 24 * 60 * MIN + 1}`])
      assert.equal((await call(`/api/overview/minutes?symbol=BTCUSDT&${q}`)).status, 400, q);
  }, minutes);
  await serving(async (call) => {
    const answer = await call(`/api/overview/minutes?symbol=BTCUSDT&from=0&to=${MIN}`);
    assert.deepEqual([answer.status, (answer.json() as { code: string }).code], [502, "UPSTREAM"]);
  }, new Minutes(klines([], true)));
});
