import assert from "node:assert/strict"
import test from "node:test"

import { run } from "./contract"

test("contract CLI compiles inline JSON input", () => {
  const result = run([
    "--json",
    JSON.stringify({
      source_observe_event_key: "obs-1",
      chain_id: "flow-1",
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
        type: "LIMIT",
        price: 65000,
        margin_usdt: 100,
      }],
      exchange_rules: {
        quantity_step_size: "0.001",
        min_qty: "0.001",
      },
    }),
  ])

  assert.equal(result.ok, true)
  assert.equal("data" in result && (result.data as { entries: Array<{ quantity: number }> }).entries[0].quantity, 0.003)
})
