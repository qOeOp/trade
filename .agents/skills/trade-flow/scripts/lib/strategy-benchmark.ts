import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { loadCandlesFromManifest, replayDataHash, type Candle } from "./replay-core"

type JSONRecord = Record<string, unknown>

interface BenchmarkDataset { datasetId: string; manifestPath: string }
interface TrendBenchmarkInput {
  benchmarkId?: string
  datasets: BenchmarkDataset[]
  timeframe?: string
  horizonBars?: number[]
  volatilityBars?: number
  rebalanceBars?: number
  feeBps?: number
  slippageBps?: number
  fundingBpsPer8h?: number
  randomTrials?: number
}

interface PortfolioStats {
  sample_count: number
  total_return: number
  annualized_return: number
  annualized_volatility: number
  sharpe: number
  max_drawdown: number
}

function runTrendBenchmark(input: TrendBenchmarkInput): JSONRecord {
  if (input.datasets.length < 3) throw new Error("trend benchmark requires at least three datasets")
  if (input.datasets.some((item) => !item.datasetId || !item.manifestPath)) throw new Error("trend benchmark datasets require datasetId and manifestPath")
  if (new Set(input.datasets.map((item) => item.datasetId)).size !== input.datasets.length) throw new Error("trend benchmark dataset ids must be unique")
  const timeframe = input.timeframe || "4h"
  if (timeframe !== "4h") throw new Error("fixed trend benchmark only supports 4h")
  const horizons = input.horizonBars || [180, 540, 1080]
  if (horizons.length === 0 || horizons.some((value) => !Number.isInteger(value) || value <= 0)) throw new Error("trend benchmark horizons must be positive integers")
  const volatilityBars = input.volatilityBars ?? 180
  const rebalanceBars = input.rebalanceBars ?? 6
  const randomTrials = input.randomTrials ?? 100
  if (!Number.isInteger(volatilityBars) || volatilityBars < 2) throw new Error("trend benchmark volatilityBars must be an integer >= 2")
  if (!Number.isInteger(rebalanceBars) || rebalanceBars < 1) throw new Error("trend benchmark rebalanceBars must be a positive integer")
  if (!Number.isInteger(randomTrials) || randomTrials < 20 || randomTrials > 500) throw new Error("trend benchmark randomTrials must be 20-500")
  const panel = alignedPanel(input.datasets, timeframe)
  const warmup = Math.max(volatilityBars, ...horizons)
  if (panel.timestamps.length <= warmup + rebalanceBars) throw new Error("trend benchmark has insufficient aligned history")
  const weights = buildWeightSchedule(panel.closes, warmup, horizons, volatilityBars, rebalanceBars, timeframe)
  const costBps = (input.feeBps ?? 5) + (input.slippageBps ?? 2)
  const fundingStressBps = input.fundingBpsPer8h ?? 1
  if (costBps < 0 || fundingStressBps < 0) throw new Error("trend benchmark costs must be non-negative")
  const observed = simulate(panel, weights, warmup, rebalanceBars, costBps, 0, timeframe)
  const stressed = simulate(panel, weights, warmup, rebalanceBars, costBps + 5, 0, timeframe)
  const fundingStressed = simulate(panel, weights, warmup, rebalanceBars, costBps, fundingStressBps, timeframe)
  const randomSharpes: number[] = []
  for (let trial = 0; trial < randomTrials; trial += 1) {
    randomSharpes.push(simulate(panel, circularShift(weights, trial + 1), warmup, rebalanceBars, costBps, 0, timeframe).stats.sharpe)
  }
  const empiricalP = (1 + randomSharpes.filter((value) => value >= observed.stats.sharpe).length) / (randomTrials + 1)
  const folds = chronologicalFolds(observed.returns, 3, timeframe)
  const blockedBy: Array<{ check_id: string; reason: string }> = []
  if (observed.stats.total_return <= 0 || observed.stats.sharpe < 0.5) blockedBy.push({ check_id: "BENCHMARK-EDGE", reason: "trend benchmark is not positive with Sharpe >= 0.5" })
  if (folds.filter((fold) => fold.total_return > 0).length < 2) blockedBy.push({ check_id: "BENCHMARK-TIME", reason: "fewer than two of three chronological folds are positive" })
  if (stressed.stats.total_return <= 0) blockedBy.push({ check_id: "BENCHMARK-COST", reason: "trend benchmark fails extra 5 bps turnover stress" })
  if (empiricalP > 0.05) blockedBy.push({ check_id: "BENCHMARK-NULL", reason: `empirical p-value ${round(empiricalP)} exceeds 0.05` })
  return {
    benchmark_id: input.benchmarkId || "multi_asset_time_series_trend_v1",
    harness_hash: createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex"),
    purpose: "rd_pipeline_calibration_only",
    calibrated: blockedBy.length === 0,
    blocked_by: blockedBy,
    datasets: input.datasets.map((item, index) => ({ dataset_id: item.datasetId, manifest_ref: item.manifestPath, data_hash: replayDataHash(item.manifestPath, timeframe), aligned_rows: panel.closes[index].length })),
    period: { first: new Date(panel.timestamps[warmup]).toISOString(), last: new Date(panel.timestamps.at(-1)!).toISOString() },
    assumptions: { timeframe, horizon_bars: horizons, volatility_bars: volatilityBars, rebalance_bars: rebalanceBars, inverse_volatility_weighting: true, target_annual_volatility: 0.15, max_gross_exposure: 1, fee_bps: input.feeBps ?? 5, slippage_bps: input.slippageBps ?? 2, adverse_funding_stress_bps_per_8h: fundingStressBps, parameter_search: false },
    observed: observed.stats,
    chronological_folds: folds,
    cost_stress: stressed.stats,
    funding_stress: fundingStressed.stats,
    null_control: { method: "portfolio_weight_circular_time_shift", trials: randomTrials, empirical_p_value: round(empiricalP), median_sharpe: round(quantile(randomSharpes, 0.5)), p95_sharpe: round(quantile(randomSharpes, 0.95)) },
    notes: ["Calibration does not authorize strategy promotion or live trading.", "Current-symbol panels carry survivorship bias and are insufficient as final strategy evidence."],
  }
}

function alignedPanel(datasets: BenchmarkDataset[], timeframe: string): { timestamps: number[]; closes: number[][] } {
  const loaded = datasets.map((dataset) => loadCandlesFromManifest(dataset.manifestPath, JSON.parse(readFileSync(dataset.manifestPath, "utf8")) as JSONRecord, timeframe))
  const common = loaded.slice(1).reduce((set, candles) => {
    const available = new Set(candles.map((candle) => candle.timestamp))
    return new Set([...set].filter((timestamp) => available.has(timestamp)))
  }, new Set(loaded[0].map((candle) => candle.timestamp)))
  const timestamps = [...common].sort((a, b) => a - b)
  if (timestamps.length === 0) throw new Error("trend benchmark datasets have no aligned timestamps")
  return { timestamps, closes: loaded.map((candles) => alignCloses(candles, timestamps)) }
}

function alignCloses(candles: Candle[], timestamps: number[]): number[] {
  const values = new Map(candles.map((candle) => [candle.timestamp, candle.close]))
  return timestamps.map((timestamp) => values.get(timestamp) || Number.NaN)
}

function buildWeightSchedule(closes: number[][], warmup: number, horizons: number[], volatilityBars: number, rebalanceBars: number, timeframe: string): number[][] {
  const weights: number[][] = []
  const annualPeriods = 365 * 24 / timeframeHours(timeframe)
  for (let index = warmup; index < closes[0].length - 1; index += rebalanceBars) {
    const signals = closes.map((series) => {
      const score = horizons.reduce((sum, horizon) => sum + Math.sign(series[index] / series[index - horizon] - 1), 0)
      return Math.sign(score)
    })
    const volatility = closes.map((series) => standardDeviation(Array.from({ length: volatilityBars }, (_, offset) => series[index - offset] / series[index - offset - 1] - 1)))
    const raw = signals.map((signal, asset) => signal / Math.max(volatility[asset], 1e-8))
    const gross = raw.reduce((sum, value) => sum + Math.abs(value), 0)
    const normalized = raw.map((value) => gross > 0 ? value / gross : 0)
    const portfolioReturns = Array.from({ length: volatilityBars }, (_, offset) => normalized.reduce((sum, weight, asset) => sum + weight * (closes[asset][index - offset] / closes[asset][index - offset - 1] - 1), 0))
    const annualVolatility = standardDeviation(portfolioReturns) * Math.sqrt(annualPeriods)
    const scale = Math.min(1, 0.15 / Math.max(annualVolatility, 1e-8))
    weights.push(normalized.map((value) => value * scale))
  }
  return weights
}

function simulate(panel: { timestamps: number[]; closes: number[][] }, schedule: number[][], warmup: number, rebalanceBars: number, costBps: number, fundingBps: number, timeframe: string): { stats: PortfolioStats; returns: number[] } {
  const returns: number[] = []
  let weights = Array(panel.closes.length).fill(0) as number[]
  let scheduleIndex = 0
  for (let index = warmup + 1; index < panel.timestamps.length; index += 1) {
    let turnover = 0
    if ((index - warmup - 1) % rebalanceBars === 0 && scheduleIndex < schedule.length) {
      const next = schedule[scheduleIndex]
      turnover = next.reduce((sum, value, asset) => sum + Math.abs(value - weights[asset]), 0)
      weights = next
      scheduleIndex += 1
    }
    const grossReturn = weights.reduce((sum, weight, asset) => sum + weight * (panel.closes[asset][index] / panel.closes[asset][index - 1] - 1), 0)
    const grossExposure = weights.reduce((sum, value) => sum + Math.abs(value), 0)
    const funding = grossExposure * fundingBps / 10000 * timeframeHours(timeframe) / 8
    returns.push(grossReturn - turnover * costBps / 10000 - funding)
  }
  return { stats: portfolioStats(returns, timeframe), returns }
}

function circularShift<T>(values: T[], seed: number): T[] {
  const offset = 1 + Math.floor(mulberry32(seed)() * Math.max(1, values.length - 1))
  return values.map((_, index) => values[(index + offset) % values.length])
}

function chronologicalFolds(returns: number[], count: number, timeframe: string): PortfolioStats[] {
  return Array.from({ length: count }, (_, index) => portfolioStats(returns.slice(Math.floor(index * returns.length / count), Math.floor((index + 1) * returns.length / count)), timeframe))
}

function portfolioStats(returns: number[], timeframe: string): PortfolioStats {
  const periods = 365 * 24 / timeframeHours(timeframe)
  const wealth = returns.reduce((value, item) => value * Math.max(0, 1 + item), 1)
  const mean = returns.reduce((sum, value) => sum + value, 0) / Math.max(1, returns.length)
  const deviation = standardDeviation(returns)
  let equity = 1; let peak = 1; let drawdown = 0
  for (const value of returns) { equity *= Math.max(0, 1 + value); peak = Math.max(peak, equity); drawdown = Math.max(drawdown, peak > 0 ? 1 - equity / peak : 0) }
  return { sample_count: returns.length, total_return: round(wealth - 1), annualized_return: round(wealth ** (periods / Math.max(1, returns.length)) - 1), annualized_volatility: round(deviation * Math.sqrt(periods)), sharpe: deviation > 0 ? round(mean / deviation * Math.sqrt(periods)) : 0, max_drawdown: round(drawdown) }
}

function strategyBenchmarkInputFromJson(value: JSONRecord): TrendBenchmarkInput {
  return {
    benchmarkId: stringField(value.benchmark_id ?? value.benchmarkId) || undefined,
    timeframe: stringField(value.timeframe) || undefined,
    feeBps: optionalNumber(value.fee_bps ?? value.feeBps), slippageBps: optionalNumber(value.slippage_bps ?? value.slippageBps), fundingBpsPer8h: optionalNumber(value.funding_bps_per_8h ?? value.fundingBpsPer8h), randomTrials: optionalNumber(value.random_trials ?? value.randomTrials),
    datasets: array(value.datasets).map((raw) => { const item = asRecord(raw); return { datasetId: stringField(item.dataset_id ?? item.datasetId), manifestPath: stringField(item.manifest_path ?? item.manifestPath) } }),
  }
}

function timeframeHours(value: string): number { const match = value.match(/^(\d+)([hd])$/); if (!match) throw new Error(`unsupported benchmark timeframe: ${value}`); return Number(match[1]) * (match[2] === "d" ? 24 : 1) }
function standardDeviation(values: number[]): number { if (values.length < 2) return 0; const mean = values.reduce((sum, value) => sum + value, 0) / values.length; return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) }
function quantile(values: number[], probability: number): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(probability * sorted.length))] ?? 0 }
function mulberry32(seed: number): () => number { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let value = Math.imul(seed ^ seed >>> 15, 1 | seed); value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value; return ((value ^ value >>> 14) >>> 0) / 4294967296 } }
function round(value: number): number { return Number.isFinite(value) ? Number(value.toFixed(6)) : value }
function asRecord(value: unknown): JSONRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {} }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function optionalNumber(value: unknown): number | undefined { const number = Number(value); return Number.isFinite(number) ? number : undefined }
function stringField(value: unknown): string { return typeof value === "string" ? value.trim() : "" }

export { runTrendBenchmark, strategyBenchmarkInputFromJson, type TrendBenchmarkInput }
