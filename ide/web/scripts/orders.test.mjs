// Every order a paper run placed as one row (model/events.ts orders): a run whose orders never filled shows them, with
// each order's final state. The lines are Nautilus's own order events (a native backtest of the entry-membership
// probe's cases) as engine/paper.py journals them, without their repr.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loader } from "./load.mjs";

const { orders, ordersText, priceText, quantityText } = await loader().namespace("model/events.ts");
const { precisions } = await loader().namespace("lib/paperApi.ts");

const NATIVE = {
  expire: [
    {"kind": "order", "wall_ns": 1767225659999000000, "client_order_id": "O-20260101-000059-001-AAA-E1", "order_side": "BUY", "order_type": "LIMIT", "quantity": "1.000", "price": "95.00", "reduce_only": false, "time_in_force": "GTD", "type": "OrderInitialized", "instrument_id": "AAAUSDT-PERP.BINANCE", "ts_event": 1767225659999000000},
    {"kind": "order", "wall_ns": 1767225659999000000, "client_order_id": "O-20260101-000059-001-AAA-E1", "type": "OrderSubmitted", "instrument_id": "AAAUSDT-PERP.BINANCE", "ts_event": 1767225659999000000},
    {"kind": "order", "wall_ns": 1767225659999000000, "client_order_id": "O-20260101-000059-001-AAA-E1", "venue_order_id": "BINANCE-1-1", "type": "OrderAccepted", "instrument_id": "AAAUSDT-PERP.BINANCE", "ts_event": 1767225659999000000},
    {"kind": "order", "wall_ns": 1767225779999000000, "client_order_id": "O-20260101-000059-001-AAA-E1", "venue_order_id": "BINANCE-1-1", "type": "OrderExpired", "instrument_id": "AAAUSDT-PERP.BINANCE", "ts_event": 1767225779999000000}
  ],
  partial_cancel: [
    {"kind": "order", "wall_ns": 1767225659999000000, "client_order_id": "O-20260101-000059-001-AAA-P1", "order_side": "BUY", "order_type": "LIMIT", "quantity": "1.000", "price": "95.00", "reduce_only": false, "time_in_force": "GTC", "type": "OrderInitialized", "instrument_id": "AAAUSDT-PERP.BINANCE", "ts_event": 1767225659999000000},
    {"kind": "order", "wall_ns": 1767225659999000000, "client_order_id": "O-20260101-000059-001-AAA-P1", "type": "OrderSubmitted", "instrument_id": "AAAUSDT-PERP.BINANCE", "ts_event": 1767225659999000000},
    {"kind": "order", "wall_ns": 1767225659999000000, "client_order_id": "O-20260101-000059-001-AAA-P1", "venue_order_id": "BINANCE-1-1", "type": "OrderAccepted", "instrument_id": "AAAUSDT-PERP.BINANCE", "ts_event": 1767225659999000000},
    {"kind": "order", "wall_ns": 1767225719999000000, "client_order_id": "O-20260101-000059-001-AAA-P1", "venue_order_id": "BINANCE-1-1", "order_side": "BUY", "order_type": "LIMIT", "last_qty": "0.250", "last_px": "95.00", "commission": "0.00475000 USDT", "liquidity_side": "MAKER", "trade_id": "T-926b63663415d291-007", "position_id": "BINANCE-1-1", "type": "OrderFilled", "instrument_id": "AAAUSDT-PERP.BINANCE", "ts_event": 1767225719999000000},
    {"kind": "order", "wall_ns": 1767225779999000000, "client_order_id": "O-20260101-000059-001-AAA-P1", "venue_order_id": "BINANCE-1-1", "type": "OrderPendingCancel", "instrument_id": "AAAUSDT-PERP.BINANCE", "ts_event": 1767225779999000000},
    {"kind": "order", "wall_ns": 1767225779999000000, "client_order_id": "O-20260101-000059-001-AAA-P1", "venue_order_id": "BINANCE-1-1", "type": "OrderCanceled", "instrument_id": "AAAUSDT-PERP.BINANCE", "ts_event": 1767225779999000000}
  ],
  stop: [
    {"kind": "order", "wall_ns": 1767225659999000000, "client_order_id": "O-20260101-000059-001-AAA-S1", "order_side": "BUY", "order_type": "MARKET", "quantity": "0.500", "reduce_only": false, "time_in_force": "GTC", "type": "OrderInitialized", "instrument_id": "AAAUSDT-PERP.BINANCE", "ts_event": 1767225659999000000},
    {"kind": "order", "wall_ns": 1767225659999000000, "client_order_id": "O-20260101-000059-001-AAA-S1", "type": "OrderSubmitted", "instrument_id": "AAAUSDT-PERP.BINANCE", "ts_event": 1767225659999000000},
    {"kind": "order", "wall_ns": 1767225659999000000, "client_order_id": "O-20260101-000059-001-AAA-S1", "venue_order_id": "BINANCE-1-1", "order_side": "BUY", "order_type": "MARKET", "last_qty": "0.500", "last_px": "100.00", "commission": "0.02500000 USDT", "liquidity_side": "TAKER", "trade_id": "T-6be027544904c598-005", "position_id": "P-20260101-000059-001-AAA-1", "type": "OrderFilled", "instrument_id": "AAAUSDT-PERP.BINANCE", "ts_event": 1767225659999000000},
    {"kind": "order", "wall_ns": 1767225659999000000, "client_order_id": "O-20260101-000059-001-AAA-S2", "order_side": "SELL", "order_type": "STOP_MARKET", "quantity": "0.500", "trigger_price": "90.00", "reduce_only": true, "time_in_force": "GTC", "type": "OrderInitialized", "instrument_id": "AAAUSDT-PERP.BINANCE", "ts_event": 1767225659999000000},
    {"kind": "order", "wall_ns": 1767225659999000000, "client_order_id": "O-20260101-000059-001-AAA-S2", "type": "OrderSubmitted", "instrument_id": "AAAUSDT-PERP.BINANCE", "ts_event": 1767225659999000000},
    {"kind": "order", "wall_ns": 1767225659999000000, "client_order_id": "O-20260101-000059-001-AAA-S2", "venue_order_id": "BINANCE-1-2", "type": "OrderAccepted", "instrument_id": "AAAUSDT-PERP.BINANCE", "ts_event": 1767225659999000000}
  ]
};
const ms = (ns) => ns / 1e6;

test("an order that expired unfilled is one row: placed, a buy limit at its price, Expired when it expired", () => {
  const [o, ...rest] = orders(NATIVE.expire), d = precisions(NATIVE.expire).get("AAAUSDT");
  assert.equal(rest.length, 0, "its four events are one order");
  assert.deepEqual([o.symbol, o.buy, o.type, o.price, o.trigger, o.quantity, o.filled, o.state, o.done, o.failed],
    ["AAAUSDT", true, "Limit", 95, null, 1, 0, "Expired", true, false]);
  assert.equal(o.placed, ms(NATIVE.expire[0].ts_event));
  assert.equal(o.at, ms(NATIVE.expire[3].ts_event), "the state's time is its expiry's");
  assert.deepEqual([priceText(o, d), quantityText(o, d)], ["95.00", "1.000"]);
  assert.equal(ordersText(orders(NATIVE.expire)), "1 order · 0 filled");
});

test("a part-filled order then canceled says Canceled and how much of it filled; a pending cancel changes nothing", () => {
  const [o] = orders(NATIVE.partial_cancel), d = precisions(NATIVE.partial_cancel).get("AAAUSDT");
  assert.deepEqual([o.state, o.filled, o.done], ["Canceled", 0.25, true]);
  assert.equal(quantityText(o, d), "0.250 of 1.000");
  const filledOnly = orders(NATIVE.partial_cancel.slice(0, 4))[0];
  assert.deepEqual([filledOnly.state, filledOnly.done], ["Partly filled", false]);
  assert.equal(orders(NATIVE.partial_cancel.slice(0, 5))[0].state, "Partly filled", "a pending cancel leaves it as it stands");
});

test("a filled market entry and its working reduce-only stop are two rows, the stop priced at its trigger", () => {
  const found = orders(NATIVE.stop), d = precisions(NATIVE.stop).get("AAAUSDT");
  const entry = found.find((o) => o.type === "Market"), stop = found.find((o) => o.type === "Stop market");
  assert.equal(found.length, 2);
  assert.deepEqual([entry.state, entry.filled, priceText(entry, d)], ["Filled", 0.5, null]);
  assert.deepEqual([stop.state, stop.done, stop.buy, stop.reduceOnly, priceText(stop, d)], ["Working", false, false, true, "trigger 90.00"]);
  assert.equal(ordersText(found), "2 orders · 1 filled");
});

test("orders of several contracts and runs list newest placed first; a denied order is failed with its reason", () => {
  const later = NATIVE.expire.map((l) => ({ ...l, instrument_id: "SOLUSDT-PERP.BINANCE", client_order_id: "O-2", ts_event: l.ts_event + 60e9 }));
  const denied = [{ ...NATIVE.expire[0], client_order_id: "O-3", ts_event: NATIVE.expire[0].ts_event + 120e9 },
    { kind: "order", wall_ns: 0, client_order_id: "O-3", reason: "NOTIONAL_EXCEEDS_FREE_BALANCE", type: "OrderDenied", instrument_id: "AAAUSDT-PERP.BINANCE", ts_event: NATIVE.expire[0].ts_event + 120e9 }];
  const found = orders([...NATIVE.expire, ...later, ...denied, { kind: "bar", wall_ns: 1 }]);
  assert.deepEqual(found.map((o) => [o.id, o.symbol, o.state]), [["O-3", "AAAUSDT", "Denied"], ["O-2", "SOLUSDT", "Expired"], ["O-20260101-000059-001-AAA-E1", "AAAUSDT", "Expired"]]);
  assert.deepEqual([found[0].failed, found[0].reason], [true, "NOTIONAL_EXCEEDS_FREE_BALANCE"]);
});
