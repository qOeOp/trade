import { createHash } from "node:crypto"
import { Database } from "bun:sqlite"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  defaultCatalogDbPathForGeneratedPath,
  registerCatalogArtifact,
} from "../../../../contracts/catalog-contract/src/catalog-client"
import { displayPath, resolveReadablePath } from "../../../../contracts/runtime-core/src/paths"
import type { JSONRecord } from "../../../../contracts/runtime-core/src/json"

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

interface CanonicalCandleRow {
  open_time: number
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

function runStrategyDataSplit(input: StrategyDataSplitInput): StrategyDataSplitReport {
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
  },
): StrategyDataSplitDatasetReport {
  if (!dataset.datasetId) {
    throw new Error("strategy data split datasets require dataset_id")
  }
  const source = dataset.manifestPath
    ? readSourceFromManifest(dataset, options.timeframe)
    : readSourceFromOhlcvStore(dataset, options.timeframe)
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

function readSourceFromOhlcvStore(dataset: StrategyDataSplitDatasetInput, timeframe: string): {
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
  if (datasetTimeframe && datasetTimeframe !== timeframe) {
    throw new Error(`dataset ${dataset.datasetId} timeframe ${datasetTimeframe} does not match split timeframe ${timeframe}`)
  }
  const db = new Database(dbPath, { readonly: true })
  try {
    const candles = readOhlcvCandles(db, {
      exchange: dataset.exchange,
      symbol,
      timeframe,
      since_ts: dataset.sinceTs,
      until_ts: dataset.untilTs,
      limit: dataset.limit,
    })
    if (candles.length === 0) {
      throw new Error(`ohlcv store has no candles for ${symbol} ${timeframe}`)
    }
    const rows = candles.map(candleToCsvRow)
    const contentSha256 = createHash("sha256").update([csvHeader(), ...rows.map((row) => row.raw)].join("\n") + "\n").digest("hex")
    const sourceRef = `ohlcv_store:canonical_candle/${dataset.exchange || "any"}/${symbol}/${timeframe}`
    return {
      header: csvHeader(),
      rows,
      sourceManifestPath: sourceRef,
      sourceManifestRef: sourceRef,
      symbol,
      sourceManifest: {
        schema_version: 2,
        source: { provider: "ohlcv_store", db_path: displayPath(dbPath) },
        closed_candles_only: true,
        symbol,
        requested_symbol: symbol,
        exchange: dataset.exchange,
        requested_exchange: dataset.exchange,
        generated_at: new Date().toISOString(),
        output_dir: "",
        manifest_path: sourceRef,
        columns: csvHeader().split(","),
        dedupe_key: "timestamp",
        timeframes: {
          [timeframe]: {
            rows: rows.length,
            first_open_ts: rows[0]?.timestamp || 0,
            last_open_ts: rows[rows.length - 1]?.timestamp || 0,
            append_only: true,
            ascending_ts: true,
            content_sha256: contentSha256,
          },
        },
      },
    }
  } finally {
    db.close()
  }
}

function readOhlcvCandles(
  db: Database,
  query: { exchange?: string; symbol: string; timeframe: string; since_ts?: number; until_ts?: number; limit?: number },
): CanonicalCandleRow[] {
  const limit = boundedLimit(query.limit, 50_000)
  try {
    return db.query(`
      SELECT open_time, open, high, low, close, volume
      FROM canonical_candle
      WHERE ($exchange IS NULL OR exchange = $exchange)
        AND symbol = $symbol
        AND timeframe = $timeframe
        AND ($since_ts IS NULL OR open_time >= $since_ts)
        AND ($until_ts IS NULL OR open_time <= $until_ts)
      ORDER BY open_time
      LIMIT $limit
    `).all({
      $exchange: query.exchange || null,
      $symbol: query.symbol,
      $timeframe: query.timeframe,
      $since_ts: query.since_ts ?? null,
      $until_ts: query.until_ts ?? null,
      $limit: limit,
    }) as CanonicalCandleRow[]
  } catch (error) {
    if (isMissingCanonicalCandleTable(error)) {
      throw new Error("ohlcv store schema is missing canonical_candle; initialize market_data_store before running strategy data split")
    }
    throw error
  }
}

function boundedLimit(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, 1_000_000)
}

function isMissingCanonicalCandleTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes("canonical_candle") && message.includes("no such table")
}

function candleToCsvRow(candle: CanonicalCandleRow): CsvRow {
  return {
    timestamp: candle.open_time,
    raw: [
      new Date(candle.open_time).toISOString(),
      candle.open_time,
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume ?? "",
    ].join(","),
  }
}

function csvHeader(): string {
  return "date,timestamp,open,high,low,close,volume"
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
    throw new Error(`DATA-SPLIT-SAMPLE-FLOOR: min_segment_rows must be at least ${DEFAULT_MIN_SEGMENT_ROWS}. Do not lower the research sample floor to make a run pass; fetch more OHLCV with modules/market-data-products/ohlcv-fetch or split from data/ohlcv.db.canonical_candle.`)
  }
  return parsed
}

function notEnoughRowsMessage(datasetId: string, rows: number, minSegmentRows: number, embargoBars: number, segmentMultiplier: number): string {
  const requiredRows = minSegmentRows * segmentMultiplier + embargoBars * 2
  return `DATA-SPLIT-INSUFFICIENT-OHLCV: dataset ${datasetId} has ${rows} rows; need at least ${requiredRows} rows for min_segment_rows=${minSegmentRows} with embargo_bars=${embargoBars}. Fetch more OHLCV with modules/market-data-products/ohlcv-fetch, or provide ohlcv_db_path so research.data-split can read data/ohlcv.db.canonical_candle. Do not lower min_segment_rows to make the split pass.`
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
  type StrategyDataSplitReport,
}
