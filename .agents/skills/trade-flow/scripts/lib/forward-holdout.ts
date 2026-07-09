import { readFileSync } from "node:fs"
import { hashCanonical, loadCandlesFromManifest, type Candle } from "./replay-core"
import { evaluateRndSignal, type StrategyRndCandidateInput } from "./strategy-rnd"
import type { JSONRecord } from "./json"

interface ForwardHoldoutDataset {
  datasetId: string
  manifestPath: string
  indicatorReportPath?: string
  entryPrice?: number
}

interface ForwardHoldoutInput {
  strategyId: string
  setupId: string
  frozenAt: string
  candidate: StrategyRndCandidateInput
  datasets: ForwardHoldoutDataset[]
  timeframe?: string
  benchmarkManifestPath?: string
  now?: string
  maxSignalAgeBars?: number
}

interface ForwardHoldoutPanelOptions {
  plan?: JSONRecord
  strategyId?: string
  setupId?: string
  frozenAt?: string
  candidateId?: string
  now?: string
  maxSignalAgeBars?: number
}

interface ForwardHoldoutRecord {
  dataset_id: string
  manifest_path: string
  symbol: string
  latest_candle_open: string
  latest_candle_closed_at: string
  eligible: boolean
  blocked_by: Array<{ check_id: string; reason: string }>
  signal?: JSONRecord
}

interface ForwardHoldoutReport {
  strategy_id: string
  setup_id: string
  frozen_at: string
  now: string
  timeframe: string
  status: "blocked" | "waiting_for_signal" | "signal_found"
  next_action: string
  frozen_candidate: {
    candidate_id: string
    family: string
    parameter_count: number
    candidate_hash: string
  }
  dataset_count: number
  eligible_count: number
  signal_count: number
  blocked_count: number
  records: ForwardHoldoutRecord[]
}

function runForwardHoldout(input: ForwardHoldoutInput): ForwardHoldoutReport {
  if (!input.strategyId || !input.setupId || !input.frozenAt) {
    throw new Error("forward holdout requires strategyId, setupId, and frozenAt")
  }
  if (!input.candidate?.candidateId) {
    throw new Error("forward holdout requires a frozen candidate")
  }
  if (input.datasets.length < 1) {
    throw new Error("forward holdout requires at least one dataset")
  }
  const frozenAtMs = Date.parse(input.frozenAt)
  if (!Number.isFinite(frozenAtMs)) {
    throw new Error("forward holdout frozenAt must be parseable time")
  }
  const records = input.datasets.map((dataset) => evaluateDataset(input, dataset, frozenAtMs))
  const eligibleCount = records.filter((record) => record.eligible).length
  const signalCount = records.filter((record) => record.signal?.action === "entry").length
  const status = eligibleCount === 0 ? "blocked" : signalCount > 0 ? "signal_found" : "waiting_for_signal"
  return {
    strategy_id: input.strategyId,
    setup_id: input.setupId,
    frozen_at: new Date(frozenAtMs).toISOString(),
    now: input.now || new Date().toISOString(),
    timeframe: input.timeframe || "4h",
    status,
    next_action: nextAction(status),
    frozen_candidate: {
      candidate_id: input.candidate.candidateId,
      family: input.candidate.family || "trend_pullback_v1",
      parameter_count: input.candidate.parameterCount ?? countActiveParameters(input.candidate.params || {}),
      candidate_hash: hashCanonical({ family: input.candidate.family || "trend_pullback_v1", params: input.candidate.params || {} }),
    },
    dataset_count: records.length,
    eligible_count: eligibleCount,
    signal_count: signalCount,
    blocked_count: records.filter((record) => record.blocked_by.length > 0).length,
    records,
  }
}

function forwardHoldoutInputFromJson(value: JSONRecord): ForwardHoldoutInput {
  const candidate = candidateFromJson(asRecord(value.candidate))
  const params = asRecord(candidate.params)
  const benchmarkManifestPath = stringField(value.benchmark_manifest_path)
  if (benchmarkManifestPath && !stringField(params.benchmark_manifest_path)) {
    candidate.params = { ...params, benchmark_manifest_path: benchmarkManifestPath }
  }
  return {
    strategyId: stringField(value.strategy_id),
    setupId: stringField(value.setup_id),
    frozenAt: stringField(value.frozen_at),
    timeframe: stringField(value.timeframe) || undefined,
    benchmarkManifestPath: benchmarkManifestPath || undefined,
    now: stringField(value.now) || undefined,
    maxSignalAgeBars: optionalNumber(value.max_signal_age_bars),
    candidate,
    datasets: array(value.datasets).map((raw) => {
      const item = asRecord(raw)
      return {
        datasetId: stringField(item.dataset_id),
        manifestPath: stringField(item.manifest_path),
        indicatorReportPath: stringField(item.indicator_report_path) || undefined,
        entryPrice: optionalNumber(item.entry_price),
      }
    }),
  }
}

function forwardHoldoutInputFromPanelJson(panel: JSONRecord, options: ForwardHoldoutPanelOptions = {}): ForwardHoldoutInput {
  const plan = asRecord(options.plan)
  const planCandidate = asRecord(plan.candidate)
  const panelCandidates = array(panel.candidates).map(asRecord)
  const requestedCandidateId = stringField(options.candidateId ?? planCandidate.candidate_id)
  const panelCandidate = requestedCandidateId
    ? panelCandidates.find((candidate) => stringField(candidate.candidate_id) === requestedCandidateId)
    : panelCandidates.length === 1
      ? panelCandidates[0]
      : {}
  const selectedCandidate = Object.keys(planCandidate).length > 0
    ? { ...asRecord(panelCandidate), ...planCandidate, params: { ...asRecord(asRecord(panelCandidate).params), ...asRecord(planCandidate.params) } }
    : requestedCandidateId
      ? panelCandidates.find((candidate) => stringField(candidate.candidate_id) === requestedCandidateId)
      : panelCandidates.length === 1
        ? panelCandidates[0]
        : {}
  const candidate = candidateFromJson(asRecord(selectedCandidate))
  const frozenAt = stringField(
    options.frozenAt
      ?? plan.frozen_at
      ?? planCandidate.frozen_at
      ?? panel.frozen_at
  )
  if (!frozenAt) {
    throw new Error("forward holdout panel input requires explicit frozenAt; do not infer freeze time from artifact names or generated_at")
  }
  return {
    strategyId: stringField(options.strategyId ?? panel.strategy_id ?? plan.strategy_id ?? plan.run_id ?? panel.panel_id),
    setupId: stringField(options.setupId ?? panel.setup_id ?? plan.setup_id ?? plan.run_id ?? panel.panel_id),
    frozenAt,
    timeframe: stringField(panel.timeframe ?? plan.timeframe) || undefined,
    now: options.now,
    maxSignalAgeBars: options.maxSignalAgeBars,
    candidate,
    datasets: array(panel.datasets).map((raw) => {
      const item = asRecord(raw)
      return {
        datasetId: stringField(item.dataset_id),
        manifestPath: stringField(item.manifest_path),
        indicatorReportPath: stringField(item.indicator_report_path) || undefined,
        entryPrice: optionalNumber(item.entry_price),
      }
    }),
  }
}

function candidateFromJson(input: JSONRecord): StrategyRndCandidateInput {
  return {
    candidateId: stringField(input.candidate_id),
    description: stringField(input.description) || undefined,
    family: stringField(input.family) || undefined,
    parameterCount: optionalNumber(input.parameter_count),
    params: asRecord(input.params),
  }
}

function evaluateDataset(input: ForwardHoldoutInput, dataset: ForwardHoldoutDataset, frozenAtMs: number): ForwardHoldoutRecord {
  const manifest = readManifest(dataset.manifestPath)
  const timeframe = input.timeframe || "4h"
  const candles = loadCandlesFromManifest(dataset.manifestPath, manifest, timeframe)
  const latest = candles.at(-1)
  if (!latest) {
    return blockedRecord(dataset, manifest, { date: "", timestamp: 0, open: 0, high: 0, low: 0, close: 0, volume: 0 }, timeframe, "HOLDOUT-DATA-EMPTY", "dataset has no candles")
  }
  const closedAt = latest.timestamp + timeframeMilliseconds(timeframe)
  const blockedBy = manifestGuards(manifest)
  blockedBy.push(...supplementalManifestGuards(input, frozenAtMs, timeframe))
  if (closedAt <= frozenAtMs) {
    blockedBy.push({ check_id: "HOLDOUT-NOT-FORWARD", reason: "latest closed candle is not after strategy freeze time" })
  }
  if (blockedBy.length > 0) {
    return recordFor(dataset, manifest, latest, timeframe, false, blockedBy)
  }
  try {
    const signal = evaluateRndSignal({
      manifestPath: dataset.manifestPath,
      indicatorReportPath: dataset.indicatorReportPath,
      timeframe,
      entryPrice: dataset.entryPrice || latest.close,
      now: input.now,
      maxSignalAgeBars: input.maxSignalAgeBars,
      candidate: input.candidate,
    })
    return { ...recordFor(dataset, manifest, latest, timeframe, true, []), signal }
  } catch (error) {
    return recordFor(dataset, manifest, latest, timeframe, false, [{
      check_id: "HOLDOUT-SIGNAL-ERROR",
      reason: error instanceof Error ? error.message : String(error),
    }])
  }
}

function manifestGuards(manifest: JSONRecord): Array<{ check_id: string; reason: string }> {
  const blockedBy: Array<{ check_id: string; reason: string }> = []
  if (Number(manifest.schema_version) !== 2) {
    blockedBy.push({ check_id: "HOLDOUT-SCHEMA", reason: "manifest schema_version must be 2" })
  }
  if (manifest.closed_candles_only !== true) {
    blockedBy.push({ check_id: "HOLDOUT-CLOSED-CANDLES", reason: "manifest must declare closed_candles_only=true" })
  }
  return blockedBy
}

function supplementalManifestGuards(input: ForwardHoldoutInput, frozenAtMs: number, timeframe: string): Array<{ check_id: string; reason: string }> {
  const refs = supplementalManifestRefs(input)
  const blockedBy: Array<{ check_id: string; reason: string }> = []
  for (const ref of refs) {
    try {
      const manifest = readManifest(ref)
      blockedBy.push(...manifestGuards(manifest).map((item) => ({
        check_id: `HOLDOUT-SUPPLEMENTAL-${item.check_id.replace(/^HOLDOUT-/, "")}`,
        reason: `${ref}: ${item.reason}`,
      })))
      const candles = loadCandlesFromManifest(ref, manifest, timeframe)
      const latest = candles.at(-1)
      if (!latest) {
        blockedBy.push({ check_id: "HOLDOUT-SUPPLEMENTAL-DATA-EMPTY", reason: `${ref}: supplemental dataset has no candles` })
        continue
      }
      const closedAt = latest.timestamp + timeframeMilliseconds(timeframe)
      if (closedAt <= frozenAtMs) {
        blockedBy.push({ check_id: "HOLDOUT-SUPPLEMENTAL-NOT-FORWARD", reason: `${ref}: latest closed candle is not after strategy freeze time` })
      }
    } catch (error) {
      blockedBy.push({
        check_id: "HOLDOUT-SUPPLEMENTAL-ERROR",
        reason: `${ref}: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }
  return blockedBy
}

function supplementalManifestRefs(input: ForwardHoldoutInput): string[] {
  const params = asRecord(input.candidate.params)
  return [
    input.benchmarkManifestPath,
    stringField(params.benchmark_manifest_path),
  ].filter((ref): ref is string => Boolean(ref))
    .filter((ref, index, refs) => refs.indexOf(ref) === index)
}

function blockedRecord(dataset: ForwardHoldoutDataset, manifest: JSONRecord, latest: Candle, timeframe: string, checkId: string, reason: string): ForwardHoldoutRecord {
  return recordFor(dataset, manifest, latest, timeframe, false, [{ check_id: checkId, reason }])
}

function recordFor(dataset: ForwardHoldoutDataset, manifest: JSONRecord, latest: Candle, timeframe: string, eligible: boolean, blockedBy: Array<{ check_id: string; reason: string }>): ForwardHoldoutRecord {
  return {
    dataset_id: dataset.datasetId,
    manifest_path: dataset.manifestPath,
    symbol: stringField(manifest.symbol) || stringField(manifest.requested_symbol) || "UNKNOWN",
    latest_candle_open: latest.date,
    latest_candle_closed_at: new Date(latest.timestamp + timeframeMilliseconds(timeframe)).toISOString(),
    eligible,
    blocked_by: blockedBy,
  }
}

function timeframeMilliseconds(timeframe: string): number {
  const match = timeframe.match(/^(\d+)([mhdw])$/)
  if (!match) throw new Error(`unsupported timeframe ${timeframe}`)
  const value = Number(match[1])
  const unit = match[2]
  const multipliers: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }
  return value * multipliers[unit]
}

function readManifest(path: string): JSONRecord {
  return JSON.parse(readFileSync(path, "utf8")) as JSONRecord
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function optionalNumber(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function nextAction(status: ForwardHoldoutReport["status"]): string {
  switch (status) {
    case "signal_found":
      return "Route any entry signal to shadow/paper review only; do not promote from forward holdout alone."
    case "waiting_for_signal":
      return "Hold the frozen candidate and re-run on the next closed forward candle."
    default:
      return "Fix forward holdout data coverage before interpreting the frozen candidate."
  }
}

function countActiveParameters(params: JSONRecord): number {
  return Object.values(params).reduce<number>((count, value) => {
    if (Array.isArray(value)) return count + value.length
    return value !== undefined && value !== null && value !== "" ? count + 1 : count
  }, 0)
}

export { forwardHoldoutInputFromJson, forwardHoldoutInputFromPanelJson, runForwardHoldout, type ForwardHoldoutInput, type ForwardHoldoutPanelOptions, type ForwardHoldoutReport }
