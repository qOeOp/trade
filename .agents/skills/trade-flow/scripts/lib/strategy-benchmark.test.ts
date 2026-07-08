import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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
    }))
    const report = runTrendBenchmark({
      datasets,
      horizonBars: [12, 24, 48],
      volatilityBars: 12,
      rebalanceBars: 3,
      feeBps: 1,
      slippageBps: 0,
      fundingBpsPer8h: 0,
      randomTrials: 20,
    }) as { calibrated: boolean; observed: { sharpe: number }; null_control: { p95_sharpe: number; empirical_p_value: number }; datasets: Array<{ data_hash: string }> }

    assert.equal(report.calibrated, true)
    assert.ok(report.observed.sharpe > report.null_control.p95_sharpe)
    assert.ok(report.null_control.empirical_p_value <= 0.05)
    assert.match(report.datasets[0].data_hash, /^[a-f0-9]{64}$/)

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
    datasets: [{ dataset_id: "BTC", manifest_path: "/tmp/btc.json" }],
  })
  assert.equal(input.horizonBars, undefined)
  assert.equal(input.randomTrials, 20)
  assert.throws(() => runTrendBenchmark({ datasets: [] }), /at least three/)
  assert.throws(() => runTrendBenchmark({ datasets: validDatasets(), feeBps: -1, slippageBps: 2 }), /non-negative/)
})

test("calibration suite reports fixed baselines and CLI stays read-only", async () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-calibration-suite-"))
  try {
    const datasets = [0, 17, 41].map((offset, index) => ({
      datasetId: ["BTC", "ETH", "SOL"][index],
      manifestPath: writeRegimeManifest(dir, index, offset),
    }))
    const report = runCalibrationSuite({ datasets, feeBps: 1, slippageBps: 0, fundingBpsPer8h: 0, randomTrials: 20 }) as {
      purpose: string
      harness_hash: string
      components: Record<string, { benchmark_id?: string; purpose?: string }>
      failure_analysis: { findings: Array<{ check_id: string; next_system_action: string }> }
    }
    assert.equal(report.purpose, "rd_pipeline_calibration_only")
    assert.match(report.harness_hash, /^[a-f0-9]{64}$/)
    assert.equal(report.components.buy_and_hold_baseline.benchmark_id, "first_dataset_buy_and_hold_v1")
    assert.equal(report.components.time_series_trend.purpose, "rd_pipeline_calibration_only")
    assert.equal(report.components.cross_sectional_relative_strength.benchmark_id, "cross_sectional_relative_strength_v1")
    assert.ok(report.failure_analysis.findings.some((finding) => finding.check_id === "CAL-SURVIVORSHIP-RISK"))
    assert.ok(report.failure_analysis.findings.every((finding) => finding.next_system_action.length > 0))

    const dbPath = join(dir, "trade.db")
    const cli = await run(["--db", dbPath, "--strategy-calibration-suite", "--json", JSON.stringify({
      datasets: datasets.map((item) => ({ dataset_id: item.datasetId, manifest_path: item.manifestPath })),
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

function writeRegimeManifest(root: string, asset: number, phase: number): string {
  const dir = join(root, String(asset))
  mkdirSync(dir, { recursive: true })
  let close = 100 + asset * 20
  const rows = Array.from({ length: 1_500 }, (_, index) => {
    const regime = Math.floor((index + phase) / 120) % 2 === 0 ? 1 : -1
    const previous = close
    close *= 1 + regime * (0.0015 + asset * 0.0001)
    const timestamp = 1_600_000_000_000 + index * 14_400_000
    return [new Date(timestamp).toISOString(), timestamp, previous, Math.max(previous, close), Math.min(previous, close), close, 1000].join(",")
  })
  writeFileSync(join(dir, "4h.csv"), ["date,timestamp,open,high,low,close,volume", ...rows].join("\n"))
  const manifestPath = join(dir, "manifest.json")
  writeFileSync(manifestPath, JSON.stringify({ symbol: `ASSET${asset}`, timeframes: { "4h": { file: "4h.csv" } } }))
  return manifestPath
}
