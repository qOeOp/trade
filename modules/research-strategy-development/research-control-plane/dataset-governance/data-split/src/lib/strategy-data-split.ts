import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  defaultCatalogDbPathForGeneratedPath,
  registerCatalogArtifact,
} from "../../../../../../contracts/catalog-contract/src/catalog-client"
import { displayPath, resolveReadablePath } from "../../../../../../contracts/runtime-core/src/paths"
import type { JSONRecord } from "../../../../../../contracts/runtime-core/src/json"
import { runOwnerToolRecordSync } from "../../../../../../contracts/runtime-core/src/owner-tool-client"

type SplitSegmentName = "discovery" | "validation" | "locked_holdout"

const DEFAULT_MIN_SEGMENT_ROWS = 100

interface StrategyDataSplitDatasetInput {
  datasetId: string
  manifestPath?: string
  ohlcvDbPath?: string
  exchange?: string
  symbol?: string
  timeframe?: string
  sinceTs?: number
  untilTs?: number
  limit?: number
}

interface StrategyDataSplitInput {
  splitId?: string
  hypothesisId?: string
  timeframe?: string
  outputRoot?: string
  discoveryRatio?: number
  validationRatio?: number
  lockedHoldoutRatio?: number
  maxHoldBars?: number
  featureLookbackBars?: number
  fundingIntervalBars?: number
  minSegmentRows?: number
  reportPath?: string
  catalogDbPath?: string
  now?: string
  datasets: StrategyDataSplitDatasetInput[]
}

interface StrategyDataSplitSegment {
  segment: SplitSegmentName
  manifest_path: string
  rows: number
  first_open_ts: number
  last_open_ts: number
  first_open_at: string
  last_open_at: string
}

interface StrategyDataSplitDatasetReport {
  dataset_id: string
  source_manifest_path: string
  symbol: string
  source_rows: number
  segments: StrategyDataSplitSegment[]
}

interface StrategyDataSplitReport {
  schema_version: "trade-flow.strategy-data-split.v1"
  split_id: string
  hypothesis_id: string
  generated_at: string
  timeframe: string
  output_root: string
  ratios: {
    discovery: number
    validation: number
    locked_holdout: number
  }
  embargo: {
    bars: number
    milliseconds: number
    reason: string
  }
  dataset_count: number
  datasets: StrategyDataSplitDatasetReport[]
  guardrails: {
    locked_holdout_reserved: true
    next_action: string
  }
  report_path?: string
  catalog_db_path?: string
  artifact_id?: string
}

interface CsvRow {
  raw: string
  timestamp: number
}

interface MarketDataSliceExportRequest {
  ohlcvDbPath?: string
  exchange?: string
  symbol: string
  timeframe: string
  sinceTs?: number
  untilTs?: number
  limit?: number
  outputRoot: string
  generatedAt: string
}

interface StrategyDataSplitDependencies {
  marketDataSliceExporter?: (input: MarketDataSliceExportRequest) => JSONRecord
}

function runStrategyDataSplit(
  input: StrategyDataSplitInput,
  dependencies: StrategyDataSplitDependencies = {},
): StrategyDataSplitReport {
  if (input.datasets.length < 1) {
    throw new Error("strategy data split requires at least one dataset")
  }
  const timeframe = input.timeframe || "4h"
  const splitId = safeId(input.splitId || input.hypothesisId || "strategy-data-split")
  const outputRoot = input.outputRoot || join("tmp", "panels", "strategy-data-splits", splitId)
  const ratios = normalizeRatios(input)
  const intervalMs = timeframeMilliseconds(timeframe)
  const embargoBars = embargoBarsFor(input, timeframe)
  const minSegmentRows = normalizeMinSegmentRows(input.minSegmentRows)
  const generatedAt = input.now || new Date().toISOString()
  const datasets = input.datasets.map((dataset) => splitDataset(dataset, {
    splitId,
    timeframe,
    outputRoot,
    ratios,
    embargoBars,
    intervalMs,
    minSegmentRows,
    generatedAt,
    marketDataSliceExporter: dependencies.marketDataSliceExporter ?? exportCandleSliceFromOwner,
  }))
  const report: StrategyDataSplitReport = {
    schema_version: "trade-flow.strategy-data-split.v1",
    split_id: splitId,
    hypothesis_id: input.hypothesisId || "",
    generated_at: generatedAt,
    timeframe,
    output_root: displayPath(outputRoot),
    ratios: {
      discovery: ratios.discovery,
      validation: ratios.validation,
      locked_holdout: ratios.locked_holdout,
    },
    embargo: {
      bars: embargoBars,
      milliseconds: embargoBars * intervalMs,
      reason: "max(max_hold_bars, feature_lookback_bars, funding_interval_bars)",
    },
    dataset_count: datasets.length,
    datasets,
    guardrails: {
      locked_holdout_reserved: true,
      next_action: "Use discovery manifests for search, validation manifests for candidate filtering, and locked_holdout manifests only once after the Trade Contract is frozen.",
    },
  }
  if (input.reportPath) {
    mkdirSync(dirname(input.reportPath), { recursive: true })
    const reportWithPath = { ...report, report_path: displayPath(input.reportPath) }
    writeFileSync(input.reportPath, JSON.stringify(reportWithPath, null, 2) + "\n")
    const registered = registerCatalogArtifact({
      catalogDbPath: input.catalogDbPath || defaultCatalogDbPathForGeneratedPath(input.reportPath),
      path: input.reportPath,
      now: generatedAt,
      referrerType: "strategy_data_split",
      referrerID: splitId,
      role: "report",
    })
    return {
      ...reportWithPath,
      catalog_db_path: registered.catalog_db_path,
      artifact_id: registered.artifact_id,
    }
  }
  return report
}

function strategyDataSplitInputFromJson(value: JSONRecord): StrategyDataSplitInput {
  return {
    splitId: stringField(value.split_id) || undefined,
    hypothesisId: stringField(value.hypothesis_id) || undefined,
    timeframe: stringField(value.timeframe) || undefined,
    outputRoot: stringField(value.output_root) || undefined,
    discoveryRatio: optionalNumber(value.discovery_ratio),
    validationRatio: optionalNumber(value.validation_ratio),
    lockedHoldoutRatio: optionalNumber(value.locked_holdout_ratio),
    maxHoldBars: optionalNumber(value.max_hold_bars),
    featureLookbackBars: optionalNumber(value.feature_lookback_bars),
    fundingIntervalBars: optionalNumber(value.funding_interval_bars),
    minSegmentRows: optionalNumber(value.min_segment_rows),
    reportPath: stringField(value.report_path) || undefined,
    catalogDbPath: stringField(value.catalog_db_path) || undefined,
    now: stringField(value.now) || undefined,
    datasets: array(value.datasets).map((raw) => {
      const item = asRecord(raw)
      return {
        datasetId: stringField(item.dataset_id),
        manifestPath: stringField(item.manifest_path) || undefined,
        ohlcvDbPath: stringField(item.ohlcv_db_path) || stringField(value.ohlcv_db_path) || stringField(value.ohlcv_db) || undefined,
        exchange: stringField(item.exchange) || undefined,
        symbol: stringField(item.symbol) || stringField(item.dataset_id) || undefined,
        timeframe: stringField(item.timeframe) || stringField(value.timeframe) || undefined,
        sinceTs: optionalNumber(item.since_ts),
        untilTs: optionalNumber(item.until_ts),
        limit: optionalNumber(item.limit),
      }
    }),
  }
}

function splitDataset(
  dataset: StrategyDataSplitDatasetInput,
  options: {
    splitId: string
    timeframe: string
    outputRoot: string
    ratios: ReturnType<typeof normalizeRatios>
    embargoBars: number
    intervalMs: number
    minSegmentRows: number
    generatedAt: string
    marketDataSliceExporter: (input: MarketDataSliceExportRequest) => JSONRecord
  },
): StrategyDataSplitDatasetReport {
  if (!dataset.datasetId) {
    throw new Error("strategy data split datasets require dataset_id")
  }
  const source = dataset.manifestPath
    ? readSourceFromManifest(dataset, options.timeframe)
    : readSourceFromOhlcvStore(dataset, options)
  const { header, rows, sourceManifestRef, sourceManifest, symbol } = source
  const usableRows = rows.length - options.embargoBars * 2
  if (usableRows < options.minSegmentRows * 3) {
    throw new Error(notEnoughRowsMessage(dataset.datasetId, rows.length, options.minSegmentRows, options.embargoBars, 3))
  }
  const discoveryRows = Math.floor(usableRows * options.ratios.discovery)
  const validationRows = Math.floor(usableRows * options.ratios.validation)
  const holdoutRows = usableRows - discoveryRows - validationRows
  if (Math.min(discoveryRows, validationRows, holdoutRows) < options.minSegmentRows) {
    const minRatio = Math.min(options.ratios.discovery, options.ratios.validation, options.ratios.locked_holdout)
    throw new Error(notEnoughRowsMessage(dataset.datasetId, rows.length, options.minSegmentRows, options.embargoBars, Math.ceil(1 / minRatio)))
  }
  const discoveryStart = 0
  const validationStart = discoveryStart + discoveryRows + options.embargoBars
  const holdoutStart = validationStart + validationRows + options.embargoBars
  const baseDir = join(options.outputRoot, safeId(dataset.datasetId))
  const segments = [
    writeSegment("discovery", rows.slice(discoveryStart, discoveryStart + discoveryRows)),
    writeSegment("validation", rows.slice(validationStart, validationStart + validationRows)),
    writeSegment("locked_holdout", rows.slice(holdoutStart, holdoutStart + holdoutRows)),
  ]
  return {
    dataset_id: dataset.datasetId,
    source_manifest_path: sourceManifestRef,
    symbol,
    source_rows: rows.length,
    segments,
  }

  function writeSegment(segment: SplitSegmentName, segmentRows: CsvRow[]): StrategyDataSplitSegment {
    const segmentDir = join(baseDir, segment)
    mkdirSync(segmentDir, { recursive: true })
    const csv = [header, ...segmentRows.map((row) => row.raw)].join("\n") + "\n"
    const csvOut = join(segmentDir, `${options.timeframe}.csv`)
    writeFileSync(csvOut, csv)
    const manifestPath = join(segmentDir, "manifest.json")
    const contentSha256 = createHash("sha256").update(csv).digest("hex")
    const first = segmentRows[0]
    const last = segmentRows[segmentRows.length - 1]
    if (!first || !last) {
      throw new Error(`empty ${segment} segment for ${dataset.datasetId}`)
    }
    writeFileSync(manifestPath, JSON.stringify({
      schema_version: 2,
      source: sourceManifest.source || {},
      closed_candles_only: sourceManifest.closed_candles_only === true,
      symbol,
      requested_symbol: stringField(sourceManifest.requested_symbol) || symbol,
      exchange: stringField(sourceManifest.exchange) || undefined,
      requested_exchange: stringField(sourceManifest.requested_exchange) || undefined,
      generated_at: options.generatedAt,
      output_dir: displayPath(segmentDir),
      manifest_path: displayPath(manifestPath),
      columns: Array.isArray(sourceManifest.columns) ? sourceManifest.columns : header.split(","),
      dedupe_key: stringField(sourceManifest.dedupe_key) || "timestamp",
      split: {
        split_id: options.splitId,
        source_manifest_path: sourceManifestRef,
        segment,
        embargo_bars: options.embargoBars,
      },
      timeframes: {
        [options.timeframe]: {
          file: `${options.timeframe}.csv`,
          rows: segmentRows.length,
          first_open_ts: first.timestamp,
          last_open_ts: last.timestamp,
          append_only: true,
          ascending_ts: true,
          content_sha256: contentSha256,
        },
      },
    }, null, 2) + "\n")
    return {
      segment,
      manifest_path: displayPath(manifestPath),
      rows: segmentRows.length,
      first_open_ts: first.timestamp,
      last_open_ts: last.timestamp,
      first_open_at: new Date(first.timestamp).toISOString(),
      last_open_at: new Date(last.timestamp).toISOString(),
    }
  }
}

function readSourceFromManifest(dataset: StrategyDataSplitDatasetInput, timeframe: string): {
  header: string
  rows: CsvRow[]
  sourceManifestPath: string
  sourceManifestRef: string
  sourceManifest: JSONRecord
  symbol: string
} {
  const sourceManifestPath = resolveReadablePath(dataset.manifestPath || "")
  const sourceManifest = asRecord(JSON.parse(readFileSync(sourceManifestPath, "utf8")))
  const timeframeEntry = asRecord(asRecord(sourceManifest.timeframes)[timeframe])
  const file = stringField(timeframeEntry.file)
  if (!file) {
    throw new Error(`manifest ${dataset.manifestPath} missing timeframe ${timeframe}`)
  }
  const csvPath = join(dirname(sourceManifestPath), file)
  const { header, rows } = readCsvRows(csvPath)
  return {
    header,
    rows,
    sourceManifestPath,
    sourceManifestRef: displayPath(sourceManifestPath),
    sourceManifest,
    symbol: stringField(sourceManifest.symbol) || stringField(sourceManifest.requested_symbol) || dataset.datasetId,
  }
}

function readSourceFromOhlcvStore(
  dataset: StrategyDataSplitDatasetInput,
  options: {
    timeframe: string
    outputRoot: string
    generatedAt: string
    marketDataSliceExporter: (input: MarketDataSliceExportRequest) => JSONRecord
  },
): {
  header: string
  rows: CsvRow[]
  sourceManifestPath: string
  sourceManifestRef: string
  sourceManifest: JSONRecord
  symbol: string
} {
  const dbPath = dataset.ohlcvDbPath || "data/ohlcv.db"
  const symbol = stringField(dataset.symbol) || dataset.datasetId
  const datasetTimeframe = stringField(dataset.timeframe)
  if (datasetTimeframe && datasetTimeframe !== options.timeframe) {
    throw new Error(`dataset ${dataset.datasetId} timeframe ${datasetTimeframe} does not match split timeframe ${options.timeframe}`)
  }
  const exported = options.marketDataSliceExporter({
    ohlcvDbPath: dbPath,
    exchange: dataset.exchange,
    symbol,
    timeframe: options.timeframe,
    sinceTs: dataset.sinceTs,
    untilTs: dataset.untilTs,
    limit: dataset.limit,
    outputRoot: join(options.outputRoot, "_sources", safeId(dataset.datasetId)),
    generatedAt: options.generatedAt,
  })
  const manifestPath = stringField(exported.manifest_path)
  if (!manifestPath) throw new Error("market_data_store export omitted manifest_path")
  const source = readSourceFromManifest({ ...dataset, manifestPath }, options.timeframe)
  return {
    ...source,
    sourceManifestRef: stringField(exported.slice_ref) || source.sourceManifestRef,
  }
}

function exportCandleSliceFromOwner(input: MarketDataSliceExportRequest): JSONRecord {
  const args = [
    ...(input.ohlcvDbPath ? ["--ohlcv-db", input.ohlcvDbPath] : []),
    "--action",
    "export_candle_slice",
    "--json",
    JSON.stringify({
      exchange: input.exchange,
      symbol: input.symbol,
      timeframe: input.timeframe,
      since_ts: input.sinceTs,
      until_ts: input.untilTs,
      limit: input.limit,
      output_root: input.outputRoot,
      generated_at: input.generatedAt,
    }),
  ]
  return asRecord(runOwnerToolRecordSync("market-data.store", args, "market data candle slice exporter").export)
}

function readCsvRows(path: string): { header: string; rows: CsvRow[] } {
  const lines = readFileSync(path, "utf8").trim().split(/\r?\n/)
  const header = lines[0] || ""
  if (!header) throw new Error(`empty CSV ${path}`)
  const rows = lines.slice(1).map((raw) => ({ raw, timestamp: Number(raw.split(",")[1]) }))
  if (rows.some((row) => !Number.isFinite(row.timestamp))) {
    throw new Error(`CSV ${path} contains invalid timestamp`)
  }
  return { header, rows }
}

function normalizeRatios(input: StrategyDataSplitInput): { discovery: number; validation: number; locked_holdout: number } {
  const discovery = input.discoveryRatio ?? 0.6
  const validation = input.validationRatio ?? 0.2
  const locked = input.lockedHoldoutRatio ?? 0.2
  const total = discovery + validation + locked
  if (![discovery, validation, locked].every((value) => Number.isFinite(value) && value > 0) || Math.abs(total - 1) > 1e-9) {
    throw new Error("discovery_ratio + validation_ratio + locked_holdout_ratio must be positive and sum to 1")
  }
  return { discovery, validation, locked_holdout: locked }
}

function normalizeMinSegmentRows(value: unknown): number {
  if (value === undefined) return DEFAULT_MIN_SEGMENT_ROWS
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < DEFAULT_MIN_SEGMENT_ROWS) {
    throw new Error(`DATA-SPLIT-SAMPLE-FLOOR: min_segment_rows must be at least ${DEFAULT_MIN_SEGMENT_ROWS}. Do not lower the research sample floor to make a run pass; fetch more OHLCV or request a larger market-data owner slice.`)
  }
  return parsed
}

function notEnoughRowsMessage(datasetId: string, rows: number, minSegmentRows: number, embargoBars: number, segmentMultiplier: number): string {
  const requiredRows = minSegmentRows * segmentMultiplier + embargoBars * 2
  return `DATA-SPLIT-INSUFFICIENT-OHLCV: dataset ${datasetId} has ${rows} rows; need at least ${requiredRows} rows for min_segment_rows=${minSegmentRows} with embargo_bars=${embargoBars}. Fetch more OHLCV or request a larger market-data owner slice. Do not lower min_segment_rows to make the split pass.`
}

function embargoBarsFor(input: StrategyDataSplitInput, timeframe: string): number {
  return Math.max(
    input.maxHoldBars ?? 18,
    input.featureLookbackBars ?? 0,
    input.fundingIntervalBars ?? Math.ceil(8 * 3_600_000 / timeframeMilliseconds(timeframe)),
  )
}

function timeframeMilliseconds(timeframe: string): number {
  const match = timeframe.match(/^(\d+)([mhdw])$/)
  if (!match) throw new Error(`unsupported split timeframe: ${timeframe}`)
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[match[2]] || 0
  return Number(match[1]) * unit
}

function safeId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "strategy-data-split"
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function optionalNumber(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

export {
  runStrategyDataSplit,
  strategyDataSplitInputFromJson,
  type StrategyDataSplitInput,
  type StrategyDataSplitDependencies,
  type StrategyDataSplitReport,
  type MarketDataSliceExportRequest,
}
