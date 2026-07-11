import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { replayDataHash } from "../../../replay-engine/src/lib/replay-core"
import { buildCalibrationSuiteReport } from "./strategy-calibration-report"
import {
  strategyBenchmarkInputFromJson,
  strategyCalibrationInputFromJson,
  type BenchmarkDataset,
  type CalibrationSuiteInput,
  type TrendBenchmarkInput,
} from "./strategy-benchmark-inputs"
import {
  alignedPanel,
  datasetDataHash,
  panelFundingEvents,
} from "./strategy-benchmark-data"
import {
  buildCostModel,
  buildRelativeStrengthSchedule,
  buildWeightSchedule,
  chronologicalFolds,
  negativeControlDiagnostics,
  portfolioStats,
  regimeAttribution,
  simulate,
  stressCostModel,
} from "./strategy-benchmark-simulation"

type JSONRecord = Record<string, unknown>

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
  const costModel = buildCostModel(input)
  const fundingStressBps = input.fundingBpsPer8h ?? 1
  if (!Number.isInteger(volatilityBars) || volatilityBars < 2) throw new Error("trend benchmark volatilityBars must be an integer >= 2")
  if (!Number.isInteger(rebalanceBars) || rebalanceBars < 1) throw new Error("trend benchmark rebalanceBars must be a positive integer")
  if (!Number.isInteger(randomTrials) || randomTrials < 20 || randomTrials > 500) throw new Error("trend benchmark randomTrials must be 20-500")
  if (fundingStressBps < 0) throw new Error("trend benchmark costs must be non-negative")
  const panel = alignedPanel(input.datasets, timeframe)
  const warmup = Math.max(volatilityBars, ...horizons)
  if (panel.timestamps.length <= warmup + rebalanceBars) throw new Error("trend benchmark has insufficient aligned history")
  const fundingEvents = panelFundingEvents(input.datasets, panel.timestamps[warmup], panel.timestamps.at(-1)!)
  const weights = buildWeightSchedule(panel.closes, warmup, horizons, volatilityBars, rebalanceBars, timeframe)
  const observed = simulate(panel, weights, warmup, rebalanceBars, costModel, 0, timeframe)
  const stressed = simulate(panel, weights, warmup, rebalanceBars, stressCostModel(costModel, 5), 0, timeframe)
  const fundingStressed = simulate(panel, weights, warmup, rebalanceBars, costModel, fundingStressBps, timeframe)
  const historicalFunding = fundingEvents.coverage.status === "full" ? simulate(panel, weights, warmup, rebalanceBars, costModel, 0, timeframe, fundingEvents.eventsByAsset) : null
  const negativeControl = negativeControlDiagnostics(panel, weights, warmup, rebalanceBars, costModel, timeframe, randomTrials, observed.stats.sharpe, 1)
  const empiricalP = numberField(negativeControl.empirical_p_value)
  const folds = chronologicalFolds(observed.returns, 3, timeframe)
  const blockedBy: Array<{ check_id: string; reason: string }> = []
  if (observed.stats.total_return <= 0 || observed.stats.sharpe < 0.5) blockedBy.push({ check_id: "BENCHMARK-EDGE", reason: "trend benchmark is not positive with Sharpe >= 0.5" })
  if (folds.filter((fold) => fold.total_return > 0).length < 2) blockedBy.push({ check_id: "BENCHMARK-TIME", reason: "fewer than two of three chronological folds are positive" })
  if (stressed.stats.total_return <= 0) blockedBy.push({ check_id: "BENCHMARK-COST", reason: "trend benchmark fails extra 5 bps turnover stress" })
  if (empiricalP > 0.05) blockedBy.push({ check_id: "BENCHMARK-NEGATIVE-CONTROL", reason: `empirical p-value ${round(empiricalP)} exceeds 0.05` })
  return {
    benchmark_id: input.benchmarkId || "multi_asset_time_series_trend_v1",
    harness_hash: benchmarkHarnessHash(),
    purpose: "rd_pipeline_calibration_only",
    calibrated: blockedBy.length === 0,
    blocked_by: blockedBy,
    datasets: input.datasets.map((item, index) => ({ dataset_id: item.datasetId, manifest_ref: item.manifestPath, data_hash: datasetDataHash(item, timeframe), aligned_rows: panel.closes[index].length })),
    period: { first: new Date(panel.timestamps[warmup]).toISOString(), last: new Date(panel.timestamps.at(-1)!).toISOString() },
    assumptions: { timeframe, horizon_bars: horizons, volatility_bars: volatilityBars, rebalance_bars: rebalanceBars, inverse_volatility_weighting: true, target_annual_volatility: 0.15, max_gross_exposure: 1, execution_cost_model: costModel, adverse_funding_stress_bps_per_8h: fundingStressBps, parameter_search: false },
    observed: observed.stats,
    execution_attribution: observed.attribution,
    chronological_folds: folds,
    regime_attribution: regimeAttribution(panel, observed.returns, warmup, timeframe),
    cost_stress: stressed.stats,
    cost_stress_attribution: stressed.attribution,
    funding_stress: fundingStressed.stats,
    funding_stress_attribution: fundingStressed.attribution,
    funding_event_coverage: fundingEvents.coverage,
    historical_funding: historicalFunding?.stats ?? null,
    historical_funding_attribution: historicalFunding?.attribution ?? null,
    negative_control: negativeControl,
    notes: ["Calibration does not authorize strategy promotion or live trading.", "Current-symbol panels carry survivorship bias and are insufficient as final strategy evidence."],
  }
}

function runCalibrationSuite(input: CalibrationSuiteInput): JSONRecord {
  const trend = runTrendBenchmark({ ...input, benchmarkId: "multi_asset_time_series_trend_v1" })
  const relativeStrength = runRelativeStrengthBenchmark(input)
  const panel = alignedPanel(input.datasets, input.timeframe || "4h")
  const buyHold = buyAndHoldBaseline(panel, input.datasets[0], input.timeframe || "4h")
  return buildCalibrationSuiteReport({
    suiteId: input.suiteId,
    previousCalibrationReportPath: input.previousCalibrationReportPath,
    harnessHash: benchmarkHarnessHash(),
    buyHold,
    trend,
    relativeStrength,
    panel: panel.diagnostics,
  })
}

function runRelativeStrengthBenchmark(input: TrendBenchmarkInput): JSONRecord {
  if (input.datasets.length < 3) throw new Error("relative strength benchmark requires at least three datasets")
  const timeframe = input.timeframe || "4h"
  if (timeframe !== "4h") throw new Error("fixed relative strength benchmark only supports 4h")
  const lookbackBars = 540
  const volatilityBars = 180
  const rebalanceBars = 6
  const randomTrials = input.randomTrials ?? 100
  const costModel = buildCostModel(input)
  const fundingStressBps = input.fundingBpsPer8h ?? 1
  if (!Number.isInteger(randomTrials) || randomTrials < 20 || randomTrials > 500) throw new Error("relative strength randomTrials must be 20-500")
  if (fundingStressBps < 0) throw new Error("relative strength costs must be non-negative")
  const panel = alignedPanel(input.datasets, timeframe)
  const warmup = Math.max(lookbackBars, volatilityBars)
  if (panel.timestamps.length <= warmup + rebalanceBars) throw new Error("relative strength benchmark has insufficient aligned history")
  const fundingEvents = panelFundingEvents(input.datasets, panel.timestamps[warmup], panel.timestamps.at(-1)!)
  const weights = buildRelativeStrengthSchedule(panel.closes, warmup, lookbackBars, volatilityBars, rebalanceBars, timeframe)
  const observed = simulate(panel, weights, warmup, rebalanceBars, costModel, 0, timeframe)
  const stressed = simulate(panel, weights, warmup, rebalanceBars, stressCostModel(costModel, 5), 0, timeframe)
  const fundingStressed = simulate(panel, weights, warmup, rebalanceBars, costModel, fundingStressBps, timeframe)
  const historicalFunding = fundingEvents.coverage.status === "full" ? simulate(panel, weights, warmup, rebalanceBars, costModel, 0, timeframe, fundingEvents.eventsByAsset) : null
  const negativeControl = negativeControlDiagnostics(panel, weights, warmup, rebalanceBars, costModel, timeframe, randomTrials, observed.stats.sharpe, 17)
  const empiricalP = numberField(negativeControl.empirical_p_value)
  const folds = chronologicalFolds(observed.returns, 3, timeframe)
  const blockedBy: Array<{ check_id: string; reason: string }> = []
  if (observed.stats.total_return <= 0 || observed.stats.sharpe < 0.5) blockedBy.push({ check_id: "XSEC-EDGE", reason: "relative strength benchmark is not positive with Sharpe >= 0.5" })
  if (folds.filter((fold) => fold.total_return > 0).length < 2) blockedBy.push({ check_id: "XSEC-TIME", reason: "fewer than two of three chronological folds are positive" })
  if (stressed.stats.total_return <= 0) blockedBy.push({ check_id: "XSEC-COST", reason: "relative strength benchmark fails extra 5 bps turnover stress" })
  if (empiricalP > 0.05) blockedBy.push({ check_id: "XSEC-NEGATIVE-CONTROL", reason: `empirical p-value ${round(empiricalP)} exceeds 0.05` })
  return {
    benchmark_id: "cross_sectional_relative_strength_v1",
    harness_hash: benchmarkHarnessHash(),
    purpose: "rd_pipeline_calibration_only",
    calibrated: blockedBy.length === 0,
    blocked_by: blockedBy,
    datasets: input.datasets.map((item, index) => ({ dataset_id: item.datasetId, manifest_ref: item.manifestPath, data_hash: datasetDataHash(item, timeframe), aligned_rows: panel.closes[index].length })),
    period: { first: new Date(panel.timestamps[warmup]).toISOString(), last: new Date(panel.timestamps.at(-1)!).toISOString() },
    assumptions: { timeframe, lookback_bars: lookbackBars, volatility_bars: volatilityBars, rebalance_bars: rebalanceBars, long_top_fraction: 1 / 3, short_bottom_fraction: 1 / 3, target_annual_volatility: 0.15, max_gross_exposure: 1, execution_cost_model: costModel, adverse_funding_stress_bps_per_8h: fundingStressBps, parameter_search: false },
    observed: observed.stats,
    execution_attribution: observed.attribution,
    chronological_folds: folds,
    regime_attribution: regimeAttribution(panel, observed.returns, warmup, timeframe),
    cost_stress: stressed.stats,
    cost_stress_attribution: stressed.attribution,
    funding_stress: fundingStressed.stats,
    funding_stress_attribution: fundingStressed.attribution,
    funding_event_coverage: fundingEvents.coverage,
    historical_funding: historicalFunding?.stats ?? null,
    historical_funding_attribution: historicalFunding?.attribution ?? null,
    negative_control: negativeControl,
  }
}

function buyAndHoldBaseline(panel: { timestamps: number[]; closes: number[][] }, dataset: BenchmarkDataset, timeframe: string): JSONRecord {
  const warmup = Math.min(1080, Math.max(0, panel.timestamps.length - 2))
  const returns = Array.from({ length: panel.timestamps.length - warmup - 1 }, (_, offset) => panel.closes[0][warmup + offset + 1] / panel.closes[0][warmup + offset] - 1)
  return {
    benchmark_id: "first_dataset_buy_and_hold_v1",
    purpose: "beta_baseline_only",
    dataset_id: dataset.datasetId,
    manifest_ref: dataset.manifestPath,
    data_hash: replayDataHash(dataset.manifestPath, timeframe),
    period: { first: new Date(panel.timestamps[warmup]).toISOString(), last: new Date(panel.timestamps.at(-1)!).toISOString() },
    assumptions: { timeframe, transaction_costs: false, parameter_search: false },
    observed: portfolioStats(returns, timeframe),
  }
}

const BENCHMARK_HARNESS_FILES = [
  "strategy-benchmark.ts",
  "strategy-benchmark-inputs.ts",
  "strategy-benchmark-data.ts",
  "strategy-benchmark-simulation.ts",
  "strategy-calibration-report.ts",
]

function benchmarkHarnessHash(): string {
  const root = dirname(fileURLToPath(import.meta.url))
  const hash = createHash("sha256")
  for (const file of [...BENCHMARK_HARNESS_FILES].sort()) {
    hash.update(file)
    hash.update("\n")
    hash.update(readFileSync(join(root, file)))
    hash.update("\n")
  }
  return hash.digest("hex")
}
function round(value: number): number { return Number.isFinite(value) ? Number(value.toFixed(6)) : value }
function numberField(value: unknown): number { const number = Number(value); return Number.isFinite(number) ? number : 0 }

export { runTrendBenchmark, runCalibrationSuite, strategyBenchmarkInputFromJson, strategyCalibrationInputFromJson, type TrendBenchmarkInput }
