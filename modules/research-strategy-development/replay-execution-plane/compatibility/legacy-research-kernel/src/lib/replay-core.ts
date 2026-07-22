import { fundingEventRangeSum, indexFundingEvents, type FundingEvent } from "../../../legacy-research-data/src/lib/funding-events"
import { calculateFundingCashflow, calculateRoundTripLinearCost } from "../../../../accounting/src/lib/replay-accounting"
import { hashCanonical, replayContentHash, replayDataHash, replayHarnessHash } from "../../../legacy-replay-identity/src/lib/legacy-replay-identity"
import { loadCandlesFromManifest, loadManifest, parseCsvCandles, type Candle } from "../../../legacy-research-data/src/lib/legacy-research-data"
import { atr, buildIndicators, ema, type IndicatorSet } from "../../../legacy-research-features/src/lib/legacy-research-features"
import {
  buildAntiOverfitProof,
  buildReplayDiagnostics,
  buildRobustnessProof,
  evaluateReplayGate,
  summarizeTrades,
} from "../../../legacy-research-evaluation/src/lib/legacy-research-evaluation"
import {
  buildReplayProvenance,
  emptyTemporalContract,
  type ReplayProvenance,
  type ReplayTemporalContract,
} from "../../../legacy-research-provenance/src/lib/legacy-research-provenance"
import type {
  LatestSignalResult,
  ReplayOptions,
  ReplayResult,
  ReplaySignal,
  ReplayStrategy,
  ReplayTemporalIntegrityReport,
  ReplayTrade,
  SimulatedLaneFill,
  SimulatedLaneOrder,
  SimulatedLaneResult,
} from "../../../legacy-research-contracts/src/lib/legacy-research-contracts"
import {
  buildReplayDecisionInput,
  detectReplayDecisionLookahead,
  evaluateLatestSignal,
  timeframeMilliseconds,
} from "../../../legacy-research-decision/src/lib/legacy-research-decision"
import { simulateReplayOrderLane } from "../../../legacy-research-order-lane/src/lib/legacy-research-order-lane"

type Side = "long" | "short"
type JSONRecord = Record<string, unknown>
type ExitReason = "target" | "stop" | "time_exit"

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
  result.provenance = buildReplayProvenance(
    options.manifestPath,
    timeframe,
    timeframeMilliseconds(timeframe),
    assumptions,
    trades,
    candles,
    options.supplementalDataRefs,
  )
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

function directionalRisk(side: Side, entry: number, stop: number): number {
  return side === "long" ? entry - stop : stop - entry
}

function directionalReward(side: Side, entry: number, target: number): number {
  return side === "long" ? target - entry : entry - target
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

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
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
