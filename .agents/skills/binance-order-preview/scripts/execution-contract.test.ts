import assert from "node:assert/strict"
import test from "node:test"

import {
  compileExecutionContract,
  compileQuantity,
  validateExecutionContract,
  type ExecutionContractInput,
} from "./execution-contract"

const baseInput: ExecutionContractInput = {
  source_observe_event_key: "obs-1",
  chain_id: "flow-1",
  setup_id: "trend-breakout",
  market: "usdm",
  symbol: "btcusdt",
  side: "long",
  position_side: "BOTH",
  margin_mode: "isolated",
  target_leverage: 3,
  account_snapshot: {
    equity_usdt: 1000,
    available_balance_usdt: 800,
    snapshot_at: "2026-07-06T12:00:00+08:00",
  },
  risk: {
    risk_budget_usdt: 20,
    stop_price: 64000,
    invalidation: "4H closes below range low",
    expected_rr_net: 2.1,
  },
  entries: [
    {
      type: "LIMIT",
      price: 65000,
      margin_usdt: 100,
    },
  ],
  exchange_rules: {
    quantity_step_size: "0.001",
    min_qty: "0.001",
    min_notional: "5",
  },
}

test("compileQuantity converts margin and leverage to aligned base quantity", () => {
  assert.equal(compileQuantity({
    marginUsdt: 100,
    leverage: 3,
    referencePrice: 65000,
    quantityStepSize: "0.001",
    minQty: "0.001",
  }), 0.004)
})

test("compileExecutionContract produces auditable entry contract", () => {
  const contract = compileExecutionContract(baseInput)

  assert.equal(contract.symbol, "BTCUSDT")
  assert.equal(contract.entries[0].quantity, 0.004)
  assert.equal(contract.entries[0].client_order_id, "flow-1-1-entry")
  assert.deepEqual(contract.verify_policy, {
    read_after_submit: true,
    abort_on_mismatch: true,
  })
})

test("validateExecutionContract rejects missing source observe key", () => {
  const contract = compileExecutionContract(baseInput) as unknown as Record<string, unknown>
  delete contract.source_observe_event_key

  const result = validateExecutionContract(contract)

  assert.equal(result.ok, false)
  assert.match(result.errors.join("\n"), /source_observe_event_key/)
})

test("compileExecutionContract rejects entries below min notional", () => {
  assert.throws(
    () => compileExecutionContract({
      ...baseInput,
      entries: [{ type: "LIMIT", price: 65000, margin_usdt: 1 }],
      exchange_rules: {
        quantity_step_size: "0.00001",
        min_notional: "10",
      },
    }),
    /below min_notional/,
  )
})
