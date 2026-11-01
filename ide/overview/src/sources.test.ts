import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fundingRates, quotes } from "./binance.ts";
import { caps, coinIds, PAGE, pages } from "./coingecko.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

test("Binance quotes and funding are read per symbol as numbers", () => {
  const q = quotes(fixture("ticker24hr.json")).get("BTCUSDT")!;
  assert.ok(q.price > 1000 && Math.abs(q.change24h) < 50 && q.volume24h > 1e8);
  const f = fundingRates(fixture("premiumIndex.json")).get("BTCUSDT")!;
  assert.ok(Math.abs(f) < 0.01);
  assert.equal(quotes([{ symbol: "X", lastPrice: "", priceChangePercent: "1", quoteVolume: "2" }]).size, 0);
});

test("CoinGecko's wrong 1000x mappings are fixed and contracts without a coin are skipped", () => {
  const ids = coinIds(fixture("binanceFutures.json"));
  assert.equal(ids.get("BTCUSDT"), "bitcoin");
  assert.equal(ids.get("1000SHIBUSDT"), "shiba-inu");
  assert.equal(ids.has("XAUUSDT"), false);
});

test("market caps are read per coin id, and ids go out in pages of at most 250", () => {
  const found = caps(fixture("coinsMarkets.json"));
  assert.equal(found.get("bitcoin")!.name, "Bitcoin");
  assert.ok(found.get("bitcoin")!.marketCap! > 1e11);
  const many = Array.from({ length: 2 * PAGE + 3 }, (_, i) => `coin-${i}`);
  assert.deepEqual(pages([...many, "coin-0"]).map((p) => p.length), [PAGE, PAGE, 3]);
});
