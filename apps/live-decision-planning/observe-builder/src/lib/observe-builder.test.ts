import assert from "node:assert/strict"
import test from "node:test"

import { buildAccountProjection, buildObserveEvent } from "./observe-builder"

const accountSnapshot = {
  data: {
    account: {
      totalMarginBalance: "1000.5",
      availableBalance: "800.25",
    },
    positions: [{
      symbol: "BTCUSDT",
      positionSide: "LONG",
      positionAmt: "0.01",
      entryPrice: "65000",
    }],
    openOrders: {
      regular: [{
        symbol: "BTCUSDT",
        type: "LIMIT",
      }],
      protective: [{
        symbol: "BTCUSDT",
        type: "STOP_MARKET",
      }],
    },
  },
  snapshot_ref: "account-run-1",
}

test("buildAccountProjection summarizes account and symbol state", () => {
  const projection = buildAccountProjection(accountSnapshot, "BTCUSDT")

  assert.equal(projection.equity_usdt, 1000.5)
  assert.equal(projection.available_balance_usdt, 800.25)
  assert.equal(projection.position_state, "LONG 0.01 @ 65000")
  assert.equal(projection.order_state, "regular=1; protective=1")
  assert.equal(projection.snapshot_ref, "account-run-1")
})

test("buildAccountProjection prefers canonical exchange account facts and preserves authority refs", () => {
  const projection = buildAccountProjection({
    account_facts: {
      schema_version: "trade.exchange.account-facts.v1",
      account_ref: "exchange-account://binance/live/usdm/primary",
      account_scope: "capital-scope://retail-small-usdm",
      equity_usdt: 1200.5,
      available_margin_usdt: 950.25,
      positions: [],
      open_orders: { regular: [], protective: [] },
      as_of: "2026-07-23T00:00:00.000Z",
      content_hash: `sha256:${"a".repeat(64)}`,
      snapshot_ref: `exchange-account-facts://binance/live/usdm/primary/2026/${"a".repeat(64)}`,
    },
  }, "BTCUSDT")

  assert.equal(projection.account_ref, "exchange-account://binance/live/usdm/primary")
  assert.equal(projection.account_scope, "capital-scope://retail-small-usdm")
  assert.equal(projection.equity_usdt, 1200.5)
  assert.equal(projection.available_balance_usdt, 950.25)
  assert.equal(projection.as_of, "2026-07-23T00:00:00.000Z")
})

test("buildObserveEvent creates minimal complete observe body", () => {
  const observe = buildObserveEvent({
    chain_id: "flow-1",
    symbol: "btcusdt",
    side: "long",
    strategy_ref: "S-TREND",
    setup_id: "trend-breakout",
    account_snapshot: accountSnapshot,
    market_snapshot: {
      data: {
        symbol: "BTCUSDT",
        markPrice: "65100",
        lastFundingRate: "0.0001",
      },
    },
    market_refs: ["market-run-1"],
    plan_seed: {
      direction_state: "偏多已确认",
      execution_verdict: "等条件",
      thesis: "4H trend intact",
      entry_intent: "breakout",
      exit_intent: "stop below range",
      invalidation: "close below range",
      expected_rr_net: 2,
      stop_price: 64000,
      risk_budget_usdt: 10,
    },
    created_at: "2026-07-06T12:00:00Z",
  })

  assert.equal(observe.kind, "observe")
  assert.equal(observe.chain_id, "flow-1")
  assert.equal(observe.body_json.symbol, "BTCUSDT")
  assert.equal((observe.body_json.account as { equity_usdt: number }).equity_usdt, 1000.5)
  assert.deepEqual((observe.body_json.microstructure as { refs: string[] }).refs, ["market-run-1"])
  assert.match((observe.body_json.microstructure as { notes: string }).notes, /mark=65100/)
})
