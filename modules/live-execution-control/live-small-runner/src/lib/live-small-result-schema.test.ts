import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"
import assert from "node:assert/strict"
import test from "node:test"
import { runLiveSmall } from "./live-small-runner"
import { appendPlanEvent, ensureSchema, readFlowEvents, readLatestOrderFill } from "../../../../portfolio-execution-state/event-store/src/lib/event-store"
import type { JSONRecord } from "../../../../contracts/runtime-core/src/json"
import type { ExecutionStateRuntime } from "../../../execution-flow-runner/src/lib/execution-flow-runner"
import type { Runner } from "../../../../contracts/runtime-core/src/tool-runner"

const TEST_DB_PATH = "test://trade.db"

test("live-small result schema locks only the stable outer execution shell", async () => {
  const schema = readSchema("live-small-result")
  assert.equal(schema.$id, "trade-flow.live-small-result.v1")
  assert.deepEqual(asArray(schema.required), ["mode", "preflight_result", "execution_gate", "recorded"])

  const db = new Database(":memory:")
  ensureSchema(db)
  const runner: Runner = async () => ({
    ok: true,
    data: {
      ok: true,
      data: {
        method: "futuresCreateAlgoOrder",
        request: {
          symbol: "BTCUSDT",
          side: "BUY",
          type: "STOP_MARKET",
          quantity: "0.001",
          clientAlgoId: "flow-live-fixture-1-entry",
        },
        result: { algoId: 9001, clientAlgoId: "flow-live-fixture-1-entry" },
      },
    },
    stdout: "{}",
    stderr: "",
  })

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

function stateRuntime(db: Database): ExecutionStateRuntime {
  return {
    eventReader: (_dbPath, chainId) => readFlowEvents(db, chainId) as unknown as Record<string, unknown>[],
    eventAppender: (_dbPath, event) => {
      appendPlanEvent(db, event as unknown as Parameters<typeof appendPlanEvent>[1])
      return event
    },
    latestOrderFillReader: (_dbPath, chainId) => readLatestOrderFill(db, chainId),
    flowStateReader: (_dbPath, chainId) => testFlowState(db, chainId),
    latestSlowObserveReader: () => null,
  }
}

function testFlowState(db: Database, chainId: string): JSONRecord {
  return {
    current_orders: [],
    current_position: { state: "flat" },
    latest_order_fill: readLatestOrderFill(db, chainId),
    risk_lock: { locked: false },
  }
}

function liveSmallInput(): JSONRecord {
  return {
    repoRoot: "/repo",
    now: "2026-07-06T12:00:20+08:00",
    event_key: "evt-live-fixture-1",
    created_at: "2026-07-06T12:00:21Z",
    target_action: "place_entry",
    plan: {
      symbol: "BTCUSDT",
      side: "long",
      setup_id: "trend-breakout",
      direction_state: "偏多已确认",
      execution_verdict: "等条件",
      thesis: "4H trend is intact",
      entry_intent: "buy breakout",
      exit_intent: "exit below invalidation",
      invalidation: "4H close below range",
      stop_price: 64000,
      risk_budget_usdt: 10,
      expected_rr_net: 2,
      live_permission: "live-small",
    },
    observe: {
      created_at: "2026-07-06T12:00:00+08:00",
      symbol: "BTCUSDT",
      side: "long",
      setup_id: "trend-breakout",
      account: { equity_usdt: 1000 },
    },
    strategy: { status: "live-small" },
    account_config: {
      max_open_risk_pct: 0.1,
      max_day_loss_pct: 0.05,
    },
    request: { type: "STOP_MARKET" },
    aggregate_view: {
      active_plans_risk_sum: 0,
      current_account_open_risk_usdt: 0,
      realized_pnl_today_usdt: 0,
      active_plans_worst_loss_at_stop: 0,
    },
    execution_contract_input: {
      source_observe_event_key: "obs-live-fixture-1",
      chain_id: "flow-live-fixture",
      setup_id: "trend-breakout",
      market: "usdm",
      symbol: "BTCUSDT",
      side: "long",
      position_side: "BOTH",
      margin_mode: "isolated",
      target_leverage: 2,
      account_snapshot: {
        equity_usdt: 1000,
        available_balance_usdt: 900,
        snapshot_at: "2026-07-06T12:00:00+08:00",
      },
      risk: {
        risk_budget_usdt: 10,
        stop_price: 64000,
        invalidation: "below range",
        expected_rr_net: 2,
      },
      entries: [{
        type: "STOP_MARKET",
        stop_price: 66000,
        margin_usdt: 100,
      }],
      exchange_rules: {
        quantity_step_size: "0.001",
        min_qty: "0.001",
      },
    },
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
