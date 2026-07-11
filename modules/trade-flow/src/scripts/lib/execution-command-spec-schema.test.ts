import { readFileSync } from "node:fs"
import assert from "node:assert/strict"
import test from "node:test"
import { buildExecutionCommandSpec, EXECUTABLE_TARGET_ACTIONS } from "../../../../flow/execution-router/src/lib/execution-router"

type JSONRecord = Record<string, unknown>

const EXECUTABLE_TOOLS = [
  "binance-order-place",
  "binance-order-cancel",
  "binance-position-protect",
  "binance-position-adjust",
]

test("execution command spec schema matches executable routing contract", () => {
  const schema = readSchema()
  assert.equal(schema.$id, "trade-flow.execution-command-spec.v1")
  assert.deepEqual(asArray(schema.required), ["target_action", "tool", "cwd", "command"])
  assert.deepEqual(asArray(asRecord(asRecord(schema.properties).target_action).enum), [...EXECUTABLE_TARGET_ACTIONS])
  assert.deepEqual(asArray(asRecord(asRecord(schema.properties).tool).enum), EXECUTABLE_TOOLS)
  assert.equal(asRecord(schema).additionalProperties, false)

  const spec = buildExecutionCommandSpec({
    repoRoot: "/repo",
    target_action: "cancel_order",
    request: {
      symbol: "BTCUSDT",
      orig_client_order_id: "flow-command-schema-1-entry",
    },
  }) as unknown as JSONRecord
  for (const field of asArray(schema.required)) {
    assert.ok(String(field) in spec, `missing required field ${String(field)}`)
  }
  assert.equal(spec.target_action, "cancel_order")
  assert.equal(spec.tool, "binance-order-cancel")
  assert.equal(spec.cwd, "/repo/modules/binance/order-cancel")
  assert.deepEqual(spec.command, [
    "bun",
    "src/scripts/main.ts",
    "--symbol",
    "BTCUSDT",
    "--orig-client-order-id",
    "flow-command-schema-1-entry",
    "--yes",
  ])
})

function readSchema(): JSONRecord {
  return JSON.parse(readFileSync(new URL("../../schemas/execution-command-spec.schema.json", import.meta.url), "utf8")) as JSONRecord
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
