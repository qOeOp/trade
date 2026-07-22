import assert from "node:assert/strict"
import test from "node:test"
import { run } from "./main"

test("forward holdout mode preserves the legacy error envelope", () => {
  const result = run(["--forward-holdout", "--json", JSON.stringify({ datasets: [] })])
  assert.equal(result.ok, false)
  assert.equal(result.schema_version, "forward-holdout.script-response.v1")
  assert.match(String(result.error), /strategyId, setupId, and frozenAt/)
})

test("latest signal mode preserves the signal evaluator error envelope", () => {
  const result = run(["--json", JSON.stringify({ candidate: {} })])
  assert.equal(result.ok, false)
  assert.equal(result.schema_version, "signal-evaluator.script-response.v1")
})
