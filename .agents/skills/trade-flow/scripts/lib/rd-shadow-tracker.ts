import { readFileSync } from "node:fs"
import { hashCanonical, loadCandlesFromManifest, type Candle } from "./replay-core"
import { asRecord, numberOrUndefined, stringField, type JSONRecord } from "./json"

type Side = "long" | "short"
type PositionStatus = "open" | "closed"
type PositionOutcome = "target" | "stop" | "time_exit"

interface RdShadowManifestRef {
  datasetId?: string
  symbol?: string
  manifestPath: string
}

interface RdShadowTrackerOptions {
  now?: string
  maxHoldBars?: number
  sourceRef?: string
  manifestRefs?: RdShadowManifestRef[]
}

interface RdShadowReviewDraft {
  strategy_id: string
  setup_id: string
  candidate_id: string
  symbol: string
  side: Side
  outcome: PositionOutcome
  pnl_r: number
  bars_held: number
  exit_time: string
  execution_attribution_required: true
  notes: string[]
}

interface RdShadowPaperPosition {
  position_id: string
  dataset_id: string
  symbol: string
  strategy_id: string
  setup_id: string
  candidate_id: string
  candidate_hash?: string
  timeframe: string
  side: Side
  signal_time: string
  opened_at: string
  entry_reference: number
  entry: number
  initial_stop: number
  stop: number
  active_stop: number
  target: number
  signal_index: number
  entry_index: number
  max_hold_bars: number
  bars_held: number
  status: PositionStatus
  source_manifest_path: string
  last_evaluated_index: number
  last_evaluated_candle_time?: string
  break_even_after_r?: number
  break_even_offset_r?: number
  exit_time?: string
  exit?: number
  outcome?: PositionOutcome
  r?: number
  review_draft?: RdShadowReviewDraft
}

interface RdShadowTrackerState {
  schema_version: 1
  tracker_id: string
  created_at: string
  updated_at: string
  source_forward_holdout_result_ref?: string
  status: "no_signals" | "open" | "closed"
  assumptions: JSONRecord
  summary: {
    position_count: number
    open_count: number
    closed_count: number
    target_count: number
    stop_count: number
    time_exit_count: number
    total_r: number
    avg_r: number | null
  }
  paper_positions: RdShadowPaperPosition[]
}

function createRdShadowTrackerFromForwardHoldout(rawReport: JSONRecord, options: RdShadowTrackerOptions = {}): RdShadowTrackerState {
  const report = unwrapForwardReport(rawReport)
  const now = normalizeTime(options.now) || new Date().toISOString()
  const positions = entryRecords(report).map((record) => positionFromRecord(report, record, options.maxHoldBars ?? 18))
  const state: RdShadowTrackerState = {
    schema_version: 1,
    tracker_id: buildTrackerId(report, options.sourceRef),
    created_at: now,
    updated_at: now,
    ...(options.sourceRef ? { source_forward_holdout_result_ref: options.sourceRef } : {}),
    status: "no_signals",
    assumptions: {
      execution_mode: "paper_shadow_only",
      entry_policy: "paper_market_after_signal_close_at_entry_reference",
      same_candle_policy: "stop_first",
      stop_gap_policy: "next_open_if_worse",
      protective_stop_policy: "optional_break_even_stop_activates_next_bar",
      promotion_policy: "not_promotion_evidence_until_reviewed_and_attributed",
    },
    summary: emptySummary(),
    paper_positions: positions,
  }
  return summarizeState(updateRdShadowTracker(state, options))
}

function updateRdShadowTracker(rawState: RdShadowTrackerState | JSONRecord, options: RdShadowTrackerOptions = {}): RdShadowTrackerState {
  const state = stateFromJson(asRecord(rawState))
  const manifestRefs = new Map<string, string>()
  for (const ref of options.manifestRefs || []) {
    if (ref.datasetId) manifestRefs.set(ref.datasetId, ref.manifestPath)
    if (ref.symbol) manifestRefs.set(ref.symbol, ref.manifestPath)
  }
  for (const position of state.paper_positions) {
    if (position.status !== "open") continue
    const manifestPath = manifestRefs.get(position.dataset_id) || manifestRefs.get(position.symbol) || position.source_manifest_path
    if (!manifestPath) continue
    updatePositionFromManifest(position, manifestPath)
  }
  state.updated_at = normalizeTime(options.now) || new Date().toISOString()
  return summarizeState(state)
}

function manifestRefsFromJson(value: JSONRecord): RdShadowManifestRef[] {
  const datasets = Array.isArray(value.datasets) ? value.datasets.map(asRecord) : []
  if (datasets.length > 0) {
    return datasets.map((item) => ({
      datasetId: stringField(item.dataset_id),
      symbol: stringField(item.symbol),
      manifestPath: stringField(item.manifest_path),
    })).filter((item) => item.manifestPath)
  }
  return Object.entries(value).flatMap(([key, raw]) => {
    if (typeof raw === "string") return [{ datasetId: key, symbol: key, manifestPath: raw }]
    const item = asRecord(raw)
    const manifestPath = stringField(item.manifest_path)
    return manifestPath ? [{ datasetId: key, symbol: stringField(item.symbol) || key, manifestPath }] : []
  })
}

function readJsonFile(path: string): JSONRecord {
  return JSON.parse(readFileSync(path, "utf8")) as JSONRecord
}

function unwrapForwardReport(raw: JSONRecord): JSONRecord {
  const data = asRecord(raw.data)
  return Array.isArray(data.records) ? data : raw
}

function entryRecords(report: JSONRecord): JSONRecord[] {
  return (Array.isArray(report.records) ? report.records.map(asRecord) : [])
    .filter((record) => asRecord(record.signal).action === "entry")
}

function positionFromRecord(report: JSONRecord, record: JSONRecord, maxHoldBars: number): RdShadowPaperPosition {
  const signalEnvelope = asRecord(record.signal)
  const signal = asRecord(signalEnvelope.signal)
  const side = parseSide(signal.side)
  const entry = requireNumber(signal.entry, "signal.entry")
  const stop = requireNumber(signal.stop, "signal.stop")
  const target = requireNumber(signal.target, "signal.target")
  const datasetId = stringField(record.dataset_id) || stringField(signalEnvelope.symbol) || "UNKNOWN"
  const symbol = stringField(signalEnvelope.symbol) || stringField(record.symbol) || datasetId
  const strategyId = stringField(report.strategy_id) || stringField(signalEnvelope.strategy_id)
  const setupId = stringField(report.setup_id)
  const candidateId = stringField(signalEnvelope.candidate_id) || stringField(asRecord(report.frozen_candidate).candidate_id)
  const signalTime = stringField(signalEnvelope.signal_time) || stringField(record.latest_candle_open)
  const openedAt = stringField(record.latest_candle_closed_at) || signalTime
  const entryIndex = requireInteger(signal.entry_index, "signal.entry_index")
  return {
    position_id: hashCanonical({ datasetId, symbol, strategyId, setupId, candidateId, signalTime, entry, stop, target }).slice(0, 24),
    dataset_id: datasetId,
    symbol,
    strategy_id: strategyId,
    setup_id: setupId,
    candidate_id: candidateId,
    candidate_hash: stringField(signalEnvelope.candidate_hash) || undefined,
    timeframe: stringField(report.timeframe) || stringField(signalEnvelope.timeframe) || "4h",
    side,
    signal_time: signalTime,
    opened_at: openedAt,
    entry_reference: requireNumber(signalEnvelope.entry_reference, "signal.entry_reference"),
    entry,
    initial_stop: stop,
    stop,
    active_stop: stop,
    target,
    signal_index: requireInteger(signal.signal_index, "signal.signal_index"),
    entry_index: entryIndex,
    max_hold_bars: maxHoldBars,
    bars_held: 0,
    status: "open",
    source_manifest_path: stringField(record.manifest_path),
    last_evaluated_index: entryIndex - 1,
    break_even_after_r: numberOrUndefined(signal.break_even_after_r),
    break_even_offset_r: numberOrUndefined(signal.break_even_offset_r),
  }
}

function updatePositionFromManifest(position: RdShadowPaperPosition, manifestPath: string): void {
  const manifest = readJsonFile(manifestPath)
  const candles = loadCandlesFromManifest(manifestPath, manifest, position.timeframe)
  const start = Math.max(position.last_evaluated_index + 1, firstPostOpenIndex(candles, position))
  if (start < 0) return
  const end = Math.min(candles.length - 1, position.entry_index + position.max_hold_bars - 1)
  for (let index = start; index <= end; index += 1) {
    const candle = candles[index]
    const barsHeld = index - position.entry_index + 1
    position.last_evaluated_index = index
    position.last_evaluated_candle_time = candle.date
    position.bars_held = Math.max(0, barsHeld)
    const outcome = hitOutcome(position, candle)
    if (outcome) {
      closePosition(position, candle, outcome, barsHeld)
      return
    }
    position.active_stop = nextProtectiveStop(position, candle)
    position.stop = position.active_stop
    if (barsHeld >= position.max_hold_bars) {
      closePosition(position, candle, "time_exit", barsHeld)
      return
    }
  }
}

function firstPostOpenIndex(candles: Candle[], position: RdShadowPaperPosition): number {
  if (position.entry_index >= 0 && position.entry_index < candles.length) return position.entry_index
  const openedAt = Date.parse(position.opened_at)
  if (!Number.isFinite(openedAt)) return -1
  return candles.findIndex((candle) => candle.timestamp >= openedAt)
}

function hitOutcome(position: RdShadowPaperPosition, candle: Candle): PositionOutcome | null {
  if (position.side === "long") {
    if (candle.low <= position.active_stop) return "stop"
    if (candle.high >= position.target) return "target"
    return null
  }
  if (candle.high >= position.active_stop) return "stop"
  if (candle.low <= position.target) return "target"
  return null
}

function closePosition(position: RdShadowPaperPosition, candle: Candle, outcome: PositionOutcome, barsHeld: number): void {
  const exit = exitPrice(position, candle, outcome)
  position.status = "closed"
  position.exit_time = candle.date
  position.exit = round(exit)
  position.outcome = outcome
  position.bars_held = Math.max(0, barsHeld)
  position.r = round(rMultiple(position, exit))
  position.review_draft = {
    strategy_id: position.strategy_id,
    setup_id: position.setup_id,
    candidate_id: position.candidate_id,
    symbol: position.symbol,
    side: position.side,
    outcome,
    pnl_r: position.r,
    bars_held: position.bars_held,
    exit_time: position.exit_time,
    execution_attribution_required: true,
    notes: [
      "R&D shadow tracker result is paper-only and cannot promote live-small without execution attribution.",
    ],
  }
}

function exitPrice(position: RdShadowPaperPosition, candle: Candle, outcome: PositionOutcome): number {
  if (outcome === "target") return position.target
  if (outcome === "time_exit") return candle.close
  return position.side === "long"
    ? Math.min(position.active_stop, candle.open)
    : Math.max(position.active_stop, candle.open)
}

function rMultiple(position: RdShadowPaperPosition, exit: number): number {
  const risk = Math.abs(position.entry - position.initial_stop)
  if (risk <= 0) return 0
  return position.side === "long" ? (exit - position.entry) / risk : (position.entry - exit) / risk
}

function nextProtectiveStop(position: RdShadowPaperPosition, candle: Candle): number {
  const triggerR = position.break_even_after_r
  if (!Number.isFinite(triggerR) || Number(triggerR) <= 0) return position.active_stop
  const risk = Math.abs(position.entry - position.initial_stop)
  if (risk <= 0) return position.active_stop
  const offsetR = Number.isFinite(position.break_even_offset_r) ? Number(position.break_even_offset_r) : 0
  if (position.side === "long") {
    const trigger = position.entry + risk * Number(triggerR)
    const protectedStop = position.entry + risk * offsetR
    return candle.high >= trigger ? Math.max(position.active_stop, protectedStop) : position.active_stop
  }
  const trigger = position.entry - risk * Number(triggerR)
  const protectedStop = position.entry - risk * offsetR
  return candle.low <= trigger ? Math.min(position.active_stop, protectedStop) : position.active_stop
}

function summarizeState(state: RdShadowTrackerState): RdShadowTrackerState {
  const closed = state.paper_positions.filter((position) => position.status === "closed")
  const open = state.paper_positions.filter((position) => position.status === "open")
  const totalR = round(closed.reduce((sum, position) => sum + (position.r ?? 0), 0))
  state.summary = {
    position_count: state.paper_positions.length,
    open_count: open.length,
    closed_count: closed.length,
    target_count: closed.filter((position) => position.outcome === "target").length,
    stop_count: closed.filter((position) => position.outcome === "stop").length,
    time_exit_count: closed.filter((position) => position.outcome === "time_exit").length,
    total_r: totalR,
    avg_r: closed.length > 0 ? round(totalR / closed.length) : null,
  }
  state.status = state.paper_positions.length === 0 ? "no_signals" : open.length > 0 ? "open" : "closed"
  return state
}

function stateFromJson(raw: JSONRecord): RdShadowTrackerState {
  const state = raw as unknown as RdShadowTrackerState
  if (state.schema_version !== 1 || !Array.isArray(state.paper_positions)) {
    throw new Error("rd shadow tracker state must be schema_version=1 with paper_positions")
  }
  return state
}

function buildTrackerId(report: JSONRecord, sourceRef?: string): string {
  return hashCanonical({
    sourceRef,
    strategy_id: report.strategy_id,
    setup_id: report.setup_id,
    frozen_at: report.frozen_at,
    signal_records: entryRecords(report).map((record) => ({
      dataset_id: record.dataset_id,
      signal_time: asRecord(record.signal).signal_time,
    })),
  }).slice(0, 24)
}

function emptySummary(): RdShadowTrackerState["summary"] {
  return {
    position_count: 0,
    open_count: 0,
    closed_count: 0,
    target_count: 0,
    stop_count: 0,
    time_exit_count: 0,
    total_r: 0,
    avg_r: null,
  }
}

function parseSide(value: unknown): Side {
  const side = stringField(value)
  if (side === "long" || side === "short") return side
  throw new Error(`unsupported side ${side}`)
}

function requireNumber(value: unknown, name: string): number {
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error(`${name} must be finite`)
  return number
}

function requireInteger(value: unknown, name: string): number {
  const number = requireNumber(value, name)
  if (!Number.isInteger(number)) throw new Error(`${name} must be an integer`)
  return number
}

function normalizeTime(value: unknown): string {
  const parsed = Date.parse(stringField(value))
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : ""
}

function round(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : value
}

export {
  createRdShadowTrackerFromForwardHoldout,
  manifestRefsFromJson,
  readJsonFile,
  updateRdShadowTracker,
  type RdShadowManifestRef,
  type RdShadowPaperPosition,
  type RdShadowTrackerOptions,
  type RdShadowTrackerState,
}
