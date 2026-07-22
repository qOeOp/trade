import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fundingEventRangeSum, indexFundingEvents, type FundingEvent } from "./funding-events"
import { resolveReadablePath } from "../../../../../../contracts/runtime-core/src/paths"
import { calculateFundingCashflow, calculateRoundTripLinearCost } from "../../../../accounting/src/lib/replay-accounting"
import { hashCanonical, hashFile, replayContentHash, replayDataHash, replayHarnessHash } from "../../../legacy-replay-identity/src/lib/legacy-replay-identity"

type Side = "long" | "short"
type JSONRecord = Record<string, unknown>
type ExitReason = "target" | "stop" | "time_exit"
type SimulatedOrderSide = "BUY" | "SELL"
type SimulatedOrderKind = "market" | "limit" | "stop_market"
type SimulatedOrderRole = "entry" | "take_profit" | "stop"

interface Candle {
  date: string
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface IndicatorSet {
  ema20: number[]
  ema50: number[]
  ema200: number[]
  atr14: number[]
}

interface ReplaySignal {
  side: Side
  signal_index: number
  entry_index: number
  entry: number
  stop: number
  target: number
  entry_risk_limit?: number
  break_even_after_r?: number
  break_even_offset_r?: number
  reason: string
  meta?: JSONRecord
}

interface ReplayTrade {
  side: Side
  signal_time: string
  entry_time: string
  exit_time: string
  entry: number
  exit: number
  stop: number
  target: number
  r: number
  funding_r?: number
  outcome: ExitReason
  reason: string
  bars_held: number
  regime: string
  meta?: JSONRecord
  fill_model?: JSONRecord
  r_multiple_initial?: number
  r_multiple_max_live_risk?: number
}

interface SimulatedLaneOrder {
  id: string
  role: SimulatedOrderRole
  side: SimulatedOrderSide
  kind: SimulatedOrderKind
  quantity: number
  price?: number
  stop_price?: number
  reduce_only?: boolean
}

interface SimulatedLaneFill {
  order_id: string
  role: SimulatedOrderRole
  side: SimulatedOrderSide
  quantity: number
  requested_quantity: number
  price: number
  candle_time: string
  reduced_only_cap_applied: boolean
}

interface SimulatedLaneResult {
  fills: SimulatedLaneFill[]
  final_position_qty: number
  realized_r_multiple_initial: number
  realized_r_multiple_max_live_risk: number
  assumptions: JSONRecord
}

interface ReplayStrategy {
  strategy_id: string
  default_timeframe: string
  warmup_bars: number
  generateSignal(input: {
    candles: Candle[]
    indicators: IndicatorSet
    index: number
    decisionPrice: number
    entryIndex: number
    options: ReplayOptions
  }): ReplaySignal | null
}

interface ReplayOptions {
  manifestPath: string
  strategyId?: string
  timeframe?: string
  maxHoldBars?: number
  rewardRisk?: number
  feeBps?: number
  slippageBps?: number
  fundingBpsPer8h?: number
  fundingEvents?: FundingEvent[]
  oosSplitRatio?: number
  trialCount?: number
  parameterCount?: number
  antiOverfitStage?: "selection_validation" | "external_validation" | "locked_holdout"
  supplementalDataRefs?: string[]
  skipParameterStability?: boolean
}

interface ReplayResult {
  strategy_id: string
  symbol: string
  timeframe: string
  sample_count: number
  win_rate: number
  avg_r: number
  total_r: number
  max_drawdown_r: number
  profit_factor: number
  expectancy_r: number
  gate: {
    shadow_candidate: boolean
    live_small_candidate: false
    blocked_by: Array<{ check_id: string; reason: string }>
  }
  trades: ReplayTrade[]
  diagnostics?: JSONRecord
  assumptions: JSONRecord
  provenance: ReplayProvenance
  notes: string[]
}

interface ReplayProvenance {
  harness_hash: string
  data_hash: string
  assumptions_hash: string
  data_ref: string
  timeframe: string
  data_schema_version: number
  closed_candles_only: boolean
  manifest_checksum_verified: boolean
  temporal_contract: ReplayTemporalContract
  supplemental_data?: Array<{ ref: string; content_sha256: string }>
}

interface ReplayTemporalContract {
  method: "closed_candle_replay_v1"
  timeframe: string
  closed_candle_only: boolean
  reference_at: string | null
  availability_at: string | null
  lookback_start: string | null
  label_end: string | null
  universe_selected_at: string | null
  universe_selection_source: string
  label_policy: string
  supplemental_data: ReplaySupplementalTemporalContract[]
}

interface ReplaySupplementalTemporalContract {
  ref: string
  reference_at: string | null
  availability_at: string | null
  availability_source: string
}

interface ReplayTemporalIntegrityReport {
  method: "full_vs_cutoff_recompute_v1"
  status: "passed" | "failed"
  coverage: "complete" | "sampled"
  eligible_cutoffs: number
  checked_cutoffs: number
  mismatch_count: number
  mismatch_examples_truncated: boolean
  mismatches: Array<{
    cutoff_index: number
    cutoff_time: string
    full_signal_hash: string
    cutoff_signal_hash: string
    error?: string
  }>
}

interface LatestSignalResult {
  strategy_id: string
  symbol: string
  timeframe: string
  signal_time: string
  entry_reference: number
  action: "entry" | "no_action"
  signal: ReplaySignal | null
}

function replayStrategy(strategy: ReplayStrategy, options: ReplayOptions): ReplayResult {
  const timeframe = options.timeframe || strategy.default_timeframe
  const effectiveOptions = { ...options, timeframe }
  const maxHoldBars = options.maxHoldBars ?? 18
  const manifest = loadManifest(options.manifestPath)
  const candles = loadCandlesFromManifest(options.manifestPath, manifest, timeframe)
  const indicators = buildIndicators(candles)
  const fundingCoverage = analyzeFundingCoverage(candles, options.fundingEvents || [])
  const trades: ReplayTrade[] = []
  let index = Math.max(strategy.warmup_bars, 1)

  while (index < candles.length - 2) {
    const decision = strategy.generateSignal(buildReplayDecisionInput(candles, indicators, index, options))
    const signal = decision
      ? materializeReplaySignalAtFill(decision, index, candles[index + 1].open)
      : null
    if (!signal) {
      index += 1
      continue
    }
    const trade = resolveTrade(candles, signal, maxHoldBars, effectiveOptions)
    trade.regime = classifyMarketRegime(candles, indicators, signal.signal_index)
    trades.push(trade)
    const exitIndex = candles.findIndex((candle) => candle.timestamp === Date.parse(trade.exit_time))
    index = Math.max(signal.entry_index + 1, exitIndex + 1)
  }

  const assumptions: JSONRecord = {
    max_hold_bars: maxHoldBars,
    reward_risk: options.rewardRisk ?? 2,
    fee_bps: options.feeBps ?? 0,
    slippage_bps: options.slippageBps ?? 0,
    adverse_funding_bps_per_8h: options.fundingBpsPer8h ?? 0,
    funding_model: options.fundingEvents?.length ? "historical_events_entry_notional" : "adverse_stress_only",
    funding_event_count: options.fundingEvents?.length ?? 0,
    funding_events_hash: options.fundingEvents?.length ? hashCanonical(options.fundingEvents) : null,
    funding_event_coverage: fundingCoverage,
    stop_gap_policy: "next_open_if_worse",
    same_candle_policy: "stop_first",
    intrabar_order_sort: "stop_reduce_only_then_take_profit_then_entry_by_id",
    protective_stop_policy: "optional_break_even_stop_activates_next_bar",
    overlapping_positions: false,
  }
  const antiOverfit = buildAntiOverfitProof(trades, effectiveOptions)
  if (antiOverfit) {
    assumptions.anti_overfit = antiOverfit
  }
  const robustness = buildRobustnessProof(trades)
  if (options.antiOverfitStage === "locked_holdout" && !options.skipParameterStability) {
    robustness.parameter_stability = buildReplayParameterStability(strategy, effectiveOptions)
  }
  assumptions.robustness = robustness

  const result = summarizeReplay({
    strategy_id: strategy.strategy_id,
    symbol: stringField(manifest.symbol) || stringField(manifest.requested_symbol) || "UNKNOWN",
    timeframe,
    trades,
    assumptions,
  })
  if (fundingCoverage.status === "partial") {
    result.gate.shadow_candidate = false
    result.gate.blocked_by.push({ check_id: "R-FUNDING-COVERAGE", reason: "historical funding events do not cover the complete replay interval" })
  }
  result.provenance = buildReplayProvenance(options.manifestPath, timeframe, assumptions, trades, candles, options.supplementalDataRefs)
  return result
}

function analyzeFundingCoverage(candles: Candle[], events: FundingEvent[]): JSONRecord {
  if (events.length === 0 || candles.length === 0) return { status: "none", event_count: events.length }
  const timestamps = indexFundingEvents(events).timestamps
  if (timestamps.length === 0) return { status: "invalid", event_count: events.length }
  const first = timestamps[0]
  const last = timestamps[timestamps.length - 1] || first
  const maxGap = timestamps.slice(1).reduce((gap, timestamp, index) => Math.max(gap, timestamp - timestamps[index]), 0)
  const tolerance = 9 * 3_600_000
  const latestCandle = candles[candles.length - 1]!
  const complete = first <= candles[0].timestamp + tolerance && last >= latestCandle.timestamp - tolerance && maxGap <= tolerance
  return { status: complete ? "complete" : "partial", event_count: timestamps.length, first: new Date(first).toISOString(), last: new Date(last).toISOString(), max_gap_hours: round(maxGap / 3_600_000) }
}

function evaluateLatestSignal(
  strategy: ReplayStrategy,
  options: ReplayOptions,
  entryPrice: number,
  freshness: { now?: string; maxAgeBars?: number } = {},
): LatestSignalResult {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    throw new Error("latest signal requires a positive entry price")
  }
  const timeframe = options.timeframe || strategy.default_timeframe
  const manifest = loadManifest(options.manifestPath)
  const candles = loadCandlesFromManifest(options.manifestPath, manifest, timeframe)
  const index = candles.length - 1
  if (index < strategy.warmup_bars) {
    throw new Error(`latest signal requires at least ${strategy.warmup_bars + 1} candles`)
  }
  const interval = timeframeMilliseconds(timeframe)
  const now = freshness.now ? Date.parse(freshness.now) : Date.now()
  const closedAt = candles[index].timestamp + interval
  const maxAgeBars = freshness.maxAgeBars ?? 1
  if (!Number.isFinite(now) || maxAgeBars < 0 || closedAt > now || now - closedAt > interval * maxAgeBars) {
    throw new Error(`latest closed candle is stale or not yet closed: ${candles[index].date}`)
  }
  const signal = strategy.generateSignal({
    ...buildReplayDecisionInput(candles, buildIndicators(candles), index, options),
    decisionPrice: entryPrice,
  })
  return {
    strategy_id: strategy.strategy_id,
    symbol: stringField(manifest.symbol) || stringField(manifest.requested_symbol) || "UNKNOWN",
    timeframe,
    signal_time: candles[index].date,
    entry_reference: entryPrice,
    action: signal ? "entry" : "no_action",
    signal,
  }
}

function buildReplayDecisionInput(
  candles: Candle[],
  indicators: IndicatorSet,
  index: number,
  options: ReplayOptions,
): Parameters<ReplayStrategy["generateSignal"]>[0] {
  if (!Number.isInteger(index) || index < 0 || index >= candles.length) {
    throw new Error(`invalid replay decision index: ${index}`)
  }
  const prefix = Object.freeze(candles.slice(0, index + 1)) as Candle[]
  const boundedIndicators = Object.freeze({
    ema20: Object.freeze(indicators.ema20.slice(0, index + 1)) as number[],
    ema50: Object.freeze(indicators.ema50.slice(0, index + 1)) as number[],
    ema200: Object.freeze(indicators.ema200.slice(0, index + 1)) as number[],
    atr14: Object.freeze(indicators.atr14.slice(0, index + 1)) as number[],
  })
  return Object.freeze({
    candles: prefix,
    indicators: boundedIndicators,
    index,
    decisionPrice: candles[index].close,
    entryIndex: index + 1,
    options: Object.freeze({ ...options }),
  })
}

function materializeReplaySignalAtFill(
  decision: ReplaySignal,
  signalIndex: number,
  fillPrice: number,
): ReplaySignal | null {
  if (decision.signal_index !== signalIndex || decision.entry_index !== signalIndex + 1) {
    throw new Error("replay strategy returned a signal outside the current decision boundary")
  }
  if (!Number.isFinite(fillPrice) || fillPrice <= 0) return null
  const plannedRisk = directionalRisk(decision.side, decision.entry, decision.stop)
  const plannedReward = directionalReward(decision.side, decision.entry, decision.target)
  if (plannedRisk <= 0 || plannedReward <= 0) return null
  const fillRisk = directionalRisk(decision.side, fillPrice, decision.stop)
  const riskLimit = decision.entry_risk_limit
  if (fillRisk <= 0 || (Number.isFinite(riskLimit) && fillRisk > Number(riskLimit))) return null
  const rewardRisk = plannedReward / plannedRisk
  return {
    ...decision,
    entry: fillPrice,
    target: decision.side === "long" ? fillPrice + fillRisk * rewardRisk : fillPrice - fillRisk * rewardRisk,
    meta: {
      ...(decision.meta || {}),
      decision_reference: decision.entry,
      execution_pricing: "next_open_materialized_after_decision",
    },
  }
}

function detectReplayDecisionLookahead(
  strategy: ReplayStrategy,
  candles: Candle[],
  options: ReplayOptions,
  detector: {
    maxCutoffs?: number
    cutoffStrategyFactory?: (prefix: Candle[], cutoffIndex: number) => ReplayStrategy
  } = {},
): ReplayTemporalIntegrityReport {
  const eligible = Array.from(
    { length: Math.max(0, candles.length - Math.max(strategy.warmup_bars, 1) - 1) },
    (_, offset) => Math.max(strategy.warmup_bars, 1) + offset,
  ).filter((index) => index < candles.length - 1)
  const requestedMaximum = Number(detector.maxCutoffs)
  const maxCutoffs = Number.isInteger(requestedMaximum) && requestedMaximum > 0
    ? Math.min(requestedMaximum, 2000)
    : 2000
  const cutoffs = boundedCutoffs(eligible, maxCutoffs)
  const fullIndicators = buildIndicators(candles)
  const mismatches: ReplayTemporalIntegrityReport["mismatches"] = []
  let mismatchCount = 0
  for (const cutoffIndex of cutoffs) {
    const prefix = candles.slice(0, cutoffIndex + 1)
    try {
      const fullSignal = strategy.generateSignal(buildReplayDecisionInput(candles, fullIndicators, cutoffIndex, options))
      const cutoffStrategy = detector.cutoffStrategyFactory?.(prefix, cutoffIndex) ?? strategy
      const cutoffSignal = cutoffStrategy.generateSignal(buildReplayDecisionInput(prefix, buildIndicators(prefix), cutoffIndex, options))
      const fullHash = hashCanonical(fullSignal)
      const cutoffHash = hashCanonical(cutoffSignal)
      if (fullHash !== cutoffHash) {
        mismatchCount += 1
        if (mismatches.length < 20) {
          mismatches.push({
            cutoff_index: cutoffIndex,
            cutoff_time: candles[cutoffIndex].date,
            full_signal_hash: fullHash,
            cutoff_signal_hash: cutoffHash,
          })
        }
      }
    } catch (error) {
      mismatchCount += 1
      if (mismatches.length < 20) {
        mismatches.push({
          cutoff_index: cutoffIndex,
          cutoff_time: candles[cutoffIndex].date,
          full_signal_hash: "error",
          cutoff_signal_hash: "error",
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
  return {
    method: "full_vs_cutoff_recompute_v1",
    status: mismatchCount === 0 ? "passed" : "failed",
    coverage: cutoffs.length === eligible.length ? "complete" : "sampled",
    eligible_cutoffs: eligible.length,
    checked_cutoffs: cutoffs.length,
    mismatch_count: mismatchCount,
    mismatch_examples_truncated: mismatchCount > mismatches.length,
    mismatches,
  }
}

function boundedCutoffs(eligible: number[], maximum: number): number[] {
  if (eligible.length <= maximum) return eligible
  const selected = new Set<number>()
  for (let index = 0; index < maximum; index += 1) {
    selected.add(eligible[Math.round(index * (eligible.length - 1) / Math.max(1, maximum - 1))])
  }
  return [...selected].sort((left, right) => left - right)
}

function directionalRisk(side: Side, entry: number, stop: number): number {
  return side === "long" ? entry - stop : stop - entry
}

function directionalReward(side: Side, entry: number, target: number): number {
  return side === "long" ? target - entry : entry - target
}

function timeframeMilliseconds(timeframe: string): number {
  const match = timeframe.match(/^(\d+)([mhdw])$/)
  if (!match) throw new Error(`unsupported signal timeframe: ${timeframe}`)
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[match[2]] || 0
  return Number(match[1]) * unit
}

function loadManifest(path: string): JSONRecord {
  return JSON.parse(readFileSync(resolveReadablePath(path), "utf8")) as JSONRecord
}

function loadCandlesFromManifest(manifestPath: string, manifest: JSONRecord, timeframe: string): Candle[] {
  const resolvedManifestPath = resolveReadablePath(manifestPath)
  const timeframes = asRecord(manifest.timeframes)
  const item = asRecord(timeframes[timeframe])
  const file = stringField(item.file)
  if (!file) {
    throw new Error(`manifest missing timeframe ${timeframe}`)
  }
  return parseCsvCandles(readFileSync(join(dirname(resolvedManifestPath), file), "utf8"))
}

function parseCsvCandles(csv: string): Candle[] {
  const lines = csv.trim().split(/\r?\n/)
  const headers = lines.shift()?.split(",") ?? []
  const index = Object.fromEntries(headers.map((header, idx) => [header, idx]))
  return lines.map((line) => {
    const parts = line.split(",")
    return Object.freeze({
      date: parts[index.date],
      timestamp: Number(parts[index.timestamp]),
      open: Number(parts[index.open]),
      high: Number(parts[index.high]),
      low: Number(parts[index.low]),
      close: Number(parts[index.close]),
      volume: Number(parts[index.volume]),
    })
  }).filter((item) => Number.isFinite(item.close))
}

function buildIndicators(candles: Candle[]): IndicatorSet {
  const closes = candles.map((item) => item.close)
  return {
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    ema200: ema(closes, 200),
    atr14: atr(candles, 14),
  }
}

function resolveTrade(
  candles: Candle[],
  signal: ReplaySignal,
  maxHoldBars: number,
  options: ReplayOptions,
): ReplayTrade {
  const end = Math.min(candles.length - 1, signal.entry_index + maxHoldBars)
  const initialStop = signal.stop
  let activeStop = signal.stop
  for (let index = signal.entry_index; index <= end; index += 1) {
    const candle = candles[index]
    if (signal.side === "long") {
      const hitStop = candle.low <= activeStop
      const hitTarget = candle.high >= signal.target
      if (hitStop || hitTarget) {
        return buildTrade({ ...signal, stop: activeStop }, initialStop, candles[signal.signal_index], candles[signal.entry_index], candle, hitStop ? "stop" : "target", options, index - signal.entry_index)
      }
      activeStop = nextProtectiveStop(signal, activeStop, candle)
    } else {
      const hitStop = candle.high >= activeStop
      const hitTarget = candle.low <= signal.target
      if (hitStop || hitTarget) {
        return buildTrade({ ...signal, stop: activeStop }, initialStop, candles[signal.signal_index], candles[signal.entry_index], candle, hitStop ? "stop" : "target", options, index - signal.entry_index)
      }
      activeStop = nextProtectiveStop(signal, activeStop, candle)
    }
  }
  return buildTrade({ ...signal, stop: activeStop }, initialStop, candles[signal.signal_index], candles[signal.entry_index], candles[end], "time_exit", options, end - signal.entry_index)
}

function simulateReplayOrderLane(input: {
  candles: Candle[]
  orders: SimulatedLaneOrder[]
  initial_position_qty?: number
  initial_entry_price?: number
  initial_risk_per_unit?: number
  max_live_risk_per_unit?: number
}): SimulatedLaneResult {
  let positionQty = input.initial_position_qty ?? 0
  let averageEntry = input.initial_entry_price ?? 0
  const initialRisk = positiveOrDefault(input.initial_risk_per_unit, 1)
  let maxLiveRisk = Math.max(positiveOrDefault(input.max_live_risk_per_unit, initialRisk), Math.abs(positionQty) * initialRisk)
  let realizedPnl = 0
  const fills: SimulatedLaneFill[] = []
  const openOrders = [...input.orders]

  for (const candle of input.candles) {
    const triggered = openOrders
      .filter((order) => orderTriggers(order, candle))
      .sort(compareSimulatedOrders)
    for (const order of triggered) {
      const openIndex = openOrders.findIndex((item) => item.id === order.id)
      if (openIndex >= 0) openOrders.splice(openIndex, 1)
      const requestedQty = Math.max(0, order.quantity)
      if (requestedQty <= 0) continue
      const signedBefore = positionQty
      const closingQty = order.reduce_only ? Math.min(requestedQty, Math.abs(positionQty)) : requestedQty
      if (closingQty <= 0) continue
      const price = simulatedFillPrice(order, candle)
      const signedFill = order.side === "BUY" ? closingQty : -closingQty
      const reducesPosition = Math.sign(signedBefore) !== 0 && Math.sign(signedBefore) !== Math.sign(signedFill)
      if (reducesPosition) {
        const pnl = signedBefore > 0 ? price - averageEntry : averageEntry - price
        realizedPnl += pnl * closingQty
        maxLiveRisk = Math.max(maxLiveRisk, Math.abs(signedBefore) * initialRisk)
        positionQty += signedFill
        if (Math.sign(signedBefore) !== Math.sign(positionQty)) {
          averageEntry = positionQty === 0 ? 0 : price
        }
      } else {
        const oldAbs = Math.abs(positionQty)
        const newAbs = oldAbs + closingQty
        averageEntry = newAbs > 0 ? ((averageEntry * oldAbs) + (price * closingQty)) / newAbs : 0
        positionQty += signedFill
        maxLiveRisk = Math.max(maxLiveRisk, Math.abs(positionQty) * initialRisk)
      }
      fills.push({
        order_id: order.id,
        role: order.role,
        side: order.side,
        quantity: round(closingQty),
        requested_quantity: round(requestedQty),
        price: round(price),
        candle_time: candle.date,
        reduced_only_cap_applied: closingQty < requestedQty,
      })
    }
  }

  const initialRiskBasis = Math.max(initialRisk * Math.max(1, Math.abs(input.initial_position_qty ?? 0)), initialRisk)
  return {
    fills,
    final_position_qty: round(positionQty),
    realized_r_multiple_initial: round(realizedPnl / initialRiskBasis),
    realized_r_multiple_max_live_risk: round(realizedPnl / Math.max(maxLiveRisk, initialRisk)),
    assumptions: {
      model: "ohlcv_lane_simulator_v1",
      intrabar_order_sort: "stop_reduce_only_then_take_profit_then_entry_by_id",
      reduce_only_cap: "cap_to_remaining_position_qty",
      same_candle_policy: "stop_first",
    },
  }
}

function nextProtectiveStop(signal: ReplaySignal, activeStop: number, candle: Candle): number {
  const triggerR = signal.break_even_after_r
  if (!Number.isFinite(triggerR) || Number(triggerR) <= 0) {
    return activeStop
  }
  const initialRisk = Math.abs(signal.entry - signal.stop)
  if (initialRisk <= 0) {
    return activeStop
  }
  const offsetR = Number.isFinite(signal.break_even_offset_r) ? Number(signal.break_even_offset_r) : 0
  if (signal.side === "long") {
    const trigger = signal.entry + initialRisk * Number(triggerR)
    const protectedStop = signal.entry + initialRisk * offsetR
    return candle.high >= trigger ? Math.max(activeStop, protectedStop) : activeStop
  }
  const trigger = signal.entry - initialRisk * Number(triggerR)
  const protectedStop = signal.entry - initialRisk * offsetR
  return candle.low <= trigger ? Math.min(activeStop, protectedStop) : activeStop
}

function buildTrade(
  signal: ReplaySignal,
  initialStop: number,
  signalCandle: Candle,
  entryCandle: Candle,
  exitCandle: Candle,
  outcome: ExitReason,
  options: ReplayOptions,
  barsHeld: number,
): ReplayTrade {
  const risk = Math.abs(signal.entry - initialStop)
  const exit = outcome === "target"
    ? signal.target
    : outcome === "stop"
      ? signal.side === "long" ? Math.min(signal.stop, exitCandle.open) : Math.max(signal.stop, exitCandle.open)
      : exitCandle.close
  const grossR = signal.side === "long"
    ? (exit - signal.entry) / risk
    : (signal.entry - exit) / risk
  const costs = estimateCostR(signal.side, signal.entry, exit, risk, barsHeld, entryCandle.timestamp, exitCandle.timestamp + (outcome === "time_exit" ? timeframeMilliseconds(options.timeframe || "4h") : 0), options)
  const netR = round(grossR - costs.total)
  return {
    side: signal.side,
    signal_time: signalCandle.date,
    entry_time: entryCandle.date,
    exit_time: exitCandle.date,
    entry: round(signal.entry),
    exit: round(exit),
    stop: round(signal.stop),
    target: round(signal.target),
    r: netR,
    funding_r: round(costs.funding),
    outcome,
    reason: signal.reason,
    bars_held: barsHeld,
    regime: "unknown",
    fill_model: buildTradeFillModel(signal, exitCandle, outcome, exit),
    r_multiple_initial: netR,
    r_multiple_max_live_risk: netR,
    ...(signal.meta ? { meta: signal.meta } : {}),
  }
}

function buildTradeFillModel(signal: ReplaySignal, exitCandle: Candle, outcome: ExitReason, exit: number): JSONRecord {
  const triggerPrice = outcome === "target" ? signal.target : outcome === "stop" ? signal.stop : exitCandle.close
  return {
    model: "ohlcv_intrabar_conservative_v1",
    entry_fill: { policy: "next_open", price: round(signal.entry) },
    exit_fill: {
      outcome,
      trigger_price: round(triggerPrice),
      fill_price: round(exit),
      candle_open: round(exitCandle.open),
      gap_adjusted: outcome === "stop" && exit !== signal.stop,
    },
    policies: {
      same_candle_policy: "stop_first",
      stop_gap_policy: "next_open_if_worse",
      protective_stop_policy: "optional_break_even_stop_activates_next_bar",
    },
  }
}

function estimateCostR(side: Side, entry: number, exit: number, risk: number, barsHeld: number, entryTime: number, exitTime: number, options: ReplayOptions): { total: number; funding: number } {
  const feeBps = options.feeBps ?? 0
  const slippageBps = options.slippageBps ?? 0
  const fundingBps = options.fundingBpsPer8h ?? 0
  if (risk <= 0 || (feeBps <= 0 && slippageBps <= 0 && fundingBps <= 0 && !options.fundingEvents?.length)) {
    return { total: 0, funding: 0 }
  }
  const tradingCost = calculateRoundTripLinearCost(entry, exit, 1, feeBps + slippageBps)
  const heldHours = (barsHeld + 1) * timeframeMilliseconds(options.timeframe || "4h") / 3_600_000
  const stressFunding = Math.abs(entry) * fundingBps * heldHours / 8 / 10000
  const historicalFunding = -calculateFundingCashflow(
    Math.abs(entry), 1, fundingEventRangeSum(options.fundingEvents || [], entryTime, exitTime), side,
  )
  const fundingR = (stressFunding + historicalFunding) / risk
  return { total: tradingCost / risk + fundingR, funding: fundingR }
}

function summarizeReplay(input: {
  strategy_id: string
  symbol: string
  timeframe: string
  trades: ReplayTrade[]
  assumptions: JSONRecord
}): ReplayResult {
  const stats = summarizeTrades(input.trades)
  const diagnostics = buildReplayDiagnostics(input.trades)
  return {
    strategy_id: input.strategy_id,
    symbol: input.symbol,
    timeframe: input.timeframe,
    ...stats,
    expectancy_r: stats.avg_r,
    gate: evaluateReplayGate(stats),
    trades: input.trades,
    diagnostics,
    assumptions: input.assumptions,
    provenance: {
      harness_hash: "",
      data_hash: "",
      assumptions_hash: hashCanonical(input.assumptions),
      data_ref: "",
      timeframe: input.timeframe,
      data_schema_version: 0,
      closed_candles_only: false,
      manifest_checksum_verified: false,
      temporal_contract: emptyTemporalContract(input.timeframe),
    },
    notes: [
      "Replay is mechanical and conservative: if stop and target hit in the same candle, stop wins.",
      "Replay diagnostics are diagnostic-only and cannot authorize promotion by themselves.",
      "Replay enforces one active position per strategy lane.",
      "This is evidence for draft/shadow gating, not permission for live-small by itself.",
    ],
  }
}

function buildReplayDiagnostics(trades: ReplayTrade[]): JSONRecord {
  const rValues = trades.map((trade) => trade.r)
  return {
    schema_version: "trade-flow.replay-diagnostics.v1",
    promotion_effect: "diagnostic_only_cannot_authorize",
    metrics: {
      sample_count: trades.length,
      r_multiple_initial: summarizeRValues(trades.map((trade) => trade.r_multiple_initial ?? trade.r)),
      r_multiple_max_live_risk: summarizeRValues(trades.map((trade) => trade.r_multiple_max_live_risk ?? trade.r)),
    },
    monte_carlo: {
      method: "deterministic_trade_order_shuffle_and_r_perturbation_v1",
      trade_order_shuffle: tradeOrderShuffleDiagnostics(rValues),
      candle_perturbation: candlePerturbationDiagnostics(rValues),
    },
  }
}

function orderTriggers(order: SimulatedLaneOrder, candle: Candle): boolean {
  if (order.kind === "market") return true
  const trigger = order.kind === "stop_market" ? order.stop_price : order.price
  if (!Number.isFinite(trigger)) return false
  if (order.side === "BUY") return candle.high >= Number(trigger)
  return candle.low <= Number(trigger)
}

function compareSimulatedOrders(a: SimulatedLaneOrder, b: SimulatedLaneOrder): number {
  const rank = (order: SimulatedLaneOrder): number => {
    if (order.reduce_only && order.role === "stop") return 0
    if (order.reduce_only && order.role === "take_profit") return 1
    if (order.role === "stop") return 2
    if (order.role === "take_profit") return 3
    return 4
  }
  return rank(a) - rank(b) || a.id.localeCompare(b.id)
}

function simulatedFillPrice(order: SimulatedLaneOrder, candle: Candle): number {
  if (order.kind === "market") return candle.open
  if (order.kind === "limit") return Number(order.price)
  const stop = Number(order.stop_price)
  if (order.side === "SELL") return Math.min(stop, candle.open)
  return Math.max(stop, candle.open)
}

function positiveOrDefault(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function summarizeRValues(values: number[]): JSONRecord {
  const finite = values.filter(Number.isFinite)
  const total = finite.reduce((sum, value) => sum + value, 0)
  return {
    sample_count: finite.length,
    avg_r: finite.length > 0 ? round(total / finite.length) : 0,
    total_r: round(total),
    max_drawdown_r: round(maxDrawdown(finite)),
    p10_r: finite.length > 0 ? round(quantile([...finite].sort((a, b) => a - b), 0.1)) : 0,
  }
}

function tradeOrderShuffleDiagnostics(values: number[]): JSONRecord {
  if (values.length === 0) return { status: "empty", trial_count: 0 }
  const trials = [
    values,
    [...values].reverse(),
    rotate(values, Math.max(1, Math.floor(values.length / 3))),
    rotate(values, Math.max(1, Math.floor(values.length / 2))),
  ]
  const drawdowns = trials.map((trial) => maxDrawdown(trial))
  return {
    status: "evaluated",
    trial_count: trials.length,
    observed_max_drawdown_r: round(maxDrawdown(values)),
    worst_shuffle_drawdown_r: round(Math.max(...drawdowns)),
    p75_shuffle_drawdown_r: round(quantile([...drawdowns].sort((a, b) => a - b), 0.75)),
  }
}

function candlePerturbationDiagnostics(values: number[]): JSONRecord {
  if (values.length === 0) return { status: "empty", trial_count: 0 }
  const variants = [0.05, 0.1, 0.15].map((drag) => values.map((value) => round(value - drag)))
  const stats = variants.map(summarizeRValues)
  return {
    status: "evaluated",
    method: "adverse_r_drag_proxy",
    trial_count: variants.length,
    worst_total_r: round(Math.min(...stats.map((item) => Number(item.total_r)))),
    worst_avg_r: round(Math.min(...stats.map((item) => Number(item.avg_r)))),
  }
}

function rotate(values: number[], offset: number): number[] {
  const normalized = values.length > 0 ? offset % values.length : 0
  return values.slice(normalized).concat(values.slice(0, normalized))
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const position = (sorted.length - 1) * q
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

function buildAntiOverfitProof(trades: ReplayTrade[], options: ReplayOptions): JSONRecord | null {
  if (trades.length === 0) {
    return null
  }
  if (options.antiOverfitStage === "locked_holdout" || options.antiOverfitStage === "external_validation") {
    const stage = options.antiOverfitStage
    return {
      method: "out_of_sample",
      stage,
      oos_stats: summarizeTrades(trades),
      trial_count: options.trialCount ?? 1,
      parameter_count: options.parameterCount ?? 0,
      notes: stage === "locked_holdout"
        ? "The frozen candidate is evaluated on the complete pristine holdout; no holdout segment is reused for selection."
        : "The frozen candidate is evaluated on the complete non-overlapping external dataset; this is not pristine holdout evidence.",
    }
  }
  const ratio = options.oosSplitRatio ?? 0
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) {
    return null
  }
  if (trades.length < 2) {
    return {
      method: "out_of_sample",
      stage: "selection_validation",
      train_stats: summarizeTrades([]),
      oos_stats: summarizeTrades(trades),
      purged_overlap_count: 0,
      trial_count: options.trialCount ?? 1,
      parameter_count: options.parameterCount ?? 0,
      notes: "Selection validation has fewer than two trades and cannot form independent train/OOS samples.",
    }
  }
  const splitIndex = Math.max(1, Math.min(trades.length - 1, Math.floor(trades.length * (1 - ratio))))
  const oosStart = Date.parse(trades[splitIndex].signal_time)
  const train = trades.slice(0, splitIndex).filter((trade) => Date.parse(trade.exit_time) < oosStart)
  const purgedCount = splitIndex - train.length
  return {
    method: "out_of_sample",
    stage: "selection_validation",
    train_stats: summarizeTrades(train),
    oos_stats: summarizeTrades(trades.slice(splitIndex)),
    purged_overlap_count: purgedCount,
    trial_count: options.trialCount ?? 1,
    parameter_count: options.parameterCount ?? 0,
    notes: `Selection validation uses the last ${round(ratio * 100)}% of chronological replay trades and purges training labels crossing the OOS boundary; it is not a locked final holdout.`,
  }
}

function classifyMarketRegime(candles: Candle[], indicators: IndicatorSet, index: number): string {
  const close = candles[index]?.close
  const longTrend = indicators.ema200[index]
  const atrNow = indicators.atr14[index]
  if (!Number.isFinite(close) || !Number.isFinite(longTrend) || !Number.isFinite(atrNow) || close <= 0) {
    return "unknown"
  }
  const ratios = candles.slice(Math.max(0, index - 99), index + 1)
    .map((candle, offset) => {
      const absoluteIndex = Math.max(0, index - 99) + offset
      const value = indicators.atr14[absoluteIndex] / candle.close
      return Number.isFinite(value) ? value : null
    })
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b)
  const median = ratios[Math.floor(ratios.length / 2)] ?? atrNow / close
  return `${close >= longTrend ? "bull" : "bear"}_${atrNow / close >= median ? "high_vol" : "low_vol"}`
}

function buildRobustnessProof(trades: ReplayTrade[]): JSONRecord {
  const groups = new Map<string, ReplayTrade[]>()
  for (const trade of trades) {
    const list = groups.get(trade.regime) || []
    list.push(trade)
    groups.set(trade.regime, list)
  }
  const regimeSlices = Array.from(groups.entries())
    .filter(([regime, items]) => regime !== "unknown" && items.length >= 5)
    .map(([regime, items]) => ({ regime, ...summarizeTrades(items) }))
  const stressed = trades.map((trade) => {
    const risk = Math.abs(trade.entry - trade.stop)
    const extraCostR = risk > 0 ? ((Math.abs(trade.entry) + Math.abs(trade.exit)) * 5 / 10000) / risk : 0
    return { ...trade, r: round(trade.r - extraCostR) }
  })
  return {
    regime_slices: regimeSlices,
    cost_stress: { extra_bps_per_side: 5, stats: summarizeTrades(stressed) },
  }
}

function buildReplayParameterStability(strategy: ReplayStrategy, options: ReplayOptions): JSONRecord {
  const base = {
    maxHoldBars: options.maxHoldBars ?? 18,
    rewardRisk: options.rewardRisk ?? 2,
  }
  const variants: Array<{ parameter: string; multiplier: number; options: ReplayOptions }> = []
  for (const multiplier of [0.9, 1.1]) {
    variants.push({
      parameter: "maxHoldBars",
      multiplier,
      options: { ...options, maxHoldBars: Math.max(1, Math.round(base.maxHoldBars * multiplier)) },
    })
    variants.push({
      parameter: "rewardRisk",
      multiplier,
      options: { ...options, rewardRisk: Number((base.rewardRisk * multiplier).toFixed(6)) },
    })
  }
  const seen = new Set<string>()
  const results = variants
    .filter((variant) => {
      const key = hashCanonical({ parameter: variant.parameter, maxHoldBars: variant.options.maxHoldBars, rewardRisk: variant.options.rewardRisk })
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((variant) => {
      const replay = replayStrategy(strategy, {
        ...variant.options,
        skipParameterStability: true,
      })
      return {
        parameter: variant.parameter,
        multiplier: variant.multiplier,
        avg_r: replay.avg_r,
        total_r: replay.total_r,
      }
    })
  const positive = results.filter((item) => item.avg_r > 0 && item.total_r > 0)
  return {
    method: "fixed_plus_minus_10pct",
    evaluation_count: results.length,
    positive_ratio: results.length > 0 ? round(positive.length / results.length) : 0,
    worst_avg_r: results.length > 0 ? round(Math.min(...results.map((item) => item.avg_r))) : 0,
    results,
  }
}

function buildReplayProvenance(
  manifestPath: string,
  timeframe: string,
  assumptions: JSONRecord,
  trades: ReplayTrade[],
  candles: Candle[],
  supplementalDataRefs: string[] = [],
): ReplayProvenance {
  const manifest = loadManifest(manifestPath)
  const item = asRecord(asRecord(manifest.timeframes)[timeframe])
  const declaredChecksum = stringField(item.content_sha256)
  const supplementalData = [...new Set(supplementalDataRefs)].sort().map((ref) => ({
    ref,
    content_sha256: hashFile(ref),
  }))
  const actualDataHash = replayDataHash(manifestPath, timeframe, supplementalData.map((item) => item.ref))
  const contentHash = replayContentHash(manifestPath, timeframe)
  return {
    harness_hash: replayHarnessHash(),
    data_hash: actualDataHash,
    assumptions_hash: hashCanonical(assumptions),
    data_ref: manifestPath,
    timeframe,
    data_schema_version: Number(manifest.schema_version) || 0,
    closed_candles_only: manifest.closed_candles_only === true,
    manifest_checksum_verified: Boolean(declaredChecksum && declaredChecksum === contentHash),
    temporal_contract: buildTemporalContract(manifest, timeframe, candles, trades, supplementalData.map((item) => item.ref)),
    ...(supplementalData.length > 0 ? { supplemental_data: supplementalData } : {}),
  }
}

function buildTemporalContract(
  manifest: JSONRecord,
  timeframe: string,
  candles: Candle[],
  trades: ReplayTrade[],
  supplementalDataRefs: string[],
): ReplayTemporalContract {
  const interval = timeframeMilliseconds(timeframe)
  const first = candles[0]
  const last = candles[candles.length - 1]
  const referenceAt = last ? new Date(last.timestamp).toISOString() : null
  const availabilityAt = last ? new Date(last.timestamp + interval).toISOString() : null
  const latestTradeExit = trades
    .map((trade) => Date.parse(trade.exit_time))
    .filter(Number.isFinite)
    .reduce((max, timestamp) => Math.max(max, timestamp), Number.NEGATIVE_INFINITY)
  const labelEnd = Number.isFinite(latestTradeExit)
    ? new Date(latestTradeExit + interval).toISOString()
    : availabilityAt
  const universe = readUniverseSelectionTime(manifest, first)
  return {
    method: "closed_candle_replay_v1",
    timeframe,
    closed_candle_only: manifest.closed_candles_only === true,
    reference_at: referenceAt,
    availability_at: availabilityAt,
    lookback_start: first ? new Date(first.timestamp).toISOString() : null,
    label_end: labelEnd,
    universe_selected_at: universe.value,
    universe_selection_source: universe.source,
    label_policy: "signals use closed candles; entries occur on next open; trade labels are only available after the exit candle closes; selection-validation train labels crossing the OOS boundary are purged",
    supplemental_data: supplementalDataRefs.map(readSupplementalTemporalContract),
  }
}

function emptyTemporalContract(timeframe: string): ReplayTemporalContract {
  return {
    method: "closed_candle_replay_v1",
    timeframe,
    closed_candle_only: false,
    reference_at: null,
    availability_at: null,
    lookback_start: null,
    label_end: null,
    universe_selected_at: null,
    universe_selection_source: "not_declared",
    label_policy: "not_evaluated",
    supplemental_data: [],
  }
}

function readUniverseSelectionTime(manifest: JSONRecord, first: Candle | undefined): { value: string | null; source: string } {
  const declared = firstString(
    manifest.universe_selected_at,
    manifest.universe_selection_time,
  )
  if (declared) {
    return { value: normalizeIsoTime(declared), source: "manifest_universe_selected_at" }
  }
  const generated = firstString(manifest.generated_at, manifest.created_at)
  if (generated) {
    return { value: normalizeIsoTime(generated), source: "manifest_generated_at" }
  }
  return { value: first ? new Date(first.timestamp).toISOString() : null, source: "dataset_start_fallback" }
}

function readSupplementalTemporalContract(ref: string): ReplaySupplementalTemporalContract {
  try {
    const report = asRecord(JSON.parse(readFileSync(resolveReadablePath(ref), "utf8")))
    const data = asRecord(report.data)
    const rawTime = firstString(
      report.generated_at,
      report.created_at,
      report.updated_at,
      data.generated_at,
      data.created_at,
      data.updated_at,
    )
    const normalized = rawTime ? normalizeIsoTime(rawTime) : null
    return {
      ref,
      reference_at: normalized,
      availability_at: normalized,
      availability_source: normalized ? "declared_report_time" : "not_declared",
    }
  } catch {
    return {
      ref,
      reference_at: null,
      availability_at: null,
      availability_source: "unreadable",
    }
  }
}

function summarizeTrades(trades: ReplayTrade[]): {
  sample_count: number
  win_rate: number
  avg_r: number
  total_r: number
  max_drawdown_r: number
  profit_factor: number
} {
  const wins = trades.filter((trade) => trade.r > 0)
  const gains = wins.reduce((sum, trade) => sum + trade.r, 0)
  const losses = Math.abs(trades.filter((trade) => trade.r < 0).reduce((sum, trade) => sum + trade.r, 0))
  const total = trades.reduce((sum, trade) => sum + trade.r, 0)
  return {
    sample_count: trades.length,
    win_rate: trades.length > 0 ? round(wins.length / trades.length) : 0,
    avg_r: trades.length > 0 ? round(total / trades.length) : 0,
    total_r: round(total),
    max_drawdown_r: round(maxDrawdown(trades.map((trade) => trade.r))),
    profit_factor: losses > 0 ? round(gains / losses) : gains > 0 ? 999999 : 0,
  }
}

function evaluateReplayGate(stats: {
  sample_count: number
  avg_r: number
  total_r: number
  max_drawdown_r: number
  profit_factor: number
}): ReplayResult["gate"] {
  const blockedBy: Array<{ check_id: string; reason: string }> = []
  if (stats.sample_count < 30) {
    blockedBy.push({ check_id: "R-SAMPLE-SIZE", reason: `sample_count ${stats.sample_count} is below 30` })
  }
  if (stats.total_r <= 0 || stats.avg_r <= 0) {
    blockedBy.push({ check_id: "R-EXPECTANCY", reason: `avg_r ${stats.avg_r} / total_r ${stats.total_r} is not positive` })
  }
  if (stats.profit_factor < 1.1) {
    blockedBy.push({ check_id: "R-PROFIT-FACTOR", reason: `profit_factor ${stats.profit_factor} is below 1.1` })
  }
  if (stats.max_drawdown_r > 10) {
    blockedBy.push({ check_id: "R-DRAWDOWN", reason: `max_drawdown_r ${stats.max_drawdown_r} exceeds 10R` })
  }
  return {
    shadow_candidate: blockedBy.length === 0,
    live_small_candidate: false,
    blocked_by: blockedBy,
  }
}

function ema(values: number[], length: number): number[] {
  const output = Array(values.length).fill(Number.NaN) as number[]
  const alpha = 2 / (length + 1)
  let previous = 0
  for (let index = 0; index < values.length; index += 1) {
    if (index < length - 1) {
      continue
    }
    if (index === length - 1) {
      previous = values.slice(0, length).reduce((sum, value) => sum + value, 0) / length
    } else {
      previous = values[index] * alpha + previous * (1 - alpha)
    }
    output[index] = previous
  }
  return output
}

function atr(candles: Candle[], length: number): number[] {
  const trueRanges = candles.map((candle, index) => {
    if (index === 0) {
      return candle.high - candle.low
    }
    const prevClose = candles[index - 1].close
    return Math.max(candle.high - candle.low, Math.abs(candle.high - prevClose), Math.abs(candle.low - prevClose))
  })
  return ema(trueRanges, length)
}

function maxDrawdown(values: number[]): number {
  let equity = 0
  let peak = 0
  let drawdown = 0
  for (const value of values) {
    equity += value
    peak = Math.max(peak, equity)
    drawdown = Math.max(drawdown, peak - equity)
  }
  return drawdown
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = stringField(value)
    if (text) {
      return text
    }
  }
  return ""
}

function normalizeIsoTime(value: string): string {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value
}

function round(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : value
}

export {
  atr,
  buildIndicators,
  buildReplayDecisionInput,
  detectReplayDecisionLookahead,
  ema,
  evaluateLatestSignal,
  loadManifest,
  loadCandlesFromManifest,
  parseCsvCandles,
  materializeReplaySignalAtFill,
  replayStrategy,
  simulateReplayOrderLane,
  replayDataHash,
  replayContentHash,
  replayHarnessHash,
  hashCanonical,
  summarizeReplay,
  summarizeTrades,
  evaluateReplayGate,
  type Candle,
  type IndicatorSet,
  type LatestSignalResult,
  type ReplayOptions,
  type ReplayResult,
  type ReplayProvenance,
  type ReplayTemporalContract,
  type ReplayTemporalIntegrityReport,
  type ReplaySignal,
  type ReplayStrategy,
  type ReplayTrade,
  type SimulatedLaneFill,
  type SimulatedLaneOrder,
  type SimulatedLaneResult,
}
