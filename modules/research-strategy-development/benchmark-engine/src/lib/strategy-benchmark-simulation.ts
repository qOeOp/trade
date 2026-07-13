import { historicalFundingDrag, type FundingEvent } from "./strategy-benchmark-data"
import type { TrendBenchmarkInput } from "./strategy-benchmark-inputs"

type JSONRecord = Record<string, unknown>

export interface PortfolioStats {
  sample_count: number
  total_return: number
  annualized_return: number
  annualized_volatility: number
  sharpe: number
  max_drawdown: number
}

export interface SimulationAttribution {
  gross_stats: PortfolioStats
  net_stats: PortfolioStats
  cost_model: CostModel
  total_turnover: number
  rebalance_count: number
  average_turnover_per_rebalance: number
  average_gross_exposure: number
  total_fee_drag: number
  total_slippage_drag: number
  total_cost_drag: number
  total_funding_drag: number
}

export interface CostModel {
  maker_fee_bps: number
  taker_fee_bps: number
  market_order_share: number
  slippage_bps: number
  effective_fee_bps: number
  effective_slippage_bps: number
  effective_cost_bps: number
}

export function buildRelativeStrengthSchedule(closes: number[][], warmup: number, lookbackBars: number, volatilityBars: number, rebalanceBars: number, timeframe: string): number[][] {
  const weights: number[][] = []
  const annualPeriods = 365 * 24 / timeframeHours(timeframe)
  for (let index = warmup; index < closes[0].length - 1; index += rebalanceBars) {
    const ranked = closes.map((series, asset) => ({ asset, momentum: series[index] / series[index - lookbackBars] - 1 })).sort((a, b) => a.momentum - b.momentum)
    const count = Math.max(1, Math.floor(closes.length / 3))
    const next = Array(closes.length).fill(0) as number[]
    assignSideWeights(next, ranked.slice(0, count).map((item) => item.asset), closes, index, volatilityBars, -0.5)
    assignSideWeights(next, ranked.slice(-count).map((item) => item.asset), closes, index, volatilityBars, 0.5)
    const portfolioReturns = Array.from({ length: volatilityBars }, (_, offset) => next.reduce((sum, weight, asset) => sum + weight * (closes[asset][index - offset] / closes[asset][index - offset - 1] - 1), 0))
    const scale = Math.min(1, 0.15 / Math.max(standardDeviation(portfolioReturns) * Math.sqrt(annualPeriods), 1e-8))
    weights.push(next.map((value) => value * scale))
  }
  return weights
}

export function buildWeightSchedule(closes: number[][], warmup: number, horizons: number[], volatilityBars: number, rebalanceBars: number, timeframe: string): number[][] {
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

export function buildCostModel(input: TrendBenchmarkInput): CostModel {
  const defaultFee = input.feeBps ?? 5
  const makerFee = input.makerFeeBps ?? defaultFee
  const takerFee = input.takerFeeBps ?? defaultFee
  const marketShare = input.marketOrderShare ?? 1
  const slippage = input.slippageBps ?? 2
  if (makerFee < 0 || takerFee < 0 || slippage < 0) throw new Error("benchmark costs must be non-negative")
  if (marketShare < 0 || marketShare > 1) throw new Error("benchmark marketOrderShare must be between 0 and 1")
  return normalizeCostModel({
    maker_fee_bps: makerFee,
    taker_fee_bps: takerFee,
    market_order_share: marketShare,
    slippage_bps: slippage,
    effective_fee_bps: 0,
    effective_slippage_bps: 0,
    effective_cost_bps: 0,
  })
}

export function stressCostModel(model: CostModel, extraBps: number): CostModel {
  return normalizeCostModel({ ...model, taker_fee_bps: model.taker_fee_bps + extraBps, slippage_bps: model.slippage_bps + extraBps })
}

export function simulate(panel: { timestamps: number[]; closes: number[][] }, schedule: number[][], warmup: number, rebalanceBars: number, costModel: CostModel, fundingBps: number, timeframe: string, fundingEventsByAsset: FundingEvent[][] = []): { stats: PortfolioStats; returns: number[]; attribution: SimulationAttribution } {
  const returns: number[] = []
  const grossReturns: number[] = []
  let weights = Array(panel.closes.length).fill(0) as number[]
  let scheduleIndex = 0
  let totalTurnover = 0
  let totalFeeDrag = 0
  let totalSlippageDrag = 0
  let totalCostDrag = 0
  let totalFundingDrag = 0
  let grossExposureSum = 0
  let rebalanceCount = 0
  const fundingOffsets = fundingEventsByAsset.map(() => 0)
  for (let index = warmup + 1; index < panel.timestamps.length; index += 1) {
    let turnover = 0
    if ((index - warmup - 1) % rebalanceBars === 0 && scheduleIndex < schedule.length) {
      const next = schedule[scheduleIndex]
      turnover = next.reduce((sum, value, asset) => sum + Math.abs(value - weights[asset]), 0)
      weights = next
      scheduleIndex += 1
      rebalanceCount += 1
    }
    const grossReturn = weights.reduce((sum, weight, asset) => sum + weight * (panel.closes[asset][index] / panel.closes[asset][index - 1] - 1), 0)
    const grossExposure = weights.reduce((sum, value) => sum + Math.abs(value), 0)
    const fee = turnover * costModel.effective_fee_bps / 10000
    const slippage = turnover * costModel.effective_slippage_bps / 10000
    const cost = fee + slippage
    const funding = fundingEventsByAsset.length > 0
      ? historicalFundingDrag(weights, fundingEventsByAsset, fundingOffsets, panel.timestamps[index - 1], panel.timestamps[index])
      : grossExposure * fundingBps / 10000 * timeframeHours(timeframe) / 8
    grossReturns.push(grossReturn)
    returns.push(grossReturn - cost - funding)
    totalTurnover += turnover
    totalFeeDrag += fee
    totalSlippageDrag += slippage
    totalCostDrag += cost
    totalFundingDrag += funding
    grossExposureSum += grossExposure
  }
  const stats = portfolioStats(returns, timeframe)
  return {
    stats,
    returns,
    attribution: {
      gross_stats: portfolioStats(grossReturns, timeframe),
      net_stats: stats,
      cost_model: costModel,
      total_turnover: round(totalTurnover),
      rebalance_count: rebalanceCount,
      average_turnover_per_rebalance: round(totalTurnover / Math.max(1, rebalanceCount)),
      average_gross_exposure: round(grossExposureSum / Math.max(1, returns.length)),
      total_fee_drag: round(totalFeeDrag),
      total_slippage_drag: round(totalSlippageDrag),
      total_cost_drag: round(totalCostDrag),
      total_funding_drag: round(totalFundingDrag),
    },
  }
}

export function negativeControlDiagnostics(panel: { timestamps: number[]; closes: number[][] }, weights: number[][], warmup: number, rebalanceBars: number, costModel: CostModel, timeframe: string, randomTrials: number, observedSharpe: number, seedOffset: number): JSONRecord {
  const timeShiftSharpes = Array.from({ length: randomTrials }, (_, trial) => simulate(panel, circularShift(weights, trial + seedOffset), warmup, rebalanceBars, costModel, 0, timeframe).stats.sharpe)
  const assetShuffleSharpes = Array.from({ length: randomTrials }, (_, trial) => simulate(panel, assetLabelShuffle(weights, panel.closes.length, trial + seedOffset + 101), warmup, rebalanceBars, costModel, 0, timeframe).stats.sharpe)
  const sideFlip = simulate(panel, weights.map((row) => row.map((value) => -value)), warmup, rebalanceBars, costModel, 0, timeframe).stats
  return {
    method: "portfolio_weight_time_shift_side_flip_asset_shuffle",
    trials: randomTrials,
    empirical_p_value: empiricalPValue(timeShiftSharpes, observedSharpe),
    median_sharpe: round(quantile(timeShiftSharpes, 0.5)),
    p95_sharpe: round(quantile(timeShiftSharpes, 0.95)),
    time_shift: controlSummary(timeShiftSharpes, observedSharpe),
    side_flip: { total_return: sideFlip.total_return, sharpe: sideFlip.sharpe, max_drawdown: sideFlip.max_drawdown },
    asset_label_shuffle: controlSummary(assetShuffleSharpes, observedSharpe),
  }
}

export function chronologicalFolds(returns: number[], count: number, timeframe: string): PortfolioStats[] {
  return Array.from({ length: count }, (_, index) => portfolioStats(returns.slice(Math.floor(index * returns.length / count), Math.floor((index + 1) * returns.length / count)), timeframe))
}

export function regimeAttribution(panel: { timestamps: number[]; closes: number[][] }, returns: number[], warmup: number, timeframe: string): JSONRecord {
  const marketReturns = Array.from({ length: returns.length }, (_, offset) => {
    const index = warmup + offset + 1
    return panel.closes.reduce((sum, series) => sum + (series[index] / series[index - 1] - 1), 0) / panel.closes.length
  })
  const lookback = Math.min(180, Math.max(20, Math.floor(returns.length / 4)), Math.max(1, warmup - 1))
  const trendScores = Array.from({ length: returns.length }, (_, offset) => {
    const index = warmup + offset + 1
    return panel.closes.reduce((sum, series) => sum + (series[index - 1] / series[index - 1 - lookback] - 1), 0) / panel.closes.length
  })
  const volSeries = marketReturns.map((_, offset) => offset < lookback ? Number.NaN : standardDeviation(marketReturns.slice(offset - lookback, offset)))
  const volMedian = quantile(volSeries.filter(Number.isFinite), 0.5)
  const buckets = [
    bucketStats("trend_up", returns, trendScores.map((value) => value > 0), timeframe),
    bucketStats("trend_down", returns, trendScores.map((value) => value <= 0), timeframe),
    bucketStats("volatility_high", returns, volSeries.map((value) => Number.isFinite(value) && value >= volMedian), timeframe),
    bucketStats("volatility_low", returns, volSeries.map((value) => Number.isFinite(value) && value < volMedian), timeframe),
  ]
  return {
    method: "causal_panel_trend_volatility_buckets_v1",
    lookback_bars: lookback,
    buckets,
    notes: ["Regime attribution is diagnostic only; it does not authorize parameter search or live trading."],
  }
}

export function portfolioStats(returns: number[], timeframe: string): PortfolioStats {
  const periods = 365 * 24 / timeframeHours(timeframe)
  const wealth = returns.reduce((value, item) => value * Math.max(0, 1 + item), 1)
  const mean = returns.reduce((sum, value) => sum + value, 0) / Math.max(1, returns.length)
  const deviation = standardDeviation(returns)
  let equity = 1; let peak = 1; let drawdown = 0
  for (const value of returns) { equity *= Math.max(0, 1 + value); peak = Math.max(peak, equity); drawdown = Math.max(drawdown, peak > 0 ? 1 - equity / peak : 0) }
  return { sample_count: returns.length, total_return: round(wealth - 1), annualized_return: round(wealth ** (periods / Math.max(1, returns.length)) - 1), annualized_volatility: round(deviation * Math.sqrt(periods)), sharpe: deviation > 0 ? round(mean / deviation * Math.sqrt(periods)) : 0, max_drawdown: round(drawdown) }
}

function assignSideWeights(weights: number[], assets: number[], closes: number[][], index: number, volatilityBars: number, gross: number): void {
  const invVol = assets.map((asset) => 1 / Math.max(standardDeviation(Array.from({ length: volatilityBars }, (_, offset) => closes[asset][index - offset] / closes[asset][index - offset - 1] - 1)), 1e-8))
  const total = invVol.reduce((sum, value) => sum + value, 0)
  assets.forEach((asset, offset) => { weights[asset] = total > 0 ? gross * invVol[offset] / total : 0 })
}

function normalizeCostModel(model: CostModel): CostModel {
  const effectiveFee = model.maker_fee_bps * (1 - model.market_order_share) + model.taker_fee_bps * model.market_order_share
  const effectiveSlippage = model.slippage_bps * model.market_order_share
  return {
    ...model,
    effective_fee_bps: round(effectiveFee),
    effective_slippage_bps: round(effectiveSlippage),
    effective_cost_bps: round(effectiveFee + effectiveSlippage),
  }
}

function circularShift<T>(values: T[], seed: number): T[] {
  const offset = 1 + Math.floor(mulberry32(seed)() * Math.max(1, values.length - 1))
  return values.map((_, index) => values[(index + offset) % values.length])
}

function assetLabelShuffle(weights: number[][], assetCount: number, seed: number): number[][] {
  const permutation = Array.from({ length: assetCount }, (_, index) => index)
  const random = mulberry32(seed)
  for (let index = permutation.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[permutation[index], permutation[swap]] = [permutation[swap], permutation[index]]
  }
  return weights.map((row) => row.map((_, asset) => row[permutation[asset]]))
}

function controlSummary(sharpes: number[], observedSharpe: number): JSONRecord {
  return {
    empirical_p_value: empiricalPValue(sharpes, observedSharpe),
    median_sharpe: round(quantile(sharpes, 0.5)),
    p95_sharpe: round(quantile(sharpes, 0.95)),
  }
}

function empiricalPValue(values: number[], observed: number): number {
  return round((1 + values.filter((value) => value >= observed).length) / (values.length + 1))
}

function bucketStats(bucket: string, returns: number[], mask: boolean[], timeframe: string): JSONRecord {
  const selected = returns.filter((_, index) => mask[index])
  return { bucket, ...portfolioStats(selected, timeframe) }
}

function timeframeHours(value: string): number { const match = value.match(/^(\d+)([hd])$/); if (!match) throw new Error(`unsupported benchmark timeframe: ${value}`); return Number(match[1]) * (match[2] === "d" ? 24 : 1) }
function standardDeviation(values: number[]): number { if (values.length < 2) return 0; const mean = values.reduce((sum, value) => sum + value, 0) / values.length; return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) }
function quantile(values: number[], probability: number): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(probability * sorted.length))] ?? 0 }
function mulberry32(seed: number): () => number { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let value = Math.imul(seed ^ seed >>> 15, 1 | seed); value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value; return ((value ^ value >>> 14) >>> 0) / 4294967296 } }
function round(value: number): number { return Number.isFinite(value) ? Number(value.toFixed(6)) : value }
