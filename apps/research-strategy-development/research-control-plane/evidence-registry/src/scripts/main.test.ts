import assert from "node:assert/strict"
import test from "node:test"
import { run } from "./main"

test("research evidence publisher emits evidence refs", () => {
  const result = run(["--json", JSON.stringify({
    evidence_ref: "artifact_catalog:artifact/research-evidence-1",
    evidence_kind: "candidate",
    artifact_refs: ["artifact_catalog:artifact/replay-1"],
    candidate_refs: ["research_state_store:frozen_candidate/trend-1"],
    source_refs: ["market_data_store:features/BTCUSDT/4h"],
    produced_at: "2026-07-11T00:00:00Z",
    content_hash: "sha256:evidence",
  })]) as { ok: boolean; data: { schema_version: string; evidence_ref: string; evidence_kind: string } }

  assert.equal(result.ok, true)
  assert.equal(result.data.schema_version, "trade.protocol.research-evidence-ref.v1")
  assert.equal(result.data.evidence_ref, "artifact_catalog:artifact/research-evidence-1")
  assert.equal(result.data.evidence_kind, "candidate")
})

test("research evidence publisher rejects payloads without artifacts", () => {
  const result = run(["--json", JSON.stringify({
    evidence_ref: "artifact_catalog:artifact/research-evidence-1",
    evidence_kind: "candidate",
    produced_at: "2026-07-11T00:00:00Z",
    content_hash: "sha256:evidence",
  })])

  assert.equal(result.ok, false)
  assert.match(String(result.error), /artifact_refs/)
})
