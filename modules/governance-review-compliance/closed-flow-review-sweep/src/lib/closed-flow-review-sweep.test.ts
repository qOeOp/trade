import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import { appendPlanEvent, ensureSchema } from "../../../../portfolio-execution-state/event-store/src/lib/event-store"
import { ensureGovernanceLedgerSchema } from "../../../governance-ledger/src/lib/governance-ledger"
import { reviewCandidateForChain, runClosedFlowReviewSweep } from "./closed-flow-review-sweep"

test("closed flow review sweep records candidates for flat unreviewed flows", () => {
  const tradeDb = new Database(":memory:")
  const govDb = new Database(":memory:")
  ensureSchema(tradeDb)
  ensureGovernanceLedgerSchema(govDb)
  try {
    seedClosedFlow(tradeDb, "flow-closed")
    const result = runClosedFlowReviewSweep(tradeDb, govDb, {
      batch_id: "batch-closed",
      candidate_chain_ids: ["flow-closed"],
      now: "2026-07-11T00:00:00Z",
    })
    assert.equal(result.ok, true)
    assert.equal(result.candidates.length, 1)
    assert.equal(result.candidates[0].chain_id, "flow-closed")
    assert.equal(result.batch_ref, "governance_ledger:review_batch/batch-closed")
    const row = govDb.query("SELECT status, summary_json FROM review_batch WHERE batch_id='batch-closed'").get() as { status: string; summary_json: string }
    assert.equal(row.status, "planned")
    assert.equal(JSON.parse(row.summary_json).candidate_count, 1)
  } finally {
    tradeDb.close()
    govDb.close()
  }
})

test("closed flow review sweep skips already reviewed and still-open flows", () => {
  const tradeDb = new Database(":memory:")
  ensureSchema(tradeDb)
  try {
    seedClosedFlow(tradeDb, "flow-reviewed")
    appendPlanEvent(tradeDb, {
      event_key: "review-1",
      chain_id: "flow-reviewed",
      kind: "review",
      created_at: "2026-07-11T01:00:00Z",
      body_json: {
        strategy_ref: "S1",
        outcome: "win",
        pnl_r: 1,
        thesis_held: true,
        key_lesson: "worked",
        promote_to_strategy: false,
      },
    })
    assert.equal(reviewCandidateForChain(tradeDb, "flow-reviewed"), null)
  } finally {
    tradeDb.close()
  }
})

function seedClosedFlow(db: Database, chainId: string): void {
  appendPlanEvent(db, {
    event_key: `${chainId}-observe`,
    chain_id: chainId,
    kind: "observe",
    created_at: "2026-07-10T00:00:00Z",
    body_json: {
      source: "slow_track",
      strategy_ref: "S1",
      symbol: "BTCUSDT",
      side: "long",
    },
  })
  appendPlanEvent(db, {
    event_key: `${chainId}-entry`,
    chain_id: chainId,
    kind: "order_fill",
    created_at: "2026-07-10T01:00:00Z",
    body_json: {
      source: "trade_flow",
      source_observe_event_key: `${chainId}-observe`,
      execution_contract_snapshot: { id: "contract-1" },
      lifecycle_status: "filled",
      client_order_id: `${chainId}-entry`,
      symbol: "BTCUSDT",
      side: "BUY",
      qty: 1,
      filled_qty: 1,
      avg_fill_price: 100,
    },
  })
  appendPlanEvent(db, {
    event_key: `${chainId}-exit`,
    chain_id: chainId,
    kind: "order_fill",
    created_at: "2026-07-10T05:00:00Z",
    body_json: {
      source: "trade_flow",
      source_observe_event_key: `${chainId}-observe`,
      execution_contract_snapshot: { id: "contract-2" },
      lifecycle_status: "filled",
      client_order_id: `${chainId}-exit`,
      symbol: "BTCUSDT",
      side: "SELL",
      qty: 1,
      filled_qty: 1,
      avg_fill_price: 101,
    },
  })
}

