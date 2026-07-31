import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import { compileExecutionContract, type ExecutionContractInput } from "../../../../contracts/execution-contract/src/execution-contract"
import { appendPlanEvent, ensureSchema, readFlowEvents } from "../../../../portfolio-execution-state/event-store/src/lib/event-store"
import { buildMockExecutionResult, evaluateIdempotency, type ExecutionStateRuntime } from "./execution-flow-runner"

test("mock execution result is deterministic for one contract entry", () => {
  const result = buildMockExecutionResult(contract(), "shadow")
  assert.equal(result.mode, "shadow")
  assert.equal(result.method, "shadowFuturesCreateAlgoOrder")
  assert.deepEqual(result.result, {
    orderId: "mock-flow-exec-1-entry",
    clientOrderId: "flow-exec-1-entry",
    status: "NEW",
    symbol: "BTCUSDT",
    type: "STOP_MARKET",
  })
})

test("idempotency gate skips an already recorded source observe", () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  try {
    appendPlanEvent(db, {
      event_key: "fill-existing-1",
      chain_id: "flow-exec-1",
      kind: "order_fill",
      created_at: "2026-07-06T12:00:00Z",
      body_json: {
        sub_kind: "submit",
        lifecycle_status: "submitted",
        source: "reconcile",
        source_observe_event_key: "obs-exec-1",
        client_order_id: "flow-exec-1-entry",
      },
    })

    const gate = evaluateIdempotency("test://trade.db", contract(), stateRuntime(db)) as { status: string; reason?: string }
    assert.equal(gate.status, "skipped")
    assert.equal(gate.reason, "source_observe_already_recorded")
  } finally {
    db.close()
  }
})

function stateRuntime(db: Database): ExecutionStateRuntime {
  return {
    eventReader: (_dbPath, chainId) => readFlowEvents(db, chainId) as unknown as Record<string, unknown>[],
  }
}

function contract() {
  return compileExecutionContract({
    source_observe_event_key: "obs-exec-1",
    chain_id: "flow-exec-1",
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
      client_order_id: "flow-exec-1-entry",
    }],
  } satisfies ExecutionContractInput)
}
