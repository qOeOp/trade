#!/usr/bin/env bun

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { runMarketFeatures } from "./market-features"
import {
  ensureMarketDataSchema,
  upsertFeatureManifest,
  upsertFundingEvents,
  upsertMarketManifest,
  type FeatureManifest,
  type FundingEvent,
  type MarketManifest,
} from "../../../market-data-store/src/lib/market-data-store"

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
  marketDataDb: string
}

interface MarketDataStoreWriteSummary {
  db: string
  funding_manifests: Array<{ dataset_id: string; manifest_id: string; events: number }>
  feature_manifests: Array<{ dataset_id: string; feature_manifest_id: string }>
  funding_events_upserted: number
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
            "--base-report", baseReportPath,
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

    const marketDataStore = recordMarketDataStoreIfEnabled(config, reports)
    if (marketDataStore) enrichSuiteDatasetsWithStoreRefs(suiteDatasets, marketDataStore)
    const suiteInput = {
      datasets: suiteDatasets,
      timeframe: config.timeframe,
      random_trials: 100,
    }
    const suiteInputPath = join(outputRoot, "calibration-suite-input-with-funding.json")
    const manifestPath = join(outputRoot, "market-features-panel-manifest.json")
    writeFileSync(suiteInputPath, `${JSON.stringify(suiteInput, null, 2)}\n`)
    const panelFeatureManifest = {
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
    }
    writeFileSync(manifestPath, `${JSON.stringify(panelFeatureManifest, null, 2)}\n`)
    return {
      ok: true,
      data: {
        output_root: displayPath(outputRoot),
        suite_input_path: displayPath(suiteInputPath),
        panel_manifest_path: displayPath(manifestPath),
        dataset_count: suiteDatasets.length,
        ...(marketDataStore ? { market_data_store: marketDataStore } : {}),
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
    marketDataDb: values.get("--market-data-db") || "",
  }
}

function enrichSuiteDatasetsWithStoreRefs(suiteDatasets: JSONRecord[], store: MarketDataStoreWriteSummary): void {
  const fundingByDataset = new Map(store.funding_manifests.map((item) => [item.dataset_id, item.manifest_id]))
  const featureByDataset = new Map(store.feature_manifests.map((item) => [item.dataset_id, item.feature_manifest_id]))
  for (const dataset of suiteDatasets) {
    const datasetID = stringField(dataset.dataset_id)
    const fundingRef = fundingByDataset.get(datasetID)
    const featureRef = featureByDataset.get(datasetID)
    if (fundingRef) dataset.funding_events_ref = fundingRef
    if (featureRef) dataset.feature_manifest_ref = featureRef
    dataset.market_data_db = store.db
  }
}

function recordMarketDataStoreIfEnabled(config: Config, reports: JSONRecord[]): MarketDataStoreWriteSummary | null {
  if (!config.marketDataDb) return null
  const dbPath = resolve(config.marketDataDb)
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  try {
    ensureMarketDataSchema(db)
    const summary: MarketDataStoreWriteSummary = {
      db: displayPath(dbPath),
      funding_manifests: [],
      feature_manifests: [],
      funding_events_upserted: 0,
    }
    for (const report of reports) {
      const datasetID = stringField(report.dataset_id)
      const symbol = stringField(report.symbol) || datasetID
      const marketFeaturesPath = resolveInputPath(stringField(report.market_features_path), process.cwd())
      if (!datasetID || !symbol || !existsSync(marketFeaturesPath)) continue
      const enriched = JSON.parse(readFileSync(marketFeaturesPath, "utf8")) as JSONRecord
      const fundingPoints = array(asRecord(asRecord(enriched.data).market_events).funding).map(asRecord)
      const contentHash = sha256(readFileSync(marketFeaturesPath, "utf8"))
      const fundingManifest = buildFundingManifest(config, report, symbol, contentHash, fundingPoints)
      upsertMarketManifest(db, fundingManifest)
      const fundingEvents = buildStoreFundingEvents(fundingManifest, symbol, fundingPoints)
      summary.funding_events_upserted += upsertFundingEvents(db, fundingEvents)
      const featureManifest = buildStoreFeatureManifest(config, report, fundingManifest, contentHash)
      upsertFeatureManifest(db, featureManifest)
      summary.funding_manifests.push({ dataset_id: datasetID, manifest_id: fundingManifest.manifest_id, events: fundingEvents.length })
      summary.feature_manifests.push({ dataset_id: datasetID, feature_manifest_id: featureManifest.feature_manifest_id })
    }
    return summary
  } finally {
    db.close()
  }
}

function buildFundingManifest(
  config: Config,
  report: JSONRecord,
  symbol: string,
  contentHash: string,
  fundingPoints: JSONRecord[],
): MarketManifest {
  const datasetID = stringField(report.dataset_id)
  const fundingTimes = fundingPoints.map((point) => Date.parse(stringField(point.timestamp))).filter(Number.isFinite)
  return {
    manifest_id: ["funding", "binanceusdm", symbol, config.timeframe, contentHash.slice(0, 16)].join(":"),
    dataset_kind: "funding_events",
    source: "binance_funding_rate",
    exchange: "binanceusdm",
    symbol,
    timeframe: config.timeframe,
    first_ts: fundingTimes.length ? Math.min(...fundingTimes) : undefined,
    last_ts: fundingTimes.length ? Math.max(...fundingTimes) : undefined,
    rows: fundingPoints.length,
    content_hash: contentHash,
    manifest_path: stringField(report.market_features_path),
    created_at: new Date().toISOString(),
    freshness_json: {
      dataset_id: datasetID,
      metrics_source: config.metricsSource,
      external: config.external,
    },
  }
}

function buildStoreFundingEvents(manifest: MarketManifest, symbol: string, fundingPoints: JSONRecord[]): FundingEvent[] {
  return fundingPoints.map((point) => ({
    manifest_id: manifest.manifest_id,
    exchange: manifest.exchange,
    symbol,
    funding_time: Date.parse(stringField(point.timestamp)),
    funding_rate: Number(point.value),
  })).filter((event) => Number.isFinite(event.funding_time) && Number.isFinite(event.funding_rate))
}

function buildStoreFeatureManifest(config: Config, report: JSONRecord, sourceManifest: MarketManifest, contentHash: string): FeatureManifest {
  const datasetID = stringField(report.dataset_id)
  return {
    feature_manifest_id: ["market-features", sourceManifest.exchange, sourceManifest.symbol || datasetID, config.timeframe, contentHash.slice(0, 16)].join(":"),
    source_manifest_id: sourceManifest.manifest_id,
    feature_set_id: "crypto-market-features.v1",
    symbol: sourceManifest.symbol,
    timeframe: config.timeframe,
    content_hash: contentHash,
    manifest_path: stringField(report.market_features_path),
    generated_at: new Date().toISOString(),
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
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
  const fromRepo = resolve(repoRoot(), path)
  if (existsSync(fromRepo)) return fromRepo
  return resolve(fallbackDir, path)
}

function displayPath(path: string): string {
  const resolved = resolve(path)
  const repoRelative = relative(repoRoot(), resolved)
  if (repoRelative && !repoRelative.startsWith("..") && !isAbsolute(repoRelative)) return repoRelative
  if (repoRelative === "") return "."
  return relative(process.cwd(), resolved) || "."
}

let cachedRepoRoot = ""

function repoRoot(): string {
  if (cachedRepoRoot) return cachedRepoRoot
  let current = resolve(process.cwd())
  while (dirname(current) !== current) {
    if (existsSync(join(current, "AGENTS.md")) && existsSync(join(current, ".agents"))) {
      cachedRepoRoot = current
      return cachedRepoRoot
    }
    current = dirname(current)
  }
  cachedRepoRoot = resolve(process.cwd())
  return cachedRepoRoot
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
