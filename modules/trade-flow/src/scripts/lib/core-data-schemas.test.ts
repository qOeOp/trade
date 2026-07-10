import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import { buildObserveEvent, OBSERVE_SIDES } from "./observe-builder"
import { loadRuntime } from "./observe-flow"
import { ensureSchema, REVIEW_OUTCOMES, validateReview, type PlanEvent } from "./plan-events"
import { applyReconcileDrafts, FLOW_POSITION_STATES, reduceFlowState } from "./flow-state"
import { cronRecoverFromTools, CRON_RECOVER_STATUSES } from "./recovery-flow"
import { runOneFlowStep } from "./execution-flow"
import { RUN_MODES } from "./run-mode"
import type { JSONRecord } from "./json"
import { runStrategyCycle, SHADOW_EVIDENCE_SYNC_STATUSES } from "./strategy-iteration"

test("flow state result schema matches reducer output", () => {
  const schema = readSchema("flow-state-result")
  assert.equal(schema.$id, "trade-flow.flow-state-result.v1")
  assert.deepEqual(asArray(schema.required), ["chain_id", "event_count", "latest_observe", "latest_order_fill", "current_orders", "current_position", "risk_lock", "open_action_gap"])
  const positionProperties = asRecord(asRecord(asRecord(schema.properties).current_position).properties)
  assert.deepEqual(asArray(asRecord(positionProperties.state).enum), [...FLOW_POSITION_STATES])

  const db = new Database(":memory:")
  try {
    ensureSchema(db)
    const state = reduceFlowState(db, "flow-schema-state") as JSONRecord
    assertSchemaRequired(schema, state)
    assert.equal(state.chain_id, "flow-schema-state")
    assert.equal(state.event_count, 0)
    assert.equal(asRecord(state.current_position).state, "flat")
    assert.equal(Array.isArray(state.current_orders), true)
  } finally {
    db.close()
  }
})

test("init result schema matches runtime init response data", () => {
  const schema = readSchema("init-result")
  assert.equal(schema.$id, "trade-flow.init-result.v1")
  assert.deepEqual(asArray(schema.required), ["initialized", "dbPath"])
  assert.equal(asRecord(asRecord(schema.properties).initialized).const, true)

  const result: JSONRecord = {
    initialized: true,
    dbPath: "./data/trade.db",
  }
  assertSchemaRequired(schema, result)
  assert.equal(result.initialized, true)
})

test("apply reconcile result schema matches local apply result", () => {
  const schema = readSchema("apply-reconcile-result")
  assert.equal(schema.$id, "trade-flow.apply-reconcile-result.v1")
  assert.deepEqual(asArray(schema.required), ["applied_count", "applied_event_keys"])

  const db = new Database(":memory:")
  try {
    ensureSchema(db)
    const result = applyReconcileDrafts(db, {
      can_reconcile: true,
      drafts: [reconcileDraft("flow-apply-schema-1", "evt-apply-schema-1")],
    }, true) as JSONRecord
    assertSchemaRequired(schema, result)
    assert.equal(result.applied_count, 1)
    assert.deepEqual(result.applied_event_keys, ["evt-apply-schema-1"])
  } finally {
    db.close()
  }
})

test("cron recover result schema matches recovery statuses and noop output", async () => {
  const schema = readSchema("cron-recover-result")
  assert.equal(schema.$id, "trade-flow.cron-recover-result.v1")
  assert.deepEqual(asArray(schema.required), ["status", "before", "reconcile", "after"])
  assert.deepEqual(asArray(asRecord(asRecord(schema.properties).status).enum), [...CRON_RECOVER_STATUSES])

  const db = new Database(":memory:")
  try {
    ensureSchema(db)
    const result = await cronRecoverFromTools(db, "flow-cron-schema-1", {
      symbol: "BTCUSDT",
    }, false, async () => ({
      ok: true,
      stdout: "{}",
      stderr: "",
      data: {
        openOrders: { regular: [], protective: [] },
        orderHistory: { regular: [], protective: [] },
        positions: [],
      },
    })) as JSONRecord
    assertSchemaRequired(schema, result)
    assert.equal(result.status, "recovered_noop")
    assert.equal(asRecord(result.before).chain_id, "flow-cron-schema-1")
    assert.equal(asRecord(result.after).chain_id, "flow-cron-schema-1")
  } finally {
    db.close()
  }
})

test("runtime load result schema matches runtime loader output", () => {
  const schema = readSchema("runtime-load-result")
  assert.equal(schema.$id, "trade-flow.runtime-load-result.v1")
  assert.deepEqual(asArray(schema.required), ["trading_config", "runtime_policy", "account_config", "strategies", "loaded_at"])

  const dir = mkdtempSync(join(tmpdir(), "runtime-load-schema-"))
  try {
    const accountConfigPath = join(dir, "account-config.json")
    const strategiesDir = join(dir, "strategies")
    mkdirSync(strategiesDir, { recursive: true })
    writeFileSync(accountConfigPath, JSON.stringify({ max_open_risk_pct: 0.1 }))
  } catch {
    rmSync(dir, { recursive: true, force: true })
    throw new Error("failed to create runtime schema fixture")
  }
  try {
    const strategiesDir = join(dir, "strategies")
    writeFileSync(join(strategiesDir, "s-test.md"), "---\nstrategy_id: S-RUNTIME\nname: Runtime\nstatus: draft\ntags: [schema]\n---\n\n# Runtime\n")
    const result = loadRuntime(join(dir, "account-config.json"), strategiesDir) as JSONRecord
    assertSchemaRequired(schema, result)
    assert.equal(asRecord(result.runtime_policy).schema_version, "runtime-policy.v1")
    assert.equal(typeof asRecord(result.runtime_policy).source_hash, "string")
    assert.equal(typeof result.account_config, "object")
    assert.equal(Array.isArray(result.strategies), true)
    assert.equal(typeof result.loaded_at, "string")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("runtime load result does not require legacy account config when trading config exists", () => {
  const dir = mkdtempSync(join(tmpdir(), "runtime-load-no-legacy-"))
  try {
    const tradingConfigPath = join(dir, "trading-config.json")
    const accountConfigPath = join(dir, "account-config.json")
    const strategiesDir = join(dir, "strategies")
    mkdirSync(strategiesDir, { recursive: true })
    writeFileSync(tradingConfigPath, JSON.stringify({
      schema_version: 1,
      profile_id: "test-live",
      mode: "live",
      permissions: { live_small_enabled: true, max_stage: "live-small" },
      risk: {},
      exposure: {},
      execution: {},
      research: {},
    }))
    writeFileSync(join(strategiesDir, "s-test.md"), "---\nstrategy_id: S-RUNTIME\nstatus: draft\n---\n")

    const result = loadRuntime({ tradingConfigPath, accountConfigPath, strategiesDir }) as JSONRecord

    assert.deepEqual(result.account_config, {})
    assert.equal(asRecord(asRecord(result.runtime_policy).permissions).can_live_small, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("observe event schema matches observe builder output", () => {
  const schema = readSchema("observe-event")
  assert.equal(schema.$id, "trade-flow.observe-event.v1")
  assert.equal(asRecord(asRecord(schema.properties).kind).const, "observe")
  const bodyProperties = asRecord(asRecord(asRecord(schema.properties).body_json).properties)
  assert.deepEqual(asArray(asRecord(bodyProperties.side).enum), [...OBSERVE_SIDES])

  const event = buildObserveEvent(observeInput()) as unknown as JSONRecord
  assertSchemaRequired(schema, event)
  assert.equal(event.kind, "observe")
  assert.equal(asRecord(event.body_json).symbol, "BTCUSDT")
  assert.equal(asRecord(event.body_json).side, "long")
})

test("strategy review body schema matches review validator", () => {
  const schema = readSchema("strategy-review-body")
  assert.equal(schema.$id, "trade-flow.strategy-review-body.v1")
  assert.deepEqual(asArray(schema.required), ["strategy_ref", "outcome", "thesis_held", "key_lesson", "promote_to_strategy"])
  assert.deepEqual(asArray(asRecord(asRecord(schema.properties).outcome).enum), [...REVIEW_OUTCOMES])

  const review = {
    strategy_ref: "S-REVIEW-BODY",
    outcome: "win",
    pnl_r: 0.5,
    thesis_held: true,
    key_lesson: "setup behaved as expected",
    promote_to_strategy: false,
  }
  validateReview(review)
  assert.throws(
    () => validateReview({ ...review, thesis_held: undefined }),
    /review.thesis_held/,
  )
})

test("run step result schema matches dry-run execution step output", () => {
  const schema = readSchema("run-step-result")
  assert.equal(schema.$id, "trade-flow.run-step-result.v1")
  assert.deepEqual(asArray(schema.required), ["mode", "preflight_result", "execution_gate", "recorded"])
  assert.deepEqual(asArray(asRecord(asRecord(schema.properties).mode).enum), [...RUN_MODES])

  const db = new Database(":memory:")
  try {
    ensureSchema(db)
    const result = runOneFlowStep(db, dryRunInput(), "dry-run") as JSONRecord
    assertSchemaRequired(schema, result)
    assert.equal(result.mode, "dry-run")
    assert.equal(result.recorded, true)
    assert.equal(asRecord(result.execution_gate).status, "ready")
    assert.equal(asRecord(result.order_fill_event).kind, "order_fill")
  } finally {
    db.close()
  }
})

test("strategy cycle result schema matches review and optional promotion wrapper", () => {
  const schema = readSchema("strategy-cycle-result")
  assert.equal(schema.$id, "trade-flow.strategy-cycle-result.v1")
  assert.deepEqual(asArray(schema.required), ["shadow_evidence", "report"])
  const shadowProperties = asRecord(asRecord(asRecord(schema.properties).shadow_evidence).properties)
  assert.deepEqual(asArray(asRecord(shadowProperties.status).enum), [...SHADOW_EVIDENCE_SYNC_STATUSES])

  const dir = mkdtempSync(join(tmpdir(), "strategy-cycle-schema-"))
  try {
    const strategyPath = join(dir, "s-cycle.md")
    const ledgerPath = join(dir, "strategy-evidence.jsonl")
    writeFileSync(strategyPath, "---\nstrategy_id: S-CYCLE\nname: Cycle Strategy\nstatus: draft\ntags: [schema]\n---\n\n# Cycle Strategy\n")
    const result = runStrategyCycle({ strategyPath, ledgerPath }) as unknown as JSONRecord
    assertSchemaRequired(schema, result)
    assert.equal(asRecord(result.shadow_evidence).status, "skipped")
    assert.equal(asRecord(result.shadow_evidence).reason, "db_not_provided")
    assert.equal(asRecord(result.report).strategy_id, "S-CYCLE")
    assert.equal("promotion" in result, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function observeInput() {
  return {
    chain_id: "flow-observe-schema-1",
    symbol: "BTCUSDT",
    side: "long" as const,
    strategy_ref: "S-TREND",
    account_snapshot: {
      account: {
        totalMarginBalance: "1000",
        availableBalance: "900",
      },
      positions: [],
      openOrders: {
        regular: [],
        protective: [],
      },
    },
    market_snapshot: {
      symbol: "BTCUSDT",
      markPrice: "65000",
    },
    created_at: "2026-07-08T12:00:00Z",
  }
}

function reconcileDraft(chainId: string, eventKey: string): PlanEvent {
  return {
    event_key: eventKey,
    chain_id: chainId,
    kind: "order_fill",
    created_at: "2026-07-08T12:00:00Z",
    body_json: {
      sub_kind: "submit",
      lifecycle_status: "submitted",
      client_order_id: `${chainId}-1-entry`,
      symbol: "BTCUSDT",
      side: "BUY",
      qty: 0.01,
      source: "reconcile",
    },
  }
}

function dryRunInput(): JSONRecord {
  return {
    now: "2026-07-08T12:00:20Z",
    event_key: "evt-run-step-schema-1",
    created_at: "2026-07-08T12:00:21Z",
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
      created_at: "2026-07-08T12:00:00Z",
      symbol: "BTCUSDT",
      side: "long",
      setup_id: "trend-breakout",
      account: {
        equity_usdt: 1000,
      },
    },
    strategy: {
      status: "live-small",
    },
    account_config: {
      max_open_risk_pct: 0.1,
      max_day_loss_pct: 0.05,
    },
    request: {
      type: "STOP_MARKET",
    },
    aggregate_view: {
      active_plans_risk_sum: 0,
      current_account_open_risk_usdt: 0,
      realized_pnl_today_usdt: 0,
      active_plans_worst_loss_at_stop: 0,
    },
    execution_contract_input: {
      source_observe_event_key: "obs-run-step-schema-1",
      chain_id: "flow-run-step-schema-1",
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
        snapshot_at: "2026-07-08T12:00:00Z",
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
  return JSON.parse(readFileSync(new URL(`../../schemas/${name}.schema.json`, import.meta.url), "utf8")) as JSONRecord
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
