import assert from "node:assert/strict"
import test from "node:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join } from "node:path"
import { DEFAULT_SYMBOLS, parseArgs, runCalibrationPanel } from "./calibration-panel"

test("calibration panel parser defaults to 20 symbols", () => {
  const config = parseArgs([])
  assert.equal(config.symbols.length, 20)
  assert.deepEqual(config.symbols, DEFAULT_SYMBOLS)
  assert.equal(config.timeframe, "4h")
  assert.equal(config.sinceTS, Date.UTC(2021, 0, 1))
})

test("calibration panel writes trade-flow suite input from fetched manifests", async () => {
  const dir = mkdtempSync(join(tmpdir(), "calibration-panel-"))
  const fundingRoot = join(dir, "funding")
  mkdirSync(join(fundingRoot, "btcusdt"), { recursive: true })
  writeFileSync(join(fundingRoot, "btcusdt", "market-features.json"), JSON.stringify({ data: { market_events: { funding: [] } } }))
  const calls: string[][] = []

  const result = await runCalibrationPanel([
    "--symbols", "BTCUSDT,ETHUSDT",
    "--output-root", join(dir, "panel"),
    "--funding-report-root", fundingRoot,
    "--maker-fee-bps", "2",
    "--taker-fee-bps", "5",
    "--market-order-share", "1",
    "--slippage-bps", "2",
    "--funding-bps-per-8h", "1",
    "--random-trials", "20",
  ], async (argv) => {
    calls.push(argv)
    const outputDir = argv[argv.indexOf("--output-dir") + 1]
    const symbol = argv[argv.indexOf("--symbol") + 1]
    writeFileSync(join(outputDir, "manifest.json"), JSON.stringify({
      schema_version: 2,
      closed_candles_only: true,
      source: { provider: "binance", market: "usdm_perpetual" },
      symbol,
      timeframes: { "4h": { rows: 12000, first_open_ts: 1609459200000, last_open_ts: 1782259200000, content_sha256: "abc" } },
    }))
    return { ok: true, data: {} }
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.data.dataset_count, 2)
  assert.equal(isAbsolute(String(result.data.output_root)), false)
  assert.equal(isAbsolute(String(result.data.suite_input_path)), false)
  assert.equal(isAbsolute(String(result.data.panel_manifest_path)), false)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].includes("--since-ts"), true)
  assert.equal(isAbsolute(calls[0][calls[0].indexOf("--output-dir") + 1]), false)
  const suite = JSON.parse(readFileSync(String(result.data.suite_input_path), "utf8")) as {
    datasets: Array<{ dataset_id: string; manifest_path: string; indicator_report_path?: string }>
    maker_fee_bps: number
    taker_fee_bps: number
    market_order_share: number
    slippage_bps: number
    funding_bps_per_8h: number
    random_trials: number
  }
  assert.deepEqual(suite.datasets.map((item) => item.dataset_id), ["BTCUSDT", "ETHUSDT"])
  assert.equal(suite.datasets.every((item) => !isAbsolute(item.manifest_path)), true)
  assert.match(suite.datasets[0].indicator_report_path || "", /market-features\.json$/)
  assert.equal(isAbsolute(suite.datasets[0].indicator_report_path || ""), false)
  assert.equal(suite.datasets[1].indicator_report_path, undefined)
  assert.equal(suite.maker_fee_bps, 2)
  assert.equal(suite.taker_fee_bps, 5)
  assert.equal(suite.market_order_share, 1)
  assert.equal(suite.slippage_bps, 2)
  assert.equal(suite.funding_bps_per_8h, 1)
  assert.equal(suite.random_trials, 20)

  const panel = JSON.parse(readFileSync(String(result.data.panel_manifest_path), "utf8")) as {
    suite_input_path: string
    survivor_only: boolean
    inactive_dataset_count: number
    datasets: Array<{ manifest_available: boolean; rows: number; manifest_path: string; funding_report_path: string | null }>
  }
  assert.equal(isAbsolute(panel.suite_input_path), false)
  assert.equal(panel.survivor_only, true)
  assert.equal(panel.inactive_dataset_count, 0)
  assert.equal(panel.datasets.every((item) => !isAbsolute(item.manifest_path)), true)
  assert.equal(isAbsolute(panel.datasets[0].funding_report_path || ""), false)
  assert.equal(panel.datasets[0].manifest_available, true)
  assert.equal(panel.datasets[0].rows, 12000)
})

test("calibration panel can include external inactive manifests", async () => {
  const dir = mkdtempSync(join(tmpdir(), "calibration-panel-inactive-"))
  const inactiveDir = join(dir, "inactive")
  mkdirSync(inactiveDir, { recursive: true })
  const inactiveManifestPath = join(inactiveDir, "lunausdt-manifest.json")
  writeFileSync(inactiveManifestPath, JSON.stringify({
    schema_version: 2,
    closed_candles_only: true,
    source: { provider: "archive", market: "usdm_perpetual" },
    symbol: "LUNAUSDT",
    timeframes: { "4h": { rows: 5000, first_open_ts: 1609459200000, last_open_ts: 1654041600000, content_sha256: "def" } },
  }))
  const inactiveMapPath = join(dir, "inactive-map.json")
  writeFileSync(inactiveMapPath, JSON.stringify({
    datasets: [{
      dataset_id: "LUNAUSDT",
      symbol: "LUNAUSDT",
      symbol_status: "delisted",
      manifest_path: inactiveManifestPath,
      delisted_at: "2022-05-12T00:00:00Z",
    }],
  }))

  const result = await runCalibrationPanel([
    "--symbols", "BTCUSDT",
    "--output-root", join(dir, "panel"),
    "--inactive-manifest-map", inactiveMapPath,
  ], async (argv) => {
    const outputDir = argv[argv.indexOf("--output-dir") + 1]
    const symbol = argv[argv.indexOf("--symbol") + 1]
    writeFileSync(join(outputDir, "manifest.json"), JSON.stringify({
      schema_version: 2,
      closed_candles_only: true,
      source: { provider: "binance", market: "usdm_perpetual" },
      symbol,
      timeframes: { "4h": { rows: 12000, first_open_ts: 1609459200000, last_open_ts: 1782259200000, content_sha256: "abc" } },
    }))
    return { ok: true, data: {} }
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.data.dataset_count, 2)
  const suite = JSON.parse(readFileSync(String(result.data.suite_input_path), "utf8")) as { datasets: Array<{ dataset_id: string; symbol_status: string; manifest_path: string }> }
  assert.deepEqual(suite.datasets.map((item) => item.dataset_id), ["BTCUSDT", "LUNAUSDT"])
  assert.deepEqual(suite.datasets.map((item) => item.symbol_status), ["active", "delisted"])
  assert.equal(suite.datasets.every((item) => !isAbsolute(item.manifest_path)), true)

  const panel = JSON.parse(readFileSync(String(result.data.panel_manifest_path), "utf8")) as {
    survivor_only: boolean
    active_dataset_count: number
    delisted_dataset_count: number
    datasets: Array<{ dataset_id: string; symbol_status: string; manifest_available: boolean; rows: number }>
  }
  assert.equal(panel.survivor_only, false)
  assert.equal(panel.active_dataset_count, 1)
  assert.equal(panel.delisted_dataset_count, 1)
  assert.deepEqual(panel.datasets.map((item) => item.symbol_status), ["active", "delisted"])
  assert.equal(panel.datasets[1].manifest_available, true)
  assert.equal(panel.datasets[1].rows, 5000)
})
