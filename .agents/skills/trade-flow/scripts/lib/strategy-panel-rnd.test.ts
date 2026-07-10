import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import { catastrophicAssetsFrom, runStrategyPanelRnd, strategyPanelRndInputFromJson } from "./strategy-panel-rnd"
import { resolveRepoPath } from "./paths"

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
    const candidate = (report.candidates as Array<{ negative_controls: { method: string; asset_count: number }; panel_negative_controls: { status: string; passed: boolean }; assets: Array<{ negative_control_passed: boolean }> }>)[0]
    assert.equal(candidate.negative_controls.method, "per_asset_candidate_negative_controls")
    assert.equal(candidate.negative_controls.asset_count, 3)
    assert.equal(candidate.panel_negative_controls.status, "not_applicable")
    assert.equal(candidate.panel_negative_controls.passed, false)
    assert.equal(candidate.assets.every((asset) => typeof asset.negative_control_passed === "boolean"), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("panel R&D evaluates cross-candidate asset shuffle negative control", () => {
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
      panel_negative_controls: { status: string; passed: boolean; p95_total_r: number }
      gate: { blocked_by: Array<{ check_id: string }> }
    }>
    const long = candidates.find((candidate) => candidate.candidate_id === "PANEL-LONG")
    const short = candidates.find((candidate) => candidate.candidate_id === "PANEL-SHORT")
    assert.equal(long?.panel_negative_controls.status, "evaluated")
    assert.equal(typeof long?.panel_negative_controls.p95_total_r, "number")
    assert.equal(short?.panel_negative_controls.status, "evaluated")
    assert.equal(long?.panel_negative_controls.passed, false)
    assert.equal(long?.gate.blocked_by.some((item) => item.check_id === "PANEL-ASSET-SHUFFLE"), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("panel R&D can evaluate true cross-sectional momentum at panel level", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-panel-rnd-xs-"))
  try {
    const report = runStrategyPanelRnd({
      panelId: "panel-cross-sectional-test",
      datasets: [
        { datasetId: "BTC", manifestPath: writeManifestWithDrift(join(dir, "btc"), "BTCUSDT", 0.7) },
        { datasetId: "ETH", manifestPath: writeManifestWithDrift(join(dir, "eth"), "ETHUSDT", 0.1) },
        { datasetId: "SOL", manifestPath: writeManifestWithDrift(join(dir, "sol"), "SOLUSDT", -0.2) },
      ],
      candidates: [{
        candidateId: "XS-MOM",
        family: "cross_sectional_momentum_v1",
        params: { lookback_bars: 10, hold_bars: 1, top_n: 1, risk_pct: 0.05 },
      }],
    })
    const candidate = (report.candidates as Array<{
      family: string
      pooled: { sample_count: number; total_r: number }
      panel_negative_controls: { method: string; status: string; observed_total_r: number }
      gate: { blocked_by: Array<{ check_id: string }> }
      assets: Array<{ dataset_id: string; sample_count: number; total_r: number }>
    }>)[0]
    assert.equal(candidate.family, "cross_sectional_momentum_v1")
    assert.ok(candidate.pooled.sample_count > 100)
    assert.ok(candidate.pooled.total_r > 0)
    assert.equal(candidate.panel_negative_controls.method, "cross_sectional_rank_shift_v1")
    assert.equal(candidate.panel_negative_controls.status, "evaluated")
    assert.equal(candidate.assets.find((asset) => asset.dataset_id === "BTC")!.sample_count, candidate.pooled.sample_count)
    assert.equal(candidate.assets.find((asset) => asset.dataset_id === "SOL")!.sample_count, 0)
    assert.equal(candidate.gate.blocked_by.some((item) => item.check_id === "PANEL-RANK-SHIFT"), false)
    assert.equal(candidate.gate.blocked_by.some((item) => item.check_id === "PANEL-BREADTH"), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("panel R&D scores marketability as a non-trading family", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-panel-rnd-marketability-"))
  try {
    const report = runStrategyPanelRnd({
      panelId: "panel-marketability-test",
      datasets: [
        { datasetId: "BTC", manifestPath: writeMarketabilityManifest(join(dir, "btc"), "BTCUSDT", 100, 100_000, 0.003) },
        { datasetId: "ETH", manifestPath: writeMarketabilityManifest(join(dir, "eth"), "ETHUSDT", 80, 80_000, 0.004) },
        { datasetId: "MICRO", manifestPath: writeMarketabilityManifest(join(dir, "micro"), "MICROUSDT", 1, 500, 0.08) },
      ],
      candidates: [{
        candidateId: "MKT-SCORE",
        family: "marketability_score_v1",
        params: {
          min_rows: 200,
          min_median_quote_volume: 1_000_000,
          max_impact_proxy_bps: 500,
          min_score: 60,
        },
      }],
    })
    const candidate = (report.candidates as Array<{
      family: string
      pooled: { positive_assets: number; avg_r: number }
      marketability: { score_avg: number; passed_assets: number; required_passed_assets: number }
      gate: { accepted: boolean; blocked_by: Array<{ check_id: string }> }
      assets: Array<{ dataset_id: string; marketability: { passed: boolean; blocked_by: string[]; median_quote_volume: number; impact_proxy_bps: number } }>
    }>)[0]
    assert.equal(candidate.family, "marketability_score_v1")
    assert.equal(candidate.gate.accepted, false)
    assert.equal(candidate.gate.blocked_by.some((item) => item.check_id === "PANEL-NON-TRADING-FAMILY"), true)
    assert.equal(candidate.gate.blocked_by.some((item) => item.check_id === "PANEL-MARKETABILITY"), true)
    assert.equal(candidate.marketability.passed_assets, 2)
    assert.equal(candidate.marketability.required_passed_assets, 3)
    assert.ok(candidate.pooled.avg_r > 0)
    const micro = candidate.assets.find((asset) => asset.dataset_id === "MICRO")
    assert.equal(micro?.marketability.passed, false)
    assert.ok(micro?.marketability.blocked_by.includes("MARKETABILITY-QUOTE-VOLUME"))
    assert.ok(Number(micro?.marketability.impact_proxy_bps) > 500)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("panel R&D applies marketability gate before cross-sectional universe selection", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-panel-rnd-marketability-gate-"))
  try {
    const report = runStrategyPanelRnd({
      panelId: "panel-marketability-gated-xs-test",
      marketabilityGate: {
        enabled: true,
        minRows: 200,
        selectionBars: 200,
        minMedianQuoteVolume: 1_000_000,
        maxImpactProxyBps: 500,
        minScore: 60,
        minAssets: 3,
      },
      datasets: [
        { datasetId: "BTC", manifestPath: writeMarketabilityManifest(join(dir, "btc"), "BTCUSDT", 100, 100_000, 0.003) },
        { datasetId: "ETH", manifestPath: writeMarketabilityManifest(join(dir, "eth"), "ETHUSDT", 80, 80_000, 0.004) },
        { datasetId: "SOL", manifestPath: writeMarketabilityManifest(join(dir, "sol"), "SOLUSDT", 50, 70_000, 0.004) },
        { datasetId: "MICRO", manifestPath: writeMarketabilityManifest(join(dir, "micro"), "MICROUSDT", 1, 500, 0.08) },
      ],
      candidates: [{
        candidateId: "XS-GATED",
        family: "cross_sectional_momentum_v1",
        params: { lookback_bars: 10, hold_bars: 2, top_n: 1, risk_pct: 0.05 },
      }],
    })
    const universe = report.universe_selection as {
      applied: boolean
      status: string
      temporal_contract: string
      selection_bars: number
      selected_dataset_count: number
      selected_assets: Array<{ dataset_id: string; selection_last_open: string | null }>
      excluded_assets: Array<{ dataset_id: string; selection_reason: string }>
    }
    const candidate = (report.candidates as Array<{
      pooled: { asset_count: number }
      assets: Array<{ dataset_id: string }>
    }>)[0]
    assert.equal(universe.applied, true)
    assert.equal(universe.status, "passed")
    assert.equal(universe.temporal_contract, "prefix_selection_window_only")
    assert.equal(universe.selection_bars, 200)
    assert.equal(report.dataset_count, 4)
    assert.equal(report.selected_dataset_count, 3)
    assert.deepEqual(universe.selected_assets.map((asset) => asset.dataset_id).sort(), ["BTC", "ETH", "SOL"])
    assert.deepEqual(universe.excluded_assets.map((asset) => asset.dataset_id), ["MICRO"])
    assert.equal(universe.excluded_assets[0].selection_reason, "failed_gate")
    assert.equal(candidate.pooled.asset_count, 3)
    assert.equal(candidate.assets.some((asset) => asset.dataset_id === "MICRO"), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("panel R&D diagnostic mode skips expensive negative controls and cannot promote", () => {
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
      panel_negative_controls: { status: string }
    }>)[0]
    assert.equal(report.outcome, "diagnostic_only")
    assert.equal(candidate.gate.accepted, false)
    assert.equal(candidate.gate.blocked_by.some((item) => item.check_id === "PANEL-DIAGNOSTIC-ONLY"), true)
    assert.equal(candidate.panel_negative_controls.status, "diagnostic_skipped")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("panel R&D resolves legacy data panel paths to tmp panels", () => {
  const panelRoot = resolveRepoPath("tmp/panels/validation-panel-path-fallback-test")
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
    negative_control_passed: true,
    negative_control_blocked_by: [],
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
    negative_control_passed: true,
    negative_control_blocked_by: [],
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
    negative_control_passed: true,
    negative_control_blocked_by: [],
  }])
  assert.deepEqual(assets.map((asset) => asset.dataset_id), ["SOL", "AVAX"])
  assert.deepEqual(assets[0].reasons, ["max_drawdown_r_above_15"])
  assert.deepEqual(assets[1].reasons, ["total_r_below_minus_10"])
})

test("panel parser requires real dataset identifiers downstream", () => {
  const input = strategyPanelRndInputFromJson({
    funding_bps_per_8h: 1,
    diagnostic_mode: true,
    marketability_gate: {
      enabled: true,
      min_rows: 200,
      selection_bars: 200,
      min_assets: 3,
    },
    datasets: [{ dataset_id: "BTC", manifest_path: "/tmp/btc.json" }],
    candidates: [{ candidate_id: "C-1", family: "trend_pullback_v1", params: { side: "long" } }],
  })
  assert.equal(input.datasets[0].datasetId, "BTC")
  assert.equal(input.candidates[0].candidateId, "C-1")
  assert.equal(input.fundingBpsPer8h, 1)
  assert.equal(input.diagnosticMode, true)
  assert.equal(input.marketabilityGate?.enabled, true)
  assert.equal(input.marketabilityGate?.minRows, 200)
  assert.equal(input.marketabilityGate?.selectionBars, 200)
  assert.equal(input.marketabilityGate?.minAssets, 3)
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
  mkdirSync(dir, { recursive: true })
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

function writeManifestWithDrift(dir: string, symbol: string, drift: number): string {
  mkdirSync(dir, { recursive: true })
  let close = 100
  const rows = Array.from({ length: 280 }, (_, index) => {
    const open = close
    close = Math.max(1, close + drift + Math.sin(index / 9) * 0.05)
    const timestamp = 1_700_000_000_000 + index * 14_400_000
    return [new Date(timestamp).toISOString(), timestamp, open, Math.max(open, close) + 0.2, Math.min(open, close) - 0.2, close, 1000 + index].join(",")
  })
  writeFileSync(join(dir, "4h.csv"), ["date,timestamp,open,high,low,close,volume", ...rows].join("\n"))
  const path = join(dir, "manifest.json")
  writeFileSync(path, JSON.stringify({ symbol, timeframes: { "4h": { file: "4h.csv" } } }))
  return path
}

function writeMarketabilityManifest(dir: string, symbol: string, price: number, volume: number, rangePct: number): string {
  mkdirSync(dir, { recursive: true })
  const rows = Array.from({ length: 260 }, (_, index) => {
    const drift = Math.sin(index / 13) * price * 0.0005
    const close = price + drift
    const open = price + Math.sin(index / 17) * price * 0.0005
    const halfRange = close * rangePct / 2
    const timestamp = 1_700_000_000_000 + index * 14_400_000
    return [new Date(timestamp).toISOString(), timestamp, open, close + halfRange, Math.max(0.0001, close - halfRange), close, volume].join(",")
  })
  writeFileSync(join(dir, "4h.csv"), ["date,timestamp,open,high,low,close,volume", ...rows].join("\n"))
  const path = join(dir, "manifest.json")
  writeFileSync(path, JSON.stringify({ symbol, timeframes: { "4h": { file: "4h.csv" } } }))
  return path
}
