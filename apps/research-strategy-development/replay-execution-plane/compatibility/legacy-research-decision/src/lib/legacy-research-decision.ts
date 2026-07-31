import type { Candle } from "../../../legacy-research-data/src/lib/legacy-research-data"
import { loadCandlesFromManifest, loadManifest } from "../../../legacy-research-data/src/lib/legacy-research-data"
import { buildIndicators, type IndicatorSet } from "../../../legacy-research-features/src/lib/legacy-research-features"
import { hashCanonical } from "../../../legacy-replay-identity/src/lib/legacy-replay-identity"
import type {
  LatestSignalResult,
  ReplayOptions,
  ReplayStrategy,
  ReplayTemporalIntegrityReport,
} from "../../../legacy-research-contracts/src/lib/legacy-research-contracts"

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

function timeframeMilliseconds(timeframe: string): number {
  const match = timeframe.match(/^(\d+)([mhdw])$/)
  if (!match) throw new Error(`unsupported signal timeframe: ${timeframe}`)
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[match[2]] || 0
  return Number(match[1]) * unit
}

function boundedCutoffs(eligible: number[], maximum: number): number[] {
  if (eligible.length <= maximum) return eligible
  const selected = new Set<number>()
  for (let index = 0; index < maximum; index += 1) {
    selected.add(eligible[Math.round(index * (eligible.length - 1) / Math.max(1, maximum - 1))])
  }
  return [...selected].sort((left, right) => left - right)
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export {
  buildReplayDecisionInput,
  detectReplayDecisionLookahead,
  evaluateLatestSignal,
  timeframeMilliseconds,
}
