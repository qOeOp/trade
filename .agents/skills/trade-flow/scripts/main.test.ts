import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import { Database } from "bun:sqlite"

import { appendPlanEvent, buildRecordedExecutionEvent, cronRecoverFromSkills, ensureSchema, reconcileFromSkills, reduceFlowState, run, runLiveSmall, runShadowFromSkills, validateOrderFill } from "./main"
import { type Runner } from "./lib/observe-adapter"
import { hashCanonical, replayContentHash, replayDataHash, replayHarnessHash } from "./lib/replay-core"
import { loadEvidenceLedger } from "./lib/strategy-iteration"

test("validateOrderFill requires audit fields for trade_flow source", () => {
  assert.throws(
    () => validateOrderFill({ source: "trade_flow" }),
    /source_observe_event_key/,
  )
})

test("run initializes schema and appends audited order_fill", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-"))
  const dbPath = join(dir, "trade.db")
  try {
    const init = await run(["--db", dbPath, "--init"])
    assert.equal(init.ok, true)
    assert.equal(init.schema_version, "trade-flow.script-response.v1")
    const result = await run([
      "--db",
      dbPath,
      "--append-order-fill",
      "--json",
      JSON.stringify({
        event_key: "evt-1",
        chain_id: "flow-1",
        created_at: "2026-07-06T12:00:00Z",
        body_json: {
          sub_kind: "submit",
          source: "trade_flow",
          source_observe_event_key: "obs-1",
          execution_contract_snapshot: {
            chain_id: "flow-1",
          },
        },
      }),
    ])
    assert.equal(result.ok, true)
    assert.equal(result.schema_version, "trade-flow.script-response.v1")

    const db = new Database(dbPath)
    try {
      const row = db.query("SELECT event_key, kind FROM plan_event").get() as { event_key: string; kind: string }
      assert.deepEqual(row, { event_key: "evt-1", kind: "order_fill" })
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("run initializes R&D program state through the CLI path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-rd-state-cli-"))
  try {
    const statePath = join(dir, "state.json")
    const catalogDb = join(dir, "catalog.db")
    const result = await run([
      "--rd-program-state",
      "--state",
      statePath,
      "--catalog-db",
      catalogDb,
      "--json",
      JSON.stringify({
        action: "init",
        program_id: "rd-cli",
        objective: "initialize durable R&D learning memory",
        now: "2026-07-09T12:00:00Z",
      }),
    ])
    assert.equal(result.ok, true)
    const data = result.ok ? result.data as { action: string; state: { program_id: string } } : null
    assert.equal(data?.action, "init")
    assert.equal(data?.state.program_id, "rd-cli")
    assert.equal(existsSync(statePath), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("run executes R&D supervisor runner through the CLI path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-rd-supervisor-cli-"))
  try {
    const statePath = join(dir, "state.json")
    const catalogDb = join(dir, "catalog.db")
    await run([
      "--rd-program-state",
      "--state",
      statePath,
      "--catalog-db",
      catalogDb,
      "--json",
      JSON.stringify({
        action: "init",
        program_id: "rd-cli-supervisor",
        objective: "block cleanly when no queue is available",
        now: "2026-07-09T12:00:00Z",
      }),
    ])

    const result = await run([
      "--rd-supervisor-run",
      "--state",
      statePath,
      "--catalog-db",
      catalogDb,
      "--json",
      JSON.stringify({ now: "2026-07-09T13:00:00Z", max_iterations: 3 }),
    ])

    assert.equal(result.ok, true)
    const data = result.ok ? result.data as { status: string; iterations: unknown[]; final_state: { status: string } } : null
    assert.equal(data?.status, "data_or_tool_blocked")
    assert.equal(data?.iterations.length, 1)
    assert.equal(data?.final_state.status, "data_or_tool_blocked")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("buildRecordedExecutionEvent compiles contract and writes audit snapshot", () => {
  const event = buildRecordedExecutionEvent({
    preflight_result: {
      verdict: "armable",
    },
    execution_contract_input: executionContractInput(),
    execution_result: {
      method: "futuresCreateAlgoOrder",
      request: {
        symbol: "BTCUSDT",
        side: "BUY",
        type: "STOP_MARKET",
      },
      result: {
        algoId: 12345,
        clientAlgoId: "flow-1-1-entry",
      },
    },
  })

  assert.equal(event.chain_id, "flow-1")
  assert.equal(event.kind, "order_fill")
  assert.equal(event.body_json.source, "trade_flow")
  assert.equal(event.body_json.source_observe_event_key, "obs-1")
  assert.equal(event.body_json.client_order_id, "flow-1-1-entry")
  assert.equal(event.body_json.exchange_order_id, "12345")
  assert.equal((event.body_json.execution_contract_snapshot as { chain_id: string }).chain_id, "flow-1")
})

test("buildRecordedExecutionEvent refuses blocked preflight", () => {
  assert.throws(
    () => buildRecordedExecutionEvent({
      preflight_result: {
        verdict: "blocked",
      },
      execution_contract_input: executionContractInput(),
      execution_result: {},
    }),
    /preflight_result\.verdict=armable/,
  )
})

test("run records execution into plan_event", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-record-"))
  const dbPath = join(dir, "trade.db")
  try {
    const result = await run([
      "--db",
      dbPath,
      "--record-execution",
      "--json",
      JSON.stringify({
        event_key: "evt-record-1",
        created_at: "2026-07-06T12:00:00Z",
        preflight_result: {
          verdict: "armable",
        },
        execution_contract_input: executionContractInput(),
        execution_result: {
          method: "futuresOrder",
          request: {
            symbol: "BTCUSDT",
            side: "BUY",
            type: "LIMIT",
          },
          result: {
            orderId: 88,
            clientOrderId: "flow-1-1-entry",
          },
        },
      }),
    ])
    assert.equal(result.ok, true)

    const db = new Database(dbPath)
    try {
      const row = db.query("SELECT chain_id, kind, json_extract(body_json, '$.client_order_id') AS client_order_id FROM plan_event").get() as {
        chain_id: string
        kind: string
        client_order_id: string
      }
      assert.deepEqual(row, {
        chain_id: "flow-1",
        kind: "order_fill",
        client_order_id: "flow-1-1-entry",
      })
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("run dry-run completes preflight contract mock execution and reducer readback", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-e2e-"))
  const dbPath = join(dir, "trade.db")
  try {
    const result = await run([
      "--db",
      dbPath,
      "--run",
      "--mode",
      "dry-run",
      "--json",
      JSON.stringify(dryRunInput()),
    ])
    assert.equal(result.ok, true)
    const data = (result as { ok: true; data: { recorded: boolean; latest_order_fill: { body_json: Record<string, unknown> } } }).data
    assert.equal(data.recorded, true)
    assert.equal(data.latest_order_fill.body_json.source, "trade_flow")
    assert.equal(data.latest_order_fill.body_json.client_order_id, "flow-1-1-entry")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("dry-run example payload executes successfully", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-example-"))
  const dbPath = join(dir, "trade.db")
  try {
    const example = readFileSync(new URL("../examples/dry-run-input.example.json", import.meta.url), "utf8")
    const result = await run([
      "--db",
      dbPath,
      "--run",
      "--mode",
      "dry-run",
      "--json",
      example,
    ])
    assert.equal(result.ok, true)
    const data = (result as { ok: true; data: { recorded: boolean } }).data
    assert.equal(data.recorded, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("run dry-run records blocked preflight as observe without order_fill", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-blocked-"))
  const dbPath = join(dir, "trade.db")
  try {
    const result = await run([
      "--db",
      dbPath,
      "--run",
      "--mode",
      "dry-run",
      "--json",
      JSON.stringify({
        ...dryRunInput(),
        now: "2026-07-06T12:02:00+08:00",
      }),
    ])
    assert.equal(result.ok, true)
    const data = (result as { ok: true; data: { recorded: boolean } }).data
    assert.equal(data.recorded, false)

    const db = new Database(dbPath)
    try {
      const row = db.query(`
        SELECT kind,
          json_extract(body_json, '$.source') AS source,
          json_extract(body_json, '$.preflight_result.verdict') AS verdict,
          json_extract(body_json, '$.decision_summary') AS decision_summary
        FROM plan_event
      `).get() as { kind: string; source: string; verdict: string; decision_summary: string }
      assert.equal(row.kind, "observe")
      assert.equal(row.source, "slow_track")
      assert.equal(row.verdict, "blocked")
      assert.match(row.decision_summary, /^slow_blocked:/)
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("run dry-run skips when trigger condition is not hit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-trigger-skip-"))
  const dbPath = join(dir, "trade.db")
  try {
    const result = await run([
      "--db",
      dbPath,
      "--run",
      "--mode",
      "dry-run",
      "--json",
      JSON.stringify({
        ...dryRunInput(),
        current_mark: 66500,
        trigger_condition: {
          price_in_range: [65900, 66100],
          valid_until_at: "2026-07-06T12:05:00+08:00",
        },
      }),
    ])
    assert.equal(result.ok, true)
    const data = (result as {
      ok: true
      data: { recorded: boolean; execution_gate: { status: string; reason: string } }
    }).data
    assert.equal(data.recorded, false)
    assert.equal(data.execution_gate.status, "skipped")
    assert.equal(data.execution_gate.reason, "current_mark_outside_trigger_range")

    const db = new Database(dbPath)
    try {
      const row = db.query(`
        SELECT kind,
          json_extract(body_json, '$.source') AS source,
          json_extract(body_json, '$.execution_gate.reason') AS reason,
          json_extract(body_json, '$.decision_summary') AS decision_summary
        FROM plan_event
      `).get() as { kind: string; source: string; reason: string; decision_summary: string }
      assert.equal(row.kind, "observe")
      assert.equal(row.source, "slow_track")
      assert.equal(row.reason, "current_mark_outside_trigger_range")
      assert.equal(row.decision_summary, "slow_skipped: current_mark_outside_trigger_range")
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("run dry-run skips when source observe was already recorded", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-idempotent-"))
  const dbPath = join(dir, "trade.db")
  const db = new Database(dbPath)
  let closed = false
  try {
    ensureSchema(db)
    appendPlanEvent(db, {
      event_key: "evt-existing-source-1",
      chain_id: "flow-1",
      kind: "order_fill",
      created_at: "2026-07-06T12:00:10Z",
      body_json: {
        sub_kind: "submit",
        source: "trade_flow",
        source_observe_event_key: "obs-1",
        execution_contract_snapshot: executionContractInput(),
        client_order_id: "flow-1-1-entry",
        symbol: "BTCUSDT",
        side: "BUY",
        qty: 0.01,
      },
    })
    db.close()
    closed = true

    const result = await run([
      "--db",
      dbPath,
      "--run",
      "--mode",
      "dry-run",
      "--json",
      JSON.stringify({
        ...dryRunInput(),
        event_key: "evt-idempotent-new-1",
      }),
    ])
    assert.equal(result.ok, true)
    const data = (result as {
      ok: true
      data: { recorded: boolean; execution_gate: { status: string; reason: string } }
    }).data
    assert.equal(data.recorded, false)
    assert.equal(data.execution_gate.reason, "source_observe_already_recorded")
    const auditDb = new Database(dbPath)
    try {
      const row = auditDb.query(`
        SELECT json_extract(body_json, '$.action_intent.target_action') AS target_action,
          json_extract(body_json, '$.action_intent.cleared_reason') AS cleared_reason
        FROM plan_event
        WHERE kind = 'observe'
      `).get() as { target_action: string; cleared_reason: string }
      assert.equal(row.target_action, "no_action")
      assert.equal(row.cleared_reason, "source_observe_already_recorded")
    } finally {
      auditDb.close()
    }
  } finally {
    if (!closed) {
      db.close()
    }
    rmSync(dir, { recursive: true, force: true })
  }
})

test("run dry-run fast track skip inherits latest slow observe strategy fields", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-fast-inherit-"))
  const dbPath = join(dir, "trade.db")
  const db = new Database(dbPath)
  let closed = false
  try {
    ensureSchema(db)
    appendPlanEvent(db, {
      event_key: "obs-fast-inherit-slow-1",
      chain_id: "flow-1",
      kind: "observe",
      created_at: "2026-07-06T11:59:00Z",
      body_json: {
        source: "slow_track",
        symbol: "BTCUSDT",
        side: "long",
        strategy_ref: "S-SLOW",
        setup_id: "trend-breakout",
        thesis: "slow thesis owns strategy context",
        entry_intent: "slow entry intent",
        exit_intent: "slow exit intent",
        invalidation: "slow invalidation",
        stop_price: 64000,
        risk_budget_usdt: 10,
        action_intent: {
          target_action: "place_entry",
          trigger_condition: {
            price_in_range: [65900, 66100],
            valid_until_at: "2026-07-06T12:05:00+08:00",
          },
          request: { type: "STOP_MARKET" },
        },
      },
    })
    db.close()
    closed = true

    const result = await run([
      "--db",
      dbPath,
      "--run",
      "--mode",
      "dry-run",
      "--json",
      JSON.stringify({
        ...dryRunInput(),
        source: "fast_track",
        created_at: "2026-07-06T12:00:22Z",
        current_mark: 66500,
        observe: {
          ...dryRunInput().observe,
          source: "fast_track",
          thesis: "fast should not rewrite thesis",
          account: { equity_usdt: 1000 },
        },
        trigger_condition: {
          price_in_range: [65900, 66100],
          valid_until_at: "2026-07-06T12:05:00+08:00",
        },
      }),
    ])
    assert.equal(result.ok, true)

    const auditDb = new Database(dbPath)
    try {
      const row = auditDb.query(`
        SELECT json_extract(body_json, '$.source') AS source,
          json_extract(body_json, '$.strategy_ref') AS strategy_ref,
          json_extract(body_json, '$.thesis') AS thesis,
          json_extract(body_json, '$.stop_price') AS stop_price,
          json_extract(body_json, '$.latest_slow_observe_event_key') AS latest_slow
        FROM plan_event
        WHERE kind = 'observe' AND json_extract(body_json, '$.source') = 'fast_track'
      `).get() as { source: string; strategy_ref: string; thesis: string; stop_price: number; latest_slow: string }
      assert.equal(row.source, "fast_track")
      assert.equal(row.strategy_ref, "S-SLOW")
      assert.equal(row.thesis, "slow thesis owns strategy context")
      assert.equal(row.stop_price, 64000)
      assert.equal(row.latest_slow, "obs-fast-inherit-slow-1")
    } finally {
      auditDb.close()
    }
  } finally {
    if (!closed) {
      db.close()
    }
    rmSync(dir, { recursive: true, force: true })
  }
})

test("run shadow records shadow execution without live exchange result", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-shadow-"))
  const dbPath = join(dir, "trade.db")
  try {
    const result = await run([
      "--db",
      dbPath,
      "--run",
      "--mode",
      "shadow",
      "--json",
      JSON.stringify({
        ...dryRunInput(),
        event_key: "evt-shadow-1",
      }),
    ])
    assert.equal(result.ok, true)
    const data = (result as {
      ok: true
      data: {
        recorded: boolean
        execution_result: { mode: string; method: string }
        latest_order_fill: { body_json: { execution_result: { mode: string } } }
      }
    }).data
    assert.equal(data.recorded, true)
    assert.equal(data.execution_result.mode, "shadow")
    assert.match(data.execution_result.method, /^shadow/)
    assert.equal(data.latest_order_fill.body_json.execution_result.mode, "shadow")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("run loads runtime account config and strategy files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-runtime-"))
  const configPath = join(dir, "account_config.json")
  const strategiesDir = join(dir, "strategies")
  try {
    mkdirSync(strategiesDir)
    writeFileSync(configPath, JSON.stringify({ max_open_risk_pct: 0.1 }))
    writeFileSync(join(strategiesDir, "s-one.md"), "---\nstrategy_id: S-ONE\nstatus: live-small\n---\nbody")

    const result = await run([
      "--db",
      join(dir, "trade.db"),
      "--load-runtime",
      "--account-config",
      configPath,
      "--strategies-dir",
      strategiesDir,
    ])

    assert.equal(result.ok, true)
    const data = (result as { ok: true; data: { account_config: Record<string, unknown>; strategies: Array<{ strategy_id: string }> } }).data
    assert.equal(data.account_config.max_open_risk_pct, 0.1)
    assert.equal(data.strategies[0].strategy_id, "S-ONE")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("run builds observe event from projections", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-no-db-observe-"))
  const dbPath = join(dir, "should-not-exist", "trade.db")
  try {
    const result = await run([
      "--db",
      dbPath,
      "--build-observe",
      "--json",
      JSON.stringify({
        chain_id: "flow-obs-1",
        symbol: "BTCUSDT",
        side: "long",
        strategy_ref: "S-TREND",
        account_snapshot: {
          data: {
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
        },
        market_snapshot: {
          data: {
            symbol: "BTCUSDT",
            markPrice: "65000",
          },
        },
      }),
    ])

    assert.equal(result.ok, true)
    const data = (result as { ok: true; data: { kind: string; body_json: Record<string, unknown> } }).data
    assert.equal(data.kind, "observe")
    assert.equal(data.body_json.symbol, "BTCUSDT")
    assert.equal(existsSync(dbPath), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("run replays strategy from manifest without creating DB", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-replay-cli-"))
  const dbPath = join(dir, "should-not-exist", "trade.db")
  try {
    writeFileSync(join(dir, "4h.csv"), [
      "date,timestamp,open,high,low,close,volume",
      ...buildReplayCandles().map((item, index) => [
        new Date(1_700_000_000_000 + index * 4 * 60 * 60 * 1000).toISOString(),
        1_700_000_000_000 + index * 4 * 60 * 60 * 1000,
        item.open,
        item.high,
        item.low,
        item.close,
        item.volume,
      ].join(",")),
    ].join("\n"))
    const manifestPath = join(dir, "manifest.json")
    writeFileSync(manifestPath, JSON.stringify({
      symbol: "BTCUSDT",
      timeframes: {
        "4h": {
          file: "4h.csv",
        },
      },
    }))

    const result = await run([
      "--db",
      dbPath,
      "--replay-strategy",
      "--manifest",
      manifestPath,
      "--strategy-id",
      "S-BTC-4H-TREND-PULLBACK",
      "--oos-split",
      "0.3",
      "--trial-count",
      "1",
      "--parameter-count",
      "4",
    ])

    assert.equal(result.ok, true)
    const data = (result as { ok: true; data: { strategy_id: string; sample_count: number; assumptions: { anti_overfit?: unknown } } }).data
    assert.equal(data.strategy_id, "S-BTC-4H-TREND-PULLBACK")
    assert.ok(data.sample_count > 0)
    assert.ok(data.assumptions.anti_overfit)
    assert.equal(existsSync(dbPath), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("run strategy R&D batch without creating DB", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-rnd-cli-"))
  const dbPath = join(dir, "should-not-exist", "trade.db")
  try {
    writeFileSync(join(dir, "4h.csv"), [
      "date,timestamp,open,high,low,close,volume",
      ...buildReplayCandles().map((item, index) => [
        new Date(1_700_000_000_000 + index * 4 * 60 * 60 * 1000).toISOString(),
        1_700_000_000_000 + index * 4 * 60 * 60 * 1000,
        item.open,
        item.high,
        item.low,
        item.close,
        item.volume,
      ].join(",")),
    ].join("\n"))
    const manifestPath = join(dir, "manifest.json")
    writeFileSync(manifestPath, JSON.stringify({
      symbol: "BTCUSDT",
      timeframes: {
        "4h": {
          file: "4h.csv",
        },
      },
    }))

    const result = await run([
      "--db",
      dbPath,
      "--strategy-rnd-batch",
      "--json",
      JSON.stringify({
        batch_id: "rnd-cli-test",
        manifest_path: manifestPath,
        candidates: [{
          candidate_id: "C-LONG-EMA50",
          parameter_count: 6,
          params: {
            side: "long",
            fast_ema: 50,
            slow_ema: 200,
            pullback_atr: 0.25,
            stop_atr: 0.5,
            max_risk_atr: 1.25,
            reward_risk: 1.5,
          },
        }],
      }),
    ])

    assert.equal(result.ok, true)
    const data = (result as { ok: true; data: { batch_id: string; trial_count: number; guardrails: { no_auto_promote: boolean }; statistical_report: { method: string } } }).data
    assert.equal(data.batch_id, "rnd-cli-test")
    assert.equal(data.trial_count, 1)
    assert.equal(data.guardrails.no_auto_promote, true)
    assert.equal(data.statistical_report.method, "full_trial_statistical_report_v1")
    assert.equal(existsSync(dbPath), false)

    const signalResult = await run([
      "--strategy-signal",
      "--json",
      JSON.stringify({
        manifest_path: manifestPath,
        entry_price: buildReplayCandles().at(-1)!.close,
        now: new Date(1_700_000_000_000 + buildReplayCandles().length * 4 * 60 * 60 * 1000).toISOString(),
        candidate: {
          candidate_id: "C-LIVE-SIGNAL",
          family: "trend_pullback_v1",
          params: { side: "both", pullback_atr: 10, max_risk_atr: 20 },
        },
      }),
    ])
    assert.equal(signalResult.ok, true)
    assert.equal((signalResult as { ok: true; data: { action: string } }).data.action, "entry")
    assert.equal(existsSync(dbPath), false)

    const strategyPath = join(dir, "s-signal.md")
    writeFileSync(strategyPath, `---
strategy_id: S-SIGNAL
contract_schema_version: 1
name: Signal Strategy
status: draft
tags: [test]
---

# Signal Strategy

## Trade Contract

\`\`\`yaml
setup_id: signal-trend-pullback
engine: rnd_family_v1
hypothesis: signal contract test
timeframe: 4h
family: trend_pullback_v1
candidate:
  side: both
  pullback_atr: 10
risk:
  stop_atr: 0.5
  max_risk_atr: 20
  reward_risk: 2
  max_hold_bars: 12
cost_model:
  fee_bps: 2
  slippage_bps: 1
  adverse_funding_bps_per_8h: 1
universe:
  include: [BTCUSDT]
execution:
  entry_rule: closed candle only
proof:
  live_permission: draft_only
\`\`\`
`)
    const compiled = await run(["--strategy-compile", "--strategy", strategyPath])
    assert.equal(compiled.ok, true)
    assert.equal((compiled as { ok: true; data: { candidate: { family: string } } }).data.candidate.family, "trend_pullback_v1")

    const contractSignalResult = await run([
      "--strategy-signal",
      "--strategy",
      strategyPath,
      "--json",
      JSON.stringify({
        manifest_path: manifestPath,
        entry_price: buildReplayCandles().at(-1)!.close,
        now: new Date(1_700_000_000_000 + buildReplayCandles().length * 4 * 60 * 60 * 1000).toISOString(),
      }),
    ])
    assert.equal(contractSignalResult.ok, true)
    assert.equal((contractSignalResult as { ok: true; data: { action: string } }).data.action, "entry")
    assert.equal(existsSync(dbPath), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("run strategy R&D loop writes ledger without creating DB", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-rnd-loop-cli-"))
  const dbPath = join(dir, "should-not-exist", "trade.db")
  const artifactRoot = join(dir, "artifacts")
  const ledgerPath = join(dir, "strategy-rnd-ledger.jsonl")
  try {
    writeFileSync(join(dir, "4h.csv"), [
      "date,timestamp,open,high,low,close,volume",
      ...buildReplayCandles().map((item, index) => [
        new Date(1_700_000_000_000 + index * 4 * 60 * 60 * 1000).toISOString(),
        1_700_000_000_000 + index * 4 * 60 * 60 * 1000,
        item.open,
        item.high,
        item.low,
        item.close,
        item.volume,
      ].join(",")),
    ].join("\n"))
    const manifestPath = join(dir, "manifest.json")
    const indicatorReportPath = join(dir, "indicator-report.json")
    writeFileSync(manifestPath, JSON.stringify({
      symbol: "BTCUSDT",
      timeframes: {
        "4h": {
          file: "4h.csv",
        },
      },
    }))
    writeFileSync(indicatorReportPath, JSON.stringify({
      ok: true,
      data: {
        selected_indicators: {
          vpci: {
            category: "volume",
            defaults: { period_short: 5, period_long: 20 },
            observe: "volume confirmation",
          },
        },
        timeframes: {
          "4h": {
            features: {
              vpci: {
                status: "ok",
                values: buildReplayCandles().map((_, index) => ({
                  timestamp: new Date(1_700_000_000_000 + index * 4 * 60 * 60 * 1000).toISOString(),
                  value: 1,
                })),
              },
            },
          },
        },
      },
    }))

    const result = await run([
      "--db",
      dbPath,
      "--strategy-rnd-loop",
      "--json",
      JSON.stringify({
        run_id: "rnd-cli-loop-test",
        manifest_path: manifestPath,
        indicator_report_path: indicatorReportPath,
        artifact_root: artifactRoot,
        ledger_path: ledgerPath,
        candidates: [{ candidate_id: "C-CLI-LOOP", parameter_count: 1, params: { side: "long" } }],
      }),
    ])

    assert.equal(result.ok, true)
    const data = (result as { ok: true; data: { run_id: string; artifact_ref: string; ledger_ref: string } }).data
    assert.equal(data.run_id, "rnd-cli-loop-test")
    assert.equal(existsSync(data.artifact_ref), true)
    assert.equal(existsSync(data.ledger_ref), true)
    assert.equal(existsSync(dbPath), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("run artifact gc reports candidates without creating DB", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-artifact-gc-"))
  const dbPath = join(dir, "trade.db")
  const root = join(dir, "artifacts")
  const artifact = join(root, "stale.json")
  try {
    mkdirSync(root, { recursive: true })
    writeFileSync(artifact, "{}")
    const oldDate = new Date("2026-01-01T00:00:00.000Z")
    utimesSync(artifact, oldDate, oldDate)

    const result = await run([
      "--db",
      dbPath,
      "--artifact-gc",
      "--artifact-root",
      root,
      "--retention-hours",
      "24",
      "--json",
      JSON.stringify({ now: "2026-01-08T00:00:00.000Z" }),
    ])

    assert.equal(result.ok, true)
    const data = (result as { ok: true; data: { candidates: Array<{ path: string }> } }).data
    assert.deepEqual(data.candidates.map((file) => file.path), [artifact])
    assert.equal(existsSync(dbPath), false)
    assert.equal(existsSync(artifact), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("run strategy iteration commands do not create DB unless DB exists", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-strategy-iteration-cli-"))
  const dbPath = join(dir, "trade.db")
  const strategyPath = join(dir, "s-test.md")
  const ledgerPath = join(dir, "strategy-evidence.jsonl")
  try {
    writeFileSync(strategyPath, "---\nstrategy_id: S-TEST\nname: Test\nstatus: draft\ntags: [test]\n---\n\n# Test\n\nRule v1\n")
    const manifestPath = join(dir, "manifest.json")
    writeFileSync(join(dir, "4h.csv"), "date,timestamp,open,high,low,close,volume\n2026-01-01T00:00:00Z,1,100,101,99,100,1\n")
    const manifest = { schema_version: 2, closed_candles_only: true, symbol: "BTCUSDT", exchange: "binanceusdm", columns: ["date", "timestamp", "open", "high", "low", "close", "volume"], timeframes: { "4h": { file: "4h.csv", content_sha256: "" } } }
    writeFileSync(manifestPath, JSON.stringify(manifest))
    manifest.timeframes["4h"].content_sha256 = replayContentHash(manifestPath, "4h")
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const assumptions = {
      anti_overfit: {
        method: "out_of_sample",
        stage: "locked_holdout",
        oos_stats: {
          sample_count: 24,
          win_rate: 0.5,
          avg_r: 0.09,
          total_r: 2.16,
          max_drawdown_r: 3,
          profit_factor: 1.2,
        },
        trial_count: 3,
        parameter_count: 4,
      },
      robustness: {
        regime_slices: [
          { regime: "bull_low_vol", sample_count: 8, avg_r: 0.1, total_r: 0.8, profit_factor: 1.2 },
          { regime: "bear_high_vol", sample_count: 7, avg_r: 0.08, total_r: 0.56, profit_factor: 1.15 },
        ],
        cost_stress: { extra_bps_per_side: 5, stats: { sample_count: 32, avg_r: 0.07, total_r: 2.24, profit_factor: 1.15 } },
        parameter_stability: { method: "fixed_plus_minus_10pct", evaluation_count: 6, positive_ratio: 1, worst_avg_r: 0.04 },
      },
    }
    const appendResult = await run([
      "--db",
      dbPath,
      "--append-strategy-evidence",
      "--strategy",
      strategyPath,
      "--ledger",
      ledgerPath,
      "--json",
      JSON.stringify({
        replay_result: {
          strategy_id: "S-TEST",
          sample_count: 32,
          win_rate: 0.5,
          avg_r: 0.1,
          total_r: 3.2,
          max_drawdown_r: 4,
          profit_factor: 1.25,
          gate: { shadow_candidate: true, live_small_candidate: false, blocked_by: [] },
          assumptions,
          provenance: {
            harness_hash: replayHarnessHash(),
            data_hash: replayDataHash(manifestPath, "4h"),
            assumptions_hash: hashCanonical(assumptions),
            data_ref: manifestPath,
            timeframe: "4h",
            data_schema_version: 2,
            closed_candles_only: true,
            manifest_checksum_verified: true,
            temporal_contract: temporalContract(),
          },
          notes: ["ok"],
        },
      }),
    ])
    assert.equal(appendResult.ok, true)

    const reviewResult = await run([
      "--db",
      dbPath,
      "--strategy-review",
      "--strategy",
      strategyPath,
      "--ledger",
      ledgerPath,
    ])
    assert.equal(reviewResult.ok, true)
    const review = (reviewResult as { ok: true; data: { gate: { shadow_candidate: boolean } } }).data
    assert.equal(review.gate.shadow_candidate, true)

    const promoteResult = await run([
      "--db",
      dbPath,
      "--strategy-promote",
      "--strategy",
      strategyPath,
      "--ledger",
      ledgerPath,
      "--to",
      "shadow",
    ])
    assert.equal(promoteResult.ok, true)
    const promote = (promoteResult as { ok: true; data: { status: string } }).data
    assert.equal(promote.status, "dry-run")
    assert.equal(existsSync(dbPath), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("run appends review then derives shadow evidence from DB", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-review-evidence-"))
  const dbPath = join(dir, "trade.db")
  const strategyPath = join(dir, "s-test.md")
  const ledgerPath = join(dir, "strategy-evidence.jsonl")
  try {
    writeFileSync(strategyPath, "---\nstrategy_id: S-TEST\nname: Test Strategy\nstatus: shadow\ntags: [test]\n---\n\n# Test Strategy\n\nRule v1\n")

    const appendReview = await run([
      "--db",
      dbPath,
      "--append-review",
      "--json",
      JSON.stringify({
        event_key: "review-e2e-1",
        chain_id: "flow-review-e2e-1",
        created_at: "2026-07-08T12:00:00Z",
        body_json: {
          strategy_ref: "S-TEST",
          setup_id: "default",
          outcome: "win",
          pnl_r: 0.8,
          fee_r: 0.01,
          slippage_r: 0.02,
          funding_r: 0,
          thesis_held: true,
          key_lesson: "shadow path followed the setup",
          promote_to_strategy: false,
        },
      }),
    ])
    assert.equal(appendReview.ok, true)

    const appendEvidence = await run([
      "--db",
      dbPath,
      "--append-strategy-evidence",
      "--strategy",
      strategyPath,
      "--ledger",
      ledgerPath,
      "--json",
      JSON.stringify({
        kind: "shadow",
        from_reviews: true,
        now: "2026-07-08T12:01:00Z",
      }),
    ])
    assert.equal(appendEvidence.ok, true)

    const reviewResult = await run([
      "--db",
      dbPath,
      "--strategy-review",
      "--strategy",
      strategyPath,
      "--ledger",
      ledgerPath,
    ])
    assert.equal(reviewResult.ok, true)
    const review = (reviewResult as { ok: true; data: { latest: { shadow: { kind: string; execution_attribution: { total_cost_drag: number } } | null } } }).data
    assert.equal(review.latest.shadow?.kind, "shadow")
    assert.equal(review.latest.shadow?.execution_attribution.total_cost_drag, 0.03)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("run strategy-cycle syncs review evidence without duplicate ledger rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-strategy-cycle-"))
  const dbPath = join(dir, "trade.db")
  const strategyPath = join(dir, "s-test.md")
  const ledgerPath = join(dir, "strategy-evidence.jsonl")
  try {
    writeFileSync(strategyPath, "---\nstrategy_id: S-TEST\nname: Test Strategy\nstatus: shadow\ntags: [test]\n---\n\n# Test Strategy\n\nRule v1\n")
    const appendReview = await run([
      "--db",
      dbPath,
      "--append-review",
      "--json",
      JSON.stringify({
        event_key: "review-cycle-1",
        chain_id: "flow-review-cycle-1",
        created_at: "2026-07-08T12:00:00Z",
        body_json: {
          strategy_ref: "S-TEST",
          outcome: "win",
          pnl_r: 0.8,
          fee_r: 0.01,
          slippage_r: 0.02,
          funding_r: 0,
          thesis_held: true,
          key_lesson: "cycle can sync evidence",
          promote_to_strategy: false,
        },
      }),
    ])
    assert.equal(appendReview.ok, true)

    const firstCycle = await run([
      "--db",
      dbPath,
      "--strategy-cycle",
      "--strategy",
      strategyPath,
      "--ledger",
      ledgerPath,
    ])
    assert.equal(firstCycle.ok, true)
    assert.equal((firstCycle as { ok: true; data: { shadow_evidence: { status: string } } }).data.shadow_evidence.status, "created")

    const secondCycle = await run([
      "--db",
      dbPath,
      "--strategy-cycle",
      "--strategy",
      strategyPath,
      "--ledger",
      ledgerPath,
    ])
    assert.equal(secondCycle.ok, true)
    assert.equal((secondCycle as { ok: true; data: { shadow_evidence: { status: string } } }).data.shadow_evidence.status, "reused")
    assert.equal(loadEvidenceLedger(ledgerPath).length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("run rejects unsupported replay strategy id", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-replay-unknown-"))
  try {
    writeFileSync(join(dir, "4h.csv"), [
      "date,timestamp,open,high,low,close,volume",
      "2026-01-01T00:00:00Z,1767225600000,100,101,99,100,10",
    ].join("\n"))
    const manifestPath = join(dir, "manifest.json")
    writeFileSync(manifestPath, JSON.stringify({
      symbol: "BTCUSDT",
      timeframes: {
        "4h": {
          file: "4h.csv",
        },
      },
    }))

    const result = await run([
      "--replay-strategy",
      "--manifest",
      manifestPath,
      "--strategy-id",
      "S-NOT-FOUND",
    ])

    assert.equal(result.ok, false)
    const failure = result as { ok: false; schema_version: string; error: string; code: string; retriable: boolean }
    assert.equal(failure.schema_version, "trade-flow.script-response.v1")
    assert.match(failure.error, /unsupported replay strategy/)
    assert.equal(failure.code, "INVALID_ARGUMENT")
    assert.equal(failure.retriable, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("runShadowFromSkills builds real-observe shadow chain with fake read-only skills", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-shadow-skills-"))
  const dbPath = join(dir, "trade.db")
  const db = new Database(dbPath)
  ensureSchema(db)
  const runner: Runner = async (command) => {
    if (command.includes("--symbol") && command.includes("BTCUSDT")) {
      if (String(command.join(" ")).includes("scripts/main.ts")) {
        return {
          ok: true,
          data: {
            data: {
              account: {
                totalMarginBalance: "1000",
                availableBalance: "900",
              },
              positions: [],
              openOrders: {
                regular: [],
                protective: [],
              },
              symbol: "BTCUSDT",
              markPrice: "65000",
            },
          },
          stdout: "{}",
          stderr: "",
        }
      }
    }
    return {
      ok: false,
      error: "unexpected command",
      stdout: "",
      stderr: "",
      exitCode: 1,
    }
  }

  try {
    const result = await runShadowFromSkills(db, {
      ...dryRunInput(),
      repoRoot: "/repo",
      chain_id: "flow-1",
      symbol: "BTCUSDT",
      side: "long",
      strategy_ref: "S-TREND",
      setup_id: "trend-breakout",
      created_at: "2026-07-06T12:00:00+08:00",
    }, runner)

    assert.equal(result.recorded, true)
    assert.equal((result.execution_result as { mode: string }).mode, "shadow")
    const row = db.query("SELECT COUNT(*) AS count FROM plan_event WHERE kind='order_fill'").get() as { count: number }
    assert.equal(row.count, 1)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("runLiveSmall requires explicit yes", async () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  try {
    await assert.rejects(
      () => runLiveSmall(db, dryRunInput(), false),
      /requires --yes/,
    )
  } finally {
    db.close()
  }
})

test("runLiveSmall calls order-place and records audited order_fill", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-live-small-"))
  const db = new Database(join(dir, "trade.db"))
  ensureSchema(db)
  let capturedCommand: string[] = []
  const runner: Runner = async (command, options) => {
    capturedCommand = command
    assert.match(options?.cwd ?? "", /binance-order-place$/)
    return {
      ok: true,
      data: {
        ok: true,
        data: {
          mode: "live",
          method: "futuresCreateAlgoOrder",
          request: {
            symbol: "BTCUSDT",
            side: "BUY",
            type: "STOP_MARKET",
            quantity: "0.001",
            clientAlgoId: "flow-1-1-entry",
          },
          result: {
            algoId: 456,
            clientAlgoId: "flow-1-1-entry",
          },
          confirmedResult: {
            algoId: 456,
            clientAlgoId: "flow-1-1-entry",
          },
        },
      },
      stdout: "{}",
      stderr: "",
    }
  }

  try {
    const result = await runLiveSmall(db, {
      ...dryRunInput(),
      repoRoot: "/repo",
      event_key: "evt-live-small-1",
    }, true, runner)

    assert.equal(result.recorded, true)
    assert.ok(capturedCommand.includes("--yes"))
    assert.ok(capturedCommand.includes("--new-client-order-id"))
    const row = db.query("SELECT json_extract(body_json, '$.exchange_order_id') AS exchange_order_id FROM plan_event").get() as {
      exchange_order_id: string
    }
    assert.equal(row.exchange_order_id, "456")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("runLiveSmall skips before calling order-place when trigger is not hit", async () => {
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
    const result = await runLiveSmall(db, {
      ...dryRunInput(),
      current_mark: 66500,
      trigger_condition: {
        price_in_range: [65900, 66100],
        valid_until_at: "2026-07-06T12:05:00+08:00",
      },
    }, true, runner) as {
      recorded: boolean
      execution_gate: { status: string; reason: string }
    }

    assert.equal(result.recorded, false)
    assert.equal(result.execution_gate.reason, "current_mark_outside_trigger_range")
    assert.equal(called, false)
    const row = db.query(`
      SELECT kind,
        json_extract(body_json, '$.source') AS source,
        json_extract(body_json, '$.execution_gate.reason') AS reason
      FROM plan_event
    `).get() as { kind: string; source: string; reason: string }
    assert.equal(row.kind, "observe")
    assert.equal(row.source, "slow_track")
    assert.equal(row.reason, "current_mark_outside_trigger_range")
  } finally {
    db.close()
  }
})

test("reduceFlowState keeps submitted order open without inventing position", () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  try {
    appendPlanEvent(db, {
      event_key: "obs-reduce-1",
      chain_id: "flow-reduce-1",
      kind: "observe",
      created_at: "2026-07-06T12:00:00Z",
      body_json: {
        symbol: "BTCUSDT",
        side: "long",
        action_intent: {
          target_action: "place_entry",
        },
      },
    })
    appendPlanEvent(db, {
      event_key: "fill-submit-1",
      chain_id: "flow-reduce-1",
      kind: "order_fill",
      created_at: "2026-07-06T12:00:01Z",
      body_json: {
        sub_kind: "submit",
        client_order_id: "flow-reduce-1-1-entry",
        source: "trade_flow",
        source_observe_event_key: "obs-reduce-1",
        execution_contract_snapshot: { chain_id: "flow-reduce-1" },
        symbol: "BTCUSDT",
        side: "BUY",
        position_side: "BOTH",
        order_type: "STOP_MARKET",
        qty: 0.01,
        stop_price: 66000,
      },
    })

    const state = reduceFlowState(db, "flow-reduce-1") as {
      current_orders: Array<{ client_order_id: string; remaining_qty: number }>
      current_position: { state: string; net_qty: number }
      open_action_gap: { exists: boolean; reason: string }
    }
    assert.equal(state.current_orders.length, 1)
    assert.equal(state.current_orders[0].client_order_id, "flow-reduce-1-1-entry")
    assert.equal(state.current_orders[0].remaining_qty, 0.01)
    assert.equal(state.current_position.state, "flat")
    assert.equal(state.current_position.net_qty, 0)
    assert.equal(state.open_action_gap.exists, false)
    assert.equal(state.open_action_gap.reason, "matched_order_fill")
  } finally {
    db.close()
  }
})

test("reduceFlowState detects unexecuted latest action intent", () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  try {
    appendPlanEvent(db, {
      event_key: "obs-gap-1",
      chain_id: "flow-gap-1",
      kind: "observe",
      created_at: "2026-07-06T12:00:00Z",
      body_json: {
        symbol: "ETHUSDT",
        side: "short",
        action_intent: {
          target_action: "place_entry",
        },
      },
    })

    const state = reduceFlowState(db, "flow-gap-1") as {
      open_action_gap: { exists: boolean; latest_observe_event_key: string; target_action: string; reason: string }
    }
    assert.equal(state.open_action_gap.exists, true)
    assert.equal(state.open_action_gap.latest_observe_event_key, "obs-gap-1")
    assert.equal(state.open_action_gap.target_action, "place_entry")
    assert.equal(state.open_action_gap.reason, "action_intent_without_order_fill")
  } finally {
    db.close()
  }
})

test("run recovers one flow from local plan_event history", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-recover-"))
  const dbPath = join(dir, "trade.db")
  const db = new Database(dbPath)
  ensureSchema(db)
  try {
    appendPlanEvent(db, {
      event_key: "obs-cli-recover-1",
      chain_id: "flow-cli-recover-1",
      kind: "observe",
      created_at: "2026-07-06T12:00:00Z",
      body_json: {
        symbol: "BTCUSDT",
        side: "long",
        action_intent: {
          target_action: "no_action",
        },
      },
    })
  } finally {
    db.close()
  }

  try {
    const result = await run([
      "--db",
      dbPath,
      "--recover-flow",
      "--chain-id",
      "flow-cli-recover-1",
    ])
    assert.equal(result.ok, true)
    const data = (result as { ok: true; data: { chain_id: string; event_count: number } }).data
    assert.equal(data.chain_id, "flow-cli-recover-1")
    assert.equal(data.event_count, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("run reconciles one flow against supplied account snapshot", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-reconcile-"))
  const dbPath = join(dir, "trade.db")
  const db = new Database(dbPath)
  ensureSchema(db)
  try {
    appendPlanEvent(db, {
      event_key: "obs-cli-reconcile-1",
      chain_id: "flow-cli-reconcile-1",
      kind: "observe",
      created_at: "2026-07-06T12:00:00Z",
      body_json: {
        symbol: "BTCUSDT",
        side: "long",
        action_intent: {
          target_action: "no_action",
        },
      },
    })
  } finally {
    db.close()
  }

  try {
    const result = await run([
      "--db",
      dbPath,
      "--reconcile-flow",
      "--chain-id",
      "flow-cli-reconcile-1",
      "--json",
      JSON.stringify({
        openOrders: {
          regular: [{
            symbol: "BTCUSDT",
            side: "BUY",
            type: "LIMIT",
            status: "NEW",
            origQty: "0.01",
            price: "65000",
            orderId: "1001",
            clientOrderId: "flow-cli-reconcile-1-1-entry",
            positionSide: "BOTH",
            source: "openOrders",
            sourceType: "standard",
          }],
          protective: [],
        },
        positions: [],
      }),
    ])
    assert.equal(result.ok, true)
    const data = (result as { ok: true; data: { can_reconcile: boolean; drafts: Array<{ body_json: Record<string, unknown> }> } }).data
    assert.equal(data.can_reconcile, true)
    assert.equal(data.drafts.length, 1)
    assert.equal(data.drafts[0].body_json.source, "reconcile")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("run applies reconcile drafts only with explicit yes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-apply-reconcile-"))
  const dbPath = join(dir, "trade.db")
  const payload = {
    can_reconcile: true,
    drafts: [{
      event_key: "reconcile-flow-apply-1-submit-flow-apply-1-1-entry",
      chain_id: "flow-apply-1",
      kind: "order_fill",
      created_at: "2026-07-06T12:00:00Z",
      body_json: {
        sub_kind: "submit",
        client_order_id: "flow-apply-1-1-entry",
        source: "reconcile",
        symbol: "BTCUSDT",
        side: "BUY",
        position_side: "BOTH",
        order_type: "LIMIT",
        qty: 0.01,
      },
    }],
  }

  try {
    const rejected = await run([
      "--db",
      dbPath,
      "--apply-reconcile",
      "--json",
      JSON.stringify(payload),
    ])
    assert.equal(rejected.ok, false)
    const failure = rejected as { ok: false; error: string; code: string; retriable: boolean }
    assert.match(failure.error, /requires --yes/)
    assert.equal(failure.code, "PRECONDITION_FAILED")
    assert.equal(failure.retriable, false)

    const accepted = await run([
      "--db",
      dbPath,
      "--apply-reconcile",
      "--yes",
      "--json",
      JSON.stringify(payload),
    ])
    assert.equal(accepted.ok, true)
    const data = (accepted as { ok: true; data: { applied_count: number } }).data
    assert.equal(data.applied_count, 1)

    const db = new Database(dbPath)
    try {
      const row = db.query("SELECT COUNT(*) AS count FROM plan_event WHERE kind='order_fill'").get() as { count: number }
      assert.equal(row.count, 1)
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("reconcileFromSkills calls read-only account snapshot with history", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-reconcile-skills-"))
  const db = new Database(join(dir, "trade.db"))
  ensureSchema(db)
  appendPlanEvent(db, {
    event_key: "obs-skill-reconcile-1",
    chain_id: "flow-skill-reconcile-1",
    kind: "observe",
    created_at: "2026-07-06T12:00:00Z",
    body_json: {
      symbol: "BTCUSDT",
      action_intent: {
        target_action: "no_action",
      },
    },
  })
  let capturedCommand: string[] = []
  const runner: Runner = async (command, options) => {
    capturedCommand = command
    assert.match(options?.cwd ?? "", /binance-account-snapshot$/)
    return {
      ok: true,
      data: {
        ok: true,
        data: {
          openOrders: {
            regular: [{
              symbol: "BTCUSDT",
              side: "BUY",
              type: "LIMIT",
              status: "NEW",
              origQty: "0.01",
              price: "65000",
              orderId: "2001",
              clientOrderId: "flow-skill-reconcile-1-1-entry",
              positionSide: "BOTH",
              source: "openOrders",
              sourceType: "standard",
            }],
            protective: [],
          },
          positions: [],
        },
      },
      stdout: "{}",
      stderr: "",
    }
  }

  try {
    const result = await reconcileFromSkills(db, "flow-skill-reconcile-1", {
      repoRoot: "/repo",
      historyLimit: 25,
    }, runner) as { drafts: Array<{ body_json: Record<string, unknown> }> }

    assert.ok(capturedCommand.includes("--include-history"))
    assert.ok(capturedCommand.includes("--history-limit"))
    assert.ok(capturedCommand.includes("25"))
    assert.equal(result.drafts.length, 1)
    assert.equal(result.drafts[0].body_json.source, "reconcile")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("cronRecoverFromSkills returns draft until explicit local apply", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-cron-recover-"))
  const db = new Database(join(dir, "trade.db"))
  ensureSchema(db)
  appendPlanEvent(db, {
    event_key: "obs-cron-recover-1",
    chain_id: "flow-cron-recover-1",
    kind: "observe",
    created_at: "2026-07-06T12:00:00Z",
    body_json: {
      symbol: "BTCUSDT",
      action_intent: {
        target_action: "no_action",
      },
    },
  })
  const runner: Runner = async () => ({
    ok: true,
    data: {
      ok: true,
      data: {
        openOrders: {
          regular: [{
            symbol: "BTCUSDT",
            side: "BUY",
            type: "LIMIT",
            status: "NEW",
            origQty: "0.01",
            price: "65000",
            orderId: "3001",
            clientOrderId: "flow-cron-recover-1-1-entry",
            positionSide: "BOTH",
            source: "openOrders",
            sourceType: "standard",
          }],
          protective: [],
        },
        positions: [],
      },
    },
    stdout: "{}",
    stderr: "",
  })

  try {
    const draftOnly = await cronRecoverFromSkills(db, "flow-cron-recover-1", {
      repoRoot: "/repo",
    }, false, runner) as { status: string; after: { current_orders: unknown[] } }
    assert.equal(draftOnly.status, "reconcile_draft_ready")
    assert.equal(draftOnly.after.current_orders.length, 0)

    const applied = await cronRecoverFromSkills(db, "flow-cron-recover-1", {
      repoRoot: "/repo",
      apply_reconcile: true,
    }, true, runner) as { status: string; after: { current_orders: unknown[] } }
    assert.equal(applied.status, "recovered_applied")
    assert.equal(applied.after.current_orders.length, 1)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("reduceFlowState applies partial and final fills to position", () => {
  const db = new Database(":memory:")
  ensureSchema(db)
  try {
    appendPlanEvent(db, {
      event_key: "fill-submit-2",
      chain_id: "flow-fill-1",
      kind: "order_fill",
      created_at: "2026-07-06T12:00:00Z",
      body_json: {
        sub_kind: "submit",
        client_order_id: "flow-fill-1-1-entry",
        source: "reconcile",
        symbol: "BTCUSDT",
        side: "BUY",
        position_side: "BOTH",
        order_type: "LIMIT",
        qty: 1,
        price: 65000,
      },
    })
    appendPlanEvent(db, {
      event_key: "fill-partial-1",
      chain_id: "flow-fill-1",
      kind: "order_fill",
      created_at: "2026-07-06T12:01:00Z",
      body_json: {
        sub_kind: "partial_fill",
        client_order_id: "flow-fill-1-1-entry",
        source: "reconcile",
        symbol: "BTCUSDT",
        side: "BUY",
        position_side: "BOTH",
        filled_qty: 0.4,
        avg_fill_price: 65000,
      },
    })
    appendPlanEvent(db, {
      event_key: "fill-final-1",
      chain_id: "flow-fill-1",
      kind: "order_fill",
      created_at: "2026-07-06T12:02:00Z",
      body_json: {
        sub_kind: "fill",
        client_order_id: "flow-fill-1-1-entry",
        source: "reconcile",
        symbol: "BTCUSDT",
        side: "BUY",
        position_side: "BOTH",
        filled_qty: 0.6,
        avg_fill_price: 65100,
      },
    })

    const state = reduceFlowState(db, "flow-fill-1") as {
      current_orders: unknown[]
      current_position: { state: string; net_qty: number; avg_entry_price: number }
    }
    assert.equal(state.current_orders.length, 0)
    assert.equal(state.current_position.state, "long")
    assert.equal(state.current_position.net_qty, 1)
    assert.equal(state.current_position.avg_entry_price, 65060)
  } finally {
    db.close()
  }
})

function executionContractInput() {
  return {
    source_observe_event_key: "obs-1",
    chain_id: "flow-1",
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
  }
}

function dryRunInput() {
  return {
    now: "2026-07-06T12:00:20+08:00",
    event_key: "evt-dry-run-1",
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
    execution_contract_input: executionContractInput(),
  }
}

function temporalContract() {
  return {
    method: "closed_candle_replay_v1",
    timeframe: "4h",
    closed_candle_only: true,
    reference_at: "2026-01-01T00:00:00.000Z",
    availability_at: "2026-01-01T04:00:00.000Z",
    lookback_start: "2026-01-01T00:00:00.000Z",
    label_end: "2026-01-01T04:00:00.000Z",
    universe_selected_at: "2026-01-01T00:00:00.000Z",
    universe_selection_source: "fixture",
    label_policy: "signals use closed candles; entries occur on next open; labels are available after exit candle close",
    supplemental_data: [],
  }
}

function buildReplayCandles(): Array<{ open: number; high: number; low: number; close: number; volume: number }> {
  const candles: Array<{ open: number; high: number; low: number; close: number; volume: number }> = []
  let close = 100
  for (let index = 0; index < 260; index += 1) {
    const trend = index < 220 ? 0.25 : 0.35
    const pullback = index > 220 && index % 8 === 0 ? -3 : 0
    const open = close
    close = close + trend + pullback
    const high = Math.max(open, close) + 0.5
    const low = Math.min(open, close) - (pullback < 0 ? Math.abs(pullback) + 0.5 : 0.4)
    candles.push({
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: 1000 + index,
    })
  }
  return candles
}
