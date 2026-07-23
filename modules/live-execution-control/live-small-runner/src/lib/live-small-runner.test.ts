import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import { runLiveSmall } from "./live-small-runner"
import { appendPlanEvent, ensureSchema, readFlowEvents, readLatestOrderFill } from "../../../../portfolio-execution-state/event-store/src/lib/event-store"
import { buildPortfolioAccountProjection } from "../../../../portfolio-execution-state/flow-projector/src/lib/flow-projector"
import type { ExecutionStateRuntime } from "../../../execution-flow-runner/src/lib/execution-flow-runner"
import type { Runner } from "../../../../contracts/runtime-core/src/tool-runner"

const TEST_DB_PATH = "test://trade.db"

test("live-small uses injected runner with stable order-place command contract", async () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  const calls: Array<{ command: string[]; cwd?: string }> = []
  const runner: Runner = async (command, options) => {
    calls.push({ command, cwd: options?.cwd })
    const gateway = gatewayResult(options?.cwd)
    if (gateway) return gateway
    return {
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
          confirmedResult: { algoId: 9001, clientAlgoId: "flow-live-fixture-1-entry" },
        },
      },
      stdout: "{}",
      stderr: "",
    }
  }

  try {
    const result = await runLiveSmall(TEST_DB_PATH, liveSmallInput(), true, runner, stateRuntime(db))
    assert.equal(result.recorded, true)
    assert.equal(calls.length, 4)
    assert.deepEqual(calls.map((call) => call.cwd), [
      "/repo/modules/exchange-gateway/exchange-request-router",
      "/repo/modules/exchange-gateway/write-pre-adapter-gate",
      "/repo/modules/exchange-gateway/binance-write/order-place",
      "/repo/modules/exchange-gateway/post-write-confirmation",
    ])
    const adapterCall = calls[2]
    assert.deepEqual(adapterCall.command.slice(0, 8), [
      "bun",
      "src/scripts/main.ts",
      "--symbol",
      "BTCUSDT",
      "--side",
      "BUY",
      "--type",
      "STOP_MARKET",
    ])
    assert.ok(adapterCall.command.includes("--new-client-order-id"))
    assert.ok(adapterCall.command.includes("flow-live-fixture-1-entry"))
    assert.ok(adapterCall.command.includes("--yes"))
    assertFlagValue(adapterCall.command, "--exchange-runtime-db", "/repo/data/exchange_runtime.db")
    assertFlagValue(adapterCall.command, "--requested-by-ref", "evt-live-fixture-1")
  } finally {
    db.close()
  }
})

test("live-small runner failure does not record order_fill", async () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  const runner: Runner = async (_command, options) => gatewayResult(options?.cwd) ?? ({
      ok: false,
      error: "order-place unavailable",
      stdout: "",
      stderr: "boom",
      exitCode: 1,
    })

  try {
    await assert.rejects(
      () => runLiveSmall(TEST_DB_PATH, liveSmallInput(), true, runner, stateRuntime(db)),
      /live-small execution failed/,
    )
    const row = db.query("SELECT COUNT(*) AS count FROM plan_event WHERE kind='order_fill'").get() as { count: number }
    assert.equal(row.count, 0)
  } finally {
    db.close()
  }
})

test("live-small skips non-place actions before order-place routing", async () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  let called = false
  const runner: Runner = async () => {
    called = true
    return {
      ok: false,
      error: "runner should not be called",
      stdout: "",
      stderr: "",
      exitCode: 1,
    }
  }

  try {
    const result = await runLiveSmall(TEST_DB_PATH, {
      ...liveSmallInput(),
      target_action: "cancel_order",
      request: {
        symbol: "BTCUSDT",
        orig_client_order_id: "flow-live-fixture-1-entry",
      },
    }, true, runner, stateRuntime(db)) as {
      recorded: boolean
      execution_gate: { status: string; reason: string; evidence: { target_action: string } }
    }

    assert.equal(result.recorded, false)
    assert.equal(result.execution_gate.reason, "unsupported_live_small_target_action")
    assert.equal(result.execution_gate.evidence.target_action, "cancel_order")
    assert.equal(called, false)
    const row = db.query(`
      SELECT json_extract(body_json, '$.execution_gate.reason') AS reason,
        json_extract(body_json, '$.action_intent.target_action') AS target_action
      FROM plan_event
      WHERE kind = 'observe'
    `).get() as { reason: string; target_action: string }
    assert.equal(row.reason, "unsupported_live_small_target_action")
    assert.equal(row.target_action, "cancel_order")
  } finally {
    db.close()
  }
})

test("live-small treats missing target_action as no_action", async () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  let called = false
  const runner: Runner = async () => {
    called = true
    return {
      ok: false,
      error: "runner should not be called",
      stdout: "",
      stderr: "",
      exitCode: 1,
    }
  }

  try {
    const input = liveSmallInput()
    delete (input as { target_action?: string }).target_action
    const result = await runLiveSmall(TEST_DB_PATH, input, true, runner, stateRuntime(db)) as {
      recorded: boolean
      execution_gate: { status: string; reason: string }
    }

    assert.equal(result.recorded, false)
    assert.equal(result.execution_gate.reason, "preflight_not_armable")
    assert.equal(called, false)
  } finally {
    db.close()
  }
})

test("live-small refuses to add risk while flow is locked by unknown lifecycle", async () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  appendPlanEvent(db, {
    event_key: "unknown-live-lock-1",
    chain_id: "flow-live-fixture",
    kind: "order_fill",
    created_at: "2026-07-06T12:00:00Z",
    body_json: {
      sub_kind: "unknown",
      lifecycle_status: "unknown",
      client_order_id: "flow-live-fixture-unknown",
      source: "reconcile",
    },
  })
  let called = false
  const runner: Runner = async () => {
    called = true
    return {
      ok: false,
      error: "runner should not be called",
      stdout: "",
      stderr: "",
      exitCode: 1,
    }
  }

  try {
    const result = await runLiveSmall(TEST_DB_PATH, liveSmallInput(), true, runner, stateRuntime(db)) as {
      recorded: boolean
      execution_gate: { status: string; reason: string; evidence: { locked: boolean } }
    }
    assert.equal(result.recorded, false)
    assert.equal(result.execution_gate.reason, "preflight_not_armable")
    assert.equal(called, false)
    const row = db.query(`
      SELECT kind,
        json_extract(body_json, '$.execution_gate.reason') AS reason,
        json_extract(body_json, '$.action_intent.target_action') AS target_action
      FROM plan_event
      WHERE kind = 'observe'
    `).get() as { kind: string; reason: string; target_action: string }
    assert.equal(row.kind, "observe")
    assert.equal(row.reason, "preflight_not_armable")
    assert.equal(row.target_action, "place_entry")
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
    portfolioProjectionReader: (_dbPath, input) => buildPortfolioAccountProjection(db, input),
  }
}

function testFlowState(db: Database, chainId: string): Record<string, unknown> {
  const events = readFlowEvents(db, chainId)
  const riskEvent = events.find((event) => {
    const body = event.body_json
    return event.kind === "order_fill" && (body.lifecycle_status === "unknown" || body.sub_kind === "unknown")
  })
  return {
    current_orders: [],
    current_position: { state: "flat" },
    risk_lock: riskEvent
      ? {
        locked: true,
        reason: "unknown_order_state",
        event_key: riskEvent.event_key,
        client_order_id: riskEvent.body_json.client_order_id,
      }
      : { locked: false },
  }
}

function liveSmallInput() {
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
      account: {
        account_ref: "exchange-account://binance/live/usdm/primary",
      account_scope: "capital-scope://retail-small-usdm",
      equity_usdt: 1000,
      snapshot_ref: "exchange-account-facts://binance/live/usdm/primary/snapshot",
      content_hash: `sha256:${"c".repeat(64)}`,
      as_of: "2026-07-06T12:00:00+08:00",
      freshness: { max_age_seconds: 30 },
      },
    },
    strategy: { status: "live-small" },
    account_config: {
      max_open_risk_pct: 0.1,
      max_day_loss_pct: 0.05,
    },
    runtime_policy: {
      schema_version: "runtime-policy.v1",
      profile_id: "retail-small-usdm",
      account_ref: "exchange-account://binance/live/usdm/primary",
      account_scope: "capital-scope://retail-small-usdm",
      source_hash: `sha256:${"a".repeat(64)}`,
      effective_limits: {},
      permissions: { can_live_small: true },
    },
    runtime_authorization: {
      schema_version: "trade.policy.runtime-authorization.v1",
      authorization_ref: "policy-authorization://retail-small-usdm/scope/hash",
      content_hash: `sha256:${"b".repeat(64)}`,
      policy_hash: `sha256:${"a".repeat(64)}`,
      account_ref: "exchange-account://binance/live/usdm/primary",
      account_scope: "capital-scope://retail-small-usdm",
      issued_at: "2026-07-06T11:59:00+08:00",
      expires_at: "2026-07-06T12:05:00+08:00",
    },
    request: { type: "STOP_MARKET" },
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

function assertFlagValue(command: string[], flag: string, value: string): void {
  const index = command.indexOf(flag)
  assert.notEqual(index, -1)
  assert.equal(command[index + 1], value)
}

function gatewayResult(cwd?: string): Awaited<ReturnType<Runner>> | null {
  if (cwd?.endsWith("/exchange-request-router")) {
    return successTool({ route: "exchange-write-pre-adapter-gate" })
  }
  if (cwd?.endsWith("/write-pre-adapter-gate")) {
    return successTool({ status: "passed", issues: [] })
  }
  if (cwd?.endsWith("/post-write-confirmation")) {
    return successTool({
      schema_version: "trade.protocol.exchange-command-ref.v1",
      command_ref: "exchange-command://fixture",
      status: "confirmed",
    })
  }
  return null
}

function successTool(data: Record<string, unknown>): Awaited<ReturnType<Runner>> {
  return {
    ok: true,
    data: { ok: true, data },
    stdout: "{}",
    stderr: "",
  }
}
