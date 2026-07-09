#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
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
  inactiveManifestMapPath: string
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
    const inactiveDatasets = loadInactiveDatasets(config.inactiveManifestMapPath)

    for (const symbol of config.symbols) {
      const datasetID = symbolId(symbol)
      const outputDir = join(outputRoot, datasetID.toLowerCase())
      const manifestPath = join(outputDir, "manifest.json")
      const displayOutputDir = displayPath(outputDir)
      const displayManifestPath = displayPath(manifestPath)
      mkdirSync(outputDir, { recursive: true })
      if (!config.dryRun) {
        const result = await fetcher([
          "--symbol", symbol,
          "--timeframes", config.timeframe,
          "--output-dir", displayOutputDir,
          "--limit", String(config.limit),
          "--since-ts", String(config.sinceTS),
        ])
        if (!result.ok) throw new Error(`${symbol} OHLCV fetch failed: ${result.error || "unknown error"}`)
      }
      const fundingReport = findFundingReport(config.fundingReportRoot, datasetID)
      datasets.push({
        dataset_id: datasetID,
        manifest_path: displayManifestPath,
        symbol_status: "active",
        ...(fundingReport ? { indicator_report_path: displayPath(fundingReport) } : {}),
      })
      panelDatasets.push({
        dataset_id: datasetID,
        symbol,
        symbol_status: "active",
        manifest_path: displayManifestPath,
        funding_report_path: fundingReport ? displayPath(fundingReport) : null,
        ...manifestSummary(manifestPath, config.timeframe),
      })
    }
    for (const dataset of inactiveDatasets) {
      datasets.push({
        dataset_id: dataset.dataset_id,
        manifest_path: displayPath(resolve(dataset.manifest_path)),
        symbol_status: dataset.symbol_status,
        ...(dataset.indicator_report_path ? { indicator_report_path: displayPath(resolve(dataset.indicator_report_path)) } : {}),
      })
      panelDatasets.push({
        dataset_id: dataset.dataset_id,
        symbol: dataset.symbol,
        symbol_status: dataset.symbol_status,
        ...(dataset.listed_at ? { listed_at: dataset.listed_at } : {}),
        ...(dataset.delisted_at ? { delisted_at: dataset.delisted_at } : {}),
        manifest_path: displayPath(resolve(dataset.manifest_path)),
        funding_report_path: dataset.indicator_report_path ? displayPath(resolve(dataset.indicator_report_path)) : null,
        ...manifestSummary(resolve(dataset.manifest_path), config.timeframe),
      })
    }
    const inactiveCount = inactiveDatasets.filter((dataset) => dataset.symbol_status === "inactive" || dataset.symbol_status === "delisted").length
    const survivorOnly = inactiveCount === 0

    const suiteInput = {
      datasets,
      timeframe: config.timeframe,
      random_trials: config.randomTrials,
      ...(config.previousCalibrationReportPath ? { previous_calibration_report_path: displayPath(resolve(config.previousCalibrationReportPath)) } : {}),
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
      dataset_count: panelDatasets.length,
      active_dataset_count: config.symbols.length,
      inactive_dataset_count: inactiveDatasets.filter((dataset) => dataset.symbol_status === "inactive").length,
      delisted_dataset_count: inactiveDatasets.filter((dataset) => dataset.symbol_status === "delisted").length,
      survivor_only: survivorOnly,
      universe_source: survivorOnly ? "current_tradable_usdm" : "current_tradable_usdm_plus_external_inactive",
      timeframe: config.timeframe,
      since_ts: config.sinceTS,
      suite_input_path: displayPath(suiteInputPath),
      datasets: panelDatasets,
    }, null, 2)}\n`)

    return {
      ok: true,
      data: {
        output_root: displayPath(outputRoot),
        suite_input_path: displayPath(suiteInputPath),
        panel_manifest_path: displayPath(panelManifestPath),
        dataset_count: datasets.length,
      },
    }
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
    inactiveManifestMapPath: values.get("--inactive-manifest-map") || "",
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

function loadInactiveDatasets(path: string): Array<{
  dataset_id: string
  symbol: string
  symbol_status: "inactive" | "delisted"
  manifest_path: string
  indicator_report_path?: string
  listed_at?: string
  delisted_at?: string
}> {
  if (!path) return []
  const payload = JSON.parse(readFileSync(resolve(path), "utf8")) as unknown
  const rawDatasets = Array.isArray(payload)
    ? payload
    : Array.isArray(asRecord(payload).datasets)
      ? asRecord(payload).datasets as unknown[]
      : Object.entries(asRecord(payload)).map(([symbol, manifestPath]) => ({ symbol, manifest_path: manifestPath }))
  return rawDatasets.map((raw) => {
    const item = asRecord(raw)
    const symbol = stringField(item.symbol) || stringField(item.dataset_id)
    const datasetID = symbolId(stringField(item.dataset_id) || symbol)
    const status = stringField(item.symbol_status || item.status)
    const symbolStatus = status === "delisted" ? "delisted" : "inactive"
    const manifestPath = stringField(item.manifest_path)
    if (!datasetID || !symbol || !manifestPath) throw new Error("--inactive-manifest-map entries require dataset_id or symbol plus manifest_path")
    return {
      dataset_id: datasetID,
      symbol: symbolId(symbol),
      symbol_status: symbolStatus,
      manifest_path: manifestPath,
      indicator_report_path: stringField(item.indicator_report_path) || undefined,
      listed_at: stringField(item.listed_at) || undefined,
      delisted_at: stringField(item.delisted_at) || undefined,
    }
  })
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

function displayPath(path: string): string {
  return relative(process.cwd(), path) || "."
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

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

if (import.meta.main) {
  runCalibrationPanel(process.argv.slice(2)).then((result) => {
    const stream = result.ok ? process.stdout : process.stderr
    stream.write(`${JSON.stringify(result, null, 2)}\n`)
    if (!result.ok) process.exit(1)
  })
}

export { DEFAULT_SYMBOLS, parseArgs, runCalibrationPanel }
