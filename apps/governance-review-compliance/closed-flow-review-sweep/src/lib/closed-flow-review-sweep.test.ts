import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import { appendPlanEvent, ensureSchema, listChainIds, readFlowEvents } from "../../../../portfolio-execution-state/event-store/src/lib/event-store"
import { reduceFlowState } from "../../../../portfolio-execution-state/flow-projector/src/lib/flow-projector"
import { ensureGovernanceLedgerSchema } from "../../../governance-ledger/src/lib/governance-ledger"
import { reviewCandidateForChain, runClosedFlowReviewSweep, type ClosedFlowReviewRuntime } from "./closed-flow-review-sweep"

const TEST_TRADE_DB_PATH = "test://trade.db"

test("closed flow review sweep records candidates for flat unreviewed flows", () => {
  const tradeDb = new Database(":memory:")
  const govDb = new Database(":memory:")
  ensureSchema(tradeDb)
  ensureGovernanceLedgerSchema(govDb)
  try {
    seedClosedFlow(tradeDb, "flow-closed")
    const result = runClosedFlowReviewSweep(TEST_TRADE_DB_PATH, govDb, {
      batch_id: "batch-closed",
      candidate_chain_ids: ["flow-closed"],
      cycle_id: "cycle-j07-lib",
      now: "2026-07-11T00:00:00Z",
    }, testRuntime(tradeDb))
    assert.equal(result.ok, true)
    assert.equal(result.candidates.length, 1)
    assert.equal(result.candidates[0].chain_id, "flow-closed")
    assert.equal(result.batch_ref, "governance_ledger:review_batch/batch-closed")
    assert.equal(result.runtime_result.schema_id, "trade.domain-runtime.domain-job-result.v1")
    assert.equal(result.runtime_result.domain, "governance-review-compliance")
    assert.equal(result.runtime_result.job_id, "closed_flow_review_sweep")
    assert.deepEqual(result.runtime_result.writes, { governance_ledger: true })
    assert.deepEqual(result.runtime_result.output_refs, ["governance_ledger:review_batch/batch-closed"])
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
    assert.equal(reviewCandidateForChain(TEST_TRADE_DB_PATH, "flow-reviewed", testRuntime(tradeDb)), null)
  } finally {
    tradeDb.close()
  }
})

function testRuntime(db: Database): ClosedFlowReviewRuntime {
  return {
    chainLister: () => listChainIds(db),
    eventReader: (_dbPath, chainId) => readFlowEvents(db, chainId) as unknown as Record<string, unknown>[],
    flowStateReader: (_dbPath, chainId) => reduceFlowState(db, chainId),
  }
}

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
