import { buildIndicators } from "../../../../../replay-execution-plane/compatibility/legacy-research-features/src/lib/legacy-research-features"
import { hashCanonical } from "../../../../../replay-execution-plane/compatibility/legacy-replay-identity/src/lib/legacy-replay-identity"
import type { Candle } from "../../../../../replay-execution-plane/compatibility/legacy-research-data/src/lib/legacy-research-data"
import {
  transformFactor,
  type FactorCondition,
  type FactorFeatureStore,
  type FactorSeriesDefinition,
  type FactorTransform,
} from "./factor-engine"

interface FactorResearchOptions {
  horizonBars?: number
  lookback?: number
  minSamples?: number
  minAbsIc?: number
  maxCorrelation?: number
  maxSelected?: number
  targets?: Array<{ timestamp: string; value: number; regime: string }>
  selectionScope?: FactorSelectionScope
}

interface FactorSelectionScope {
  method: "full_declared_sample" | "purged_chronological_trade_split_v1"
  purge_rule: "none" | "label_end_strictly_before_oos_start"
  train_end_at: string | null
  oos_start_at: string | null
  total_target_count: number
  selected_target_count: number
  purged_overlap_count: number
  oos_target_count: number
}

interface FactorResearchProfile {
  factor_id: string
  transform: FactorTransform
  sample_count: number
  ic: number
  p_value: number
  fdr_q_value: number
  fold_ics: number[]
  regime_ics: Array<{ regime: string; sample_count: number; ic: number }>
  accepted: boolean
  rejected_by: string[]
}

interface FactorResearchReport {
  method: "causal_rank_ic" | "setup_conditioned_rank_ic"
  horizon_bars: number
  lookback: number
  min_samples: number
  min_abs_ic: number
  max_correlation: number
  max_fdr: 0.05
  selection_scope: FactorSelectionScope
  selection_identity_hash: string
  profiles: FactorResearchProfile[]
  selected_factor_ids: string[]
  seeds: FactorCondition[]
}

interface Observation {
  index: number
  factor: number
  forwardReturn: number
  regime: string
}

function researchFactorSeeds(
  store: FactorFeatureStore,
  candles: Candle[],
  timeframe: string,
  options: FactorResearchOptions = {},
): FactorResearchReport {
  const horizonBars = positiveInteger(options.horizonBars, 6)
  const setupConditioned = Array.isArray(options.targets)
  const lookback = positiveInteger(options.lookback, 100)
  const minSamples = positiveInteger(options.minSamples, setupConditioned ? 30 : 300)
  const minAbsIc = boundedNumber(options.minAbsIc, 0.03, 0, 1)
  const maxCorrelation = boundedNumber(options.maxCorrelation, 0.85, 0, 1)
  const maxSelected = positiveInteger(options.maxSelected, 6)
  const regimes = classifyRegimes(candles)
  const timestampIndexes = new Map(candles.map((candle, index) => [Date.parse(candle.date), index]))
  const targets = new Map((options.targets || []).map((target, index) => [Date.parse(target.timestamp), { ...target, index }]))
  const internals: Array<{ definition: FactorSeriesDefinition; profile: FactorResearchProfile; observations: Observation[] }> = []

  for (const definition of store.definitions()) {
    const series = store.series(timeframe, definition.factor_id)
    if (!series) continue
    const transform = preferredTransform(definition)
    const observations: Observation[] = []
    for (let seriesIndex = 0; seriesIndex < series.timestamps.length; seriesIndex += 1) {
      const candleIndex = timestampIndexes.get(Date.parse(series.timestamps[seriesIndex]))
      if (candleIndex === undefined) continue
      const factor = transformFactor(series.values, seriesIndex, transform, lookback)
      const target = targets.get(Date.parse(series.timestamps[seriesIndex]))
      const close = candles[candleIndex].close
      const futureClose = candles[candleIndex + horizonBars]?.close
      if (!Number.isFinite(factor)) continue
      if (setupConditioned && !target) continue
      if (!setupConditioned && (!Number.isFinite(close) || !Number.isFinite(futureClose) || close <= 0)) continue
      observations.push({
        index: target?.index ?? candleIndex,
        factor: Number(factor),
        forwardReturn: target?.value ?? Number(futureClose) / close - 1,
        regime: target?.regime || regimes[candleIndex],
      })
    }
    const ic = rankIc(observations)
    const foldIcs = chronologicalFoldIcs(observations, 3)
    const regimeIcs = regimeSlices(observations, Math.max(setupConditioned ? 5 : 30, Math.floor(minSamples / 10)))
    const rejectedBy: string[] = []
    if (observations.length < minSamples) rejectedBy.push("insufficient_samples")
    if (Math.abs(ic) < minAbsIc) rejectedBy.push("weak_ic")
    if (sameSignCount(foldIcs, ic, 0.01) < 2) rejectedBy.push("unstable_time_folds")
    if (sameSignCount(regimeIcs.map((item) => item.ic), ic, 0.01) < 2) rejectedBy.push("unstable_regimes")
    internals.push({
      definition,
      observations,
      profile: {
        factor_id: definition.factor_id,
        transform,
        sample_count: observations.length,
        ic: round(ic),
        p_value: round(icPValue(ic, observations.length, setupConditioned ? 1 : horizonBars)),
        fdr_q_value: 1,
        fold_ics: foldIcs.map(round),
        regime_ics: regimeIcs.map((item) => ({ ...item, ic: round(item.ic) })),
        accepted: rejectedBy.length === 0,
        rejected_by: rejectedBy,
      },
    })
  }

  assignFdr(internals.map((item) => item.profile))
  for (const item of internals) {
    if (item.profile.fdr_q_value > 0.05) {
      item.profile.accepted = false
      item.profile.rejected_by.push("fdr_not_significant")
    }
  }

  const selected: typeof internals = []
  for (const item of internals.filter((entry) => entry.profile.accepted).sort((a, b) => Math.abs(b.profile.ic) - Math.abs(a.profile.ic))) {
    if (selected.length >= maxSelected) {
      item.profile.accepted = false
      item.profile.rejected_by.push("selection_budget")
      continue
    }
    const redundant = selected.some((kept) => Math.abs(alignedCorrelation(item.observations, kept.observations)) >= maxCorrelation)
    if (redundant) {
      item.profile.accepted = false
      item.profile.rejected_by.push("redundant_correlation")
      continue
    }
    selected.push(item)
  }

  const selectionScope = options.selectionScope || {
    method: "full_declared_sample",
    purge_rule: "none",
    train_end_at: null,
    oos_start_at: null,
    total_target_count: options.targets?.length ?? 0,
    selected_target_count: options.targets?.length ?? 0,
    purged_overlap_count: 0,
    oos_target_count: 0,
  }
  const selectedFactorIds = selected.map((item) => item.definition.factor_id)
  const seeds = selected.flatMap(({ definition, profile }) => buildDirectionalSeeds(definition, profile, lookback, setupConditioned))
  const selectionIdentityHash = hashCanonical({
    method: setupConditioned ? "setup_conditioned_rank_ic" : "causal_rank_ic",
    horizon_bars: horizonBars,
    lookback,
    min_samples: minSamples,
    min_abs_ic: minAbsIc,
    max_correlation: maxCorrelation,
    max_fdr: 0.05,
    selection_scope: selectionScope,
    selected_factor_ids: selectedFactorIds,
    seeds,
  })
  return {
    method: setupConditioned ? "setup_conditioned_rank_ic" : "causal_rank_ic",
    horizon_bars: horizonBars,
    lookback,
    min_samples: minSamples,
    min_abs_ic: minAbsIc,
    max_correlation: maxCorrelation,
    max_fdr: 0.05,
    selection_scope: selectionScope,
    selection_identity_hash: selectionIdentityHash,
    profiles: internals.map((item) => item.profile).sort((a, b) => Math.abs(b.ic) - Math.abs(a.ic)),
    selected_factor_ids: selectedFactorIds,
    seeds,
  }
}

function assignFdr(profiles: FactorResearchProfile[]): void {
  const ranked = [...profiles].sort((a, b) => a.p_value - b.p_value)
  let next = 1
  for (let index = ranked.length - 1; index >= 0; index -= 1) {
    next = Math.min(next, ranked[index].p_value * ranked.length / (index + 1))
    ranked[index].fdr_q_value = round(next)
  }
}

function icPValue(ic: number, samples: number, horizonBars: number): number {
  const effectiveSamples = Math.max(3, Math.floor(samples / Math.max(1, horizonBars)))
  const z = Math.abs(ic) * Math.sqrt(effectiveSamples - 3)
  const t = 1 / (1 + 0.2316419 * z)
  const density = 0.39894228 * Math.exp(-0.5 * z * z)
  const tail = density * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return Math.min(1, 2 * tail)
}

function buildDirectionalSeeds(definition: FactorSeriesDefinition, profile: FactorResearchProfile, lookback: number, favorableOnly: boolean): FactorCondition[] {
  const role = readRole(definition.roles[0])
  const highOp = profile.ic >= 0 ? "gt" : "lt"
  const lowOp = profile.ic >= 0 ? "lt" : "gt"
  const favorable = { factorId: definition.factor_id, role, transform: profile.transform, lookback, op: highOp, value: highOp === "gt" ? 0.7 : 0.3 } as FactorCondition
  return favorableOnly ? [favorable] : [
    favorable,
    { factorId: definition.factor_id, role, transform: profile.transform, lookback, op: lowOp, value: lowOp === "gt" ? 0.7 : 0.3 },
  ]
}

function classifyRegimes(candles: Candle[]): string[] {
  const indicators = buildIndicators(candles)
  const ratios = candles.map((candle, index) => indicators.atr14[index] / candle.close)
  return candles.map((candle, index) => {
    if (index < 199 || !Number.isFinite(ratios[index])) return "unknown"
    const history = ratios.slice(Math.max(0, index - 99), index + 1).filter(Number.isFinite).sort((a, b) => a - b)
    const median = history[Math.floor(history.length / 2)] ?? ratios[index]
    return `${candle.close >= indicators.ema200[index] ? "bull" : "bear"}_${ratios[index] >= median ? "high_vol" : "low_vol"}`
  })
}

function preferredTransform(definition: FactorSeriesDefinition): FactorTransform {
  if (definition.allowed_transforms.includes("percentile")) return "percentile"
  if (definition.allowed_transforms.includes("zscore")) return "zscore"
  return definition.allowed_transforms[0] || "level"
}

function chronologicalFoldIcs(observations: Observation[], folds: number): number[] {
  if (observations.length === 0) return []
  const size = Math.ceil(observations.length / folds)
  return Array.from({ length: folds }, (_, index) => rankIc(observations.slice(index * size, Math.min(observations.length, (index + 1) * size))))
}

function regimeSlices(observations: Observation[], minimum: number): Array<{ regime: string; sample_count: number; ic: number }> {
  const groups = new Map<string, Observation[]>()
  for (const observation of observations) {
    if (observation.regime === "unknown") continue
    const group = groups.get(observation.regime) || []
    group.push(observation)
    groups.set(observation.regime, group)
  }
  return Array.from(groups.entries())
    .filter(([, items]) => items.length >= minimum)
    .map(([regime, items]) => ({ regime, sample_count: items.length, ic: rankIc(items) }))
    .sort((a, b) => a.regime.localeCompare(b.regime))
}

function rankIc(observations: Observation[]): number {
  if (observations.length < 3) return 0
  return pearson(ranks(observations.map((item) => item.factor)), ranks(observations.map((item) => item.forwardReturn)))
}

function alignedCorrelation(left: Observation[], right: Observation[]): number {
  const rightByIndex = new Map(right.map((item) => [item.index, item.factor]))
  const pairs = left.map((item) => [item.factor, rightByIndex.get(item.index)] as const).filter((item): item is readonly [number, number] => Number.isFinite(item[1]))
  return pairs.length >= 3 ? pearson(pairs.map((item) => item[0]), pairs.map((item) => item[1])) : 0
}

function ranks(values: number[]): number[] {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value)
  const result = new Array<number>(values.length)
  let start = 0
  while (start < sorted.length) {
    let end = start + 1
    while (end < sorted.length && sorted[end].value === sorted[start].value) end += 1
    const rank = (start + end - 1) / 2 + 1
    for (let index = start; index < end; index += 1) result[sorted[index].index] = rank
    start = end
  }
  return result
}

function pearson(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length < 3) return 0
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length
  let covariance = 0
  let leftVariance = 0
  let rightVariance = 0
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] - leftMean
    const b = right[index] - rightMean
    covariance += a * b
    leftVariance += a * a
    rightVariance += b * b
  }
  const denominator = Math.sqrt(leftVariance * rightVariance)
  return denominator > 0 ? covariance / denominator : 0
}

function sameSignCount(values: number[], reference: number, minimumAbsolute: number): number {
  const sign = Math.sign(reference)
  return values.filter((value) => Math.abs(value) >= minimumAbsolute && Math.sign(value) === sign).length
}

function readRole(value: string): FactorCondition["role"] {
  return value === "regime" || value === "confirmation" || value === "trigger" || value === "timing" || value === "risk" || value === "location"
    ? value
    : "filter"
}

function positiveInteger(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const number = Number(value)
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : fallback
}

function round(value: number): number {
  return Number(value.toFixed(6))
}

export {
  researchFactorSeeds,
  type FactorResearchOptions,
  type FactorResearchProfile,
  type FactorResearchReport,
  type FactorSelectionScope,
}
