import { readFileSync } from "node:fs"
import {
  hashCanonical,
  replayStrategy,
  type ReplayResult,
  type ReplaySignal,
  type ReplayStrategy,
} from "./replay-core"
import { type FactorFeatureStore } from "../../../strategy-family-engine/src/lib/factor-engine"
import { getRndFamily, type RndFamilyConfigured } from "../../../strategy-family-engine/src/lib/rnd-family"
import type { JSONRecord } from "./json"
import type { StrategyRndBatchInput, StrategyRndCandidateInput } from "./strategy-rnd-inputs"

const fundingEventCache = new Map<string, Array<{ timestamp: string; value: number }>>()
const MIN_OOS_EFFECTIVE_SAMPLE_COUNT = 10
const MIN_OOS_RAW_SAMPLE_COUNT = 20
const MIN_OOS_AVG_R_MARGIN = 0.05
const MIN_OOS_TOTAL_R_MARGIN = 1
const MIN_OOS_PROFIT_FACTOR = 1.1

export interface StrategyRndCandidateReport {
  candidate_id: string
  description: string
  family: string
  parameter_count: number
  params: JSONRecord
  replay: ReplayResult
  negative_controls: CandidateNegativeControlReport
  gate: {
    accepted: boolean
    blocked_by: Array<{ check_id: string; reason: string }>
  }
}

export interface CandidateNegativeControlReport {
  method: "side_flip_and_entry_lag"
  observed_sample_count: number
  observed_avg_r: number
  observed_total_r: number
  controls: Array<{
    control_id: string
    sample_count: number
    avg_r: number
    total_r: number
    profit_factor: number
  }>
  blocked_by: Array<{ check_id: string; reason: string; evidence?: JSONRecord }>
}

export function runCandidate(input: StrategyRndBatchInput, candidate: StrategyRndCandidateInput, featureStore: FactorFeatureStore): StrategyRndCandidateReport {
  const family = candidate.family || "trend_pullback_v1"
  const parameterCount = candidate.parameterCount ?? countActiveParameters(candidate.params || {})
  const rawParams = candidate.params || {}
  const configured = getRndFamily(family).configure(candidate.candidateId, rawParams, featureStore)
  const supplementalDataRefs = replaySupplementalDataRefs(input.indicatorReportPath, configured)
  const replay = replayStrategy(configured.strategy, {
    manifestPath: input.manifestPath,
    timeframe: input.timeframe,
    maxHoldBars: input.maxHoldBars,
    rewardRisk: configured.rewardRisk,
    feeBps: input.feeBps,
    slippageBps: input.slippageBps,
    fundingBpsPer8h: input.fundingBpsPer8h,
    fundingEvents: loadFundingEvents(input.indicatorReportPath),
    oosSplitRatio: input.oosSplitRatio ?? 0.3,
    trialCount: input.searchTrialCount ?? input.candidates.length,
    parameterCount,
    antiOverfitStage: input.antiOverfitStage,
    supplementalDataRefs,
  })
  const robustness = asRecord(replay.assumptions.robustness)
  robustness.parameter_stability = input.diagnosticMode
    ? { method: "diagnostic_skipped", evaluation_count: 0, positive_ratio: 0, worst_avg_r: 0 }
    : Object.keys(input.parameterStability || {}).length > 0
    ? input.parameterStability
    : evaluateParameterStability(input, candidate, featureStore)
  replay.assumptions.robustness = robustness
  replay.provenance.assumptions_hash = hashCanonical(replay.assumptions)
  const negativeControls = input.diagnosticMode
    ? diagnosticNegativeControls(replay)
    : buildCandidateNegativeControls(input, candidate, configured, featureStore, replay)
  return {
    candidate_id: candidate.candidateId,
    description: candidate.description || "",
    family,
    parameter_count: parameterCount,
    params: configured.params,
    replay,
    negative_controls: negativeControls,
    gate: evaluateRndCandidate(replay, parameterCount, negativeControls.blocked_by),
  }
}

function diagnosticNegativeControls(observed: ReplayResult): CandidateNegativeControlReport {
  return {
    method: "side_flip_and_entry_lag",
    observed_sample_count: observed.sample_count,
    observed_avg_r: observed.avg_r,
    observed_total_r: observed.total_r,
    controls: [],
    blocked_by: [],
  }
}

export function buildCandidateNegativeControls(
  input: StrategyRndBatchInput,
  candidate: StrategyRndCandidateInput,
  configured: RndFamilyConfigured,
  featureStore: FactorFeatureStore,
  observed: ReplayResult,
): CandidateNegativeControlReport {
  const parameterCount = candidate.parameterCount ?? countActiveParameters(candidate.params || {})
  const controls: CandidateNegativeControlReport["controls"] = []
  const sideFlipped = flippedSideParams(candidate.params || {})
  if (sideFlipped) {
    const flipped = getRndFamily(candidate.family || "trend_pullback_v1").configure(`${candidate.candidateId}-negative-control-side-flip`, sideFlipped, featureStore)
    controls.push(summarizeNegativeControl("side_flip", runConfiguredReplay(input, flipped, countActiveParameters(sideFlipped))))
  }
  controls.push(summarizeNegativeControl(
    "entry_lag_3",
    runConfiguredReplay(input, { ...configured, strategy: laggedEntryStrategy(configured.strategy, 3) }, parameterCount),
  ))
  const blockedBy = buildNegativeControlBlocks(observed, controls)
  return {
    method: "side_flip_and_entry_lag",
    observed_sample_count: observed.sample_count,
    observed_avg_r: observed.avg_r,
    observed_total_r: observed.total_r,
    controls,
    blocked_by: blockedBy,
  }
}

function buildNegativeControlBlocks(
  observed: ReplayResult,
  controls: CandidateNegativeControlReport["controls"],
): CandidateNegativeControlReport["blocked_by"] {
  if (observed.total_r <= 0 || observed.avg_r <= 0) return []
  return controls
    .filter((control) => control.sample_count >= 10)
    .map((control) => {
      const triggeredMetrics = [
        ...(control.total_r >= observed.total_r ? ["total_r"] : []),
        ...(control.avg_r >= observed.avg_r ? ["avg_r"] : []),
      ]
      if (triggeredMetrics.length === 0) return null
      return {
        check_id: "RND-NEGATIVE-CONTROL-NOT-BEATEN",
        reason: `${control.control_id} negative control is not beaten on ${triggeredMetrics.join(" and ")}`,
        evidence: {
          control_id: control.control_id,
          comparison_policy: "eligible_null_sample_count_ge_10_and_total_r_or_avg_r_not_beaten",
          triggered_metrics: triggeredMetrics,
          observed: {
            sample_count: observed.sample_count,
            avg_r: observed.avg_r,
            total_r: observed.total_r,
          },
          control: {
            sample_count: control.sample_count,
            avg_r: control.avg_r,
            total_r: control.total_r,
            profit_factor: control.profit_factor,
          },
        },
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
}

export function runConfiguredReplay(input: StrategyRndBatchInput, configured: RndFamilyConfigured, parameterCount: number): ReplayResult {
  return replayStrategy(configured.strategy, {
    manifestPath: input.manifestPath,
    timeframe: input.timeframe,
    maxHoldBars: input.maxHoldBars,
    rewardRisk: configured.rewardRisk,
    feeBps: input.feeBps,
    slippageBps: input.slippageBps,
    fundingBpsPer8h: input.fundingBpsPer8h,
    fundingEvents: loadFundingEvents(input.indicatorReportPath),
    oosSplitRatio: input.oosSplitRatio ?? 0.3,
    trialCount: input.searchTrialCount ?? input.candidates.length,
    parameterCount,
    antiOverfitStage: input.antiOverfitStage,
    supplementalDataRefs: replaySupplementalDataRefs(input.indicatorReportPath, configured),
  })
}

export function summarizeNegativeControl(controlId: string, replay: ReplayResult): CandidateNegativeControlReport["controls"][number] {
  return {
    control_id: controlId,
    sample_count: replay.sample_count,
    avg_r: replay.avg_r,
    total_r: replay.total_r,
    profit_factor: replay.profit_factor,
  }
}

export function flippedSideParams(params: JSONRecord): JSONRecord | null {
  const side = stringField(params.side).toLowerCase()
  if (side === "long") return { ...params, side: "short" }
  if (side === "short") return { ...params, side: "long" }
  return null
}

export function laggedEntryStrategy(strategy: ReplayStrategy, lagBars: number): ReplayStrategy {
  return {
    ...strategy,
    strategy_id: `${strategy.strategy_id}-negative-control-entry-lag-${lagBars}`,
    generateSignal(input) {
      const sourceIndex = input.index - lagBars
      if (sourceIndex < strategy.warmup_bars) return null
      const sourceEntryIndex = sourceIndex + 1
      const sourceEntryPrice = input.candles[sourceEntryIndex]?.open
      if (!Number.isFinite(sourceEntryPrice)) return null
      const original = strategy.generateSignal({
        ...input,
        index: sourceIndex,
        entryIndex: sourceEntryIndex,
        entryPrice: sourceEntryPrice,
      })
      return original ? rebuildSignalAtEntry(original, input.index, input.entryIndex, input.entryPrice) : null
    },
  }
}

export function rebuildSignalAtEntry(signal: ReplaySignal, signalIndex: number, entryIndex: number, entry: number): ReplaySignal | null {
  const originalRisk = Math.abs(signal.entry - signal.stop)
  const originalReward = Math.abs(signal.target - signal.entry)
  const rewardRisk = originalRisk > 0 ? originalReward / originalRisk : 0
  const risk = Math.abs(entry - signal.stop)
  if (!Number.isFinite(rewardRisk) || rewardRisk <= 0 || risk <= 0) return null
  return {
    ...signal,
    signal_index: signalIndex,
    entry_index: entryIndex,
    entry,
    target: signal.side === "long" ? entry + risk * rewardRisk : entry - risk * rewardRisk,
    reason: `${signal.reason} negative control entry lag`,
  }
}

export function evaluateParameterStability(
  input: StrategyRndBatchInput,
  candidate: StrategyRndCandidateInput,
  featureStore: FactorFeatureStore,
): JSONRecord {
  const raw = candidate.params || {}
  const keys = Object.entries(raw)
    .filter(([key, value]) => {
      const normalized = key.toLowerCase()
      return typeof value === "number" && value > 0 && !normalized.includes("ema") && !normalized.includes("lookback")
    })
    .map(([key]) => key)
    .slice(0, 3)
  const results: Array<{ parameter: string; multiplier: number; avg_r: number; total_r: number }> = []
  for (const key of keys) {
    for (const multiplier of [0.9, 1.1]) {
      const params = { ...raw, [key]: Number(raw[key]) * multiplier }
      const configured = getRndFamily(candidate.family || "trend_pullback_v1").configure(`${candidate.candidateId}-stability`, params, featureStore)
      const replay = replayStrategy(configured.strategy, {
        manifestPath: input.manifestPath,
        timeframe: input.timeframe,
        maxHoldBars: input.maxHoldBars,
        rewardRisk: configured.rewardRisk,
        feeBps: input.feeBps,
        slippageBps: input.slippageBps,
        fundingBpsPer8h: input.fundingBpsPer8h,
        fundingEvents: loadFundingEvents(input.indicatorReportPath),
        supplementalDataRefs: replaySupplementalDataRefs(input.indicatorReportPath, configured),
      })
      results.push({ parameter: key, multiplier, avg_r: replay.avg_r, total_r: replay.total_r })
    }
  }
  const positive = results.filter((item) => item.avg_r > 0 && item.total_r > 0)
  return {
    method: "fixed_plus_minus_10pct",
    evaluation_count: results.length,
    positive_ratio: results.length > 0 ? Number((positive.length / results.length).toFixed(6)) : 0,
    worst_avg_r: results.length > 0 ? Math.min(...results.map((item) => item.avg_r)) : 0,
    results,
  }
}

function replaySupplementalDataRefs(indicatorReportPath: string | undefined, configured: RndFamilyConfigured): string[] {
  return [
    ...(indicatorReportPath ? [indicatorReportPath] : []),
    ...(configured.supplementalDataRefs || []),
  ]
}

export function evaluateRndCandidate(
  replay: ReplayResult,
  parameterCount: number,
  negativeBlocks: Array<{ check_id: string; reason: string }> = [],
): StrategyRndCandidateReport["gate"] {
  const blockedBy = [...replay.gate.blocked_by]
  const proof = replay.assumptions.anti_overfit as { oos_stats?: { sample_count: number; avg_r: number; total_r: number; max_drawdown_r: number; profit_factor: number }; trial_count?: number; parameter_count?: number } | undefined
  if (!proof || !proof.oos_stats) {
    blockedBy.push({ check_id: "RND-OOS-MISSING", reason: "candidate replay must include OOS proof" })
  } else {
    if (proof.oos_stats.sample_count < 10) {
      blockedBy.push({ check_id: "RND-OOS-SAMPLE", reason: `oos sample_count ${proof.oos_stats.sample_count} is below 10` })
    }
    if (proof.oos_stats.avg_r <= 0 || proof.oos_stats.total_r <= 0) {
      blockedBy.push({ check_id: "RND-OOS-EXPECTANCY", reason: "OOS expectancy is not positive after costs" })
    }
    if (proof.oos_stats.profit_factor < 1.05) {
      blockedBy.push({ check_id: "RND-OOS-PROFIT-FACTOR", reason: `OOS profit_factor ${proof.oos_stats.profit_factor} is below 1.05` })
    }
    if (proof.oos_stats.max_drawdown_r > 10) {
      blockedBy.push({ check_id: "RND-OOS-DRAWDOWN", reason: `OOS max_drawdown_r ${proof.oos_stats.max_drawdown_r} exceeds 10R` })
    }
    blockedBy.push(...evaluateOosEdgeMargin(proof.oos_stats, proof.trial_count ?? 1))
    if ((proof.trial_count ?? 1) > 10) {
      blockedBy.push({ check_id: "RND-SEARCH-BUDGET", reason: `trial_count ${proof.trial_count} exceeds 10` })
    }
    if ((proof.parameter_count ?? parameterCount) > 8) {
      blockedBy.push({ check_id: "RND-PARAM-COUNT", reason: `parameter_count ${proof.parameter_count ?? parameterCount} exceeds 8` })
    }
  }
  if (parameterCount > 8) {
    blockedBy.push({ check_id: "RND-PARAM-COUNT", reason: `parameter_count ${parameterCount} exceeds 8` })
  }
  blockedBy.push(...evaluateRndRobustness(replay))
  blockedBy.push(...negativeBlocks)
  return {
    accepted: blockedBy.length === 0,
    blocked_by: blockedBy,
  }
}

function evaluateOosEdgeMargin(
  stats: { sample_count: number; avg_r: number; total_r: number; profit_factor: number },
  trialCount: number,
): Array<{ check_id: string; reason: string }> {
  const blockedBy: Array<{ check_id: string; reason: string }> = []
  const effective = effectiveSampleCount(stats.sample_count, trialCount)
  if (stats.sample_count < MIN_OOS_RAW_SAMPLE_COUNT || effective < MIN_OOS_EFFECTIVE_SAMPLE_COUNT) {
    blockedBy.push({
      check_id: "RND-OOS-EFFECTIVE-SAMPLE",
      reason: `oos raw/effective sample_count ${stats.sample_count}/${effective} is below ${MIN_OOS_RAW_SAMPLE_COUNT}/${MIN_OOS_EFFECTIVE_SAMPLE_COUNT}`,
    })
  }
  if (stats.avg_r < MIN_OOS_AVG_R_MARGIN || stats.total_r < MIN_OOS_TOTAL_R_MARGIN || stats.profit_factor < MIN_OOS_PROFIT_FACTOR) {
    blockedBy.push({
      check_id: "RND-OOS-EDGE-MARGIN",
      reason: `OOS edge margin is too thin: avg_r ${stats.avg_r}, total_r ${stats.total_r}, profit_factor ${stats.profit_factor}`,
    })
  }
  return blockedBy
}

function effectiveSampleCount(sampleCount: number, trialCount: number): number {
  const trials = Math.max(1, Number.isFinite(trialCount) ? trialCount : 1)
  return Math.floor(sampleCount / Math.sqrt(trials))
}

export function evaluateRndRobustness(replay: ReplayResult): Array<{ check_id: string; reason: string }> {
  const robustness = asRecord(replay.assumptions.robustness)
  const slices = Array.isArray(robustness.regime_slices) ? robustness.regime_slices.map(asRecord) : []
  const eligible = slices.filter((slice) => Number(slice.sample_count) >= 5)
  const positive = eligible.filter((slice) => Number(slice.avg_r) > 0 && Number(slice.total_r) > 0)
  const blocked: Array<{ check_id: string; reason: string }> = []
  if (eligible.length < 2 || positive.length < 2) {
    blocked.push({ check_id: "RND-ROBUSTNESS-REGIME", reason: "at least two regime slices with five samples each must be positive" })
  }
  const costStress = asRecord(robustness.cost_stress)
  const costStats = asRecord(costStress.stats)
  if (Number(costStress.extra_bps_per_side) < 5 || Number(costStats.avg_r) <= 0 || Number(costStats.total_r) <= 0) {
    blocked.push({ check_id: "RND-ROBUSTNESS-COST", reason: "candidate must remain positive under at least 5 bps extra cost per side" })
  }
  const stability = asRecord(robustness.parameter_stability)
  if (stringField(stability.method) !== "fixed_plus_minus_10pct"
    || Number(stability.evaluation_count) < 2
    || Number(stability.positive_ratio) < 0.5
    || Number(stability.worst_avg_r) <= 0) {
    blocked.push({ check_id: "RND-ROBUSTNESS-PARAM", reason: "fixed +/-10% parameter perturbations are not stable" })
  }
  return blocked
}

export function compareCandidates(a: StrategyRndCandidateReport, b: StrategyRndCandidateReport): number {
  const aOos = (a.replay.assumptions.anti_overfit as { oos_stats?: { total_r?: number; avg_r?: number } } | undefined)?.oos_stats
  const bOos = (b.replay.assumptions.anti_overfit as { oos_stats?: { total_r?: number; avg_r?: number } } | undefined)?.oos_stats
  return (bOos?.total_r ?? b.replay.total_r) - (aOos?.total_r ?? a.replay.total_r)
    || (bOos?.avg_r ?? b.replay.avg_r) - (aOos?.avg_r ?? a.replay.avg_r)
}

export function countActiveParameters(params: JSONRecord): number {
  return Object.values(params).reduce<number>((count, value) => {
    if (Array.isArray(value)) {
      return count + value.length
    }
    return value !== undefined && value !== null && value !== "" ? count + 1 : count
  }, 0)
}

export function loadFundingEvents(path?: string): Array<{ timestamp: string; value: number }> {
  if (!path) return []
  const cached = fundingEventCache.get(path)
  if (cached) return cached
  const report = asRecord(JSON.parse(readFileSync(path, "utf8")))
  const raw = asRecord(asRecord(report.data).market_events).funding
  const events = (Array.isArray(raw) ? raw : []).map((item) => {
    const value = asRecord(item)
    return { timestamp: stringField(value.timestamp), value: Number(value.value) }
  }).filter((item) => item.timestamp && Number.isFinite(item.value))
  fundingEventCache.set(path, events)
  return events
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}
