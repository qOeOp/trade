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
  store.moves = new Map([["BTCUSDT", { back1h: 62344, back4h: null, back7d: 77930 * 2 }]]);  // the windows measured against the latest price
  store.lines = new Map([["BTCUSDT", [[1793000000, 76000], [1793003600, 77000]]]]);
  store.interest = new Map([["BTCUSDT", { oi: 8e9, oiChange24h: 2.5 }]]);
  store.ratios = new Map([["BTCUSDT", 1.8]]);
  store.intervals = new Map([["NEWUSDT", 4]]);
  store.venues.set("Bybit", new Map([["BTC", { oi: 5e9, funding: 0.00005, intervalHours: 8 }]]));
  store.venues.set("OKX", new Map([["NEW", { oi: 1e6, funding: null, intervalHours: 4 }]]));
  return store;
}

test("the snapshot joins each quoted contract with its funding and market cap", () => {
  const { coins } = filled().snapshot();
  assert.deepEqual(coins.map((c) => c.symbol), ["BTCUSDT", "NEWUSDT"]);  // no quote, no tile
  assert.deepEqual(coins[0], { symbol: "BTCUSDT", base: "BTC", name: "Bitcoin", sector: "PoW", subsector: null, price: 77930, change24h: 0.34,
                               volume24h: 3.7e9, funding: 0.0001, marketCap: 1.57e12, fdv: 1.6e12, change1h: 25, change4h: null, change7d: -50,
                               oi: 8e9, oiChange24h: 2.5, longShort: 1.8, oiByVenue: [["Binance", 8e9], ["Bybit", 5e9]] });
  assert.deepEqual({ name: coins[1].name, funding: coins[1].funding, marketCap: coins[1].marketCap, oi: coins[1].oi, oiByVenue: coins[1].oiByVenue },
                   { name: "NEW", funding: null, marketCap: null, oi: null, oiByVenue: [["OKX", 1e6]] });  // only exchanges with open interest
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

test("a coin's details: its seven-day line and each exchange listing its coin, Binance first", () => {
  const store = filled();
  assert.deepEqual(store.coin("BTCUSDT"), { symbol: "BTCUSDT", line: [[1793000000, 76000], [1793003600, 77000]], venues: [
    { venue: "Binance", oi: 8e9, funding: 0.0001, intervalHours: 8 }, { venue: "Bybit", oi: 5e9, funding: 0.00005, intervalHours: 8 }] });
  assert.deepEqual(store.coin("NEWUSDT")!.venues.map((v) => [v.venue, v.intervalHours]), [["Binance", 4], ["OKX", 4]]);
  assert.equal(store.coin("NOPEUSDT"), null);
});
