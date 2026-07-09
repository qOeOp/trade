import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import { catastrophicAssetsFrom, runStrategyPanelRnd, strategyPanelRndInputFromJson } from "./strategy-panel-rnd"

test("panel R&D pools samples but keeps per-asset evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-panel-rnd-"))
  try {
    const manifestPath = writeManifest(dir)
    const report = runStrategyPanelRnd({
      panelId: "panel-test",
      datasets: ["BTC", "ETH", "SOL"].map((datasetId) => ({ datasetId, manifestPath })),
      candidates: [{ candidateId: "PANEL-LONG", params: { side: "long" } }],
    })
    assert.equal(report.dataset_count, 3)
    assert.equal((report.candidates as Array<{ assets: unknown[] }>)[0].assets.length, 3)
    assert.ok(Number((report.candidates as Array<{ pooled: { sample_count: number } }>)[0].pooled.sample_count) > 0)
    const candidate = (report.candidates as Array<{ null_controls: { method: string; asset_count: number }; panel_null_controls: { status: string; passed: boolean }; assets: Array<{ null_control_passed: boolean }> }>)[0]
    assert.equal(candidate.null_controls.method, "per_asset_candidate_null_controls")
    assert.equal(candidate.null_controls.asset_count, 3)
    assert.equal(candidate.panel_null_controls.status, "not_applicable")
    assert.equal(candidate.panel_null_controls.passed, true)
    assert.equal(candidate.assets.every((asset) => typeof asset.null_control_passed === "boolean"), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("panel R&D evaluates cross-candidate asset shuffle null", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-panel-rnd-shuffle-"))
  try {
    const manifestPath = writeManifest(dir)
    const report = runStrategyPanelRnd({
      panelId: "panel-shuffle-test",
      datasets: ["BTC", "ETH", "SOL"].map((datasetId) => ({ datasetId, manifestPath })),
      candidates: [
        { candidateId: "PANEL-LONG", params: { side: "long" } },
        { candidateId: "PANEL-SHORT", params: { side: "short" } },
      ],
    })
    const candidates = report.candidates as Array<{
      candidate_id: string
      panel_null_controls: { status: string; passed: boolean; p95_total_r: number }
      gate: { blocked_by: Array<{ check_id: string }> }
    }>
    const long = candidates.find((candidate) => candidate.candidate_id === "PANEL-LONG")
    const short = candidates.find((candidate) => candidate.candidate_id === "PANEL-SHORT")
    assert.equal(long?.panel_null_controls.status, "evaluated")
    assert.equal(typeof long?.panel_null_controls.p95_total_r, "number")
    assert.equal(short?.panel_null_controls.status, "evaluated")
    assert.equal(long?.panel_null_controls.passed, false)
    assert.equal(long?.gate.blocked_by.some((item) => item.check_id === "PANEL-ASSET-SHUFFLE"), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("panel R&D diagnostic mode skips expensive null controls and cannot promote", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-panel-rnd-diagnostic-"))
  try {
    const manifestPath = writeManifest(dir)
    const report = runStrategyPanelRnd({
      panelId: "panel-diagnostic-test",
      diagnosticMode: true,
      datasets: ["BTC", "ETH", "SOL"].map((datasetId) => ({ datasetId, manifestPath })),
      candidates: [{ candidateId: "PANEL-LONG", params: { side: "long" } }],
    })
    const candidate = (report.candidates as Array<{
      gate: { accepted: boolean; blocked_by: Array<{ check_id: string }> }
      panel_null_controls: { status: string }
    }>)[0]
    assert.equal(report.outcome, "diagnostic_only")
    assert.equal(candidate.gate.accepted, false)
    assert.equal(candidate.gate.blocked_by.some((item) => item.check_id === "PANEL-DIAGNOSTIC-ONLY"), true)
    assert.equal(candidate.panel_null_controls.status, "diagnostic_skipped")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("panel R&D resolves legacy data panel paths to tmp panels", () => {
  const panelRoot = join(process.cwd(), "tmp", "panels", "validation-panel-path-fallback-test")
  try {
    const manifestPath = join(panelRoot, "btcusdt", "manifest.json")
    mkdirSync(join(panelRoot, "btcusdt"), { recursive: true })
    writeManifest(join(panelRoot, "btcusdt"))
    const report = runStrategyPanelRnd({
      panelId: "panel-path-fallback-test",
      diagnosticMode: true,
      datasets: ["BTC", "ETH", "SOL"].map((datasetId) => ({
        datasetId,
        manifestPath: "data/validation-panel-path-fallback-test/btcusdt/manifest.json",
      })),
      candidates: [{ candidateId: "PANEL-LONG", params: { side: "long" } }],
    })
    assert.equal(report.dataset_count, 3)
    assert.ok(Number((report.candidates as Array<{ pooled: { sample_count: number } }>)[0].pooled.sample_count) > 0)
    assert.equal(manifestPath.endsWith("manifest.json"), true)
  } finally {
    rmSync(panelRoot, { recursive: true, force: true })
  }
})

test("panel R&D attributes assets that trigger catastrophic veto", () => {
  const assets = catastrophicAssetsFrom([{
    dataset_id: "SOL",
    symbol: "SOLUSDT",
    sample_count: 100,
    avg_r: 0.01,
    total_r: 1,
    profit_factor: 1.1,
    max_drawdown_r: 17,
    oos_positive: true,
    cost_stress_positive: false,
    null_control_passed: true,
    null_control_blocked_by: [],
  }, {
    dataset_id: "AVAX",
    symbol: "AVAXUSDT",
    sample_count: 100,
    avg_r: -0.2,
    total_r: -12,
    profit_factor: 0.8,
    max_drawdown_r: 8,
    oos_positive: false,
    cost_stress_positive: false,
    null_control_passed: true,
    null_control_blocked_by: [],
  }, {
    dataset_id: "LINK",
    symbol: "LINKUSDT",
    sample_count: 100,
    avg_r: 0.1,
    total_r: 10,
    profit_factor: 1.4,
    max_drawdown_r: 6,
    oos_positive: true,
    cost_stress_positive: true,
    null_control_passed: true,
    null_control_blocked_by: [],
  }])
  assert.deepEqual(assets.map((asset) => asset.dataset_id), ["SOL", "AVAX"])
  assert.deepEqual(assets[0].reasons, ["max_drawdown_r_above_15"])
  assert.deepEqual(assets[1].reasons, ["total_r_below_minus_10"])
})

test("panel parser requires real dataset identifiers downstream", () => {
  const input = strategyPanelRndInputFromJson({
    funding_bps_per_8h: 1,
    diagnostic_mode: true,
    datasets: [{ dataset_id: "BTC", manifest_path: "/tmp/btc.json" }],
    candidates: [{ candidate_id: "C-1", family: "trend_pullback_v1", params: { side: "long" } }],
  })
  assert.equal(input.datasets[0].datasetId, "BTC")
  assert.equal(input.candidates[0].candidateId, "C-1")
  assert.equal(input.fundingBpsPer8h, 1)
  assert.equal(input.diagnosticMode, true)
})

test("panel parser ignores camel-case contract fields", () => {
  const input = strategyPanelRndInputFromJson({
    panelId: "panel",
    maxHoldBars: 8,
    diagnosticMode: true,
    datasets: [{ datasetId: "BTC", manifestPath: "/tmp/btc.json" }],
    candidates: [{ candidateId: "C-1", parameterCount: 2, params: { side: "long" } }],
  })

  assert.equal(input.panelId, undefined)
  assert.equal(input.maxHoldBars, undefined)
  assert.equal(input.diagnosticMode, false)
  assert.equal(input.datasets[0].datasetId, "")
  assert.equal(input.datasets[0].manifestPath, "")
  assert.equal(input.candidates[0].candidateId, "")
  assert.equal(input.candidates[0].parameterCount, undefined)
})

function writeManifest(dir: string): string {
  let close = 100
  const rows = Array.from({ length: 280 }, (_, index) => {
    const open = close
    close += 0.25 + (index > 220 && index % 8 === 0 ? -3 : 0)
    const timestamp = 1_700_000_000_000 + index * 14_400_000
    return [new Date(timestamp).toISOString(), timestamp, open, Math.max(open, close) + 0.5, Math.min(open, close) - 0.5, close, 1000 + index].join(",")
  })
  writeFileSync(join(dir, "4h.csv"), ["date,timestamp,open,high,low,close,volume", ...rows].join("\n"))
  const path = join(dir, "manifest.json")
  writeFileSync(path, JSON.stringify({ symbol: "TEST", timeframes: { "4h": { file: "4h.csv" } } }))
  return path
}
