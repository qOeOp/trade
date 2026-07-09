import { readFileSync } from "node:fs"
import { factorConditionsToJson, passesFactorConditions, readFactorConditions, type FactorCondition, type FactorFeatureStore } from "../factor-engine"
import { loadCandlesFromManifest, type Candle, type ReplaySignal, type ReplayStrategy } from "../replay-core"
import type { RndFamilyModule } from "../rnd-family"
import { readNonNegativeNumber, readPositiveInteger, readPositiveNumber, readSide, round, type JSONRecord, type SideFilter } from "../rnd-family-helpers"

interface Params {
  side: SideFilter
  benchmarkManifestPath: string
  benchmarkTimeframe: string
  lookbackBars: number
  relativeThresholdAtr: number
  stopAtr: number
  maxRiskAtr: number
  rewardRisk: number
  breakEvenAfterR: number
  breakEvenOffsetR: number
  factorConditions: FactorCondition[]
}

interface BenchmarkSeries {
  byTimestamp: Map<number, number>
  closes: number[]
}

const family: RndFamilyModule = {
  id: "relative_weakness_momentum_v1",
  configure(strategyId, raw, store) {
    const params = normalize(raw)
    const benchmark = loadBenchmark(params)
    return {
      strategy: strategy(strategyId, params, benchmark, store),
      rewardRisk: params.rewardRisk,
      params: json(params),
      supplementalDataRefs: [params.benchmarkManifestPath],
    }
  },
}

function normalize(raw: JSONRecord): Params {
  const benchmarkManifestPath = stringField(raw.benchmark_manifest_path ?? raw.benchmarkManifestPath)
  if (!benchmarkManifestPath) {
    throw new Error("relative_weakness_momentum_v1 requires benchmark_manifest_path")
  }
  return {
    side: readSide(raw.side),
    benchmarkManifestPath,
    benchmarkTimeframe: stringField(raw.benchmark_timeframe ?? raw.benchmarkTimeframe) || "4h",
    lookbackBars: readPositiveInteger(raw.lookback_bars ?? raw.lookbackBars, 120),
    relativeThresholdAtr: readPositiveNumber(raw.relative_threshold_atr ?? raw.relativeThresholdAtr, 1),
    stopAtr: readPositiveNumber(raw.stop_atr ?? raw.stopAtr, 1),
    maxRiskAtr: readPositiveNumber(raw.max_risk_atr ?? raw.maxRiskAtr, 2.5),
    rewardRisk: readPositiveNumber(raw.reward_risk ?? raw.rewardRisk, 2),
    breakEvenAfterR: readNonNegativeNumber(raw.break_even_after_r ?? raw.breakEvenAfterR, 0),
    breakEvenOffsetR: readNonNegativeNumber(raw.break_even_offset_r ?? raw.breakEvenOffsetR, 0),
    factorConditions: readFactorConditions(raw.factor_conditions ?? raw.factorConditions),
  }
}

function json(params: Params): JSONRecord {
  return {
    side: params.side,
    benchmarkManifestPath: params.benchmarkManifestPath,
    benchmarkTimeframe: params.benchmarkTimeframe,
    lookbackBars: params.lookbackBars,
    relativeThresholdAtr: params.relativeThresholdAtr,
    stopAtr: params.stopAtr,
    maxRiskAtr: params.maxRiskAtr,
    rewardRisk: params.rewardRisk,
    breakEvenAfterR: params.breakEvenAfterR,
    breakEvenOffsetR: params.breakEvenOffsetR,
    factorConditions: factorConditionsToJson(params.factorConditions),
  }
}

function loadBenchmark(params: Params): BenchmarkSeries {
  const manifest = JSON.parse(readFileSync(params.benchmarkManifestPath, "utf8")) as JSONRecord
  const candles = loadCandlesFromManifest(params.benchmarkManifestPath, manifest, params.benchmarkTimeframe)
  return {
    byTimestamp: new Map(candles.map((candle, index) => [candle.timestamp, index])),
    closes: candles.map((candle) => candle.close),
  }
}

function strategy(id: string, params: Params, benchmark: BenchmarkSeries, store: FactorFeatureStore): ReplayStrategy {
  return {
    strategy_id: id,
    default_timeframe: "4h",
    warmup_bars: Math.max(200, params.lookbackBars + 1),
    generateSignal({ candles, indicators, index, entryIndex, entryPrice, options }) {
      const candle = candles[index]
      const prior = candles[index - params.lookbackBars]
      const atr = indicators.atr14[index]
      if (!prior || !Number.isFinite(atr) || atr <= 0 || !passesFactorConditions(params.factorConditions, store, options.timeframe || "4h", candle.date)) return null
      const relativeAtr = relativeMoveAtr(candle, prior, benchmark, params.lookbackBars, atr)
      if (!Number.isFinite(relativeAtr)) return null
      if ((params.side === "short" || params.side === "both") && relativeAtr <= -params.relativeThresholdAtr) {
        return signal("short", candle, index, entryIndex, entryPrice, atr, relativeAtr, params)
      }
      if ((params.side === "long" || params.side === "both") && relativeAtr >= params.relativeThresholdAtr) {
        return signal("long", candle, index, entryIndex, entryPrice, atr, relativeAtr, params)
      }
      return null
    },
  }
}

function relativeMoveAtr(candle: Candle, prior: Candle, benchmark: BenchmarkSeries, lookbackBars: number, atr: number): number {
  const benchmarkIndex = benchmark.byTimestamp.get(candle.timestamp)
  if (benchmarkIndex === undefined) return Number.NaN
  const benchmarkPrior = benchmark.closes[benchmarkIndex - lookbackBars]
  const benchmarkNow = benchmark.closes[benchmarkIndex]
  if (!Number.isFinite(benchmarkPrior) || !Number.isFinite(benchmarkNow) || benchmarkPrior <= 0 || prior.close <= 0) return Number.NaN
  const assetReturn = candle.close / prior.close - 1
  const benchmarkReturn = benchmarkNow / benchmarkPrior - 1
  return ((assetReturn - benchmarkReturn) * candle.close) / atr
}

function signal(side: "long" | "short", candle: Candle, index: number, entryIndex: number, entry: number, atr: number, relativeAtr: number, params: Params): ReplaySignal | null {
  const stop = side === "long" ? candle.low - params.stopAtr * atr : candle.high + params.stopAtr * atr
  const risk = Math.abs(entry - stop)
  if (risk <= 0 || risk > params.maxRiskAtr * atr) return null
  return {
    side,
    signal_index: index,
    entry_index: entryIndex,
    entry,
    stop,
    target: side === "long" ? entry + risk * params.rewardRisk : entry - risk * params.rewardRisk,
    ...(params.breakEvenAfterR > 0 ? { break_even_after_r: params.breakEvenAfterR, break_even_offset_r: params.breakEvenOffsetR } : {}),
    reason: `rnd relative weakness momentum ${side}`,
    meta: { ...json(params), relativeAtr: round(relativeAtr) },
  }
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export default family
