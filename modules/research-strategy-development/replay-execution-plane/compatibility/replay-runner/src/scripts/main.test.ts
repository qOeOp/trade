import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { run } from "./main"
import { REPLAY_REQUEST_SCHEMA_VERSION, REPLAY_SIMULATOR_POLICY_VERSION } from "../../../../contracts/src/lib/replay-contracts"

type JSONRecord = Record<string, unknown>

test("replay runner requires a manifest", () => {
  const result = run([])
  assert.equal(result.ok, false)
  assert.match(String(result.error), /requires --manifest/)
})

test("replay runner exposes owner fingerprint surface", () => {
  const result = run(["--fingerprint"]) as {
    ok: boolean
    data: { harness_hash: string }
  }
  assert.equal(result.ok, true)
  assert.equal(typeof result.data.harness_hash, "string")
  assert.equal(result.data.harness_hash.length, 64)
})

test("replay runner executes registered strategy", () => {
  const dir = mkdtempSync(join(tmpdir(), "replay-runner-"))
  const csvPath = join(dir, "BTCUSDT-4h.csv")
  const manifestPath = join(dir, "manifest.json")
  writeFileSync(csvPath, buildCsv())
  writeFileSync(manifestPath, JSON.stringify({
    symbol: "BTCUSDT",
    timeframes: {
      "4h": {
        file: "BTCUSDT-4h.csv",
      },
    },
  }))

  const result = run(["--manifest", manifestPath, "--strategy-id", "S-BTC-4H-TREND-PULLBACK"])
  assert.equal(result.ok, true)
  const data = asRecord(result.data)
  assert.equal(data.strategy_id, "S-BTC-4H-TREND-PULLBACK")
  assert.equal(data.timeframe, "4h")
  assert.ok(Number(data.sample_count) > 0)
})

test("legacy replay runner adapts Trial-bound requests to Replay Execution Plane", () => {
  const hash = "a".repeat(64)
  const executionRequest = {
    schema_version: REPLAY_REQUEST_SCHEMA_VERSION,
    run_id: "adapter-run-1", idempotency_key: "adapter-key-1", experiment_id: "experiment-1",
    trial_group_id: "group-1", trial_group_hash: hash, trial_id: "trial-1", candidate_id: "candidate-1", candidate_hash: hash,
    identity_hash_policy_version: "identity-v1", experiment_contract_hash: hash, dataset_manifest_ref: "dataset://fixture", dataset_hash: hash,
    harness_hash: hash, assumptions_hash: hash, symbol: "BTCUSDT", timeframe: "4h", initial_cash: 1000,
    order: { side: "long", quantity: 1, signal_time: "2026-07-14T00:00:00Z", earliest_executable_time: "2026-07-14T04:00:00Z", stop_price: 95, target_price: 110 },
    cost_policy: { policy_id: "fixture", version: "1", fee_bps: 0, slippage_bps: 0 },
    simulator_policy: { version: REPLAY_SIMULATOR_POLICY_VERSION, signal_visibility: "closed_candle", earliest_execution: "next_open", same_bar_policy: "stop_first", gap_fill_policy: "worse_open", position_accounting: "average_cost", funding_timing: "exact_event" }, random_seed: 1,
  }
  const result = run(["--json", JSON.stringify({
    execution_request: executionRequest,
    bars: [{ open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 111, low: 99, close: 110, volume: 10, closed: true }],
  })]) as { ok: boolean; data: { status: string } }
  assert.equal(result.ok, true)
  assert.equal(result.data.status, "completed")
})

function buildCsv(): string {
  const lines = ["date,timestamp,open,high,low,close,volume"]
  const start = 1_700_000_000_000
  let close = 100
  for (let index = 0; index < 260; index += 1) {
    const trend = index < 220 ? 0.25 : 0.35
    const pullback = index > 220 && index % 8 === 0 ? -3 : 0
    const open = close
    close = close + trend + pullback
    const high = Math.max(open, close) + 0.5
    const low = Math.min(open, close) - (pullback < 0 ? Math.abs(pullback) + 0.5 : 0.4)
    const timestamp = start + index * 4 * 60 * 60 * 1000
    lines.push(`${new Date(timestamp).toISOString()},${timestamp},${open.toFixed(2)},${high.toFixed(2)},${low.toFixed(2)},${close.toFixed(2)},${1000 + index}`)
  }
  return `${lines.join("\n")}\n`
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}
