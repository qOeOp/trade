import type { JSONRecord } from "./json"

export interface BenchmarkDataset {
  datasetId: string
  manifestPath: string
  indicatorReportPath?: string
}

export interface TrendBenchmarkInput {
  benchmarkId?: string
  datasets: BenchmarkDataset[]
  timeframe?: string
  horizonBars?: number[]
  volatilityBars?: number
  rebalanceBars?: number
  feeBps?: number
  makerFeeBps?: number
  takerFeeBps?: number
  slippageBps?: number
  marketOrderShare?: number
  fundingBpsPer8h?: number
  randomTrials?: number
}

export interface CalibrationSuiteInput extends TrendBenchmarkInput {
  suiteId?: string
  previousCalibrationReportPath?: string
}

export function strategyBenchmarkInputFromJson(value: JSONRecord): TrendBenchmarkInput {
  return {
    benchmarkId: stringField(value.benchmark_id ?? value.benchmarkId) || undefined,
    timeframe: stringField(value.timeframe) || undefined,
    feeBps: optionalNumber(value.fee_bps ?? value.feeBps),
    makerFeeBps: optionalNumber(value.maker_fee_bps ?? value.makerFeeBps),
    takerFeeBps: optionalNumber(value.taker_fee_bps ?? value.takerFeeBps),
    marketOrderShare: optionalNumber(value.market_order_share ?? value.marketOrderShare),
    slippageBps: optionalNumber(value.slippage_bps ?? value.slippageBps),
    fundingBpsPer8h: optionalNumber(value.funding_bps_per_8h ?? value.fundingBpsPer8h),
    randomTrials: optionalNumber(value.random_trials ?? value.randomTrials),
    datasets: array(value.datasets).map((raw) => {
      const item = asRecord(raw)
      return {
        datasetId: stringField(item.dataset_id ?? item.datasetId),
        manifestPath: stringField(item.manifest_path ?? item.manifestPath),
        indicatorReportPath: stringField(item.indicator_report_path ?? item.indicatorReportPath ?? item.funding_report_path ?? item.fundingReportPath) || undefined,
      }
    }),
  }
}

export function strategyCalibrationInputFromJson(value: JSONRecord): CalibrationSuiteInput {
  return {
    ...strategyBenchmarkInputFromJson(value),
    suiteId: stringField(value.calibration_suite_id ?? value.suiteId) || undefined,
    previousCalibrationReportPath: stringField(value.previous_calibration_report_path ?? value.previousCalibrationReportPath) || undefined,
  }
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function optionalNumber(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}
