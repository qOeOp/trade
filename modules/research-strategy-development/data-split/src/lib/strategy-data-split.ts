import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  defaultCatalogDbPathForGeneratedPath,
  registerCatalogArtifact,
} from "../../../../contracts/catalog-contract/src/catalog-client"
import { displayPath, resolveReadablePath } from "../../../../contracts/runtime-core/src/paths"
import type { JSONRecord } from "../../../../contracts/runtime-core/src/json"

type SplitSegmentName = "discovery" | "validation" | "locked_holdout"

interface StrategyDataSplitDatasetInput {
  datasetId: string
  manifestPath: string
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
  const generatedAt = input.now || new Date().toISOString()
  const datasets = input.datasets.map((dataset) => splitDataset(dataset, {
    splitId,
    timeframe,
    outputRoot,
    ratios,
    embargoBars,
    intervalMs,
    minSegmentRows: input.minSegmentRows ?? 100,
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
        manifestPath: stringField(item.manifest_path),
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
  if (!dataset.datasetId || !dataset.manifestPath) {
    throw new Error("strategy data split datasets require dataset_id and manifest_path")
  }
  const sourceManifestPath = resolveReadablePath(dataset.manifestPath)
  const sourceManifest = asRecord(JSON.parse(readFileSync(sourceManifestPath, "utf8")))
  const timeframeEntry = asRecord(asRecord(sourceManifest.timeframes)[options.timeframe])
  const file = stringField(timeframeEntry.file)
  if (!file) {
    throw new Error(`manifest ${dataset.manifestPath} missing timeframe ${options.timeframe}`)
  }
  const csvPath = join(dirname(sourceManifestPath), file)
  const { header, rows } = readCsvRows(csvPath)
  const usableRows = rows.length - options.embargoBars * 2
  if (usableRows < options.minSegmentRows * 3) {
    throw new Error(`dataset ${dataset.datasetId} has ${rows.length} rows; not enough after embargo for three ${options.minSegmentRows}-row segments`)
  }
  const discoveryRows = Math.floor(usableRows * options.ratios.discovery)
  const validationRows = Math.floor(usableRows * options.ratios.validation)
  const holdoutRows = usableRows - discoveryRows - validationRows
  if (Math.min(discoveryRows, validationRows, holdoutRows) < options.minSegmentRows) {
    throw new Error(`dataset ${dataset.datasetId} split creates a segment below min_segment_rows=${options.minSegmentRows}`)
  }
  const discoveryStart = 0
  const validationStart = discoveryStart + discoveryRows + options.embargoBars
  const holdoutStart = validationStart + validationRows + options.embargoBars
  const symbol = stringField(sourceManifest.symbol) || stringField(sourceManifest.requested_symbol) || dataset.datasetId
  const baseDir = join(options.outputRoot, safeId(dataset.datasetId))
  const segments = [
    writeSegment("discovery", rows.slice(discoveryStart, discoveryStart + discoveryRows)),
    writeSegment("validation", rows.slice(validationStart, validationStart + validationRows)),
    writeSegment("locked_holdout", rows.slice(holdoutStart, holdoutStart + holdoutRows)),
  ]
  return {
    dataset_id: dataset.datasetId,
    source_manifest_path: displayPath(sourceManifestPath),
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
        source_manifest_path: displayPath(sourceManifestPath),
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
