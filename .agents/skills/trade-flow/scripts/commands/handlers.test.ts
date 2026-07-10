import assert from "node:assert/strict"
import test from "node:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { handleEvidenceCommand } from "./evidence"
import { handleExecutionCommand } from "./execution"
import { handleObserveCommand } from "./observe"
import { handleRecoveryCommand } from "./recovery"
import { handleRuntimeCommand } from "./runtime"
import type { CommandConfig, JSONRecord } from "./types"
import { appendPlanEvent, ensureSchema, readFlowEvents } from "../lib/plan-events"
import { createRdProgramState, readRdProgramState, writeRdProgramState } from "../lib/rd-program-state"
import { loadEvidenceLedger } from "../lib/strategy-iteration"

test("observe command handler builds observe events without opening trade DB", async () => {
  const response = await handleObserveCommand(baseConfig({
    buildObserve: true,
    input: observeInput(),
  }))

  assert.equal(response?.ok, true)
  const event = response?.data as { kind: string; body_json: JSONRecord }
  assert.equal(event.kind, "observe")
  assert.equal(event.body_json.symbol, "BTCUSDT")
  assert.equal((event.body_json.account as { equity_usdt: number }).equity_usdt, 1000)
})

test("runtime command handler initializes schema and appends local order_fill", () => {
  const db = new Database(":memory:")
  try {
    ensureSchema(db)
    const init = handleRuntimeCommand(db, baseConfig({ init: true, dbPath: ":memory:" }))
    assert.equal(init?.ok, true)

    const append = handleRuntimeCommand(db, baseConfig({
      appendOrderFill: true,
      input: {
        event_key: "evt-runtime-append-1",
        chain_id: "flow-runtime-1",
        created_at: "2026-07-08T12:00:00Z",
        body_json: {
          sub_kind: "submit",
          source: "reconcile",
          client_order_id: "flow-runtime-1-1-entry",
          symbol: "BTCUSDT",
          side: "BUY",
          qty: 0.01,
        },
      },
    }))
    assert.equal(append?.ok, true)
    assert.equal(readFlowEvents(db, "flow-runtime-1").length, 1)
  } finally {
    db.close()
  }
})

test("runtime command handler appends validated strategy review", () => {
  const db = new Database(":memory:")
  try {
    ensureSchema(db)
    const response = handleRuntimeCommand(db, baseConfig({
      appendReview: true,
      input: {
        event_key: "review-handler-valid-1",
        chain_id: "flow-review-handler-1",
        created_at: "2026-07-08T12:30:00Z",
        body_json: {
          strategy_ref: "S-TREND",
          outcome: "win",
          pnl_r: 0.7,
          fee_r: 0.01,
          slippage_r: 0.02,
          funding_r: 0,
          thesis_held: true,
          key_lesson: "setup followed the expected path",
          promote_to_strategy: false,
        },
      },
    }))
    assert.equal(response?.ok, true)
    const event = readFlowEvents(db, "flow-review-handler-1")[0]
    assert.equal(event.kind, "review")
    assert.equal(event.body_json.strategy_ref, "S-TREND")

    assert.throws(
      () => handleRuntimeCommand(db, baseConfig({
        appendReview: true,
        input: {
          event_key: "review-handler-invalid-1",
          chain_id: "flow-review-handler-1",
          body_json: {
            strategy_ref: "S-TREND",
            outcome: "win",
            pnl_r: 0.4,
          },
        },
      })),
      /review.thesis_held/,
    )
  } finally {
    db.close()
  }
})

test("runtime command handler returns track dry-run summary with lane conflicts", () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-track-handler-"))
  const db = new Database(":memory:")
  try {
    ensureSchema(db)
    appendObserve(db, "obs-track-1", "flow-track-1", "2026-07-08T12:00:00Z")
    appendObserve(db, "obs-track-2", "flow-track-2", "2026-07-08T12:01:00Z")
    appendObserve(db, "obs-track-3", "flow-track-3", "2026-07-08T12:02:00Z")
    appendPlanEvent(db, {
      event_key: "review-track-3",
      chain_id: "flow-track-3",
      kind: "review",
      body_json: {},
      created_at: "2026-07-08T12:03:00Z",
    })

    const response = handleRuntimeCommand(db, baseConfig({ track: "slow", dbPath: join(dir, "trade.db") }))
    assert.equal(response?.ok, true)
    const data = response?.data as {
      track: string
      executable: boolean
      active_flow_count: number
      lane_conflicts: Array<{ lane_key: string; chain_ids: string[] }>
      planned_steps: string[]
    }
    assert.equal(data.track, "slow")
    assert.equal(data.executable, false)
    assert.equal(data.active_flow_count, 2)
    assert.ok(data.planned_steps.includes("plan_and_preflight"))
    assert.deepEqual(data.lane_conflicts, [{
      lane_key: "S-TREND|BTCUSDT|long",
      chain_ids: ["flow-track-1", "flow-track-2"],
    }])
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("execution command handler records execution and dry-run flow through execution domain", async () => {
  const db = new Database(":memory:")
  try {
    ensureSchema(db)
    const record = await handleExecutionCommand(db, baseConfig({
      recordExecution: true,
      input: {
        preflight_result: { verdict: "armable" },
        execution_contract_input: executionContractInput(),
        execution_result: {
          method: "futuresCreateAlgoOrder",
          request: {
            symbol: "BTCUSDT",
            side: "BUY",
            type: "STOP_MARKET",
          },
          result: {
            algoId: 123,
            clientAlgoId: "flow-handler-1-1-entry",
          },
        },
      },
    }))
    assert.equal(record?.ok, true)
    assert.equal(readFlowEvents(db, "flow-handler-1").length, 1)

    const dryRun = await handleExecutionCommand(db, baseConfig({
      run: true,
      mode: "dry-run",
      input: dryRunInput(),
    }))
    assert.equal(dryRun?.ok, true)
    assert.equal((dryRun?.data as { recorded: boolean }).recorded, true)
  } finally {
    db.close()
  }
})

test("recovery command handler reduces local state and returns reconcile drafts", async () => {
  const db = new Database(":memory:")
  try {
    ensureSchema(db)
    const recover = await handleRecoveryCommand(db, baseConfig({
      recoverFlow: true,
      chainId: "flow-recovery-1",
    }))
    assert.equal(recover?.ok, true)
    assert.equal((recover?.data as { event_count: number }).event_count, 0)

    const reconcile = await handleRecoveryCommand(db, baseConfig({
      reconcileFlow: true,
      chainId: "flow-recovery-1",
      input: {
        openOrders: {
          regular: [{
            symbol: "BTCUSDT",
            side: "BUY",
            type: "LIMIT",
            status: "NEW",
            origQty: "0.01",
            price: "65000",
            orderId: "1001",
            clientOrderId: "flow-recovery-1-1-entry",
            positionSide: "BOTH",
            source: "openOrders",
            sourceType: "standard",
          }],
          protective: [],
        },
        positions: [],
      },
    }))
    assert.equal(reconcile?.ok, true)
    const data = reconcile?.data as { can_reconcile: boolean; drafts: Array<{ body_json: JSONRecord }> }
    assert.equal(data.can_reconcile, true)
    assert.equal(data.drafts.length, 1)
    assert.equal(data.drafts[0].body_json.source, "reconcile")
  } finally {
    db.close()
  }
})

test("evidence command handler can append shadow evidence from DB reviews", () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-evidence-handler-"))
  const dbPath = join(dir, "trade.db")
  const strategyPath = join(dir, "s-test.md")
  const ledgerPath = join(dir, "strategy-evidence.jsonl")
  const db = new Database(dbPath)
  let dbClosed = false
  try {
    writeFileSync(strategyPath, "---\nstrategy_id: S-TEST\nname: Test\nstatus: shadow\ntags: [test]\n---\n\n# Test\n\nRule v1\n")
    ensureSchema(db)
    appendPlanEvent(db, {
      event_key: "review-handler-1",
      chain_id: "flow-handler-review-1",
      kind: "review",
      created_at: "2026-07-08T12:00:00Z",
      body_json: {
        strategy_ref: "S-TEST",
        outcome: "win",
        pnl_r: 0.8,
        fee_r: 0.01,
        slippage_r: 0.02,
        funding_r: 0,
        thesis_held: true,
        key_lesson: "shadow evidence fixture",
        promote_to_strategy: false,
      },
    })
    db.close()
    dbClosed = true

    const response = handleEvidenceCommand(baseConfig({
      appendStrategyEvidence: true,
      dbPath,
      strategyPath,
      ledgerPath,
      input: {
        kind: "shadow",
        from_reviews: true,
        now: "2026-07-08T12:01:00Z",
      },
    }))

    assert.equal(response?.ok, true)
    const record = loadEvidenceLedger(ledgerPath)[0] as { kind: string; execution_attribution: { total_cost_drag: number } }
    assert.equal(record.kind, "shadow")
    assert.equal(record.execution_attribution.total_cost_drag, 0.03)
  } finally {
    if (!dbClosed) db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("strategy review command can feed diagnostics back into R&D program state", () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-review-rd-state-"))
  const strategyPath = join(dir, "s-test.md")
  const catalogDbPath = join(dir, "data_catalog.db")
  const statePath = join(dir, "rd-state.json")
  try {
    writeFileSync(strategyPath, "---\nstrategy_id: S-TEST\nname: Test\nstatus: shadow\ntags: [test]\n---\n\n# Test\n\nRule v1\n")
    writeRdProgramState(statePath, createRdProgramState({
      programId: "review-feedback",
      objective: "learn from strategy review diagnostics",
      now: "2026-07-08T12:00:00Z",
    }), catalogDbPath)
    const evidence = handleEvidenceCommand(baseConfig({
      appendStrategyEvidence: true,
      strategyPath,
      catalogDbPath,
      input: {
        kind: "replay",
        source_ref: "tmp/replay.json",
        now: "2026-07-08T12:01:00Z",
        stats: { sample_count: 12, avg_r: 0.2, total_r: 2.4, profit_factor: 1.4 },
        anti_overfit: {
          method: "out_of_sample",
          stage: "locked_holdout",
          oos_stats: { sample_count: 12, avg_r: 0.2, total_r: 2.4, profit_factor: 1.4 },
          trial_count: 1,
          parameter_count: 2,
        },
      },
    }))
    assert.equal(evidence?.ok, true)

    const response = handleEvidenceCommand(baseConfig({
      strategyReview: true,
      strategyPath,
      catalogDbPath,
      input: {
        now: "2026-07-08T12:02:00Z",
        rd_program_state_path: statePath,
      },
    }))

    assert.equal(response?.ok, true)
    const report = response?.data as { rd_program_state?: { state: { latest_reliability_gate: JSONRecord } } }
    assert.equal(report.rd_program_state?.state.latest_reliability_gate.source, "strategy_review")
    const state = readRdProgramState(statePath)
    assert.equal(state.latest_reliability_gate?.source, "strategy_review")
    assert.equal(state.universe_lessons.some((lesson) => lesson.source === "strategy_review"), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function baseConfig(overrides: Partial<CommandConfig>): CommandConfig {
  return {
    dbPath: "./data/trade.db",
    init: false,
    appendOrderFill: false,
    appendReview: false,
    recordExecution: false,
    run: false,
    mode: "dry-run",
    loadRuntime: false,
    buildObserve: false,
    observeFromSkills: false,
    replayStrategy: false,
    strategyRndBatch: false,
    strategyRndLoop: false,
    strategyRndCampaign: false,
    strategyPanelRnd: false,
    strategyDataSplit: false,
    rdProgramState: false,
    rdSupervisorRun: false,
    automationCycle: false,
    strategyBenchmark: false,
    strategyCalibrationSuite: false,
    strategySignal: false,
    strategyCompile: false,
    strategyLint: false,
    artifactGc: false,
    catalogInit: false,
    catalogScan: false,
    catalogQuery: false,
    catalogStale: false,
    catalogGc: false,
    appendStrategyEvidence: false,
    strategyReview: false,
    strategyPromote: false,
    strategyCycle: false,
    promoteToExplicit: false,
    runShadowFromSkills: false,
    runLiveSmall: false,
    recoverFlow: false,
    reconcileFlow: false,
    reconcileFromSkills: false,
    applyReconcile: false,
    cronRecoverFromSkills: false,
    track: "",
    yes: false,
    chainId: "",
    tradingConfigPath: "",
    accountConfigPath: "./data/account_config.json",
    strategiesDir: "./strategies",
    manifestPath: "",
    strategyId: "S-BTC-4H-TREND-PULLBACK",
    timeframe: "",
    artifactRoot: "",
    catalogDbPath: "./data/data_catalog.db",
    catalogRoots: [],
    strategyPath: "",
    ledgerPath: "./data/strategy-evidence.jsonl",
    statePath: "",
    promoteTo: "shadow",
    input: {},
    ...overrides,
  }
}

function observeInput(): JSONRecord {
  return {
    chain_id: "flow-observe-handler-1",
    symbol: "BTCUSDT",
    side: "long",
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

function appendObserve(db: Database, eventKey: string, chainId: string, created_at: string): void {
  appendPlanEvent(db, {
    event_key: eventKey,
    chain_id: chainId,
    kind: "observe",
    body_json: {
      source: "slow_track",
      strategy_ref: "S-TREND",
      symbol: "BTCUSDT",
      side: "long",
      action_intent: {
        target_action: "no_action",
      },
    },
    created_at,
  })
}

function executionContractInput(): JSONRecord {
  return {
    source_observe_event_key: "obs-handler-1",
    chain_id: "flow-handler-1",
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
  }
}

function dryRunInput(): JSONRecord {
  return {
    now: "2026-07-08T12:00:20Z",
    event_key: "evt-handler-dry-run-1",
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
      ...executionContractInput(),
      source_observe_event_key: "obs-handler-dry-run-1",
      chain_id: "flow-handler-dry-run-1",
    },
  }
}
