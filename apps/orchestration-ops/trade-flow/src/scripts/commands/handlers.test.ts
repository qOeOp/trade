import assert from "node:assert/strict"
import test from "node:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { handleExecutionCommand } from "./execution"
import { handleObserveCommand } from "./observe"
import { handleRecoveryCommand } from "./recovery"
import { handleRuntimeCommand } from "./runtime"
import type { CommandConfig, JSONRecord } from "./types"
import { appendPlanEvent, ensureSchema as ensureEventStoreSchema, readFlowEvents } from "../../../../../portfolio-execution-state/event-store/src/lib/event-store"
import { buildDatabaseIdentity, ensureDatabaseIdentity } from "../../../../../contracts/runtime-core/src/database-identity"
import { dryRunInputFixture, executionContractInputFixture } from "../lib/dry-run-test-fixture"

function ensureSchema(db: Database): void {
  ensureDatabaseIdentity(db, buildDatabaseIdentity("local:local", "trade_event_store"))
  ensureEventStoreSchema(db)
}

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

test("runtime command handler initializes schema and appends local order_fill", async () => {
  const dir = makeCheckDir("trade-flow-runtime-handler-")
  const dbPath = join(dir, "trade.db")
  const db = new Database(dbPath)
  try {
    ensureSchema(db)
    const init = await handleRuntimeCommand(db, baseConfig({ init: true, dbPath }))
    assert.equal(init?.ok, true)

    const append = await handleRuntimeCommand(db, baseConfig({
      dbPath,
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
    rmSync(dir, { recursive: true, force: true })
  }
})

test("runtime command handler appends validated strategy review", async () => {
  const dir = makeCheckDir("trade-flow-review-handler-")
  const dbPath = join(dir, "trade.db")
  const db = new Database(dbPath)
  try {
    ensureSchema(db)
    const response = await handleRuntimeCommand(db, baseConfig({
      dbPath,
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

    await assert.rejects(
      () => handleRuntimeCommand(db, baseConfig({
        dbPath,
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
    rmSync(dir, { recursive: true, force: true })
  }
})

test("runtime command handler returns track dry-run summary with lane conflicts", async () => {
  const dir = makeCheckDir("trade-flow-track-handler-")
  const dbPath = join(dir, "trade.db")
  const db = new Database(dbPath)
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
    db.close()

    const response = await handleRuntimeCommand(db, baseConfig({ track: "slow", dbPath }))
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
    rmSync(dir, { recursive: true, force: true })
  }
})

test("execution command handler records execution and dry-run flow through execution domain", async () => {
  const checkRoot = join(process.cwd(), "../../..", "tmp/check")
  mkdirSync(checkRoot, { recursive: true })
  const dir = mkdtempSync(join(checkRoot, "trade-flow-execution-handler-"))
  const recordDbPath = join(dir, "record.db")
  const db = new Database(":memory:")
  try {
    ensureSchema(db)
    const recordDb = new Database(recordDbPath)
    ensureSchema(recordDb)
    recordDb.close()
    const record = await handleExecutionCommand(db, baseConfig({
      dbPath: recordDbPath,
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
    const writtenDb = new Database(recordDbPath)
    try {
      assert.equal(readFlowEvents(writtenDb, "flow-handler-1").length, 1)
    } finally {
      writtenDb.close()
    }

    const dbPath = join(dir, "trade.db")
    const fileDb = new Database(dbPath)
    ensureSchema(fileDb)
    fileDb.close()
    const dryRun = await handleExecutionCommand(db, baseConfig({
      dbPath,
      run: true,
      mode: "dry-run",
      input: dryRunInput(),
    }))
    assert.equal(dryRun?.ok, true)
    assert.equal((dryRun?.data as { recorded: boolean }).recorded, true)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("recovery command handler reduces local state and returns reconcile drafts", async () => {
  const checkRoot = join(process.cwd(), "../../..", "tmp/check")
  mkdirSync(checkRoot, { recursive: true })
  const dir = mkdtempSync(join(checkRoot, "trade-flow-recovery-handler-"))
  const db = new Database(":memory:")
  try {
    ensureSchema(db)
    const dbPath = join(dir, "trade.db")
    const fileDb = new Database(dbPath)
    ensureSchema(fileDb)
    fileDb.close()
    const recover = await handleRecoveryCommand(db, baseConfig({
      dbPath,
      recoverFlow: true,
      chainId: "flow-recovery-1",
    }))
    assert.equal(recover?.ok, true)
    assert.equal((recover?.data as { event_count: number }).event_count, 0)

    const reconcile = await handleRecoveryCommand(db, baseConfig({
      dbPath,
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
    observeFromTools: false,
    automationCycle: false,
    runJobGraph: false,
    runProgramShadow: false,
    runProgramShadowSupervisor: false,
    runShadowFromTools: false,
    runLiveSmall: false,
    recoverFlow: false,
    reconcileFlow: false,
    reconcileFromTools: false,
    applyReconcile: false,
    cronRecoverFromTools: false,
    track: "",
    yes: false,
    chainId: "",
    tradingConfigPath: "",
    accountConfigPath: "./data/account_config.json",
    strategiesDir: "./strategies",
    input: {},
    ...overrides,
  }
}

function makeCheckDir(prefix: string): string {
  const checkRoot = join(process.cwd(), "../../..", "tmp/check")
  mkdirSync(checkRoot, { recursive: true })
  return mkdtempSync(join(checkRoot, prefix))
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
  return executionContractInputFixture("obs-handler-1", "flow-handler-1")
}

function dryRunInput(): JSONRecord {
  return dryRunInputFixture({
    eventKey: "evt-handler-dry-run-1",
    sourceObserveEventKey: "obs-handler-dry-run-1",
    chainId: "flow-handler-dry-run-1",
  })
}
