import { factorConditionsToJson, passesFactorConditions, readFactorConditions, type FactorCondition, type FactorFeatureStore } from "../factor-engine"
import { loadCandlesFromManifest, loadManifest, type Candle, type ReplaySignal, type ReplayStrategy } from "../../../../replay-engine/src/lib/replay-core"
import type { RndFamilyModule } from "../rnd-family"
import { readNonNegativeNumber, readPositiveInteger, readPositiveNumber, readSide, round, type JSONRecord, type SideFilter } from "../rnd-family-helpers"

interface Params {
  side: SideFilter
  signalMode: SignalMode
  confirmationMode: ConfirmationMode
  benchmarkManifestPath: string
  benchmarkTimeframe: string
  lookbackBars: number
  relativeThresholdAtr: number
  benchmarkReturnMax?: number
  benchmarkReturnMin?: number
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

interface RelativeMove {
  relativeAtr: number
  benchmarkReturn: number
}

type SignalMode = "momentum" | "reversion"
type ConfirmationMode = "none" | "reversal_close"

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
  const benchmarkManifestPath = stringField(raw.benchmark_manifest_path)
  if (!benchmarkManifestPath) {
    throw new Error("relative_weakness_momentum_v1 requires benchmark_manifest_path")
  }
  return {
    side: readSide(raw.side),
    signalMode: readSignalMode(raw.signal_mode),
    confirmationMode: readConfirmationMode(raw.confirmation_mode),
    benchmarkManifestPath,
    benchmarkTimeframe: stringField(raw.benchmark_timeframe) || "4h",
    lookbackBars: readPositiveInteger(raw.lookback_bars, 120),
    relativeThresholdAtr: readPositiveNumber(raw.relative_threshold_atr, 1),
    benchmarkReturnMax: optionalNumber(raw.benchmark_return_max),
    benchmarkReturnMin: optionalNumber(raw.benchmark_return_min),
    stopAtr: readPositiveNumber(raw.stop_atr, 1),
    maxRiskAtr: readPositiveNumber(raw.max_risk_atr, 2.5),
    rewardRisk: readPositiveNumber(raw.reward_risk, 2),
    breakEvenAfterR: readNonNegativeNumber(raw.break_even_after_r, 0),
    breakEvenOffsetR: readNonNegativeNumber(raw.break_even_offset_r, 0),
    factorConditions: readFactorConditions(raw.factor_conditions),
  }
}

function json(params: Params): JSONRecord {
  return {
    side: params.side,
    ...(params.signalMode !== "momentum" ? { signal_mode: params.signalMode } : {}),
    ...(params.confirmationMode !== "none" ? { confirmation_mode: params.confirmationMode } : {}),
    benchmark_manifest_path: params.benchmarkManifestPath,
    benchmark_timeframe: params.benchmarkTimeframe,
    lookback_bars: params.lookbackBars,
    relative_threshold_atr: params.relativeThresholdAtr,
    ...(params.benchmarkReturnMax !== undefined ? { benchmark_return_max: params.benchmarkReturnMax } : {}),
    ...(params.benchmarkReturnMin !== undefined ? { benchmark_return_min: params.benchmarkReturnMin } : {}),
    stop_atr: params.stopAtr,
    max_risk_atr: params.maxRiskAtr,
    reward_risk: params.rewardRisk,
    break_even_after_r: params.breakEvenAfterR,
    break_even_offset_r: params.breakEvenOffsetR,
    factor_conditions: factorConditionsToJson(params.factorConditions),
  }
}

function loadBenchmark(params: Params): BenchmarkSeries {
  const manifest = loadManifest(params.benchmarkManifestPath)
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
      const move = relativeMoveAtr(candle, prior, benchmark, params.lookbackBars, atr)
      if (!move || !Number.isFinite(move.relativeAtr)) return null
      if (!passesBenchmarkBounds(move.benchmarkReturn, params)) return null
      const weakAsset = move.relativeAtr <= -params.relativeThresholdAtr
      const strongAsset = move.relativeAtr >= params.relativeThresholdAtr
      const longSetup = params.signalMode === "momentum" ? strongAsset : weakAsset
      const shortSetup = params.signalMode === "momentum" ? weakAsset : strongAsset
      if ((params.side === "short" || params.side === "both") && shortSetup) {
        if (!passesConfirmation("short", candles, index, params.confirmationMode)) return null
        return signal("short", candle, index, entryIndex, entryPrice, atr, move, params)
      }
      if ((params.side === "long" || params.side === "both") && longSetup) {
        if (!passesConfirmation("long", candles, index, params.confirmationMode)) return null
        return signal("long", candle, index, entryIndex, entryPrice, atr, move, params)
      }
      return null
    },
  }
}

function relativeMoveAtr(candle: Candle, prior: Candle, benchmark: BenchmarkSeries, lookbackBars: number, atr: number): RelativeMove | null {
  const benchmarkIndex = benchmark.byTimestamp.get(candle.timestamp)
  if (benchmarkIndex === undefined) return null
  const benchmarkPrior = benchmark.closes[benchmarkIndex - lookbackBars]
  const benchmarkNow = benchmark.closes[benchmarkIndex]
  if (!Number.isFinite(benchmarkPrior) || !Number.isFinite(benchmarkNow) || benchmarkPrior <= 0 || prior.close <= 0) return null
  const assetReturn = candle.close / prior.close - 1
  const benchmarkReturn = benchmarkNow / benchmarkPrior - 1
  return {
    relativeAtr: ((assetReturn - benchmarkReturn) * candle.close) / atr,
    benchmarkReturn,
  }
}

function passesBenchmarkBounds(benchmarkReturn: number, params: Params): boolean {
  if (params.benchmarkReturnMax !== undefined && benchmarkReturn > params.benchmarkReturnMax) return false
  if (params.benchmarkReturnMin !== undefined && benchmarkReturn < params.benchmarkReturnMin) return false
  return true
}

function passesConfirmation(side: "long" | "short", candles: Candle[], index: number, mode: ConfirmationMode): boolean {
  if (mode === "none") return true
  const candle = candles[index]
  const previous = candles[index - 1]
  if (!previous) return false
  if (side === "short") return candle.close < candle.open && candle.close < previous.close
  return candle.close > candle.open && candle.close > previous.close
}

function signal(side: "long" | "short", candle: Candle, index: number, entryIndex: number, entry: number, atr: number, move: RelativeMove, params: Params): ReplaySignal | null {
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
    reason: `rnd relative weakness ${params.signalMode} ${side}`,
    meta: { ...json(params), relative_atr: round(move.relativeAtr), benchmark_return: round(move.benchmarkReturn) },
  }
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function optionalNumber(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function readSignalMode(value: unknown): SignalMode {
  return value === "reversion" ? "reversion" : "momentum"
}

function readConfirmationMode(value: unknown): ConfirmationMode {
  return value === "reversal_close" ? "reversal_close" : "none"
}

export default family
