import type { JSONRecord } from "../../../../../../contracts/runtime-core/src/json"

export interface BenchmarkDataset {
  datasetId: string
  manifestPath: string
  indicatorReportPath?: string
  marketDataDb?: string
  fundingEventsRef?: string
  featureManifestRef?: string
  symbolStatus?: string
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
    benchmarkId: stringField(value.benchmark_id) || undefined,
    timeframe: stringField(value.timeframe) || undefined,
    feeBps: optionalNumber(value.fee_bps),
    makerFeeBps: optionalNumber(value.maker_fee_bps),
    takerFeeBps: optionalNumber(value.taker_fee_bps),
    marketOrderShare: optionalNumber(value.market_order_share),
    slippageBps: optionalNumber(value.slippage_bps),
    fundingBpsPer8h: optionalNumber(value.funding_bps_per_8h),
    randomTrials: optionalNumber(value.random_trials),
    datasets: array(value.datasets).map((raw) => {
      const item = asRecord(raw)
      return {
        datasetId: stringField(item.dataset_id),
        manifestPath: stringField(item.manifest_path),
        indicatorReportPath: stringField(item.indicator_report_path) || undefined,
        marketDataDb: stringField(item.market_data_db) || undefined,
        fundingEventsRef: stringField(item.funding_events_ref) || undefined,
        featureManifestRef: stringField(item.feature_manifest_ref) || undefined,
        symbolStatus: stringField(item.symbol_status) || undefined,
      }
    }),
  }
}

export function strategyCalibrationInputFromJson(value: JSONRecord): CalibrationSuiteInput {
  return {
    ...strategyBenchmarkInputFromJson(value),
    suiteId: stringField(value.calibration_suite_id) || undefined,
    previousCalibrationReportPath: stringField(value.previous_calibration_report_path) || undefined,
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
