#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { run as fetchOhlcv } from "./main"

type JSONRecord = Record<string, unknown>
type Fetcher = (argv: string[]) => Promise<{ ok: boolean; data?: unknown; error?: string }>

interface Config {
  symbols: string[]
  outputRoot: string
  timeframe: string
  sinceTS: number
  limit: number
  dryRun: boolean
  fundingReportRoot: string
  previousCalibrationReportPath: string
  randomTrials: number
  makerFeeBps?: number
  takerFeeBps?: number
  marketOrderShare?: number
  slippageBps?: number
  fundingBpsPer8h?: number
}

const DEFAULT_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
  "ADAUSDT", "DOGEUSDT", "TRXUSDT", "LINKUSDT", "BCHUSDT",
  "LTCUSDT", "ETCUSDT", "ATOMUSDT", "FILUSDT", "AAVEUSDT",
  "UNIUSDT", "DOTUSDT", "AVAXUSDT", "NEARUSDT", "APTUSDT",
]

async function runCalibrationPanel(argv: string[], fetcher: Fetcher = fetchOhlcv): Promise<{ ok: true; data: JSONRecord } | { ok: false; error: string }> {
  try {
    const config = parseArgs(argv)
    const outputRoot = resolve(config.outputRoot)
    mkdirSync(outputRoot, { recursive: true })
    const datasets: JSONRecord[] = []
    const panelDatasets: JSONRecord[] = []

    for (const symbol of config.symbols) {
      const datasetID = symbolId(symbol)
      const outputDir = join(outputRoot, datasetID.toLowerCase())
      const manifestPath = join(outputDir, "manifest.json")
      mkdirSync(outputDir, { recursive: true })
      if (!config.dryRun) {
        const result = await fetcher([
          "--symbol", symbol,
          "--timeframes", config.timeframe,
          "--output-dir", outputDir,
          "--limit", String(config.limit),
          "--since-ts", String(config.sinceTS),
        ])
        if (!result.ok) throw new Error(`${symbol} OHLCV fetch failed: ${result.error || "unknown error"}`)
      }
      const fundingReport = findFundingReport(config.fundingReportRoot, datasetID)
      datasets.push({
        dataset_id: datasetID,
        manifest_path: manifestPath,
        ...(fundingReport ? { indicator_report_path: fundingReport } : {}),
      })
      panelDatasets.push({
        dataset_id: datasetID,
        symbol,
        manifest_path: manifestPath,
        funding_report_path: fundingReport || null,
        ...manifestSummary(manifestPath, config.timeframe),
      })
    }

    const suiteInput = {
      datasets,
      timeframe: config.timeframe,
      random_trials: config.randomTrials,
      ...(config.previousCalibrationReportPath ? { previous_calibration_report_path: resolve(config.previousCalibrationReportPath) } : {}),
      ...(config.makerFeeBps !== undefined ? { maker_fee_bps: config.makerFeeBps } : {}),
      ...(config.takerFeeBps !== undefined ? { taker_fee_bps: config.takerFeeBps } : {}),
      ...(config.marketOrderShare !== undefined ? { market_order_share: config.marketOrderShare } : {}),
      ...(config.slippageBps !== undefined ? { slippage_bps: config.slippageBps } : {}),
      ...(config.fundingBpsPer8h !== undefined ? { funding_bps_per_8h: config.fundingBpsPer8h } : {}),
    }
    const suiteInputPath = join(outputRoot, "calibration-suite-input.json")
    const panelManifestPath = join(outputRoot, "panel-manifest.json")
    writeFileSync(suiteInputPath, `${JSON.stringify(suiteInput, null, 2)}\n`)
    writeFileSync(panelManifestPath, `${JSON.stringify({
      schema_version: 1,
      generated_at: new Date().toISOString(),
      purpose: "trade_flow_calibration_panel_input",
      target_dataset_count: 20,
      symbol_count: config.symbols.length,
      timeframe: config.timeframe,
      since_ts: config.sinceTS,
      suite_input_path: suiteInputPath,
      datasets: panelDatasets,
    }, null, 2)}\n`)

    return { ok: true, data: { output_root: outputRoot, suite_input_path: suiteInputPath, panel_manifest_path: panelManifestPath, dataset_count: datasets.length } }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function parseArgs(argv: string[]): Config {
  const values = new Map<string, string>()
  const flags = new Set<string>()
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key === "--dry-run") { flags.add(key); continue }
    if (!key.startsWith("--")) throw new Error(`unexpected argument: ${key}`)
    const value = argv[index + 1]
    if (!value || value.startsWith("--")) throw new Error(`${key} requires a value`)
    values.set(key, value)
    index += 1
  }
  const symbols = (values.get("--symbols") || DEFAULT_SYMBOLS.join(",")).split(",").map((item) => item.trim().toUpperCase()).filter(Boolean)
  if (symbols.length === 0) throw new Error("--symbols cannot be empty")
  return {
    symbols,
    outputRoot: values.get("--output-root") || "./data/calibration-panel",
    timeframe: values.get("--timeframe") || "4h",
    sinceTS: numberValue(values, "--since-ts", Date.UTC(2021, 0, 1)),
    limit: numberValue(values, "--limit", 12_000),
    dryRun: flags.has("--dry-run"),
    fundingReportRoot: values.get("--funding-report-root") || "",
    previousCalibrationReportPath: values.get("--previous-calibration-report-path") || "",
    randomTrials: numberValue(values, "--random-trials", 100),
    makerFeeBps: optionalNumber(values.get("--maker-fee-bps")),
    takerFeeBps: optionalNumber(values.get("--taker-fee-bps")),
    marketOrderShare: optionalNumber(values.get("--market-order-share")),
    slippageBps: optionalNumber(values.get("--slippage-bps")),
    fundingBpsPer8h: optionalNumber(values.get("--funding-bps-per-8h")),
  }
}

function manifestSummary(path: string, timeframe: string): JSONRecord {
  if (!existsSync(path)) return { manifest_available: false }
  const manifest = JSON.parse(readFileSync(path, "utf8")) as JSONRecord
  const entry = asRecord(asRecord(manifest.timeframes)[timeframe])
  return {
    manifest_available: true,
    schema_version: Number(manifest.schema_version) || 0,
    closed_candles_only: manifest.closed_candles_only === true,
    rows: Number(entry.rows) || 0,
    first_open_ts: Number(entry.first_open_ts) || 0,
    last_open_ts: Number(entry.last_open_ts) || 0,
    source: asRecord(manifest.source),
  }
}

function findFundingReport(root: string, datasetID: string): string | null {
  if (!root) return null
  const dir = join(resolve(root), datasetID.toLowerCase())
  for (const name of ["market-features.json", "factor-report.json", "factors.json"]) {
    const path = join(dir, name)
    if (existsSync(path)) return path
  }
  return null
}

function symbolId(symbol: string): string {
  return symbol.toUpperCase().replace(/[:/]/g, "").replace(/USDTUSDT$/, "USDT")
}

function numberValue(values: Map<string, string>, key: string, fallback: number): number {
  const value = values.get(key)
  const number = value === undefined ? fallback : Number(value)
  if (!Number.isFinite(number) || number < 0) throw new Error(`${key} must be a non-negative number`)
  return number
}

function optionalNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new Error("numeric options must be non-negative")
  return number
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

if (import.meta.main) {
  runCalibrationPanel(process.argv.slice(2)).then((result) => {
    const stream = result.ok ? process.stdout : process.stderr
    stream.write(`${JSON.stringify(result, null, 2)}\n`)
    if (!result.ok) process.exit(1)
  })
}

export { DEFAULT_SYMBOLS, parseArgs, runCalibrationPanel }
