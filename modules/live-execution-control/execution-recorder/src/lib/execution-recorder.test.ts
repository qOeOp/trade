import assert from "node:assert/strict"
import test from "node:test"

import {
  buildRecordedActionEvents,
  buildRecordedExecutionEvent,
  unwrapToolResponse,
} from "./execution-recorder"

test("recorded entry event compiles execution contract and audit fields", () => {
  const event = buildRecordedExecutionEvent({
    event_key: "evt-entry",
    created_at: "2026-07-06T12:00:00Z",
    preflight_result: { verdict: "armable" },
    execution_contract_input: contractInput(),
    execution_result: {
      method: "futuresOrder",
      request: { symbol: "BTCUSDT" },
      result: {
        orderId: 123,
        clientOrderId: "flow-record-1-1-entry",
      },
    },
  })

  assert.equal(event.kind, "order_fill")
  assert.equal(event.chain_id, "flow-record-1")
  assert.equal(event.body_json.source_observe_event_key, "obs-record-1")
  assert.equal(event.body_json.client_order_id, "flow-record-1-1-entry")
  assert.equal(event.body_json.execution_method, "futuresOrder")
})

test("recorded cancel event returns an order_fill draft without persistence", () => {
  const [event] = buildRecordedActionEvents({
    target_action: "cancel_order",
    chain_id: "flow-record-cancel",
    source_observe_event_key: "obs-record-cancel",
    request: {
      symbol: "btc/usdt",
      orig_client_order_id: "entry-1",
    },
    execution_result: {
      method: "futuresCancelOrder",
      result: {
        clientOrderId: "entry-1",
        orderId: 123,
      },
    },
  })

  assert.equal(event.chain_id, "flow-record-cancel")
  assert.equal(event.body_json.sub_kind, "cancel")
  assert.equal(event.body_json.symbol, "BTCUSDT")
  assert.equal(event.body_json.source_observe_event_key, "obs-record-cancel")
})

test("recorder rejects incomplete execution tool results", () => {
  assert.throws(
    () => buildRecordedActionEvents({
      target_action: "sync_protection",
      chain_id: "flow-incomplete-protect",
      source_observe_event_key: "obs-incomplete-protect",
      request: { symbol: "BTCUSDT", position_side: "LONG", quantity: "0.01" },
      execution_result: {
        method: "futuresCreateAlgoOrder",
        created: [{ leg: "stopLoss", request: { symbol: "BTCUSDT" } }],
      },
    }),
    /sync_protection execution_result\.created\[0\]\.result must be an object/,
  )
})

test("unwrapToolResponse rejects failed tool envelopes", () => {
  assert.throws(
    () => unwrapToolResponse({ ok: false, error: "binance rejected order" }),
    /binance rejected order/,
  )
})

function contractInput() {
  return {
    source_observe_event_key: "obs-record-1",
    chain_id: "flow-record-1",
    setup_id: "trend-breakout",
    market: "usdm",
    symbol: "BTCUSDT",
    side: "long",
    position_side: "BOTH",
    margin_mode: "isolated",
    target_leverage: 2,
    account_snapshot: {
      equity_usdt: 1000,
      available_balance_usdt: 900,
      snapshot_at: "2026-07-06T12:00:00+08:00",
    },
    risk: {
      risk_budget_usdt: 10,
      stop_price: 64000,
      invalidation: "below range",
      expected_rr_net: 2,
    },
    entries: [{
      type: "STOP_MARKET",
      stop_price: 66000,
      margin_usdt: 100,
    }],
    exchange_rules: {
      quantity_step_size: "0.001",
      min_qty: "0.001",
    },
  }
}
