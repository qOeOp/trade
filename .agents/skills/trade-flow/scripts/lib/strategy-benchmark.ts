import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { loadCandlesFromManifest, replayDataHash, type Candle } from "./replay-core"

type JSONRecord = Record<string, unknown>

interface BenchmarkDataset { datasetId: string; manifestPath: string; indicatorReportPath?: string }
interface FundingEvent { timestamp: string; value: number }
interface FundingCoverage {
  status: "not_provided" | "partial" | "full"
  missing_dataset_ids: string[]
  event_counts: Record<string, number>
  max_gap_hours: number | null
  first_event: string | null
  last_event: string | null
}
interface AlignedPanel {
  timestamps: number[]
  closes: number[][]
  diagnostics: PanelDiagnostics
}
interface PanelDiagnostics {
  dataset_count: number
  target_dataset_count: number
  timeframe: string
  aligned_rows: number
  aligned_start: string | null
  aligned_end: string | null
  min_raw_rows: number
  min_aligned_ratio: number
  schema_version_ok: boolean
  closed_candles_only: boolean
  source_providers: string[]
  datasets: Array<{
    dataset_id: string
    manifest_ref: string
    indicator_report_ref?: string
    raw_rows: number
    aligned_rows: number
    aligned_ratio: number
    first_open: string | null
    last_open: string | null
    schema_version: number
    closed_candles_only: boolean
    source_provider: string
    source_market: string
    content_sha256_present: boolean
  }>
}
interface TrendBenchmarkInput {
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

interface CalibrationSuiteInput extends TrendBenchmarkInput {
  suiteId?: string
}

interface PortfolioStats {
  sample_count: number
  total_return: number
  annualized_return: number
  annualized_volatility: number
  sharpe: number
  max_drawdown: number
}

interface SimulationAttribution {
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

interface CostModel {
  maker_fee_bps: number
  taker_fee_bps: number
  market_order_share: number
  slippage_bps: number
  effective_fee_bps: number
  effective_slippage_bps: number
  effective_cost_bps: number
}

interface DiagnosticFinding {
  check_id: string
  severity: "info" | "warning" | "blocker"
  component: string
  evidence: JSONRecord
  next_system_action: string
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
  const nullControl = nullControlDiagnostics(panel, weights, warmup, rebalanceBars, costModel, timeframe, randomTrials, observed.stats.sharpe, 1)
  const empiricalP = numberField(nullControl.empirical_p_value)
  const folds = chronologicalFolds(observed.returns, 3, timeframe)
  const blockedBy: Array<{ check_id: string; reason: string }> = []
  if (observed.stats.total_return <= 0 || observed.stats.sharpe < 0.5) blockedBy.push({ check_id: "BENCHMARK-EDGE", reason: "trend benchmark is not positive with Sharpe >= 0.5" })
  if (folds.filter((fold) => fold.total_return > 0).length < 2) blockedBy.push({ check_id: "BENCHMARK-TIME", reason: "fewer than two of three chronological folds are positive" })
  if (stressed.stats.total_return <= 0) blockedBy.push({ check_id: "BENCHMARK-COST", reason: "trend benchmark fails extra 5 bps turnover stress" })
  if (empiricalP > 0.05) blockedBy.push({ check_id: "BENCHMARK-NULL", reason: `empirical p-value ${round(empiricalP)} exceeds 0.05` })
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
    null_control: nullControl,
    notes: ["Calibration does not authorize strategy promotion or live trading.", "Current-symbol panels carry survivorship bias and are insufficient as final strategy evidence."],
  }
}

function runCalibrationSuite(input: CalibrationSuiteInput): JSONRecord {
  const trend = runTrendBenchmark({ ...input, benchmarkId: "multi_asset_time_series_trend_v1" })
  const relativeStrength = runRelativeStrengthBenchmark(input)
  const panel = alignedPanel(input.datasets, input.timeframe || "4h")
  const buyHold = buyAndHoldBaseline(panel, input.datasets[0], input.timeframe || "4h")
  const findings = calibrationFindings(buyHold, trend, relativeStrength, panel.diagnostics)
  const blockedBy: Array<{ check_id: string; reason: string }> = []
  if (!booleanField(trend.calibrated)) blockedBy.push({ check_id: "CAL-TREND", reason: "fixed time-series trend benchmark is not calibrated" })
  if (!booleanField(relativeStrength.calibrated)) blockedBy.push({ check_id: "CAL-RELATIVE-STRENGTH", reason: "fixed cross-sectional relative strength benchmark is not calibrated" })
  return {
    calibration_suite_id: input.suiteId || "known_edge_calibration_v1",
    harness_hash: benchmarkHarnessHash(),
    purpose: "rd_pipeline_calibration_only",
    calibrated: blockedBy.length === 0,
    blocked_by: blockedBy,
    data_panel: panel.diagnostics,
    components: {
      buy_and_hold_baseline: buyHold,
      time_series_trend: trend,
      cross_sectional_relative_strength: relativeStrength,
      cash_baseline: { total_return: 0, annualized_return: 0, annualized_volatility: 0, sharpe: 0, max_drawdown: 0 },
    },
    diagnostics: [
      "Buy-and-hold is diagnostic only; it separates beta from claimed alpha.",
      "Failed calibration means R&D should diagnose data, costs, portfolio construction, or replay before searching more candidates.",
    ],
    failure_analysis: {
      findings,
      next_system_actions: [...new Set(findings.map((finding) => finding.next_system_action))],
    },
    notes: ["Calibration suite never authorizes shadow, live-small, or live trading."],
  }
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
  const nullControl = nullControlDiagnostics(panel, weights, warmup, rebalanceBars, costModel, timeframe, randomTrials, observed.stats.sharpe, 17)
  const empiricalP = numberField(nullControl.empirical_p_value)
  const folds = chronologicalFolds(observed.returns, 3, timeframe)
  const blockedBy: Array<{ check_id: string; reason: string }> = []
  if (observed.stats.total_return <= 0 || observed.stats.sharpe < 0.5) blockedBy.push({ check_id: "XSEC-EDGE", reason: "relative strength benchmark is not positive with Sharpe >= 0.5" })
  if (folds.filter((fold) => fold.total_return > 0).length < 2) blockedBy.push({ check_id: "XSEC-TIME", reason: "fewer than two of three chronological folds are positive" })
  if (stressed.stats.total_return <= 0) blockedBy.push({ check_id: "XSEC-COST", reason: "relative strength benchmark fails extra 5 bps turnover stress" })
  if (empiricalP > 0.05) blockedBy.push({ check_id: "XSEC-NULL", reason: `empirical p-value ${round(empiricalP)} exceeds 0.05` })
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
    null_control: nullControl,
  }
}

function alignedPanel(datasets: BenchmarkDataset[], timeframe: string): AlignedPanel {
  const loaded = datasets.map((dataset) => {
    const manifest = JSON.parse(readFileSync(dataset.manifestPath, "utf8")) as JSONRecord
    return { dataset, manifest, candles: loadCandlesFromManifest(dataset.manifestPath, manifest, timeframe) }
  })
  const common = loaded.slice(1).reduce((set, item) => {
    const candles = item.candles
    const available = new Set(candles.map((candle) => candle.timestamp))
    return new Set([...set].filter((timestamp) => available.has(timestamp)))
  }, new Set(loaded[0].candles.map((candle) => candle.timestamp)))
  const timestamps = [...common].sort((a, b) => a - b)
  if (timestamps.length === 0) throw new Error("trend benchmark datasets have no aligned timestamps")
  return {
    timestamps,
    closes: loaded.map((item) => alignCloses(item.candles, timestamps)),
    diagnostics: panelDiagnostics(loaded, timestamps, timeframe),
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

function calibrationFindings(buyHold: JSONRecord, trend: JSONRecord, relativeStrength: JSONRecord, panel: PanelDiagnostics): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = []
  const buyHoldStats = asStats(buyHold.observed)
  if (buyHoldStats.total_return > 0 && (!booleanField(trend.calibrated) || !booleanField(relativeStrength.calibrated))) {
    findings.push({
      check_id: "CAL-BETA-NOT-ENOUGH",
      severity: "warning",
      component: "buy_and_hold_baseline",
      evidence: { total_return: buyHoldStats.total_return, sharpe: buyHoldStats.sharpe, max_drawdown: buyHoldStats.max_drawdown },
      next_system_action: "Separate beta exposure from claimed alpha before running more R&D search.",
    })
  }
  findings.push(...componentFindings("time_series_trend", trend))
  findings.push(...componentFindings("cross_sectional_relative_strength", relativeStrength))
  if (panel.dataset_count < panel.target_dataset_count) {
    findings.push({
      check_id: "CAL-PANEL-BREADTH",
      severity: "warning",
      component: "data_panel",
      evidence: { dataset_count: panel.dataset_count, minimum_target: panel.target_dataset_count },
      next_system_action: "Expand calibration data breadth before treating failed known-edge tests as final market evidence.",
    })
  }
  findings.push(...panelFindings(panel as unknown as JSONRecord))
  findings.push({
    check_id: "CAL-SURVIVORSHIP-RISK",
    severity: "info",
    component: "data_panel",
    evidence: { panel_type: "current_symbol_manifest_panel" },
    next_system_action: "Add delisted and historically tradable symbols when a reliable source is available.",
  })
  return findings
}

function panelDiagnostics(loaded: Array<{ dataset: BenchmarkDataset; manifest: JSONRecord; candles: Candle[] }>, timestamps: number[], timeframe: string): PanelDiagnostics {
  const datasetDiagnostics = loaded.map((item) => {
    const timeframeEntry = asRecord(asRecord(item.manifest.timeframes)[timeframe])
    const source = asRecord(item.manifest.source)
    return {
      dataset_id: item.dataset.datasetId,
      manifest_ref: item.dataset.manifestPath,
      ...(item.dataset.indicatorReportPath ? { indicator_report_ref: item.dataset.indicatorReportPath } : {}),
      raw_rows: item.candles.length,
      aligned_rows: timestamps.length,
      aligned_ratio: round(timestamps.length / Math.max(1, item.candles.length)),
      first_open: item.candles[0] ? new Date(item.candles[0].timestamp).toISOString() : null,
      last_open: item.candles.at(-1) ? new Date(item.candles.at(-1)!.timestamp).toISOString() : null,
      schema_version: numberField(item.manifest.schema_version),
      closed_candles_only: item.manifest.closed_candles_only === true,
      source_provider: stringField(source.provider),
      source_market: stringField(source.market),
      content_sha256_present: Boolean(stringField(timeframeEntry.content_sha256)),
    }
  })
  return {
    dataset_count: loaded.length,
    target_dataset_count: 20,
    timeframe,
    aligned_rows: timestamps.length,
    aligned_start: timestamps[0] ? new Date(timestamps[0]).toISOString() : null,
    aligned_end: timestamps.at(-1) ? new Date(timestamps.at(-1)!).toISOString() : null,
    min_raw_rows: Math.min(...datasetDiagnostics.map((item) => item.raw_rows)),
    min_aligned_ratio: round(Math.min(...datasetDiagnostics.map((item) => item.aligned_ratio))),
    schema_version_ok: datasetDiagnostics.every((item) => item.schema_version >= 2 && item.content_sha256_present),
    closed_candles_only: datasetDiagnostics.every((item) => item.closed_candles_only),
    source_providers: [...new Set(datasetDiagnostics.map((item) => item.source_provider).filter(Boolean))].sort(),
    datasets: datasetDiagnostics,
  }
}

function panelFindings(panel: JSONRecord): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = []
  if (panel.schema_version_ok !== true || panel.closed_candles_only !== true) {
    findings.push({
      check_id: "CAL-PANEL-SCHEMA",
      severity: "blocker",
      component: "data_panel",
      evidence: { schema_version_ok: panel.schema_version_ok, closed_candles_only: panel.closed_candles_only },
      next_system_action: "Regenerate calibration manifests with schema_version>=2, checksums, and closed candles only.",
    })
  }
  if (numberField(panel.min_aligned_ratio) < 0.95) {
    findings.push({
      check_id: "CAL-PANEL-ALIGNMENT",
      severity: "warning",
      component: "data_panel",
      evidence: { min_aligned_ratio: panel.min_aligned_ratio, aligned_rows: panel.aligned_rows, min_raw_rows: panel.min_raw_rows },
      next_system_action: "Diagnose listing windows, missing candles, and symbol overlap before treating panel results as market evidence.",
    })
  }
  return findings
}

function componentFindings(component: string, report: JSONRecord): DiagnosticFinding[] {
  const stats = asStats(report.observed)
  const cost = asStats(report.cost_stress)
  const funding = asStats(report.funding_stress)
  const historicalFunding = asStats(report.historical_funding)
  const nullControl = asRecord(report.null_control)
  const fundingCoverage = asRecord(report.funding_event_coverage)
  const folds = array(report.chronological_folds).map(asStats)
  const regimeBuckets = array(asRecord(report.regime_attribution).buckets).map(asRecord)
  const findings: DiagnosticFinding[] = []
  if (stringField(fundingCoverage.status) !== "full") {
    findings.push({
      check_id: "CAL-FUNDING-COVERAGE",
      severity: "warning",
      component,
      evidence: fundingCoverage,
      next_system_action: "Backfill exact funding events before interpreting perpetual funding fragility.",
    })
  }
  if (stats.sharpe < 0.5 || stats.total_return <= 0) {
    findings.push({
      check_id: "CAL-EDGE-WEAK",
      severity: "blocker",
      component,
      evidence: { total_return: stats.total_return, sharpe: stats.sharpe },
      next_system_action: "Diagnose benchmark construction and data before increasing candidate search.",
    })
  }
  const empiricalP = numberField(nullControl.empirical_p_value)
  if (empiricalP > 0.05) {
    findings.push({
      check_id: "CAL-NULL-NOT-BEATEN",
      severity: "blocker",
      component,
      evidence: { empirical_p_value: empiricalP, observed_sharpe: stats.sharpe, p95_sharpe: numberField(nullControl.p95_sharpe) },
      next_system_action: "Keep negative controls in the loop; do not accept mild positive returns as edge.",
    })
  }
  const sideFlip = asStats(nullControl.side_flip)
  if (sideFlip.sharpe >= stats.sharpe || sideFlip.total_return > 0) {
    findings.push({
      check_id: "CAL-SIDE-FLIP-NOT-BEATEN",
      severity: "warning",
      component,
      evidence: { observed_sharpe: stats.sharpe, side_flip_sharpe: sideFlip.sharpe, side_flip_total_return: sideFlip.total_return },
      next_system_action: "Check whether the rule direction is economically meaningful before treating it as edge.",
    })
  }
  const assetShuffle = asRecord(nullControl.asset_label_shuffle)
  const assetShuffleP = numberField(assetShuffle.empirical_p_value)
  if (assetShuffleP > 0.05) {
    findings.push({
      check_id: "CAL-ASSET-SHUFFLE-NOT-BEATEN",
      severity: "warning",
      component,
      evidence: { empirical_p_value: assetShuffleP, observed_sharpe: stats.sharpe, p95_sharpe: numberField(assetShuffle.p95_sharpe) },
      next_system_action: "Verify the edge is not just broad market co-movement or asset-label coincidence.",
    })
  }
  if (cost.total_return <= 0 || cost.total_return < stats.total_return * 0.5) {
    const costAttribution = asRecord(report.cost_stress_attribution)
    findings.push({
      check_id: "CAL-COST-FRAGILE",
      severity: cost.total_return <= 0 ? "blocker" : "warning",
      component,
      evidence: {
        observed_total_return: stats.total_return,
        cost_stress_total_return: cost.total_return,
        total_turnover: numberField(costAttribution.total_turnover),
        total_fee_drag: numberField(costAttribution.total_fee_drag),
        total_slippage_drag: numberField(costAttribution.total_slippage_drag),
        total_cost_drag: numberField(costAttribution.total_cost_drag),
      },
      next_system_action: "Improve turnover, fee, and slippage diagnostics before strategy iteration.",
    })
  }
  if (funding.total_return <= 0) {
    findings.push({
      check_id: "CAL-FUNDING-FRAGILE",
      severity: "warning",
      component,
      evidence: { observed_total_return: stats.total_return, funding_stress_total_return: funding.total_return, total_funding_drag: numberField(asRecord(report.funding_stress_attribution).total_funding_drag) },
      next_system_action: "Integrate exact funding coverage into calibration before using perpetual-only results.",
    })
  }
  if (stringField(fundingCoverage.status) === "full" && historicalFunding.total_return <= 0) {
    findings.push({
      check_id: "CAL-HISTORICAL-FUNDING-FRAGILE",
      severity: "warning",
      component,
      evidence: { historical_funding_total_return: historicalFunding.total_return, total_funding_drag: numberField(asRecord(report.historical_funding_attribution).total_funding_drag) },
      next_system_action: "Decide whether funding is a tradable filter, hedge input, or strategy veto before R&D search.",
    })
  }
  const negativeFolds = folds.filter((fold) => fold.total_return <= 0)
  if (negativeFolds.length > 0) {
    findings.push({
      check_id: "CAL-TIME-INSTABILITY",
      severity: "warning",
      component,
      evidence: { negative_fold_count: negativeFolds.length, fold_total_returns: folds.map((fold) => fold.total_return) },
      next_system_action: "Add regime and subperiod diagnostics before optimizing parameters.",
    })
  }
  const negativeRegimes = regimeBuckets
    .map((bucket) => ({ bucket: stringField(bucket.bucket), total_return: numberField(bucket.total_return), sample_count: numberField(bucket.sample_count) }))
    .filter((bucket) => bucket.sample_count > 0 && bucket.total_return <= 0)
  if (negativeRegimes.length > 0) {
    findings.push({
      check_id: "CAL-REGIME-FRAGILITY",
      severity: "warning",
      component,
      evidence: { negative_regimes: negativeRegimes },
      next_system_action: "Diagnose whether the mechanism only works in one market state before expanding R&D search.",
    })
  }
  return findings
}

function alignCloses(candles: Candle[], timestamps: number[]): number[] {
  const values = new Map(candles.map((candle) => [candle.timestamp, candle.close]))
  return timestamps.map((timestamp) => values.get(timestamp) || Number.NaN)
}

function buildRelativeStrengthSchedule(closes: number[][], warmup: number, lookbackBars: number, volatilityBars: number, rebalanceBars: number, timeframe: string): number[][] {
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

function assignSideWeights(weights: number[], assets: number[], closes: number[][], index: number, volatilityBars: number, gross: number): void {
  const invVol = assets.map((asset) => 1 / Math.max(standardDeviation(Array.from({ length: volatilityBars }, (_, offset) => closes[asset][index - offset] / closes[asset][index - offset - 1] - 1)), 1e-8))
  const total = invVol.reduce((sum, value) => sum + value, 0)
  assets.forEach((asset, offset) => { weights[asset] = total > 0 ? gross * invVol[offset] / total : 0 })
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

function buildCostModel(input: TrendBenchmarkInput): CostModel {
  const legacyFee = input.feeBps ?? 5
  const makerFee = input.makerFeeBps ?? legacyFee
  const takerFee = input.takerFeeBps ?? legacyFee
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

function stressCostModel(model: CostModel, extraBps: number): CostModel {
  return normalizeCostModel({ ...model, taker_fee_bps: model.taker_fee_bps + extraBps, slippage_bps: model.slippage_bps + extraBps })
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

function simulate(panel: { timestamps: number[]; closes: number[][] }, schedule: number[][], warmup: number, rebalanceBars: number, costModel: CostModel, fundingBps: number, timeframe: string, fundingEventsByAsset: FundingEvent[][] = []): { stats: PortfolioStats; returns: number[]; attribution: SimulationAttribution } {
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

function circularShift<T>(values: T[], seed: number): T[] {
  const offset = 1 + Math.floor(mulberry32(seed)() * Math.max(1, values.length - 1))
  return values.map((_, index) => values[(index + offset) % values.length])
}

function nullControlDiagnostics(panel: { timestamps: number[]; closes: number[][] }, weights: number[][], warmup: number, rebalanceBars: number, costModel: CostModel, timeframe: string, randomTrials: number, observedSharpe: number, seedOffset: number): JSONRecord {
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

function chronologicalFolds(returns: number[], count: number, timeframe: string): PortfolioStats[] {
  return Array.from({ length: count }, (_, index) => portfolioStats(returns.slice(Math.floor(index * returns.length / count), Math.floor((index + 1) * returns.length / count)), timeframe))
}

function regimeAttribution(panel: { timestamps: number[]; closes: number[][] }, returns: number[], warmup: number, timeframe: string): JSONRecord {
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

function bucketStats(bucket: string, returns: number[], mask: boolean[], timeframe: string): JSONRecord {
  const selected = returns.filter((_, index) => mask[index])
  return { bucket, ...portfolioStats(selected, timeframe) }
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

function strategyCalibrationInputFromJson(value: JSONRecord): CalibrationSuiteInput {
  return {
    ...strategyBenchmarkInputFromJson(value),
    suiteId: stringField(value.calibration_suite_id ?? value.suiteId) || undefined,
  }
}

function benchmarkHarnessHash(): string { return createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex") }
function datasetDataHash(dataset: BenchmarkDataset, timeframe: string): string { return replayDataHash(dataset.manifestPath, timeframe, dataset.indicatorReportPath ? [dataset.indicatorReportPath] : []) }
function panelFundingEvents(datasets: BenchmarkDataset[], firstTimestamp: number, lastTimestamp: number): { coverage: FundingCoverage; eventsByAsset: FundingEvent[][] } {
  const eventsByAsset = datasets.map((dataset) => loadFundingEvents(dataset.indicatorReportPath))
  const missing = datasets.filter((dataset, index) => !dataset.indicatorReportPath || eventsByAsset[index].length === 0).map((dataset) => dataset.datasetId)
  if (missing.length === datasets.length) return { eventsByAsset, coverage: fundingCoverage("not_provided", datasets, eventsByAsset, missing) }
  const allEvents = eventsByAsset.flat().map((event) => Date.parse(event.timestamp)).filter(Number.isFinite).sort((a, b) => a - b)
  const maxGapHours = maxFundingGapHours(eventsByAsset)
  const firstEvent = allEvents[0]
  const lastEvent = allEvents.at(-1)
  const incomplete = missing.length > 0 || !firstEvent || !lastEvent || firstEvent > firstTimestamp + 9 * 3_600_000 || lastEvent < lastTimestamp - 9 * 3_600_000 || maxGapHours > 9
  return { eventsByAsset, coverage: fundingCoverage(incomplete ? "partial" : "full", datasets, eventsByAsset, missing, maxGapHours, firstEvent, lastEvent) }
}
function fundingCoverage(status: FundingCoverage["status"], datasets: BenchmarkDataset[], eventsByAsset: FundingEvent[][], missing: string[], maxGapHours: number | null = null, firstEvent?: number, lastEvent?: number): FundingCoverage {
  return {
    status,
    missing_dataset_ids: missing,
    event_counts: Object.fromEntries(datasets.map((dataset, index) => [dataset.datasetId, eventsByAsset[index].length])),
    max_gap_hours: maxGapHours === null ? null : round(maxGapHours),
    first_event: firstEvent ? new Date(firstEvent).toISOString() : null,
    last_event: lastEvent ? new Date(lastEvent).toISOString() : null,
  }
}
function loadFundingEvents(path?: string): FundingEvent[] {
  if (!path) return []
  const report = asRecord(JSON.parse(readFileSync(path, "utf8")))
  const raw = asRecord(asRecord(report.data).market_events).funding
  return (Array.isArray(raw) ? raw : []).map((item) => {
    const record = asRecord(item)
    return { timestamp: stringField(record.timestamp), value: Number(record.value) }
  }).filter((item) => item.timestamp && Number.isFinite(item.value)).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
}
function maxFundingGapHours(eventsByAsset: FundingEvent[][]): number {
  return eventsByAsset.reduce((maxGap, events) => {
    for (let index = 1; index < events.length; index += 1) {
      maxGap = Math.max(maxGap, (Date.parse(events[index].timestamp) - Date.parse(events[index - 1].timestamp)) / 3_600_000)
    }
    return maxGap
  }, 0)
}
function historicalFundingDrag(weights: number[], eventsByAsset: FundingEvent[][], offsets: number[], previousTimestamp: number, timestamp: number): number {
  return weights.reduce((sum, weight, asset) => {
    const events = eventsByAsset[asset]
    while (offsets[asset] < events.length && Date.parse(events[offsets[asset]].timestamp) <= previousTimestamp) offsets[asset] += 1
    let funding = 0
    while (offsets[asset] < events.length && Date.parse(events[offsets[asset]].timestamp) <= timestamp) {
      funding += events[offsets[asset]].value
      offsets[asset] += 1
    }
    return sum + weight * funding
  }, 0)
}
function timeframeHours(value: string): number { const match = value.match(/^(\d+)([hd])$/); if (!match) throw new Error(`unsupported benchmark timeframe: ${value}`); return Number(match[1]) * (match[2] === "d" ? 24 : 1) }
function standardDeviation(values: number[]): number { if (values.length < 2) return 0; const mean = values.reduce((sum, value) => sum + value, 0) / values.length; return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) }
function quantile(values: number[], probability: number): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(probability * sorted.length))] ?? 0 }
function mulberry32(seed: number): () => number { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let value = Math.imul(seed ^ seed >>> 15, 1 | seed); value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value; return ((value ^ value >>> 14) >>> 0) / 4294967296 } }
function round(value: number): number { return Number.isFinite(value) ? Number(value.toFixed(6)) : value }
function asRecord(value: unknown): JSONRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {} }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function optionalNumber(value: unknown): number | undefined { const number = Number(value); return Number.isFinite(number) ? number : undefined }
function numberField(value: unknown): number { const number = Number(value); return Number.isFinite(number) ? number : 0 }
function stringField(value: unknown): string { return typeof value === "string" ? value.trim() : "" }
function booleanField(value: unknown): boolean { return value === true }
function asStats(value: unknown): PortfolioStats { const item = asRecord(value); return { sample_count: numberField(item.sample_count), total_return: numberField(item.total_return), annualized_return: numberField(item.annualized_return), annualized_volatility: numberField(item.annualized_volatility), sharpe: numberField(item.sharpe), max_drawdown: numberField(item.max_drawdown) } }

export { runTrendBenchmark, runCalibrationSuite, strategyBenchmarkInputFromJson, strategyCalibrationInputFromJson, type TrendBenchmarkInput }
