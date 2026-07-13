import assert from "node:assert/strict"
import test from "node:test"
import { run } from "./main"

test("trade plan builder emits plan drafts", () => {
  const result = run(["--json", JSON.stringify({
    plan_ref: "artifact_catalog:artifact/trade-plan-1",
    decision_input_ref: "artifact_catalog:artifact/decision-input-1",
    symbol: "BTCUSDT",
    side: "long",
    entry: 101,
    stop: 95,
    source_refs: ["artifact_catalog:artifact/decision-input-1"],
  })]) as { ok: boolean; data: { schema_version: string; plan_ref: string; entry: number } }

  assert.equal(result.ok, true)
  assert.equal(result.data.schema_version, "trade-plan-draft.v1")
  assert.equal(result.data.plan_ref, "artifact_catalog:artifact/trade-plan-1")
  assert.equal(result.data.entry, 101)
})

test("trade plan builder rejects unsupported sides", () => {
  const result = run(["--json", JSON.stringify({
    plan_ref: "artifact_catalog:artifact/trade-plan-1",
    decision_input_ref: "artifact_catalog:artifact/decision-input-1",
    symbol: "BTCUSDT",
    side: "flat",
    source_refs: ["artifact_catalog:artifact/decision-input-1"],
  })])

  assert.equal(result.ok, false)
  assert.match(String(result.error), /side/)
})
