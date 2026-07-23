import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"
import assert from "node:assert/strict"
import test from "node:test"
import { runLiveSmall } from "./live-small-runner"
import { ensureSchema, readLatestOrderFill } from "../../../../portfolio-execution-state/event-store/src/lib/event-store"
import type { JSONRecord } from "../../../../contracts/runtime-core/src/json"
import type { Runner } from "../../../../contracts/runtime-core/src/tool-runner"
import { createStateRuntime, liveSmallInput, successTool } from "./live-small-test-fixture.test"

const TEST_DB_PATH = "test://trade.db"

test("live-small result schema locks only the stable outer execution shell", async () => {
  const schema = readSchema("live-small-result")
  assert.equal(schema.$id, "trade-flow.live-small-result.v1")
  assert.deepEqual(asArray(schema.required), ["mode", "preflight_result", "execution_gate", "recorded"])

  const db = new Database(":memory:")
  ensureSchema(db)
  const runner: Runner = async (_command, options) => {
    if (options?.cwd?.endsWith("/exchange-request-router")) {
      return successTool({ route: "exchange-write-pre-adapter-gate" })
    }
    if (options?.cwd?.endsWith("/write-pre-adapter-gate")) {
      return successTool({ status: "passed", issues: [] })
    }
    if (options?.cwd?.endsWith("/post-write-confirmation")) {
      return successTool({
        schema_version: "trade.protocol.exchange-command-ref.v1",
        command_ref: "exchange-command://fixture",
        status: "confirmed",
      })
    }
    return successTool({
      method: "futuresCreateAlgoOrder",
      request: {
        symbol: "BTCUSDT",
        side: "BUY",
        type: "STOP_MARKET",
        quantity: "0.001",
        clientAlgoId: "flow-live-fixture-1-entry",
      },
      result: { algoId: 9001, clientAlgoId: "flow-live-fixture-1-entry" },
      confirmedResult: { algoId: 9001, clientAlgoId: "flow-live-fixture-1-entry" },
    })
  }

  try {
    const skipped = await runLiveSmall(TEST_DB_PATH, {
      ...liveSmallInput(),
      target_action: "cancel_order",
      request: {
        symbol: "BTCUSDT",
        orig_client_order_id: "flow-live-fixture-1-entry",
      },
    }, true, runner, stateRuntime(db))
    assertSchemaRequired(schema, skipped)
    assert.equal(skipped.mode, "live-small")
    assert.equal(asRecord(skipped.execution_gate).status, "skipped")
    assert.equal(skipped.recorded, false)

    const recorded = await runLiveSmall(TEST_DB_PATH, liveSmallInput(), true, runner, stateRuntime(db))
    assertSchemaRequired(schema, recorded)
    assert.equal(recorded.mode, "live-small")
    assert.equal(asRecord(recorded.execution_gate).status, "ready")
    assert.equal(recorded.recorded, true)
  } finally {
    db.close()
  }
})

function stateRuntime(db: Database) {
  return createStateRuntime(db, (chainId) => testFlowState(db, chainId))
}

function testFlowState(db: Database, chainId: string): JSONRecord {
  return {
    current_orders: [],
    current_position: { state: "flat" },
    latest_order_fill: readLatestOrderFill(db, chainId),
    risk_lock: { locked: false },
  }
}

function readSchema(name: string): JSONRecord {
  return JSON.parse(readFileSync(new URL(`../../../../orchestration-ops/trade-flow/src/schemas/${name}.schema.json`, import.meta.url), "utf8")) as JSONRecord
}

function assertSchemaRequired(schema: JSONRecord, value: JSONRecord): void {
  for (const field of asArray(schema.required)) {
    assert.ok(String(field) in value, `missing required field ${String(field)}`)
  }
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
