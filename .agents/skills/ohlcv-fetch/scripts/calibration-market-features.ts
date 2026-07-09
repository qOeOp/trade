#!/usr/bin/env bun

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { runMarketFeatures } from "./market-features"

type JSONRecord = Record<string, unknown>
type Analyzer = (manifestPath: string) => JSONRecord
type MarketRunner = (argv: string[]) => Promise<JSONRecord>

interface Config {
  panelManifestPath: string
  outputRoot: string
  timeframe: string
  sinceTS: number
  metricsSource: "vision" | "rest"
  microstructureDays: number
  external: boolean
  techIndicatorsDir: string
  analyzerTimeoutMs: number
  marketTimeoutMs: number
  force: boolean
}

async function runCalibrationMarketFeatures(argv: string[], analyzer: Analyzer = defaultAnalyzer, marketRunner: MarketRunner = runMarketFeatures): Promise<{ ok: true; data: JSONRecord } | { ok: false; error: string }> {
  try {
    const config = parseArgs(argv)
    const panel = asRecord(JSON.parse(readFileSync(config.panelManifestPath, "utf8")))
    const outputRoot = resolve(config.outputRoot || join(dirname(config.panelManifestPath), "market-features"))
    const panelDir = dirname(config.panelManifestPath)
    mkdirSync(outputRoot, { recursive: true })
    const datasets = array(panel.datasets).map(asRecord)
    if (datasets.length === 0) throw new Error("panel manifest has no datasets")
    const analyze = analyzer === defaultAnalyzer ? (manifestPath: string) => defaultAnalyzer(manifestPath, config.techIndicatorsDir, config.analyzerTimeoutMs) : analyzer

    const suiteDatasets: JSONRecord[] = []
    const reports: JSONRecord[] = []
    for (const dataset of datasets) {
      const datasetID = stringField(dataset.dataset_id)
      const symbol = stringField(dataset.symbol) || datasetID
      const manifestPathRaw = stringField(dataset.manifest_path)
      if (!datasetID || !manifestPathRaw) throw new Error("panel dataset requires dataset_id and manifest_path")
      const manifestPath = resolveInputPath(manifestPathRaw, panelDir)
      if (!existsSync(manifestPath)) throw new Error(`manifest not found: ${manifestPath}`)
      const dir = join(outputRoot, datasetID.toLowerCase())
      mkdirSync(dir, { recursive: true })
      const baseReportPath = join(dir, "base-features.json")
      const marketFeaturesPath = join(dir, "market-features.json")
      const displayManifestPath = displayPath(manifestPath)
      const displayBaseReportPath = displayPath(baseReportPath)
      const displayMarketFeaturesPath = displayPath(marketFeaturesPath)
      let status = "ok"
      let error: string | null = null
      let enriched: JSONRecord
      process.stderr.write(`[calibration-market-features] ${datasetID} start\n`)
      const cached = existsSync(marketFeaturesPath) && !config.force ? JSON.parse(readFileSync(marketFeaturesPath, "utf8")) as JSONRecord : null
      if (cached && cached.ok !== false) {
        enriched = cached
        status = "cached"
        error = stringField(enriched.error) || null
      } else {
        try {
          writeFileSync(baseReportPath, `${JSON.stringify(analyze(manifestPath), null, 2)}\n`)
          enriched = await withTimeout(marketRunner([
            "--symbol", symbol,
            "--timeframe", config.timeframe,
            "--since-ts", String(config.sinceTS || Number(panel.since_ts) || Date.UTC(2021, 0, 1)),
            "--base-report", displayBaseReportPath,
            "--metrics-source", config.metricsSource,
            "--microstructure-days", String(config.microstructureDays),
            "--external", String(config.external),
          ]), config.marketTimeoutMs, `${datasetID} market feature timeout`)
        } catch (caught) {
          status = "failed"
          error = caught instanceof Error ? caught.message : String(caught)
          enriched = { ok: false, error, data: { market_events: { funding: [] } } }
        }
        writeFileSync(marketFeaturesPath, `${JSON.stringify(enriched, null, 2)}\n`)
      }
      const fundingCount = array(asRecord(asRecord(enriched.data).market_events).funding).length
      suiteDatasets.push({ dataset_id: datasetID, manifest_path: displayManifestPath, indicator_report_path: displayMarketFeaturesPath })
      reports.push({ dataset_id: datasetID, symbol, status, error, base_report_path: displayBaseReportPath, market_features_path: displayMarketFeaturesPath, funding_event_count: fundingCount })
      process.stderr.write(`[calibration-market-features] ${datasetID} ${status} funding_events=${fundingCount}${error ? ` error=${error.slice(0, 160)}` : ""}\n`)
    }

    const suiteInput = {
      datasets: suiteDatasets,
      timeframe: config.timeframe,
      random_trials: 100,
    }
    const suiteInputPath = join(outputRoot, "calibration-suite-input-with-funding.json")
    const manifestPath = join(outputRoot, "market-features-panel-manifest.json")
    writeFileSync(suiteInputPath, `${JSON.stringify(suiteInput, null, 2)}\n`)
    writeFileSync(manifestPath, `${JSON.stringify({
      schema_version: 1,
      generated_at: new Date().toISOString(),
      purpose: "trade_flow_calibration_market_features",
      panel_manifest_ref: displayPath(config.panelManifestPath),
      suite_input_path: displayPath(suiteInputPath),
      timeframe: config.timeframe,
      metrics_source: config.metricsSource,
      microstructure_days: config.microstructureDays,
      external: config.external,
      reports,
    }, null, 2)}\n`)
    return {
      ok: true,
      data: {
        output_root: displayPath(outputRoot),
        suite_input_path: displayPath(suiteInputPath),
        panel_manifest_path: displayPath(manifestPath),
        dataset_count: suiteDatasets.length,
      },
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function defaultAnalyzer(manifestPath: string, techDir = defaultTechIndicatorsDir(), timeout = 60_000): JSONRecord {
  const stdout = execFileSync("go", ["run", "./scripts", "--manifest", manifestPath, "--feature-series"], { cwd: techDir, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout })
  return JSON.parse(stdout) as JSONRecord
}

function parseArgs(argv: string[]): Config {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    if (!key?.startsWith("--")) throw new Error(`unexpected argument: ${key}`)
    const value = argv[index + 1]
    if (!value || value.startsWith("--")) throw new Error(`${key} requires a value`)
    values.set(key, value)
  }
  const panelManifestPath = values.get("--panel-manifest") || ""
  if (!panelManifestPath) throw new Error("--panel-manifest is required")
  const source = values.get("--metrics-source") || "vision"
  return {
    panelManifestPath: resolve(panelManifestPath),
    outputRoot: values.get("--output-root") || "",
    timeframe: values.get("--timeframe") || "4h",
    sinceTS: numberValue(values.get("--since-ts"), 0, "--since-ts"),
    metricsSource: source === "rest" ? "rest" : "vision",
    microstructureDays: numberValue(values.get("--microstructure-days"), 0, "--microstructure-days"),
    external: values.get("--external") === "true",
    techIndicatorsDir: values.get("--tech-indicators-dir") || defaultTechIndicatorsDir(),
    analyzerTimeoutMs: numberValue(values.get("--analyzer-timeout-ms"), 60_000, "--analyzer-timeout-ms"),
    marketTimeoutMs: numberValue(values.get("--market-timeout-ms"), 45_000, "--market-timeout-ms"),
    force: values.get("--force") === "true",
  }
}

function withTimeout<T>(task: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    task.then((value) => { clearTimeout(timer); resolve(value) }, (error) => { clearTimeout(timer); reject(error) })
  })
}

function defaultTechIndicatorsDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "tech-indicators")
}

function resolveInputPath(path: string, fallbackDir: string): string {
  if (isAbsolute(path)) return path
  const fromCwd = resolve(path)
  if (existsSync(fromCwd)) return fromCwd
  return resolve(fallbackDir, path)
}

function displayPath(path: string): string {
  return relative(process.cwd(), path) || "."
}

function numberValue(value: string | undefined, fallback: number, name: string): number {
  const number = value === undefined ? fallback : Number(value)
  if (!Number.isFinite(number) || number < 0) throw new Error(`${name} must be a non-negative number`)
  return number
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : ""
}

if (import.meta.main) {
  runCalibrationMarketFeatures(process.argv.slice(2)).then((result) => {
    const stream = result.ok ? process.stdout : process.stderr
    stream.write(`${JSON.stringify(result, null, 2)}\n`)
    if (!result.ok) process.exit(1)
  })
}

export { parseArgs, runCalibrationMarketFeatures }
