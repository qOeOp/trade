import { readFileSync } from "node:fs"
import { loadCandlesFromManifest, replayDataHash, type Candle } from "./replay-core"
import type { BenchmarkDataset } from "./strategy-benchmark-inputs"

type JSONRecord = Record<string, unknown>

export interface FundingEvent { timestamp: string; value: number }

export interface FundingCoverage {
  status: "not_provided" | "partial" | "full"
  missing_dataset_ids: string[]
  event_counts: Record<string, number>
  max_gap_hours: number | null
  first_event: string | null
  last_event: string | null
}

export interface AlignedPanel {
  timestamps: number[]
  closes: number[][]
  diagnostics: PanelDiagnostics
}

export interface PanelDiagnostics {
  dataset_count: number
  target_dataset_count: number
  timeframe: string
  aligned_rows: number
  aligned_start: string | null
  aligned_end: string | null
  min_raw_rows: number
  min_aligned_ratio: number
  schema_version_ok: boolean
  closed_candles_only: boolean
  source_providers: string[]
  datasets: Array<{
    dataset_id: string
    manifest_ref: string
    indicator_report_ref?: string
    raw_rows: number
    aligned_rows: number
    aligned_ratio: number
    first_open: string | null
    last_open: string | null
    schema_version: number
    closed_candles_only: boolean
    source_provider: string
    source_market: string
    content_sha256_present: boolean
  }>
}

export interface PanelDiagnosticFinding {
  check_id: string
  severity: "info" | "warning" | "blocker"
  component: string
  evidence: JSONRecord
  next_system_action: string
}

export function alignedPanel(datasets: BenchmarkDataset[], timeframe: string): AlignedPanel {
  const loaded = datasets.map((dataset) => {
    const manifest = JSON.parse(readFileSync(dataset.manifestPath, "utf8")) as JSONRecord
    return { dataset, manifest, candles: loadCandlesFromManifest(dataset.manifestPath, manifest, timeframe) }
  })
  const common = loaded.slice(1).reduce((set, item) => {
    const candles = item.candles
    const available = new Set(candles.map((candle) => candle.timestamp))
    return new Set([...set].filter((timestamp) => available.has(timestamp)))
  }, new Set(loaded[0].candles.map((candle) => candle.timestamp)))
  const timestamps = [...common].sort((a, b) => a - b)
  if (timestamps.length === 0) throw new Error("trend benchmark datasets have no aligned timestamps")
  return {
    timestamps,
    closes: loaded.map((item) => alignCloses(item.candles, timestamps)),
    diagnostics: panelDiagnostics(loaded, timestamps, timeframe),
  }
}

export function datasetDataHash(dataset: BenchmarkDataset, timeframe: string): string {
  return replayDataHash(dataset.manifestPath, timeframe, dataset.indicatorReportPath ? [dataset.indicatorReportPath] : [])
}

export function panelFundingEvents(datasets: BenchmarkDataset[], firstTimestamp: number, lastTimestamp: number): { coverage: FundingCoverage; eventsByAsset: FundingEvent[][] } {
  const eventsByAsset = datasets.map((dataset) => loadFundingEvents(dataset.indicatorReportPath))
  const missing = datasets.filter((dataset, index) => !dataset.indicatorReportPath || eventsByAsset[index].length === 0).map((dataset) => dataset.datasetId)
  if (missing.length === datasets.length) return { eventsByAsset, coverage: fundingCoverage("not_provided", datasets, eventsByAsset, missing) }
  const allEvents = eventsByAsset.flat().map((event) => Date.parse(event.timestamp)).filter(Number.isFinite).sort((a, b) => a - b)
  const maxGapHours = maxFundingGapHours(eventsByAsset)
  const firstEvent = allEvents[0]
  const lastEvent = allEvents.at(-1)
  const incomplete = missing.length > 0 || !firstEvent || !lastEvent || firstEvent > firstTimestamp + 9 * 3_600_000 || lastEvent < lastTimestamp - 9 * 3_600_000 || maxGapHours > 9
  return { eventsByAsset, coverage: fundingCoverage(incomplete ? "partial" : "full", datasets, eventsByAsset, missing, maxGapHours, firstEvent, lastEvent) }
}

export function historicalFundingDrag(weights: number[], eventsByAsset: FundingEvent[][], offsets: number[], previousTimestamp: number, timestamp: number): number {
  return weights.reduce((sum, weight, asset) => {
    const events = eventsByAsset[asset]
    while (offsets[asset] < events.length && Date.parse(events[offsets[asset]].timestamp) <= previousTimestamp) offsets[asset] += 1
    let funding = 0
    while (offsets[asset] < events.length && Date.parse(events[offsets[asset]].timestamp) <= timestamp) {
      funding += events[offsets[asset]].value
      offsets[asset] += 1
    }
    return sum + weight * funding
  }, 0)
}

export function panelFindings(panel: JSONRecord): PanelDiagnosticFinding[] {
  const findings: PanelDiagnosticFinding[] = []
  if (panel.schema_version_ok !== true || panel.closed_candles_only !== true) {
    findings.push({
      check_id: "CAL-PANEL-SCHEMA",
      severity: "blocker",
      component: "data_panel",
      evidence: { schema_version_ok: panel.schema_version_ok, closed_candles_only: panel.closed_candles_only },
      next_system_action: "Regenerate calibration manifests with schema_version>=2, checksums, and closed candles only.",
    })
  }
  if (numberField(panel.min_aligned_ratio) < 0.95) {
    findings.push({
      check_id: "CAL-PANEL-ALIGNMENT",
      severity: "warning",
      component: "data_panel",
      evidence: { min_aligned_ratio: panel.min_aligned_ratio, aligned_rows: panel.aligned_rows, min_raw_rows: panel.min_raw_rows },
      next_system_action: "Diagnose listing windows, missing candles, and symbol overlap before treating panel results as market evidence.",
    })
  }
  return findings
}

function alignCloses(candles: Candle[], timestamps: number[]): number[] {
  const values = new Map(candles.map((candle) => [candle.timestamp, candle.close]))
  return timestamps.map((timestamp) => values.get(timestamp) || Number.NaN)
}

function panelDiagnostics(loaded: Array<{ dataset: BenchmarkDataset; manifest: JSONRecord; candles: Candle[] }>, timestamps: number[], timeframe: string): PanelDiagnostics {
  const alignedStart = timestamps[0] ?? 0
  const alignedEnd = timestamps.at(-1) ?? 0
  const datasetDiagnostics = loaded.map((item) => {
    const timeframeEntry = asRecord(asRecord(item.manifest.timeframes)[timeframe])
    const source = asRecord(item.manifest.source)
    const rowsInAlignedWindow = item.candles.filter((candle) => candle.timestamp >= alignedStart && candle.timestamp <= alignedEnd).length
    return {
      dataset_id: item.dataset.datasetId,
      manifest_ref: item.dataset.manifestPath,
      ...(item.dataset.indicatorReportPath ? { indicator_report_ref: item.dataset.indicatorReportPath } : {}),
      raw_rows: item.candles.length,
      aligned_rows: timestamps.length,
      aligned_ratio: round(timestamps.length / Math.max(1, rowsInAlignedWindow)),
      first_open: item.candles[0] ? new Date(item.candles[0].timestamp).toISOString() : null,
      last_open: item.candles.at(-1) ? new Date(item.candles.at(-1)!.timestamp).toISOString() : null,
      schema_version: numberField(item.manifest.schema_version),
      closed_candles_only: item.manifest.closed_candles_only === true,
      source_provider: stringField(source.provider),
      source_market: stringField(source.market),
      content_sha256_present: Boolean(stringField(timeframeEntry.content_sha256)),
    }
  })
  return {
    dataset_count: loaded.length,
    target_dataset_count: 20,
    timeframe,
    aligned_rows: timestamps.length,
    aligned_start: timestamps[0] ? new Date(timestamps[0]).toISOString() : null,
    aligned_end: timestamps.at(-1) ? new Date(timestamps.at(-1)!).toISOString() : null,
    min_raw_rows: Math.min(...datasetDiagnostics.map((item) => item.raw_rows)),
    min_aligned_ratio: round(Math.min(...datasetDiagnostics.map((item) => item.aligned_ratio))),
    schema_version_ok: datasetDiagnostics.every((item) => item.schema_version >= 2 && item.content_sha256_present),
    closed_candles_only: datasetDiagnostics.every((item) => item.closed_candles_only),
    source_providers: [...new Set(datasetDiagnostics.map((item) => item.source_provider).filter(Boolean))].sort(),
    datasets: datasetDiagnostics,
  }
}

function fundingCoverage(status: FundingCoverage["status"], datasets: BenchmarkDataset[], eventsByAsset: FundingEvent[][], missing: string[], maxGapHours: number | null = null, firstEvent?: number, lastEvent?: number): FundingCoverage {
  return {
    status,
    missing_dataset_ids: missing,
    event_counts: Object.fromEntries(datasets.map((dataset, index) => [dataset.datasetId, eventsByAsset[index].length])),
    max_gap_hours: maxGapHours === null ? null : round(maxGapHours),
    first_event: firstEvent ? new Date(firstEvent).toISOString() : null,
    last_event: lastEvent ? new Date(lastEvent).toISOString() : null,
  }
}

function loadFundingEvents(path?: string): FundingEvent[] {
  if (!path) return []
  const report = asRecord(JSON.parse(readFileSync(path, "utf8")))
  const raw = asRecord(asRecord(report.data).market_events).funding
  return (Array.isArray(raw) ? raw : []).map((item) => {
    const record = asRecord(item)
    return { timestamp: stringField(record.timestamp), value: Number(record.value) }
  }).filter((item) => item.timestamp && Number.isFinite(item.value)).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
}

function maxFundingGapHours(eventsByAsset: FundingEvent[][]): number {
  return eventsByAsset.reduce((maxGap, events) => {
    for (let index = 1; index < events.length; index += 1) {
      maxGap = Math.max(maxGap, (Date.parse(events[index].timestamp) - Date.parse(events[index - 1].timestamp)) / 3_600_000)
    }
    return maxGap
  }, 0)
}

function round(value: number): number { return Number.isFinite(value) ? Number(value.toFixed(6)) : value }
function asRecord(value: unknown): JSONRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {} }
function numberField(value: unknown): number { const number = Number(value); return Number.isFinite(number) ? number : 0 }
function stringField(value: unknown): string { return typeof value === "string" ? value.trim() : "" }
