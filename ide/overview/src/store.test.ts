import assert from "node:assert/strict";
import { test } from "node:test";
import { Liquidations } from "./liquidations.ts";
import { Store } from "./store.ts";

function filled() {
  const store = new Store();
  store.contracts = [{ symbol: "BTCUSDT", base: "BTC", sector: "PoW" }, { symbol: "NEWUSDT", base: "NEW", sector: "Other" }, { symbol: "OLDUSDT", base: "OLD", sector: "Other" }];
  store.quotes = new Map([["BTCUSDT", { price: 77930, change24h: 0.34, volume24h: 3.7e9 }], ["NEWUSDT", { price: 1, change24h: -2, volume24h: 1e6 }]]);
  store.funding = new Map([["BTCUSDT", 0.0001]]);
  store.ids = new Map([["BTCUSDT", "bitcoin"]]);
  store.caps = new Map([["bitcoin", { name: "Bitcoin", marketCap: 1.57e12, fdv: 1.6e12 }]]);
  store.moves = new Map([["BTCUSDT", { back1h: 62344, back4h: null, back7d: 77930 * 2, line: [[1793000000, 76000], [1793003600, 77000]] }]]);  // the windows measured against the latest price
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
                               oi: 8e9, oiChange24h: 2.5, longShort: 1.8, oiByVenue: [["Binance", 8e9], ["Bybit", 5e9]], liquidations: { long: 0, short: 0 } });
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

test("liquidations: each exchange's recorded or hourly ones, summed for the coin, and since when all three pushes record", () => {
  const store = filled();
  store.venues.set("Gate", new Map([["BTC", { oi: 4e9, funding: 0.0001, intervalHours: 8 }]]));
  store.liquidations = new Liquidations(() => 1793602534217);
  store.liquidations.started("Bybit");
  store.liquidations.add([{ venue: "Bybit", market: "BTCUSDT", coin: "BTC", side: "long", usd: 3000, at: 1793602534217, key: "k" }]);
  store.gateLiquidations.set("BTC", { long: 500, short: 20 });
  assert.equal(store.snapshot().liquidationsSince, null);  // Binance and OKX not yet connected
  assert.deepEqual(store.snapshot().coins[0]!.liquidations, { long: 3500, short: 20 });
  assert.deepEqual(store.coin("BTCUSDT")!.venues.map((v) => [v.venue, v.liquidations]),
                   [["Binance", null], ["Bybit", { long: 3000, short: 0 }], ["Gate", { long: 500, short: 20 }]]);
  store.liquidations.started("Binance");
  store.liquidations.started("OKX");
  assert.equal(store.snapshot().liquidationsSince, new Date(1793602534217).toISOString());
  assert.deepEqual(store.coin("NEWUSDT")!.venues.map((v) => [v.venue, v.liquidations]), [["Binance", { long: 0, short: 0 }], ["OKX", { long: 0, short: 0 }]]);
});

test("a coin's details: its seven-day line and each exchange listing its coin, Binance first", () => {
  const store = filled();
  assert.deepEqual(store.coin("BTCUSDT"), { symbol: "BTCUSDT", line: [[1793000000, 76000], [1793003600, 77000]], venues: [
    { venue: "Binance", oi: 8e9, funding: 0.0001, intervalHours: 8, liquidations: null }, { venue: "Bybit", oi: 5e9, funding: 0.00005, intervalHours: 8, liquidations: null }] });
  assert.deepEqual(store.coin("NEWUSDT")!.venues.map((v) => [v.venue, v.intervalHours]), [["Binance", 4], ["OKX", 4]]);
  assert.equal(store.coin("NOPEUSDT"), null);
});

test("news: each headline with the contracts of the coins it names, by name only for the largest coins; none whose source names only unlisted coins, nor TradFi listings", () => {
  const store = new Store();
  store.contracts = [{ symbol: "BTCUSDT", base: "BTC", sector: "PoW" }, { symbol: "1000PEPEUSDT", base: "1000PEPE", sector: "Meme" }];
  store.ids = new Map([["BTCUSDT", "bitcoin"], ["1000PEPEUSDT", "pepe"]]);
  store.caps = new Map([["bitcoin", { name: "Bitcoin", marketCap: 1.57e12, fdv: null }], ["pepe", { name: "Pepe", marketCap: 1e9, fdv: null }]]);
  const at = Date.now();
  store.headlines.add([{ source: "X", kind: "news", title: "Bitcoin and PEPE rally", link: "https://x.test/1", at, coins: [] },
                       { source: "Upbit", kind: "announcement", title: "닐리온(NIL) 추가", link: "https://x.test/2", at: at - 1, coins: ["NIL"] },
                       { source: "Binance Square", kind: "news", title: "Tesla FSD praised", link: "https://x.test/3", at: at - 2, coins: ["TSLAB"] },
                       { source: "Bithumb", kind: "announcement", title: "비트코인(BTC) 안내", link: "https://x.test/4", at: at - 3, coins: ["BTC"] },
                       { source: "Bybit", kind: "announcement", title: "New listing: Listing of XLIUSDT on Bybit TradFi Perpetual", link: "https://x.test/5", at: at - 4, coins: [] }]);
  assert.deepEqual(store.news(), [{ source: "X", kind: "news", title: "Bitcoin and PEPE rally", link: "https://x.test/1", at, symbols: ["1000PEPEUSDT", "BTCUSDT"] },
                                  { source: "Bithumb", kind: "announcement", title: "비트코인(BTC) 안내", link: "https://x.test/4", at: at - 3, symbols: ["BTCUSDT"] }]);
});
