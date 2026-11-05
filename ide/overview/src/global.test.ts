import assert from "node:assert/strict";
import { test } from "node:test";
import { altseason, cap, coinbasePremium, dvol, fearGreed, koreaPremium, maxPain, options, SEASON_DAYS, seasonChange, stablecoins } from "./global.ts";
import { fixture } from "./fixture.ts";

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b));

test("CoinGecko's totals and alternative.me's index", () => {
  const body = fixture("coingeckoGlobal.json");
  assert.deepEqual(cap(body), { marketCap: body.data.total_market_cap.usd, marketCapChange24h: body.data.market_cap_change_percentage_24h_usd,
                                btcShare: body.data.market_cap_percentage.btc });
  assert.deepEqual(cap({}), { marketCap: null, marketCapChange24h: null, btcShare: null });
  assert.deepEqual(fearGreed(fixture("fearGreed.json")), { value: 37, label: "Fear" });
  assert.equal(fearGreed({ data: [] }), null);
});

test("stablecoins: USD-pegged ones only, the week's change among those reporting last week", () => {
  const body = fixture("stablecoins.json");
  const usd = body.peggedAssets.filter((a: { pegType: string }) => a.pegType === "peggedUSD");
  const reporting = usd.filter((a: { circulatingPrevWeek?: { peggedUSD?: number } }) => a.circulatingPrevWeek?.peggedUSD);  // USDL's is {}
  assert.equal(usd.length - reporting.length, 1, "the fixture holds one coin without last week's figure");
  const read = stablecoins(body)!;
  assert.ok(close(read.supply, usd.reduce((s: number, a: { circulating: { peggedUSD: number } }) => s + a.circulating.peggedUSD, 0)), "the euro coin is left out");
  const now = reporting.reduce((s: number, a: { circulating: { peggedUSD: number } }) => s + a.circulating.peggedUSD, 0);
  const before = reporting.reduce((s: number, a: { circulatingPrevWeek: { peggedUSD: number } }) => s + a.circulatingPrevWeek.peggedUSD, 0);
  assert.ok(close(read.change7d!, (now / before - 1) * 100));
  assert.equal(stablecoins({ peggedAssets: [] }), null);
});

test("premiums: Coinbase's in dollars at Kraken's Tether rate, Upbit's in Tether", () => {
  const spot = fixture("binanceSpotPrice.json"), kraken = fixture("krakenUsdtUsd.json"), upbit = fixture("upbitTicker.json");
  const coinbase = Number(fixture("coinbaseTicker.json").price), binance = Number(spot.price), tether = Number(kraken.result.USDTZUSD.c[0]);
  assert.ok(close(coinbasePremium(fixture("coinbaseTicker.json"), spot, kraken)!, (coinbase / (binance * tether) - 1) * 100));
  const krw = (m: string) => upbit.find((r: { market: string }) => r.market === m).trade_price;
  assert.ok(close(koreaPremium(upbit, spot)!, (krw("KRW-BTC") / krw("KRW-USDT") / binance - 1) * 100));
  assert.equal(koreaPremium(upbit.slice(0, 1), spot), null, "no Tether price, no premium");
  assert.equal(coinbasePremium({}, spot, kraken), null);
});

test("max pain: the strike that pays calls below it and puts above it least", () => {
  const o = (strike: number, put: boolean, oi: number) => ({ expiry: "2026-11-06", strike, put, oi });
  // At 100: puts at 110 pay 10 × 5 = 50. At 110: calls at 100 pay 10 × 1 = 10. At 120: calls 20 × 1 + 10 × 2 = 40, puts nothing.
  assert.equal(maxPain([o(100, false, 1), o(110, false, 2), o(110, true, 5), o(120, true, 0)]), 110);
  assert.equal(maxPain([]), null);
});

test("Deribit options: all expiries' open interest at the index, the nearest Friday's max pain, and DVOL", () => {
  const body = fixture("deribitOptions.json"), read = options(body)!;
  const total = body.result.reduce((s: number, r: { open_interest: number }) => s + r.open_interest, 0);
  assert.ok(close(read.oi, total * body.result[0].estimated_delivery_price));
  const side = (s: string) => body.result.filter((r: { instrument_name: string }) => r.instrument_name.endsWith(s)).reduce((a: number, r: { open_interest: number }) => a + r.open_interest, 0);
  assert.ok(close(read.putCall!, side("-P") / side("-C")));
  assert.equal(read.maxPain!.expiry, "2026-11-06", "Friday the 6th, not Tuesday the 3rd");
  assert.ok(body.result.some((r: { instrument_name: string }) => r.instrument_name === `BTC-6NOV26-${read.maxPain!.strike}-C`));
  assert.equal(options({ result: [] }), null);
  const d = fixture("deribitDvol.json");
  assert.equal(dvol(d), d.result.data.at(-1)[4]);
});

test("altcoin season: the share of coins with 90 days of history that rose more than Bitcoin", () => {
  const klines = fixture("klines1d.json");
  assert.equal(klines.length, SEASON_DAYS + 1);
  assert.ok(close(seasonChange(klines)!, Number(klines.at(-1)[4]) / Number(klines[0][4]) - 1));
  assert.equal(seasonChange(klines.slice(1)), null, "a coin listed within the window is not counted");
  assert.deepEqual(altseason(0.1, [0.2, 0.05, null, 0.3]), { index: 67, coins: 3 });
  assert.equal(altseason(null, [0.2]), null);
});
