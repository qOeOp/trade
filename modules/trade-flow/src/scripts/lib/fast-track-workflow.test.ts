import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join } from "node:path"
import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import { runFastTrackWorkflowDryRun } from "./fast-track-workflow"
import { appendPlanEvent, ensureSchema } from "./plan-events"
import type { Runner } from "../../../../flow/observe-runner/src/lib/observe-runner"

test("fast track workflow checks active flow and appends fast observe", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "trade-flow-fast-workflow-"))
  const dataDir = join(repoRoot, "data")
  mkdirSync(dataDir, { recursive: true })
  const db = new Database(":memory:")
  ensureSchema(db)
  appendPlanEvent(db, {
    event_key: "obs-fast-workflow-slow-1",
    chain_id: "flow-fast-workflow-1",
    kind: "observe",
    created_at: "2026-07-08T12:00:00Z",
    body_json: {
      source: "slow_track",
      symbol: "BTCUSDT",
      side: "long",
      strategy_ref: "S-BTC",
      setup_id: "btc-breakout",
      thesis: "slow track thesis",
      action_intent: {
        target_action: "place_entry",
        trigger_condition: {
          price_in_range: [64000, 66000],
        },
        request: {
          type: "STOP_MARKET",
        },
      },
    },
  })
  const calls: Array<{ command: string[]; cwd?: string }> = []
  const runner: Runner = async (command, options) => {
    calls.push({ command, cwd: options?.cwd })
    if (options?.cwd?.endsWith("binance/account-snapshot")) {
      return jsonOk({
        generated_at: "2026-07-08T16:00:00+08:00",
        positions: [],
        openOrders: { regular: [], protective: [] },
        errors: {},
      })
    }
    if (options?.cwd?.endsWith("binance/symbol-snapshot")) {
      return jsonOk({
        symbol: "BTCUSDT",
        generated_at: "2026-07-08T16:00:01+08:00",
        priceSnapshot: { markPrice: "65000" },
        premiumIndex: { lastFundingRate: "0.0001" },
        openInterest: { openInterest: "12345" },
      })
    }
    throw new Error("unexpected runner call")
  }

  try {
    const result = await runFastTrackWorkflowDryRun({
      repoRoot,
      dataDir,
      runId: "run-fast-test",
      db,
      runner,
    })
    assert.equal(result.mode, "workflow-dry-run")
    assert.equal(isAbsolute(String(result.artifact_path)), false)
    assert.equal(result.active_flow_count, 1)
    assert.equal((result.trade_decision as { target_action: string }).target_action, "no_action")
    const check = (result.flow_checks as Array<{ execution_gate: { status: string }; symbol: string }>)[0]
    assert.equal(check.symbol, "BTCUSDT")
    assert.equal(check.execution_gate.status, "ready")
    assert.match(readFileSync(join(repoRoot, String(result.artifact_path)), "utf8"), /flow-fast-workflow-1/)
    assert.equal(calls.some((call) => call.command.includes("--run-live-small")), false)

    const row = db.query(`
      SELECT json_extract(body_json, '$.source') AS source,
        json_extract(body_json, '$.latest_slow_observe_event_key') AS latest_slow,
        json_extract(body_json, '$.execution_gate.status') AS gate_status,
        json_extract(body_json, '$.action_intent.target_action') AS target_action
      FROM plan_event
      WHERE kind = 'observe' AND json_extract(body_json, '$.source') = 'fast_track'
      ORDER BY created_at DESC
      LIMIT 1
    `).get() as { source: string; latest_slow: string; gate_status: string; target_action: string }
    assert.equal(row.source, "fast_track")
    assert.equal(row.latest_slow, "obs-fast-workflow-slow-1")
    assert.equal(row.gate_status, "ready")
    assert.equal(row.target_action, "place_entry")
  } finally {
    db.close()
    rmSync(repoRoot, { recursive: true, force: true })
  }
})

test("fast track workflow with no active flows does not call snapshot tools", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "trade-flow-fast-empty-"))
  const dataDir = join(repoRoot, "data")
  mkdirSync(dataDir, { recursive: true })
  const db = new Database(":memory:")
  ensureSchema(db)
  let called = false
  const runner: Runner = async () => {
    called = true
    return jsonOk({})
  }

  try {
    const result = await runFastTrackWorkflowDryRun({
      repoRoot,
      dataDir,
      runId: "run-fast-empty",
      db,
      runner,
    })
    assert.equal(isAbsolute(String(result.artifact_path)), false)
    assert.equal(result.active_flow_count, 0)
    assert.equal((result.trade_decision as { reason: string }).reason, "no_active_flows")
    assert.equal(called, false)
  } finally {
    db.close()
    rmSync(repoRoot, { recursive: true, force: true })
  }
})

function jsonOk(data: unknown) {
  return {
    ok: true as const,
    data: { ok: true, data },
    stdout: "{}",
    stderr: "",
  }
}
