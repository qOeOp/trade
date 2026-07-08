import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import { run } from "../main"
import { runCalibrationSuite, runTrendBenchmark, strategyBenchmarkInputFromJson } from "./strategy-benchmark"

test("fixed trend benchmark beats shuffled timing and CLI does not create trade DB", async () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-benchmark-"))
  try {
    const datasets = [0, 17, 41].map((offset, index) => ({
      datasetId: ["BTC", "ETH", "SOL"][index],
      manifestPath: writeRegimeManifest(dir, index, offset),
      indicatorReportPath: writeFundingReport(dir, index, -0.00001 + index * 0.00001),
    }))
    const report = runTrendBenchmark({
      datasets,
      horizonBars: [12, 24, 48],
      volatilityBars: 12,
      rebalanceBars: 3,
      makerFeeBps: 0.2,
      takerFeeBps: 1,
      marketOrderShare: 0.5,
      slippageBps: 0.4,
      fundingBpsPer8h: 0,
      randomTrials: 20,
    }) as { calibrated: boolean; harness_hash: string; observed: { sharpe: number }; null_control: { p95_sharpe: number; empirical_p_value: number; time_shift: unknown; side_flip: unknown; asset_label_shuffle: unknown }; datasets: Array<{ data_hash: string }>; execution_attribution: { cost_model: { effective_fee_bps: number; effective_slippage_bps: number }; total_fee_drag: number; total_slippage_drag: number }; regime_attribution: { buckets: Array<{ bucket: string; sample_count: number }> } }

    assert.equal(report.calibrated, true)
    assert.ok(report.observed.sharpe > report.null_control.p95_sharpe)
    assert.ok(report.null_control.empirical_p_value <= 0.05)
    assert.ok(report.null_control.time_shift)
    assert.ok(report.null_control.side_flip)
    assert.ok(report.null_control.asset_label_shuffle)
    assert.match(report.datasets[0].data_hash, /^[a-f0-9]{64}$/)
    assert.equal(report.execution_attribution.cost_model.effective_fee_bps, 0.6)
    assert.equal(report.execution_attribution.cost_model.effective_slippage_bps, 0.2)
    assert.ok(report.execution_attribution.total_fee_drag > 0)
    assert.ok(report.execution_attribution.total_slippage_drag > 0)
    assert.deepEqual(report.regime_attribution.buckets.map((item) => item.bucket), ["trend_up", "trend_down", "volatility_high", "volatility_low"])
    assert.ok(report.regime_attribution.buckets.every((item) => item.sample_count >= 0))
    assert.equal(report.harness_hash, expectedBenchmarkHarnessHash())

    const dbPath = join(dir, "trade.db")
    const cli = await run(["--db", dbPath, "--strategy-benchmark", "--json", JSON.stringify({
      datasets: datasets.map((item) => ({ dataset_id: item.datasetId, manifest_path: item.manifestPath })),
      horizon_bars: [12, 24, 48], volatility_bars: 12, rebalance_bars: 3,
      fee_bps: 1, slippage_bps: 0, funding_bps_per_8h: 0, random_trials: 20,
    })])
    assert.equal(cli.ok, true)
    assert.equal(existsSync(dbPath), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("benchmark parser keeps the public definition fixed", () => {
  const input = strategyBenchmarkInputFromJson({
    horizon_bars: [12, 24, 48],
    random_trials: 20,
    maker_fee_bps: 0.2,
    taker_fee_bps: 1,
    market_order_share: 0.5,
    datasets: [{ dataset_id: "BTC", manifest_path: "/tmp/btc.json" }],
  })
  assert.equal(input.horizonBars, undefined)
  assert.equal(input.randomTrials, 20)
  assert.equal(input.makerFeeBps, 0.2)
  assert.equal(input.takerFeeBps, 1)
  assert.equal(input.marketOrderShare, 0.5)
  assert.throws(() => runTrendBenchmark({ datasets: [] }), /at least three/)
  assert.throws(() => runTrendBenchmark({ datasets: validDatasets(), feeBps: -1, slippageBps: 2 }), /non-negative/)
  assert.throws(() => runTrendBenchmark({ datasets: validDatasets(), marketOrderShare: 1.5 }), /between 0 and 1/)
})

test("calibration suite reports fixed baselines and CLI stays read-only", async () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-calibration-suite-"))
  try {
    const datasets = [0, 17, 41].map((offset, index) => ({
      datasetId: ["BTC", "ETH", "SOL"][index],
      manifestPath: writeRegimeManifest(dir, index, offset),
      indicatorReportPath: writeFundingReport(dir, index, -0.00001 + index * 0.00001),
    }))
    const report = runCalibrationSuite({ datasets, feeBps: 1, slippageBps: 0, fundingBpsPer8h: 0, randomTrials: 20 }) as {
      purpose: string
      harness_hash: string
      report_hash: string
      previous_run_comparison: unknown
      data_panel: { dataset_count: number; schema_version_ok: boolean; closed_candles_only: boolean; min_aligned_ratio: number }
      components: Record<string, { benchmark_id?: string; purpose?: string; execution_attribution?: { average_turnover_per_rebalance: number; total_fee_drag: number; total_slippage_drag: number }; funding_stress_attribution?: { total_funding_drag: number }; funding_event_coverage?: { status: string }; historical_funding?: unknown; regime_attribution?: { buckets: Array<{ bucket: string }> } }>
      failure_analysis: { findings: Array<{ check_id: string; next_system_action: string }> }
    }
    assert.equal(report.purpose, "rd_pipeline_calibration_only")
    assert.match(report.harness_hash, /^[a-f0-9]{64}$/)
    assert.match(report.report_hash, /^[a-f0-9]{64}$/)
    assert.equal(report.previous_run_comparison, null)
    assert.equal(report.data_panel.dataset_count, 3)
    assert.equal(report.data_panel.schema_version_ok, true)
    assert.equal(report.data_panel.closed_candles_only, true)
    assert.equal(report.data_panel.min_aligned_ratio, 1)
    assert.equal(report.components.buy_and_hold_baseline.benchmark_id, "first_dataset_buy_and_hold_v1")
    assert.equal(report.components.time_series_trend.purpose, "rd_pipeline_calibration_only")
    assert.equal(report.components.cross_sectional_relative_strength.benchmark_id, "cross_sectional_relative_strength_v1")
    assert.equal(report.components.time_series_trend.regime_attribution?.buckets.length, 4)
    assert.ok((report.components.time_series_trend.execution_attribution?.average_turnover_per_rebalance ?? -1) >= 0)
    assert.ok((report.components.time_series_trend.execution_attribution?.total_fee_drag ?? -1) >= 0)
    assert.ok((report.components.time_series_trend.execution_attribution?.total_slippage_drag ?? -1) >= 0)
    assert.ok((report.components.time_series_trend.funding_stress_attribution?.total_funding_drag ?? -1) >= 0)
    assert.equal(report.components.time_series_trend.funding_event_coverage?.status, "full")
    assert.notEqual(report.components.time_series_trend.historical_funding, null)
    assert.ok(report.failure_analysis.findings.some((finding) => finding.check_id === "CAL-SURVIVORSHIP-RISK"))
    assert.ok(report.failure_analysis.findings.every((finding) => finding.next_system_action.length > 0))

    const previousPath = join(dir, "previous-calibration.json")
    writeFileSync(previousPath, JSON.stringify(report))
    const compared = runCalibrationSuite({ datasets, feeBps: 1, slippageBps: 0, fundingBpsPer8h: 0, randomTrials: 20, previousCalibrationReportPath: previousPath }) as {
      report_hash: string
      previous_run_comparison: { previous_report_hash: string; current_report_hash: string; blocker_count_delta: number; harness_changed: boolean; data_panel_changed: boolean }
    }
    assert.equal(compared.previous_run_comparison.previous_report_hash, report.report_hash)
    assert.equal(compared.previous_run_comparison.current_report_hash, compared.report_hash)
    assert.equal(compared.previous_run_comparison.blocker_count_delta, 0)
    assert.equal(compared.previous_run_comparison.harness_changed, false)
    assert.equal(compared.previous_run_comparison.data_panel_changed, false)

    const dbPath = join(dir, "trade.db")
    const cli = await run(["--db", dbPath, "--strategy-calibration-suite", "--json", JSON.stringify({
      datasets: datasets.map((item) => ({ dataset_id: item.datasetId, manifest_path: item.manifestPath, indicator_report_path: item.indicatorReportPath })),
      fee_bps: 1, slippage_bps: 0, funding_bps_per_8h: 0, random_trials: 20,
    })])
    assert.equal(cli.ok, true)
    assert.equal(existsSync(dbPath), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function validDatasets() {
  return [
    { datasetId: "BTC", manifestPath: "/tmp/btc.json" },
    { datasetId: "ETH", manifestPath: "/tmp/eth.json" },
    { datasetId: "SOL", manifestPath: "/tmp/sol.json" },
  ]
}

test("calibration suite flags partial funding coverage instead of using it", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-calibration-funding-"))
  try {
    const datasets = [0, 17, 41].map((offset, index) => ({
      datasetId: ["BTC", "ETH", "SOL"][index],
      manifestPath: writeRegimeManifest(dir, index, offset),
      indicatorReportPath: index === 0 ? writeFundingReport(dir, index, 0.00001, 20) : undefined,
    }))
    const report = runCalibrationSuite({ datasets, feeBps: 1, slippageBps: 0, fundingBpsPer8h: 0, randomTrials: 20 }) as {
      components: Record<string, { funding_event_coverage?: { status: string }; historical_funding?: unknown }>
      failure_analysis: { findings: Array<{ check_id: string }> }
    }
    assert.equal(report.components.time_series_trend.funding_event_coverage?.status, "partial")
    assert.equal(report.components.time_series_trend.historical_funding, null)
    assert.ok(report.failure_analysis.findings.some((finding) => finding.check_id === "CAL-FUNDING-COVERAGE"))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("calibration panel alignment ignores history before common listing window", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-calibration-alignment-"))
  try {
    const datasets = [
      { datasetId: "OLD1", manifestPath: writeRegimeManifest(dir, 0, 0) },
      { datasetId: "OLD2", manifestPath: writeRegimeManifest(dir, 1, 17) },
      { datasetId: "LATE", manifestPath: writeRegimeManifest(dir, 2, 41, 300, 1200) },
    ]
    const report = runCalibrationSuite({ datasets, horizonBars: [12, 24, 48], volatilityBars: 12, rebalanceBars: 3, feeBps: 1, slippageBps: 0, fundingBpsPer8h: 0, randomTrials: 20 }) as {
      data_panel: { aligned_rows: number; min_aligned_ratio: number }
      failure_analysis: { findings: Array<{ check_id: string }> }
    }
    assert.equal(report.data_panel.aligned_rows, 1200)
    assert.equal(report.data_panel.min_aligned_ratio, 1)
    assert.equal(report.failure_analysis.findings.some((finding) => finding.check_id === "CAL-PANEL-ALIGNMENT"), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function writeRegimeManifest(root: string, asset: number, phase: number, startIndex = 0, length = 1_500): string {
  const dir = join(root, String(asset))
  mkdirSync(dir, { recursive: true })
  let close = 100 + asset * 20
  const rows = Array.from({ length }, (_, index) => {
    const actualIndex = startIndex + index
    const regime = Math.floor((actualIndex + phase) / 120) % 2 === 0 ? 1 : -1
    const previous = close
    close *= 1 + regime * (0.0015 + asset * 0.0001)
    const timestamp = 1_600_000_000_000 + actualIndex * 14_400_000
    return [new Date(timestamp).toISOString(), timestamp, previous, Math.max(previous, close), Math.min(previous, close), close, 1000].join(",")
  })
  const csv = ["date,timestamp,open,high,low,close,volume", ...rows].join("\n")
  writeFileSync(join(dir, "4h.csv"), csv)
  const manifestPath = join(dir, "manifest.json")
  writeFileSync(manifestPath, JSON.stringify({
    schema_version: 2,
    source: { provider: "test", market: "synthetic" },
    closed_candles_only: true,
    symbol: `ASSET${asset}`,
    timeframes: { "4h": { file: "4h.csv", content_sha256: createHash("sha256").update(csv).digest("hex") } },
  }))
  return manifestPath
}

function writeFundingReport(root: string, asset: number, rate: number, count = 750): string {
  const dir = join(root, String(asset))
  mkdirSync(dir, { recursive: true })
  const events = Array.from({ length: count }, (_, index) => ({
    timestamp: new Date(1_600_000_000_000 + index * 28_800_000).toISOString(),
    value: rate,
  }))
  const path = join(dir, "factors.json")
  writeFileSync(path, JSON.stringify({ data: { market_events: { funding: events } } }))
  return path
}

function expectedBenchmarkHarnessHash(): string {
  const files = [
    "strategy-benchmark.ts",
    "strategy-benchmark-inputs.ts",
    "strategy-benchmark-data.ts",
    "strategy-benchmark-simulation.ts",
    "strategy-calibration-report.ts",
  ]
  const hash = createHash("sha256")
  for (const file of files.sort()) {
    hash.update(file)
    hash.update("\n")
    hash.update(readFileSync(new URL(file, import.meta.url)))
    hash.update("\n")
  }
  return hash.digest("hex")
}
