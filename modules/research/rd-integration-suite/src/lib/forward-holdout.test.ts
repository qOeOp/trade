import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"

import { forwardHoldoutInputFromJson, forwardHoldoutInputFromPanelJson, runForwardHoldout } from "../../../forward-holdout/src/lib/forward-holdout"

test("forward holdout parser accepts artifact-style snake case candidate fields", () => {
  const input = forwardHoldoutInputFromJson({
    strategy_id: "S-TEST",
    setup_id: "setup",
    frozen_at: "2026-07-09T00:00:00.000Z",
    candidate: { candidate_id: "C-1", parameter_count: 8, params: { side: "short" } },
    datasets: [{ dataset_id: "ALT", manifest_path: "/tmp/manifest.json" }],
  })
  assert.equal(input.strategyId, "S-TEST")
  assert.equal(input.candidate.candidateId, "C-1")
  assert.equal(input.candidate.parameterCount, 8)
  assert.ok(input.datasets[0])
  assert.equal(input.datasets[0].datasetId, "ALT")
})

test("forward holdout parser ignores camel-case artifact aliases", () => {
  const input = forwardHoldoutInputFromJson({
    strategyId: "S-TEST",
    setupId: "setup",
    frozenAt: "2026-07-09T00:00:00.000Z",
    maxSignalAgeBars: 6,
    benchmarkManifestPath: "/tmp/benchmark.json",
    candidate: { candidateId: "C-1", parameterCount: 8, params: { side: "short" } },
    datasets: [{ datasetId: "ALT", manifestPath: "/tmp/manifest.json", entryPrice: 123 }],
  })
  assert.equal(input.strategyId, "")
  assert.equal(input.maxSignalAgeBars, undefined)
  assert.equal(input.candidate.candidateId, "")
  assert.equal(input.candidate.parameterCount, undefined)
  assert.equal(input.datasets[0].manifestPath, "")
  assert.equal(input.datasets[0].entryPrice, undefined)
  assert.equal(asRecord(input.candidate.params).benchmark_manifest_path, undefined)
})

test("forward holdout panel builder requires explicit freeze time", () => {
  assert.throws(() => forwardHoldoutInputFromPanelJson({
    panel_id: "panel",
    timeframe: "4h",
    datasets: [{ dataset_id: "ALT", manifest_path: "/tmp/manifest.json" }],
    candidates: [{ candidate_id: "C-1", params: { side: "short" } }],
  }, {
    plan: { generated_at: "2026-07-09T00:00:00.000Z" },
  }), /requires explicit frozenAt/)
})

test("forward holdout panel builder converts frozen panel inputs", () => {
  const input = forwardHoldoutInputFromPanelJson({
    panel_id: "panel",
    timeframe: "4h",
    datasets: [{ dataset_id: "ALT", manifest_path: "/tmp/manifest.json", indicator_report_path: "/tmp/features.json" }],
    candidates: [{ candidate_id: "C-1", parameter_count: 8, params: { side: "short" } }],
  }, {
    plan: { run_id: "plan", candidate: { candidate_id: "C-1", family: "time_series_momentum_v1", params: { threshold_atr: 2 } } },
    frozenAt: "2026-07-09T00:00:00.000Z",
    now: "2026-07-09T04:30:00.000Z",
  })
  assert.equal(input.strategyId, "plan")
  assert.equal(input.setupId, "plan")
  assert.equal(input.frozenAt, "2026-07-09T00:00:00.000Z")
  assert.equal(input.now, "2026-07-09T04:30:00.000Z")
  assert.equal(input.candidate.candidateId, "C-1")
  assert.equal(input.candidate.family, "time_series_momentum_v1")
  assert.equal(input.candidate.parameterCount, 8)
  assert.equal(input.candidate.params?.side, "short")
  assert.equal(input.candidate.params?.threshold_atr, 2)
  assert.equal(input.datasets[0].datasetId, "ALT")
  assert.equal(input.datasets[0].indicatorReportPath, "/tmp/features.json")
})

test("forward holdout blocks candles that closed before strategy freeze", () => {
  const dir = mkdtempSync(join(tmpdir(), "forward-holdout-"))
  try {
    const asset = writeManifest(join(dir, "asset"), "ALTUSDT", Date.parse("2026-05-01T00:00:00.000Z"))
    const benchmark = writeManifest(join(dir, "benchmark"), "BTCUSDT", Date.parse("2026-05-01T00:00:00.000Z"))
    const result = runForwardHoldout({
      strategyId: "S-TEST",
      setupId: "setup",
      frozenAt: "2026-07-09T00:00:00.000Z",
      timeframe: "4h",
      now: "2026-07-09T04:30:00.000Z",
      candidate: candidate(benchmark),
      datasets: [{ datasetId: "ALT", manifestPath: asset }],
    })

    const record = (result.records as Array<{ eligible: boolean; blocked_by: Array<{ check_id: string }> }>)[0]
    assert.equal(record.eligible, false)
    assert.equal(record.blocked_by.some((item) => item.check_id === "HOLDOUT-NOT-FORWARD"), true)
    assert.equal(result.status, "blocked")
    assert.equal(result.next_action, "Wait for the next closed candle after frozen_at, then re-run forward holdout with refreshed asset and benchmark manifests.")
    assert.equal(result.eligible_count, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("forward holdout blocks when supplemental benchmark data is not forward", () => {
  const dir = mkdtempSync(join(tmpdir(), "forward-holdout-"))
  try {
    const asset = writeManifest(join(dir, "asset"), "ALTUSDT", Date.parse("2026-07-10T00:00:00.000Z"))
    const benchmark = writeManifest(join(dir, "benchmark"), "BTCUSDT", Date.parse("2026-05-01T00:00:00.000Z"))
    const result = runForwardHoldout({
      strategyId: "S-TEST",
      setupId: "setup",
      frozenAt: "2026-07-09T00:00:00.000Z",
      timeframe: "4h",
      now: "2026-07-10T04:30:00.000Z",
      candidate: candidate(benchmark),
      datasets: [{ datasetId: "ALT", manifestPath: asset }],
    })

    const record = (result.records as Array<{ eligible: boolean; blocked_by: Array<{ check_id: string }> }>)[0]
    assert.equal(record.eligible, false)
    assert.equal(record.blocked_by.some((item) => item.check_id === "HOLDOUT-SUPPLEMENTAL-NOT-FORWARD"), true)
    assert.equal(result.status, "blocked")
    assert.equal(result.eligible_count, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("forward holdout evaluates a frozen candidate only on post-freeze closed candles", () => {
  const dir = mkdtempSync(join(tmpdir(), "forward-holdout-"))
  try {
    const asset = writeManifest(join(dir, "asset"), "ALTUSDT", Date.parse("2026-07-10T00:00:00.000Z"))
    const benchmark = writeManifest(join(dir, "benchmark"), "BTCUSDT", Date.parse("2026-07-10T00:00:00.000Z"))
    const result = runForwardHoldout({
      strategyId: "S-TEST",
      setupId: "setup",
      frozenAt: "2026-07-09T00:00:00.000Z",
      timeframe: "4h",
      now: "2026-08-26T08:30:00.000Z",
      maxSignalAgeBars: 8,
      candidate: candidate(benchmark),
      datasets: [{ datasetId: "ALT", manifestPath: asset }],
    })

    const record = (result.records as Array<{ eligible: boolean; blocked_by: unknown[]; signal?: { action: string } }>)[0]
    assert.equal(record.eligible, true)
    assert.equal(record.blocked_by.length, 0)
    assert.ok(record.signal)
    assert.ok(record.signal.action === "entry" || record.signal.action === "no_action")
    assert.equal(result.eligible_count, 1)
    assert.ok(["signal_found", "waiting_for_signal"].includes(result.status))
    assert.equal(result.frozen_candidate.candidate_id, "C-FORWARD-HOLDOUT")
    assert.equal(result.frozen_candidate.parameter_count, 8)
    assert.ok(result.frozen_candidate.candidate_hash)
    assertSchemaRequired(readSchema(), result as unknown as Record<string, unknown>)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function readSchema(): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL("../../../forward-holdout/src/schemas/forward-holdout-result.schema.json", import.meta.url), "utf8")) as Record<string, unknown>
}

function assertSchemaRequired(schema: Record<string, unknown>, value: Record<string, unknown>): void {
  for (const field of asArray(schema.required)) {
    assert.ok(String(field) in value, `missing required field ${String(field)}`)
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function candidate(benchmarkManifestPath: string) {
  return {
    candidateId: "C-FORWARD-HOLDOUT",
    family: "relative_weakness_momentum_v1",
    parameterCount: 8,
    params: {
      side: "short",
      signal_mode: "reversion",
      confirmation_mode: "reversal_close",
      benchmark_manifest_path: benchmarkManifestPath,
      lookback_bars: 40,
      relative_threshold_atr: 1,
      benchmark_return_min: 0.01,
      stop_atr: 1,
    },
  }
}

function writeManifest(dir: string, symbol: string, start: number): string {
  mkdirSync(dir, { recursive: true })
  const rows = Array.from({ length: 280 }, (_, index) => {
    const timestamp = start + index * 4 * 60 * 60 * 1000
    const open = 100 + index * 0.1
    const close = open + (index % 9 === 0 ? -0.4 : 0.2)
    return [new Date(timestamp).toISOString(), timestamp, open, Math.max(open, close) + 0.5, Math.min(open, close) - 0.5, close, 1000 + index].join(",")
  })
  writeFileSync(join(dir, "4h.csv"), ["date,timestamp,open,high,low,close,volume", ...rows].join("\n"))
  const path = join(dir, "manifest.json")
  writeFileSync(path, JSON.stringify({
    schema_version: 2,
    closed_candles_only: true,
    symbol,
    timeframes: { "4h": { file: "4h.csv" } },
  }))
  return path
}
