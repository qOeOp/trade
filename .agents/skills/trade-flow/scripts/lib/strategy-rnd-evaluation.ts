import { readFileSync } from "node:fs"
import {
  hashCanonical,
  replayStrategy,
  type ReplayResult,
  type ReplaySignal,
  type ReplayStrategy,
} from "./replay-core"
import { type FactorFeatureStore } from "./factor-engine"
import { getRndFamily, type RndFamilyConfigured } from "./rnd-family"
import type { JSONRecord } from "./json"
import type { StrategyRndBatchInput, StrategyRndCandidateInput } from "./strategy-rnd-inputs"

const fundingEventCache = new Map<string, Array<{ timestamp: string; value: number }>>()

export interface StrategyRndCandidateReport {
  candidate_id: string
  description: string
  family: string
  parameter_count: number
  params: JSONRecord
  replay: ReplayResult
  null_controls: CandidateNullControlReport
  gate: {
    accepted: boolean
    blocked_by: Array<{ check_id: string; reason: string }>
  }
}

export interface CandidateNullControlReport {
  method: "side_flip_and_entry_lag"
  observed_total_r: number
  controls: Array<{
    control_id: string
    sample_count: number
    avg_r: number
    total_r: number
    profit_factor: number
  }>
  blocked_by: Array<{ check_id: string; reason: string }>
}

export function runCandidate(input: StrategyRndBatchInput, candidate: StrategyRndCandidateInput, featureStore: FactorFeatureStore): StrategyRndCandidateReport {
  const family = candidate.family || "trend_pullback_v1"
  const parameterCount = candidate.parameterCount ?? countActiveParameters(candidate.params || {})
  const rawParams = candidate.params || {}
  const configured = getRndFamily(family).configure(candidate.candidateId, rawParams, featureStore)
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
    supplementalDataRefs: input.indicatorReportPath ? [input.indicatorReportPath] : [],
  })
  const robustness = asRecord(replay.assumptions.robustness)
  robustness.parameter_stability = Object.keys(input.parameterStability || {}).length > 0
    ? input.parameterStability
    : evaluateParameterStability(input, candidate, featureStore)
  replay.assumptions.robustness = robustness
  replay.provenance.assumptions_hash = hashCanonical(replay.assumptions)
  const nullControls = buildCandidateNullControls(input, candidate, configured, featureStore, replay)
  return {
    candidate_id: candidate.candidateId,
    description: candidate.description || "",
    family,
    parameter_count: parameterCount,
    params: configured.params,
    replay,
    null_controls: nullControls,
    gate: evaluateRndCandidate(replay, parameterCount, nullControls.blocked_by),
  }
}

export function buildCandidateNullControls(
  input: StrategyRndBatchInput,
  candidate: StrategyRndCandidateInput,
  configured: RndFamilyConfigured,
  featureStore: FactorFeatureStore,
  observed: ReplayResult,
): CandidateNullControlReport {
  const parameterCount = candidate.parameterCount ?? countActiveParameters(candidate.params || {})
  const controls: CandidateNullControlReport["controls"] = []
  const sideFlipped = flippedSideParams(candidate.params || {})
  if (sideFlipped) {
    const flipped = getRndFamily(candidate.family || "trend_pullback_v1").configure(`${candidate.candidateId}-null-side-flip`, sideFlipped, featureStore)
    controls.push(summarizeNullControl("side_flip", runConfiguredReplay(input, flipped, countActiveParameters(sideFlipped))))
  }
  controls.push(summarizeNullControl(
    "entry_lag_3",
    runConfiguredReplay(input, { ...configured, strategy: laggedEntryStrategy(configured.strategy, 3) }, parameterCount),
  ))
  const eligible = controls.filter((control) => control.sample_count >= 10)
  const blocked = observed.total_r > 0
    && observed.avg_r > 0
    && eligible.some((control) => control.total_r >= observed.total_r || control.avg_r >= observed.avg_r)
  return {
    method: "side_flip_and_entry_lag",
    observed_total_r: observed.total_r,
    controls,
    blocked_by: blocked
      ? [{ check_id: "RND-NULL-NOT-BEATEN", reason: "candidate does not beat side-flip or delayed-entry null control" }]
      : [],
  }
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
    supplementalDataRefs: input.indicatorReportPath ? [input.indicatorReportPath] : [],
  })
}

export function summarizeNullControl(controlId: string, replay: ReplayResult): CandidateNullControlReport["controls"][number] {
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
    strategy_id: `${strategy.strategy_id}-null-entry-lag-${lagBars}`,
    generateSignal(input) {
      const sourceIndex = input.index - lagBars
      if (sourceIndex < strategy.warmup_bars) return null
      const original = strategy.generateSignal({ ...input, index: sourceIndex })
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
    reason: `${signal.reason} null entry lag`,
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
        supplementalDataRefs: input.indicatorReportPath ? [input.indicatorReportPath] : [],
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

export function evaluateRndCandidate(
  replay: ReplayResult,
  parameterCount: number,
  nullBlocks: Array<{ check_id: string; reason: string }> = [],
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
  blockedBy.push(...nullBlocks)
  return {
    accepted: blockedBy.length === 0,
    blocked_by: blockedBy,
  }
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

export function emptyFeatureStore(): FactorFeatureStore {
  return {
    definitions() {
      return []
    },
    series() {
      return undefined
    },
    read() {
      return undefined
    },
  }
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
