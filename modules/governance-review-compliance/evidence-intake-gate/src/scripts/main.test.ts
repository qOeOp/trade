import assert from "node:assert/strict"
import test from "node:test"
import { run } from "./main"

test("evidence intake gate accepts complete evidence", () => {
  const result = run(["--json", JSON.stringify({
    evidence_ref: "artifact_catalog:artifact/review-evidence-1",
    verdict_ref: "governance_ledger:evidence_verdict/verdict-1",
    strategy_id: "trend-1",
    source_refs: ["artifact_catalog:artifact/replay-1"],
    data_hash: "sha256:data",
    policy_hash: "sha256:policy",
    freshness: { as_of: "2026-07-11T00:00:00Z", max_age_seconds: 3600 },
  })]) as { ok: boolean; data: { status: string; governance_ref: { kind: string; decision: string } } }

  assert.equal(result.ok, true)
  assert.equal(result.data.status, "accepted")
  assert.equal(result.data.governance_ref.kind, "evidence_verdict")
  assert.equal(result.data.governance_ref.decision, "accepted")
})

test("evidence intake gate blocks missing hashes", () => {
  const result = run(["--json", JSON.stringify({
    evidence_ref: "artifact_catalog:artifact/review-evidence-1",
    source_refs: ["artifact_catalog:artifact/replay-1"],
    freshness: { as_of: "2026-07-11T00:00:00Z" },
  })]) as { ok: boolean; data: { status: string; issues: unknown[] } }

  assert.equal(result.ok, false)
  assert.equal(result.data.status, "needs_evidence")
  assert.ok(result.data.issues.length > 0)
})
