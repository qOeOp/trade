import assert from "node:assert/strict";
import { test } from "node:test";
import { Store } from "./store.ts";

function filled() {
  const store = new Store();
  store.contracts = [{ symbol: "BTCUSDT", base: "BTC", sector: "PoW" }, { symbol: "NEWUSDT", base: "NEW", sector: "Other" }, { symbol: "OLDUSDT", base: "OLD", sector: "Other" }];
  store.quotes = new Map([["BTCUSDT", { price: 77930, change24h: 0.34, volume24h: 3.7e9 }], ["NEWUSDT", { price: 1, change24h: -2, volume24h: 1e6 }]]);
  store.funding = new Map([["BTCUSDT", 0.0001]]);
  store.ids = new Map([["BTCUSDT", "bitcoin"]]);
  store.caps = new Map([["bitcoin", { name: "Bitcoin", marketCap: 1.57e12, fdv: 1.6e12 }]]);
  return store;
}

test("the snapshot joins each quoted contract with its funding and market cap", () => {
  const { coins } = filled().snapshot();
  assert.deepEqual(coins.map((c) => c.symbol), ["BTCUSDT", "NEWUSDT"]);  // no quote, no tile
  assert.deepEqual(coins[0], { symbol: "BTCUSDT", base: "BTC", name: "Bitcoin", sector: "PoW", price: 77930, change24h: 0.34,
                               volume24h: 3.7e9, funding: 0.0001, marketCap: 1.57e12, fdv: 1.6e12 });
  assert.deepEqual({ name: coins[1].name, funding: coins[1].funding, marketCap: coins[1].marketCap }, { name: "NEW", funding: null, marketCap: null });
});

test("a kind that fails keeps its last value and says why, the others unaffected", async () => {
  const store = filled();
  const at = () => new Date("2026-11-02T10:00:00Z");
  await store.refresh("quotes", async () => {}, at);
  await store.refresh("quotes", async () => { throw new Error("fapi answered 503"); }, at);
  assert.deepEqual(store.snapshot().sources.quotes, { updated: "2026-11-02T10:00:00.000Z", error: "fapi answered 503" });
  assert.equal(store.snapshot().coins.length, 2);
  assert.deepEqual(store.snapshot().sources.caps, { updated: null, error: null });
});
