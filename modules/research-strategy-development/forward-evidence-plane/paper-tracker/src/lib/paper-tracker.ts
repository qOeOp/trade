import { readFileSync } from "node:fs"
import { canonicalHash as hashCanonical } from "../../../../../contracts/runtime-core/src/canonical-json"
import { loadCandlesFromManifest, loadManifest, type Candle } from "../../../../replay-execution-plane/compatibility/legacy-research-data/src/lib/legacy-research-data"
import { buildSetupEvent, projectSetupEvents, type SetupEvent, type SetupProjection } from "./setup-event-chain"
import { asRecord, numberOrUndefined, stringField, type JSONRecord } from "../../../../../contracts/runtime-core/src/json"

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
  forwardReport?: JSONRecord
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
  entry_quality: string
  exit_quality: string
  execution_attribution_required: true
  can_be_strategy_evidence: false
  notes: string[]
}

interface RdShadowPaperPosition {
  position_id: string
  rd_chain_id: string
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
  source_forward_result_ref?: string
  last_evaluated_index: number
  last_evaluated_candle_time?: string
  break_even_after_r?: number
  break_even_offset_r?: number
  entry_evidence: JSONRecord
  events: SetupEvent[]
  projection: SetupProjection
  exit_time?: string
  exit?: number
  outcome?: PositionOutcome
  r?: number
  review_draft?: RdShadowReviewDraft
}

interface RdShadowTrackerState {
  schema_version: 2
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
    event_count: number
  }
  paper_positions: RdShadowPaperPosition[]
}

function createRdShadowTrackerFromForwardHoldout(rawReport: JSONRecord, options: RdShadowTrackerOptions = {}): RdShadowTrackerState {
  const report = unwrapForwardReport(rawReport)
  const now = normalizeTime(options.now) || new Date().toISOString()
  const positions = entryRecords(report).map((record) => positionFromRecord(report, record, options.maxHoldBars ?? 18, options.sourceRef, now))
  const state: RdShadowTrackerState = {
    schema_version: 2,
    tracker_id: buildTrackerId(report, options.sourceRef),
    created_at: now,
    updated_at: now,
    ...(options.sourceRef ? { source_forward_holdout_result_ref: options.sourceRef } : {}),
    status: "no_signals",
    assumptions: {
      design: "behavior_driven_setup_event_chain_v1",
      backend: "rd_artifact",
      execution_mode: "paper_shadow_only",
      entry_policy: "paper_market_after_signal_close_at_entry_reference",
      same_candle_policy: "stop_first",
      stop_gap_policy: "next_open_if_worse",
      protective_stop_policy: "optional_break_even_stop_activates_next_bar",
      promotion_policy: "raw_rd_chain_is_review_input_not_promotion_evidence",
    },
    summary: emptySummary(),
    paper_positions: positions,
  }
  return summarizeState(updateRdShadowTracker(state, options))
}

function updateRdShadowTracker(rawState: RdShadowTrackerState | JSONRecord, options: RdShadowTrackerOptions = {}): RdShadowTrackerState {
  const state = stateFromJson(unwrapTrackerState(asRecord(rawState)))
  const now = normalizeTime(options.now) || new Date().toISOString()
  suppressDuplicateOpenPositions(state)
  if (options.forwardReport) {
    mergeForwardEntries(state, unwrapForwardReport(options.forwardReport), options, now)
  }
  const manifestRefs = new Map<string, string>()
  for (const ref of options.manifestRefs || []) {
    if (ref.datasetId) manifestRefs.set(ref.datasetId, ref.manifestPath)
    if (ref.symbol) manifestRefs.set(ref.symbol, ref.manifestPath)
  }
  for (const position of state.paper_positions) {
    refreshPositionProjection(position)
    if (position.status !== "open") continue
    const manifestPath = manifestRefs.get(position.dataset_id) || manifestRefs.get(position.symbol) || position.source_manifest_path
      updatePositionFromManifest(position, manifestPath)
  }
  state.updated_at = now
  return summarizeState(state)
}

function mergeForwardEntries(state: RdShadowTrackerState, report: JSONRecord, options: RdShadowTrackerOptions, now: string): void {
  const existingIds = new Set(state.paper_positions.map((position) => position.position_id))
  const maxHoldBars = options.maxHoldBars ?? state.paper_positions[0]?.max_hold_bars ?? 18
  for (const record of entryRecords(report)) {
    const position = positionFromRecord(report, record, maxHoldBars, options.sourceRef, now)
    if (existingIds.has(position.position_id)) continue
    const existingOpen = matchingOpenPosition(state, position)
    if (existingOpen) {
      appendSuppressedReentryEvent(existingOpen, position, record)
      continue
    }
    state.paper_positions.push(position)
    existingIds.add(position.position_id)
  }
  if (options.sourceRef) state.source_forward_holdout_result_ref = options.sourceRef
}

function matchingOpenPosition(state: RdShadowTrackerState, incoming: RdShadowPaperPosition): RdShadowPaperPosition | undefined {
  return state.paper_positions.find((position) => position.status === "open" && sameOpenPositionKey(position, incoming))
}

function suppressDuplicateOpenPositions(state: RdShadowTrackerState): void {
  const openByKey = new Map<string, RdShadowPaperPosition>()
  const uniquePositions: RdShadowPaperPosition[] = []
  for (const position of state.paper_positions) {
    refreshPositionProjection(position)
    if (position.status !== "open") {
      uniquePositions.push(position)
      continue
    }
    const key = openPositionKey(position)
    const existing = openByKey.get(key)
    if (existing) {
      appendSuppressedReentryEvent(existing, position)
      continue
    }
    openByKey.set(key, position)
    uniquePositions.push(position)
  }
  state.paper_positions = uniquePositions
}

function sameOpenPositionKey(existing: RdShadowPaperPosition, incoming: RdShadowPaperPosition): boolean {
  return openPositionKey(existing) === openPositionKey(incoming)
}

function openPositionKey(position: RdShadowPaperPosition): string {
  return [
    position.symbol,
    position.side,
    position.strategy_id,
    position.candidate_hash || position.candidate_id,
  ].join("\u0000")
}

function appendSuppressedReentryEvent(existing: RdShadowPaperPosition, incoming: RdShadowPaperPosition, record?: JSONRecord): void {
  if (existing.events.some((event) => {
    const payload = asRecord(event.payload)
    return stringField(payload.event_type) === "rd_reinforce_signal"
      && stringField(payload.suppressed_position_id) === incoming.position_id
  })) return
  const signalEvent = buildSetupEvent({
    chainId: existing.rd_chain_id,
    behavior: "observe_setup",
    backend: "rd_artifact",
    source: "rd_4h_tracker",
    createdAt: incoming.opened_at || incoming.signal_time,
    payload: {
      event_type: "rd_reinforce_signal",
      position_id: existing.position_id,
      rd_chain_id: existing.rd_chain_id,
      suppressed_position_id: incoming.position_id,
      suppression_reason: "open_same_symbol_candidate_side",
      symbol: existing.symbol,
      side: existing.side,
      strategy_id: existing.strategy_id,
      setup_id: existing.setup_id,
      candidate_id: existing.candidate_id,
      candidate_hash: existing.candidate_hash,
      signal_time: incoming.signal_time,
      data_cutoff: stringField(record?.latest_candle_closed_at) || incoming.opened_at,
      entry_reference: incoming.entry_reference,
      entry: incoming.entry,
      stop: incoming.initial_stop,
      target: incoming.target,
      active_position_entry: existing.entry,
      active_position_opened_at: existing.opened_at,
      active_position_stop: existing.active_stop,
      active_position_target: existing.target,
    },
  })
  existing.events.push(signalEvent)
  refreshPositionProjection(existing)
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

function positionFromRecord(report: JSONRecord, record: JSONRecord, maxHoldBars: number, sourceRef: string | undefined, now: string): RdShadowPaperPosition {
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
  const positionId = hashCanonical({ datasetId, symbol, strategyId, setupId, candidateId, signalTime, entry, stop, target }).slice(0, 24)
  const rdChainId = `rd-${positionId}`
  const entryEvidence = buildEntryEvidence({ report, record, signalEnvelope, signal, positionId, rdChainId, maxHoldBars, sourceRef })
  const openEvent = buildSetupEvent({
    chainId: rdChainId,
    behavior: "open_setup",
    backend: "rd_artifact",
    source: "rd_4h_tracker",
    createdAt: now,
    payload: entryEvidence,
  })
  const projection = projectSetupEvents([openEvent])
  return {
    position_id: positionId,
    rd_chain_id: rdChainId,
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
    ...(sourceRef ? { source_forward_result_ref: sourceRef } : {}),
    last_evaluated_index: entryIndex - 1,
    break_even_after_r: numberOrUndefined(signal.break_even_after_r),
    break_even_offset_r: numberOrUndefined(signal.break_even_offset_r),
    entry_evidence: entryEvidence,
    events: [openEvent],
    projection,
  }
}

function buildEntryEvidence(input: {
  report: JSONRecord
  record: JSONRecord
  signalEnvelope: JSONRecord
  signal: JSONRecord
  positionId: string
  rdChainId: string
  maxHoldBars: number
  sourceRef?: string
}): JSONRecord {
  const params = asRecord(input.signalEnvelope.params)
  const signalMeta = asRecord(input.signal.meta)
  const side = parseSide(input.signal.side)
  const entry = requireNumber(input.signal.entry, "signal.entry")
  const stop = requireNumber(input.signal.stop, "signal.stop")
  const target = requireNumber(input.signal.target, "signal.target")
  return {
    event_type: "rd_entry_evidence",
    position_id: input.positionId,
    rd_chain_id: input.rdChainId,
    strategy_id: stringField(input.report.strategy_id) || stringField(input.signalEnvelope.strategy_id),
    setup_id: stringField(input.report.setup_id),
    candidate_id: stringField(input.signalEnvelope.candidate_id) || stringField(asRecord(input.report.frozen_candidate).candidate_id),
    candidate_hash: stringField(input.signalEnvelope.candidate_hash),
    data_hash: stringField(input.signalEnvelope.data_hash),
    symbol: stringField(input.signalEnvelope.symbol) || stringField(input.record.symbol),
    side,
    timeframe: stringField(input.report.timeframe) || stringField(input.signalEnvelope.timeframe) || "4h",
    signal_time: stringField(input.signalEnvelope.signal_time) || stringField(input.record.latest_candle_open),
    data_cutoff: stringField(input.record.latest_candle_closed_at),
    source_forward_result_ref: input.sourceRef || null,
    source_manifest_path: stringField(input.record.manifest_path),
    setup_template_ref: {
      family: stringField(input.signalEnvelope.family) || stringField(asRecord(input.report.frozen_candidate).family),
      params: Object.keys(params).length > 0 ? params : signalMeta,
    },
    entry_reference: requireNumber(input.signalEnvelope.entry_reference, "signal.entry_reference"),
    entry,
    initial_stop: stop,
    active_stop: stop,
    stop,
    target,
    max_hold_bars: input.maxHoldBars,
    break_even_after_r: numberOrUndefined(input.signal.break_even_after_r),
    break_even_offset_r: numberOrUndefined(input.signal.break_even_offset_r),
    signal_index: requireInteger(input.signal.signal_index, "signal.signal_index"),
    entry_index: requireInteger(input.signal.entry_index, "signal.entry_index"),
    entry_evidence: [
      { id: "forward_holdout_entry", kind: "hard", passed: true, value: "entry" },
      { id: "candidate_hash_frozen", kind: "hard", passed: Boolean(stringField(input.signalEnvelope.candidate_hash)), value: stringField(input.signalEnvelope.candidate_hash) },
      { id: "holdout_record_eligible", kind: "hard", passed: input.record.eligible === true, value: input.record.eligible === true },
    ],
    invalidation_rules: [
      { id: "initial_stop", type: "price", level: stop, meaning: "paper thesis invalidated by adverse move" },
      { id: "max_hold_bars", type: "time", bars: input.maxHoldBars, meaning: "paper thesis did not resolve inside expected horizon" },
    ],
    no_trade_filters: [
      { id: "holdout_blockers", passed: asArray(input.record.blocked_by).length === 0, value: asArray(input.record.blocked_by) },
    ],
  }
}

function updatePositionFromManifest(position: RdShadowPaperPosition, manifestPath: string): void {
  const manifest = loadManifest(manifestPath)
  const candles = loadCandlesFromManifest(manifestPath, manifest, position.timeframe)
  const start = Math.max(position.last_evaluated_index + 1, firstPostOpenIndex(candles, position))
  if (start < 0) return
  const end = Math.min(candles.length - 1, position.entry_index + position.max_hold_bars - 1)
  for (let index = start; index <= end; index += 1) {
    const candle = candles[index]
    const barsHeld = index - position.entry_index + 1
    const outcome = hitOutcome(position, candle)
    const hitTimeExit = !outcome && barsHeld >= position.max_hold_bars
    const activeStopBefore = position.active_stop
    const activeStopAfter = outcome || hitTimeExit ? activeStopBefore : nextProtectiveStop(position, candle)
    appendObservationEvent(position, candle, {
      index,
      barsHeld,
      activeStopBefore,
      activeStopAfter,
      hitStop: outcome === "stop",
      hitTarget: outcome === "target",
      hitTimeExit,
      sourceManifestPath: manifestPath,
    })
    position.last_evaluated_index = index
    position.last_evaluated_candle_time = candle.date
    position.bars_held = Math.max(0, barsHeld)
    if (outcome || hitTimeExit) {
      closePosition(position, candle, outcome || "time_exit", barsHeld, activeStopBefore)
      return
    }
    position.active_stop = activeStopAfter
    position.stop = activeStopAfter
    refreshPositionProjection(position)
  }
}

function appendObservationEvent(
  position: RdShadowPaperPosition,
  candle: Candle,
  input: {
    index: number
    barsHeld: number
    activeStopBefore: number
    activeStopAfter: number
    hitStop: boolean
    hitTarget: boolean
    hitTimeExit: boolean
    sourceManifestPath: string
  },
): void {
  const pathR = candlePathR(position, candle)
  const barClosedAt = new Date(candle.timestamp + timeframeMilliseconds(position.timeframe)).toISOString()
  const breakEvenArmed = isBreakEvenArmed(position, input.activeStopAfter)
  position.events.push(buildSetupEvent({
    chainId: position.rd_chain_id,
    behavior: "observe_setup",
    backend: "rd_artifact",
    source: "rd_4h_tracker",
    createdAt: barClosedAt,
    payload: {
      event_type: "rd_observation",
      position_id: position.position_id,
      rd_chain_id: position.rd_chain_id,
      observed_at: barClosedAt,
      source: "rd_4h_tracker",
      bar_timeframe: position.timeframe,
      bar_index: input.index,
      bar_open_time: candle.date,
      bar_closed_at: barClosedAt,
      open: round(candle.open),
      high: round(candle.high),
      low: round(candle.low),
      close: round(candle.close),
      volume: round(candle.volume),
      mfe_r: pathR.mfe,
      mae_r: pathR.mae,
      close_r: pathR.close,
      bars_held: Math.max(0, input.barsHeld),
      active_stop_before: round(input.activeStopBefore),
      active_stop: round(input.activeStopAfter),
      target: round(position.target),
      break_even_armed: breakEvenArmed,
      hit_stop: input.hitStop,
      hit_target: input.hitTarget,
      hit_time_exit: input.hitTimeExit,
      source_manifest_path: input.sourceManifestPath,
      evidence_state: {
        invalidation_hit: input.hitStop,
        target_hit: input.hitTarget,
        break_even_armed: breakEvenArmed,
      },
    },
  }))
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

function closePosition(position: RdShadowPaperPosition, candle: Candle, outcome: PositionOutcome, barsHeld: number, activeStop: number): void {
  const exit = exitPrice(position, candle, outcome, activeStop)
  const r = round(rMultiple(position, exit))
  const exitTime = candle.date
  position.events.push(buildSetupEvent({
    chainId: position.rd_chain_id,
    behavior: "close_setup",
    backend: "rd_artifact",
    source: "rd_4h_tracker",
    createdAt: exitTime,
    payload: {
      event_type: "rd_exit",
      position_id: position.position_id,
      rd_chain_id: position.rd_chain_id,
      exit_reason: outcome,
      exit_time: exitTime,
      exit_price: round(exit),
      r,
      bars_held: Math.max(0, barsHeld),
      same_bar_policy: "stop_first",
      path_summary: projectSetupEvents(position.events),
    },
  }))
  position.status = "closed"
  position.exit_time = exitTime
  position.exit = round(exit)
  position.outcome = outcome
  position.bars_held = Math.max(0, barsHeld)
  position.r = r
  position.review_draft = buildReviewDraft(position, outcome, r, exitTime)
  position.events.push(buildSetupEvent({
    chainId: position.rd_chain_id,
    behavior: "review_setup",
    backend: "rd_artifact",
    source: "rd_4h_tracker",
    createdAt: exitTime,
    payload: {
      event_type: "rd_review_draft",
      position_id: position.position_id,
      rd_chain_id: position.rd_chain_id,
      ...position.review_draft,
    },
  }))
  refreshPositionProjection(position)
}

function buildReviewDraft(position: RdShadowPaperPosition, outcome: PositionOutcome, r: number, exitTime: string): RdShadowReviewDraft {
  const projection = projectSetupEvents(position.events)
  return {
    strategy_id: position.strategy_id,
    setup_id: position.setup_id,
    candidate_id: position.candidate_id,
    symbol: position.symbol,
    side: position.side,
    outcome,
    pnl_r: r,
    bars_held: position.bars_held,
    exit_time: exitTime,
    entry_quality: entryQuality(projection),
    exit_quality: exitQuality(outcome, projection),
    execution_attribution_required: true,
    can_be_strategy_evidence: false,
    notes: [
      "R&D event chain is paper-only and cannot promote live-small without formal shadow execution attribution.",
    ],
  }
}

function entryQuality(projection: SetupProjection): string {
  if (projection.mae_r !== null && projection.mae_r <= -1) return "failed_before_sustained_favorable_excursion"
  if (projection.mfe_r !== null && projection.mfe_r >= 1) return "favorable_excursion_confirmed"
  return "unresolved"
}

function exitQuality(outcome: PositionOutcome, projection: SetupProjection): string {
  if (outcome === "target") return "target_realized"
  if (outcome === "time_exit") return "time_exit"
  if (projection.mfe_r !== null && projection.mfe_r >= 1) return "gave_back_material_favorable_excursion"
  return "invalidation_hit"
}

function exitPrice(position: RdShadowPaperPosition, candle: Candle, outcome: PositionOutcome, activeStop: number): number {
  if (outcome === "target") return position.target
  if (outcome === "time_exit") return candle.close
  return position.side === "long"
    ? Math.min(activeStop, candle.open)
    : Math.max(activeStop, candle.open)
}

function rMultiple(position: RdShadowPaperPosition, exit: number): number {
  const risk = Math.abs(position.entry - position.initial_stop)
  if (risk <= 0) return 0
  return position.side === "long" ? (exit - position.entry) / risk : (position.entry - exit) / risk
}

function candlePathR(position: RdShadowPaperPosition, candle: Candle): { mfe: number; mae: number; close: number } {
  const risk = Math.abs(position.entry - position.initial_stop)
  if (risk <= 0) return { mfe: 0, mae: 0, close: 0 }
  if (position.side === "long") {
    return {
      mfe: round(Math.max(0, (candle.high - position.entry) / risk)),
      mae: round(Math.min(0, (candle.low - position.entry) / risk)),
      close: round((candle.close - position.entry) / risk),
    }
  }
  return {
    mfe: round(Math.max(0, (position.entry - candle.low) / risk)),
    mae: round(Math.min(0, (position.entry - candle.high) / risk)),
    close: round((position.entry - candle.close) / risk),
  }
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

function isBreakEvenArmed(position: RdShadowPaperPosition, activeStop: number): boolean {
  return position.side === "long" ? activeStop > position.initial_stop : activeStop < position.initial_stop
}

function refreshPositionProjection(position: RdShadowPaperPosition): void {
  position.projection = projectSetupEvents(position.events)
  position.status = position.projection.status
  position.active_stop = position.projection.active_stop ?? position.active_stop
  position.stop = position.active_stop
  position.target = position.projection.target ?? position.target
  position.bars_held = position.projection.bars_held
  if (position.projection.status === "closed") {
    position.outcome = parseOutcome(position.projection.exit_reason)
    position.exit_time = position.projection.exit_time
    position.exit = position.projection.exit_price
    position.r = position.projection.r
  }
}

function summarizeState(state: RdShadowTrackerState): RdShadowTrackerState {
  for (const position of state.paper_positions) {
    refreshPositionProjection(position)
  }
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
    event_count: state.paper_positions.reduce((sum, position) => sum + position.events.length, 0),
  }
  state.status = state.paper_positions.length === 0 ? "no_signals" : open.length > 0 ? "open" : "closed"
  return state
}

function stateFromJson(raw: JSONRecord): RdShadowTrackerState {
  const state = raw as unknown as RdShadowTrackerState
  if (state.schema_version !== 2 || !Array.isArray(state.paper_positions)) {
    throw new Error("rd shadow tracker state must be schema_version=2 with paper_positions")
  }
  for (const position of state.paper_positions) {
    if (!Array.isArray(position.events)) {
      throw new Error("rd shadow tracker v2 position requires events")
    }
  }
  return state
}

function unwrapTrackerState(raw: JSONRecord): JSONRecord {
  const data = asRecord(raw.data)
  return data.schema_version === 2 ? data : raw
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
    event_count: 0,
  }
}

function parseSide(value: unknown): Side {
  const side = stringField(value)
  if (side === "long" || side === "short") return side
  throw new Error(`unsupported side ${side}`)
}

function parseOutcome(value: unknown): PositionOutcome | undefined {
  const outcome = stringField(value)
  return outcome === "target" || outcome === "stop" || outcome === "time_exit" ? outcome : undefined
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

function timeframeMilliseconds(timeframe: string): number {
  const match = timeframe.match(/^(\d+)([mhdw])$/)
  if (!match) throw new Error(`unsupported timeframe ${timeframe}`)
  const value = Number(match[1])
  const unit = match[2]
  const multipliers: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }
  return value * multipliers[unit]
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function round(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(12)) : value
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
