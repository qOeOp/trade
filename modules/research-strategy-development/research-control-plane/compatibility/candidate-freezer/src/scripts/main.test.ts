import assert from "node:assert/strict"
import test from "node:test"
import { run } from "./main"

test("candidate freezer emits frozen candidate refs", () => {
  const result = run(["--json", JSON.stringify({
    candidate_ref: "research_state_store:frozen_candidate/trend-1",
    strategy_id: "trend-1",
    frozen_at: "2026-07-11T00:00:00Z",
    source_evidence_refs: ["artifact_catalog:artifact/replay-1"],
    assumption_refs: ["artifact_catalog:artifact/assumptions-1"],
    promotion_status: "validated",
    content_hash: "sha256:candidate",
  })]) as { ok: boolean; data: { schema_version: string; candidate_ref: string; promotion_status: string } }

  assert.equal(result.ok, true)
  assert.equal(result.data.schema_version, "trade.protocol.frozen-candidate-ref.v1")
  assert.equal(result.data.candidate_ref, "research_state_store:frozen_candidate/trend-1")
  assert.equal(result.data.promotion_status, "validated")
})

test("candidate freezer rejects payloads without evidence", () => {
  const result = run(["--json", JSON.stringify({
    candidate_ref: "research_state_store:frozen_candidate/trend-1",
    strategy_id: "trend-1",
    frozen_at: "2026-07-11T00:00:00Z",
    promotion_status: "validated",
    content_hash: "sha256:candidate",
  })])

  assert.equal(result.ok, false)
  assert.match(String(result.error), /source_evidence_refs/)
})
