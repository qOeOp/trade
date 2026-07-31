import assert from "node:assert/strict"
import test from "node:test"
import { run } from "./main"

test("panel mode preserves the panel evaluator error envelope", () => {
  const result = run(["--panel", "--json", JSON.stringify({ datasets: [], candidates: [] })])
  assert.equal(result.ok, false)
  assert.equal(result.schema_version, "panel-evaluator.script-response.v1")
  assert.match(String(result.error), /at least three datasets/)
})

test("candidate mode preserves the candidate batch error envelope", () => {
  const result = run(["--json", JSON.stringify({ candidates: [] })])
  assert.equal(result.ok, false)
  assert.equal(result.schema_version, "candidate-batch.script-response.v1")
})
