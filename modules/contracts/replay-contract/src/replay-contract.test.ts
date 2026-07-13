import { readFileSync } from "node:fs"
import assert from "node:assert/strict"
import test from "node:test"

test("replay result schema exposes the stable outer shell", () => {
  const schema = JSON.parse(readFileSync(new URL("./schemas/replay-result.schema.json", import.meta.url), "utf8")) as { $id?: string; required?: unknown }

  assert.equal(schema.$id, "trade-flow.replay-result.v1")
  assert.deepEqual(schema.required, [
    "strategy_id",
    "symbol",
    "timeframe",
    "sample_count",
    "win_rate",
    "avg_r",
    "total_r",
    "max_drawdown_r",
    "profit_factor",
    "expectancy_r",
    "gate",
    "trades",
    "assumptions",
    "provenance",
    "notes",
  ])
})

test("replay fingerprint schema exposes the owner fingerprint contract", () => {
  const schema = JSON.parse(readFileSync(new URL("./schemas/replay-fingerprint.schema.json", import.meta.url), "utf8")) as {
    $id?: string
    required?: unknown
    properties?: Record<string, { pattern?: string }>
  }

  assert.equal(schema.$id, "trade-flow.replay-fingerprint.v1")
  assert.deepEqual(schema.required, ["harness_hash"])
  assert.equal(schema.properties?.harness_hash?.pattern, "^[a-f0-9]{64}$")
  assert.equal(schema.properties?.data_hash?.pattern, "^[a-f0-9]{64}$")
  assert.equal(schema.properties?.assumptions_hash?.pattern, "^[a-f0-9]{64}$")
})
