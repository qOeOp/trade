import assert from "node:assert/strict";
import { test } from "node:test";
import { fromBinance, fromBybit, fromOkx, gateDay, Liquidations, okxContractValues, type Liquidation } from "./liquidations.ts";
import { fixture } from "./fixture.ts";

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b));
const HOUR = 3_600_000;

test("Bybit: a Buy is a long liquidated, worth its coins times its price", () => {
  const [near, btc] = fixture("bybitAllLiquidation.json");
  const read = fromBybit(btc);
  assert.equal(read.length, 1);
  assert.deepEqual({ ...read[0], usd: 0 }, { venue: "Bybit", market: "BTCUSDT", coin: "BTC", side: "long", usd: 0, at: 1793602534217,
                                            key: "BTCUSDT|1793602534217|Buy|0.048|77864.70" });
  assert.ok(close(read[0]!.usd, 0.048 * 77864.7));
  assert.equal(fromBybit(near).length, 3);
  assert.equal(fromBybit({ ...btc, data: btc.data.map((d: object) => ({ ...d, S: "Sell" })) })[0]!.side, "short");
  assert.deepEqual(fromBybit({ success: true, op: "subscribe" }), []);  // a subscription's answer is no liquidation
});

test("Binance: a SELL order closes a long, worth its filled coins at their average price", () => {
  const [hype, bless] = fixture("binanceForceOrder.json");
  const [h] = fromBinance(hype);
  assert.deepEqual({ venue: h!.venue, coin: h!.coin, side: h!.side, at: h!.at }, { venue: "Binance", coin: "HYPE", side: "long", at: 1793602529095 });
  assert.ok(close(h!.usd, 2.93 * 86.06));
  assert.ok(close(fromBinance(bless)[0]!.usd, 4306 * 0.0100402));  // z, all filled, not l, the last fill
  assert.equal(fromBinance({ ...hype, o: { ...hype.o, S: "BUY" } })[0]!.side, "short");
});

test("OKX: contracts times the coins in one at the bankruptcy price, pushed or listed by REST", () => {
  const values = okxContractValues(fixture("okxInstruments.json"));
  assert.equal(values.get("BTC-USDT-SWAP"), 0.01);
  const [pushed] = fixture("okxLiquidationOrders.json");
  const [sndk] = fromOkx(pushed, values);
  assert.deepEqual({ venue: sndk!.venue, market: sndk!.market, coin: sndk!.coin, side: sndk!.side }, { venue: "OKX", market: "SNDK-USDT-SWAP", coin: "SNDK", side: "long" });
  assert.ok(close(sndk!.usd, 0.298 * 1 * 1180.2));
  const listed = fromOkx(fixture("okxLiquidationOrdersRest.json"), values);
  assert.equal(listed.length, 2);
  assert.ok(close(listed[0]!.usd, 10 * 0.01 * 78108.2));
  assert.deepEqual(fromOkx(pushed, new Map()), []);  // no contract size, no value
  const net = { data: [{ ...pushed.data[0], details: [{ ...pushed.data[0].details[0], posSide: "net", side: "buy" }] }] };
  assert.equal(fromOkx(net, values)[0]!.side, "short");  // in net mode a buy closes a short
});

test("Gate: the hours that began within the last day, longs and shorts apart", () => {
  const rows = fixture("gateContractStats.json"), last = rows.at(-1).time * 1000;
  const day = gateDay(rows, last + HOUR);
  assert.ok(close(day.long, 4656.038112 + 11334.060153));
  assert.ok(close(day.short, 7.832799));
  assert.deepEqual(gateDay(rows, last + 25 * HOUR), { long: 0, short: 0 });
});

test("the record keeps each liquidation once for 24 hours and adds them up by coin and venue", () => {
  let now = 1793602534217;
  const record = new Liquidations(() => now);
  const one = (venue: Liquidation["venue"], side: Liquidation["side"], usd: number, key: string, at = now): Liquidation =>
    ({ venue, market: "BTCUSDT", coin: "BTC", side, usd, at, key });
  record.add([one("Bybit", "long", 100, "a"), one("Bybit", "long", 100, "a"), one("Bybit", "short", 40, "b"), one("Binance", "long", 7, "c")]);
  record.add([one("Bybit", "long", 1, "old", now - 25 * HOUR)]);  // older than a day, never counted
  assert.deepEqual(Object.fromEntries(record.byCoin().get("BTC")!), { Bybit: { long: 100, short: 40 }, Binance: { long: 7, short: 0 } });
  assert.deepEqual([...record.markets("Bybit", now - HOUR)], ["BTCUSDT"]);
  now += 24 * HOUR + 1;
  record.add([one("Bybit", "long", 5, "a")]);  // a day later the key is free again
  assert.deepEqual(Object.fromEntries(record.byCoin().get("BTC")!), { Bybit: { long: 5, short: 0 } });
});
