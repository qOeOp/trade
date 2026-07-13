import assert from "node:assert/strict"
import test from "node:test"
import { run } from "./main"

test("decision input assembler builds ref bundles", () => {
  const result = run(["--json", JSON.stringify({
    decision_input_ref: "artifact_catalog:artifact/decision-input-1",
    source_refs: ["policy_registry:runtime_policy/policy-1", "market_data_store:features/BTCUSDT/4h"],
    policy_refs: ["policy_registry:runtime_policy/policy-1"],
    market_refs: ["market_data_store:features/BTCUSDT/4h"],
    symbol_scope: ["BTCUSDT"],
    assembled_at: "2026-07-11T00:00:00Z",
  })]) as { ok: boolean; data: { schema_version: string; decision_input_ref: string; content_hash: string } }

  assert.equal(result.ok, true)
  assert.equal(result.data.schema_version, "decision-input-bundle.v1")
  assert.equal(result.data.decision_input_ref, "artifact_catalog:artifact/decision-input-1")
  assert.match(result.data.content_hash, /^fnv1a:/)
})

test("decision input assembler rejects empty source refs", () => {
  const result = run(["--json", JSON.stringify({
    decision_input_ref: "artifact_catalog:artifact/decision-input-1",
    assembled_at: "2026-07-11T00:00:00Z",
  })])

  assert.equal(result.ok, false)
  assert.match(String(result.error), /source_refs/)
})
