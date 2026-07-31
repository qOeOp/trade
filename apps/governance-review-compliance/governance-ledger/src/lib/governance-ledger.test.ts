import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import {
  buildClosedFlowReview,
  buildGovernanceEvidence,
  buildPromotionDecision,
  buildReviewBatch,
  ensureGovernanceLedgerSchema,
  recordClosedFlowReview,
  recordGovernanceEvidence,
  recordPromotionDecision,
  recordReviewBatch,
} from "./governance-ledger"

test("governance ledger records evidence, decisions, closed-flow reviews, and batches", () => {
  const db = new Database(":memory:")
  ensureGovernanceLedgerSchema(db)
  try {
    recordGovernanceEvidence(db, buildGovernanceEvidence({
      evidence_id: "ev-1",
      strategy_id: "s1",
      evidence_kind: "replay",
      source_ref: "artifact://replay.json",
      body: { score: 1 },
    }))
    recordPromotionDecision(db, buildPromotionDecision({
      decision_id: "dec-1",
      strategy_id: "s1",
      to_status: "shadow",
      verdict: "approved",
      evidence_refs: ["ev-1"],
    }))
    recordClosedFlowReview(db, buildClosedFlowReview({
      review_id: "review-1",
      chain_id: "flow-1",
      strategy_id: "s1",
      pnl_r: 0.7,
      review_ref: "plan_event/review-1",
      body: { thesis_held: true },
    }))
    recordReviewBatch(db, buildReviewBatch({
      batch_id: "batch-1",
      status: "planned",
      input_refs: ["plan_event/flow-1"],
      summary: { candidate_count: 1 },
    }))

    assert.equal((db.query("SELECT COUNT(*) AS count FROM governance_evidence").get() as { count: number }).count, 1)
    assert.equal((db.query("SELECT COUNT(*) AS count FROM promotion_decision").get() as { count: number }).count, 1)
    assert.equal((db.query("SELECT pnl_r FROM closed_flow_review WHERE review_id='review-1'").get() as { pnl_r: number }).pnl_r, 0.7)
    assert.equal((db.query("SELECT status FROM review_batch WHERE batch_id='batch-1'").get() as { status: string }).status, "planned")
  } finally {
    db.close()
  }
})
