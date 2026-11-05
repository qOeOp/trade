import assert from "node:assert/strict";
import { test } from "node:test";
import { change, fundingIntervals, interest, longShort, moves } from "./binance.ts";
import { bitget, bybit, coinKey, gate, hyperliquid, okx } from "./venues.ts";
import { fixture } from "./fixture.ts";

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b));

test("open interest is the last five minutes' value, its change measured over 24 hours once the history spans them", () => {
  const rows = fixture("openInterestHist.json");
  const read = interest(rows)!;
  assert.equal(read.oi, Number(rows.at(-1).sumOpenInterestValue));
  assert.ok(close(read.oiChange24h!, (Number(rows.at(-1).sumOpenInterestValue) / Number(rows[0].sumOpenInterestValue) - 1) * 100));
  assert.equal(interest(rows.slice(1))!.oiChange24h, null);  // twelve hours of history is no 24h change
  assert.equal(interest([]), null);
});

test("the windows start from the close 12 and 48 five-minute klines and 168 hourly ones back", () => {
  const hourly = fixture("klines1h.json");
  const fiveMinute = Array.from({ length: 49 }, (_, i) => [i * 300_000, "0", "0", "0", String(100 + i)]);
  const read = moves(fiveMinute, hourly);
  assert.deepEqual([read.back1h, read.back4h, read.back7d], [136, 100, Number(hourly[0][4])]);
  assert.equal(read.line.length, 169);
  assert.deepEqual(read.line[0], [hourly[0][0] / 1000, Number(hourly[0][4])]);
  assert.equal(moves(fiveMinute.slice(0, 20), hourly.slice(0, 100)).back4h, null);
  assert.ok(close(change(110, 100)!, 10));
  assert.equal(change(110, null), null);
});

test("the long/short ratio and the funding periods other than eight hours are read per symbol", () => {
  assert.equal(longShort(fixture("longShortRatio.json")), 2.2573);
  assert.equal(fundingIntervals(fixture("fundingInfo.json")).get("GTCUSDT"), 4);
});

test("a contract's coin drops the size written into its symbol", () => {
  assert.deepEqual(["1000PEPE", "SHIB1000", "1MBABYDOGE", "1000000MOG", "10000SATS", "1INCH", "BTC"].map(coinKey),
                   ["PEPE", "SHIB", "BABYDOGE", "MOG", "SATS", "1INCH", "BTC"]);
});

test("each exchange's open interest comes out in USD, with its funding rate and period, keyed by coin", () => {
  const by = bybit(fixture("bybitTickers.json").result.list), btcRow = fixture("bybitTickers.json").result.list.find((r: { symbol: string }) => r.symbol === "BTCUSDT");
  assert.deepEqual([...by.keys()].sort(), ["BTC", "PEPE", "SHIB"]);  // USDC (…PERP) and dated contracts left out
  assert.deepEqual(by.get("BTC"), { oi: Number(btcRow.openInterestValue), funding: Number(btcRow.fundingRate), intervalHours: 8 });

  const o = okx(fixture("okxOpenInterest.json").data, fixture("okxFunding.json").data);
  const usdt = fixture("okxOpenInterest.json").data.find((r: { instId: string }) => r.instId === "BTC-USDT-SWAP");
  assert.deepEqual([...o.keys()].sort(), ["BTC", "PEPE"]);  // the coin-margined BTC-USD-SWAP left out
  assert.equal(o.get("BTC")!.oi, Number(usdt.oiUsd));
  assert.ok([1, 2, 4, 8].includes(o.get("BTC")!.intervalHours!));

  const bg = bitget(fixture("bitgetTickers.json").data, fixture("bitgetContracts.json").data);
  const bgRow = fixture("bitgetTickers.json").data.find((r: { symbol: string }) => r.symbol === "BTCUSDT");
  assert.ok(close(bg.get("BTC")!.oi!, Number(bgRow.holdingAmount) * Number(bgRow.markPrice)));
  assert.equal(bg.get("BTC")!.intervalHours, 8);
  assert.equal(bitget(fixture("bitgetTickers.json").data, []).get("BTC")!.intervalHours, null);

  const g = gate(fixture("gateTickers.json"), fixture("gateContracts.json"));
  const gRow = fixture("gateTickers.json").find((r: { contract: string }) => r.contract === "BTC_USDT");
  assert.ok(close(g.get("BTC")!.oi!, Number(gRow.total_size) * Number(gRow.quanto_multiplier) * Number(gRow.mark_price)));
  assert.equal(g.get("BTC")!.intervalHours, 8);
  const h = hyperliquid(fixture("hyperliquidMetaAndAssetCtxs.json"));
  assert.ok(close(h.get("BTC")!.oi!, 40226.62362 * 78376));
  assert.deepEqual([h.get("BTC")!.funding, h.get("BTC")!.intervalHours], [0.0000125, 1]);
  assert.ok(close(h.get("PEPE")!.oi!, 11808541390 * 0.004919));
  assert.deepEqual([...h.keys()].sort(), ["BTC", "ETH", "PEPE"]);
  assert.equal(hyperliquid({ error: "bad" }).size, 0);
  for (const m of [by, o, bg, g, h]) assert.ok(m.get("BTC")!.oi! > 1e8 && Math.abs(m.get("BTC")!.funding!) < 0.01);
});

test("of two contracts on one coin, the one with more open interest stands for it", () => {
  const rows = [{ symbol: "PEPEUSDT", openInterestValue: "5", fundingRate: "0.001", fundingIntervalHour: "4" },
                { symbol: "1000PEPEUSDT", openInterestValue: "900", fundingRate: "0.0001", fundingIntervalHour: "8" }];
  assert.deepEqual(bybit(rows).get("PEPE"), { oi: 900, funding: 0.0001, intervalHours: 8 });
  assert.deepEqual(bybit([...rows].reverse()).get("PEPE"), { oi: 900, funding: 0.0001, intervalHours: 8 });
});
