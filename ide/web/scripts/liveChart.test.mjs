import assert from "node:assert/strict";
import { test } from "node:test";
import { namespace } from "./load.mjs";

const { liveChart, sideOf } = await namespace("model/liveChart.ts");

const MIN = 60_000, T = Date.UTC(2026, 10, 6, 20, 3), ns = (ms) => String(BigInt(ms) * 1_000_000n);
const order = (type, ms, extra = {}) => ({ event_type: type, ts_event: ns(ms), observed_ns: ns(ms + 40), event_ref: { source: "native", cursor: `${type}:${ms}` },
  instrument_id: "BTCUSDT-PERP.BINANCE", ...extra });
const run = (over = {}) => ({ id: "run", symbols: ["BTCUSDT"], running: false, observedNs: { account: ns(T - 20_000), terminal: ns(T + 41_000) },
  orders: [order("OrderInitialized", T, { order_side: "SELL", order_type: "LIMIT", price: "75838.20", quantity: "0.001" }),
    order("OrderFilled", T + 3_000, { order_side: "SELL", order_type: "LIMIT", last_px: "75893.00", last_qty: "0.001" }),
    order("OrderFilled", T + 31_000, { order_side: "BUY", order_type: "MARKET", last_px: "75886.0", last_qty: "0.001" })], positions: [], ...over });

test("a stopped run's chart spans an hour either side of its account check and terminal event, with its native fills unnetted", () => {
  const c = liveChart(run(), T + 86_400_000);
  assert.deepEqual([c.symbol, c.running, c.from, c.to], ["BTCUSDT", false, T - 61 * MIN, T + 61 * MIN]);
  assert.deepEqual(c.fills.map((f) => [f.buy, f.px, f.qty, f.opening, f.exit]), [[false, 75893, 0.001, null, null], [true, 75886, 0.001, null, null]],
    "Live sums no fills, so none is called an entry or an exit");
  assert.deepEqual([c.places, c.size], [2, 3]);
});

test("a running run reaches now; nothing placing a run in time draws no chart; a long run keeps its last three days", () => {
  const now = T + 10 * MIN + 5_000;
  const c = liveChart(run({ running: true, observedNs: { account: ns(T - 20_000), terminal: null } }), now);
  assert.equal(c.running, true);
  assert.equal(c.to, T + 12 * MIN, "the minute forming now and the next, never an hour ahead");
  assert.equal(c.fills.length, 2);
  assert.equal(liveChart(run({ orders: [order("OrderFilled", T, { order_side: "BUY", last_qty: "0.001", last_px: null })] }), now).fills.length, 0, "a fill with no price places nothing");
  assert.equal(liveChart(run({ orders: [], observedNs: { account: null, terminal: null } }), now), null);
  assert.equal(liveChart(run({ symbols: null }), now), null);
  const long = liveChart(run({ observedNs: { account: ns(T - 10 * 86_400_000), terminal: ns(T + 41_000) } }), T + 86_400_000);
  assert.equal(long.to - long.from, 3 * 86_400_000);
});

test("a run on several contracts charts the one asked for, with only its own fills and decimals, over the run's window", () => {
  const two = run({ symbols: ["BTCUSDT", "ETHUSDT"], orders: [...run().orders,
    order("OrderFilled", T + 9_000, { instrument_id: "ETHUSDT-PERP.BINANCE", order_side: "BUY", last_px: "2500.123", last_qty: "0.0100" })] });
  const btc = liveChart(two, T + 86_400_000), eth = liveChart(two, T + 86_400_000, "ETHUSDT");
  assert.equal(btc.symbol, "BTCUSDT", "the first contract by default");
  assert.deepEqual([eth.symbol, eth.fills.length, eth.fills[0].px, eth.places, eth.size], ["ETHUSDT", 1, 2500.123, 3, 4]);
  assert.deepEqual([eth.from, eth.to], [btc.from, btc.to]);
  assert.equal(btc.fills.length, 2);
  assert.equal(liveChart(two, T, "SOLUSDT"), null, "a contract the run does not trade");
});

test("a contract's side is its latest position event's, none once closed or the run ended", () => {
  const pos = (type, symbol, side) => ({ event_type: type, instrument_id: `${symbol}-PERP.BINANCE`, side });
  const held = run({ symbols: ["BTCUSDT", "ETHUSDT"], positions: [pos("PositionOpened", "BTCUSDT", "SHORT"), pos("PositionClosed", "BTCUSDT", "FLAT"), pos("PositionOpened", "ETHUSDT", "LONG")] });
  assert.deepEqual([sideOf(held, "BTCUSDT"), sideOf(held, "ETHUSDT")], [null, "LONG"]);
  assert.equal(sideOf({ ...held, ended: true }, "ETHUSDT"), null);
});
