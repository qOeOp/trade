import assert from "node:assert/strict"
import test from "node:test"
import { run } from "./main"

test("policy feedback compiler emits governance refs", () => {
  const result = run(["--json", JSON.stringify({
    feedback_ref: "governance_ledger:policy_feedback/feedback-1",
    review_refs: ["governance_ledger:review/review-1"],
    recommendation_kind: "risk_limit",
    severity: "warning",
    strategy_id: "trend-1",
    content_hash: "sha256:feedback",
  })]) as { ok: boolean; data: { schema_version: string; governance_ref: { kind: string }; recommendation_kind: string } }

  assert.equal(result.ok, true)
  assert.equal(result.data.schema_version, "policy-feedback.v1")
  assert.equal(result.data.recommendation_kind, "risk_limit")
  assert.equal(result.data.governance_ref.kind, "policy_feedback")
})

test("policy feedback compiler rejects missing review refs", () => {
  const result = run(["--json", JSON.stringify({
    feedback_ref: "governance_ledger:policy_feedback/feedback-1",
    recommendation_kind: "risk_limit",
    content_hash: "sha256:feedback",
  })])

  assert.equal(result.ok, false)
  assert.match(String(result.error), /review_refs/)
})
