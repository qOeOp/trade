import { readFileSync } from "node:fs"
import { hashCanonical } from "../../../compatibility/replay-engine/src/lib/replay-core"
import { panelFindings, type PanelDiagnostics } from "./strategy-benchmark-data"
import type { PortfolioStats } from "./strategy-benchmark-simulation"

type JSONRecord = Record<string, unknown>

interface DiagnosticFinding {
  check_id: string
  severity: "info" | "warning" | "blocker"
  component: string
  evidence: JSONRecord
  next_system_action: string
}

interface CalibrationSuiteReportInput {
  suiteId?: string
  previousCalibrationReportPath?: string
  harnessHash: string
  buyHold: JSONRecord
  trend: JSONRecord
  relativeStrength: JSONRecord
  panel: PanelDiagnostics
}

export function buildCalibrationSuiteReport(input: CalibrationSuiteReportInput): JSONRecord {
  const findings = calibrationFindings(input.buyHold, input.trend, input.relativeStrength, input.panel)
  const blockedBy: Array<{ check_id: string; reason: string }> = []
  if (!booleanField(input.trend.calibrated)) blockedBy.push({ check_id: "CAL-TREND", reason: "fixed time-series trend benchmark is not calibrated" })
  if (!booleanField(input.relativeStrength.calibrated)) blockedBy.push({ check_id: "CAL-RELATIVE-STRENGTH", reason: "fixed cross-sectional relative strength benchmark is not calibrated" })
  const report: JSONRecord = {
    calibration_suite_id: input.suiteId || "known_edge_calibration_v1",
    harness_hash: input.harnessHash,
    purpose: "rd_pipeline_calibration_only",
    calibrated: blockedBy.length === 0,
    blocked_by: blockedBy,
    data_panel: input.panel,
    components: {
      buy_and_hold_baseline: input.buyHold,
      time_series_trend: input.trend,
      cross_sectional_relative_strength: input.relativeStrength,
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
  return {
    ...report,
    report_hash: calibrationReportHash(report),
    previous_run_comparison: input.previousCalibrationReportPath ? compareCalibrationReports(report, input.previousCalibrationReportPath) : null,
  }
}

function calibrationReportHash(report: JSONRecord): string {
  const { report_hash: _reportHash, previous_run_comparison: _comparison, ...stable } = report
  return hashCanonical(stable)
}

function compareCalibrationReports(current: JSONRecord, previousPath: string): JSONRecord {
  const previous = readCalibrationReport(previousPath)
  const currentBlockers = findingIds(current, "blocker")
  const previousBlockers = findingIds(previous, "blocker")
  return {
    previous_report_ref: previousPath,
    previous_report_hash: stringField(previous.report_hash) || calibrationReportHash(previous),
    current_report_hash: calibrationReportHash(current),
    harness_changed: stringField(previous.harness_hash) !== stringField(current.harness_hash),
    calibrated_changed: previous.calibrated !== current.calibrated,
    blocker_count_delta: currentBlockers.length - previousBlockers.length,
    new_blockers: currentBlockers.filter((item) => !previousBlockers.includes(item)),
    cleared_blockers: previousBlockers.filter((item) => !currentBlockers.includes(item)),
    data_panel_changed: hashCanonical(previous.data_panel ?? null) !== hashCanonical(current.data_panel ?? null),
    component_sharpe_delta: {
      time_series_trend: round(asStats(asRecord(asRecord(current.components).time_series_trend).observed).sharpe - asStats(asRecord(asRecord(previous.components).time_series_trend).observed).sharpe),
      cross_sectional_relative_strength: round(asStats(asRecord(asRecord(current.components).cross_sectional_relative_strength).observed).sharpe - asStats(asRecord(asRecord(previous.components).cross_sectional_relative_strength).observed).sharpe),
    },
  }
}

function readCalibrationReport(path: string): JSONRecord {
  const raw = asRecord(JSON.parse(readFileSync(path, "utf8")))
  return asRecord(raw.data ?? raw)
}

function findingIds(report: JSONRecord, severity: string): string[] {
  return array(asRecord(asRecord(report.failure_analysis).findings))
    .map(asRecord)
    .filter((finding) => stringField(finding.severity) === severity)
    .map((finding) => stringField(finding.check_id))
    .filter(Boolean)
    .sort()
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
  return findings
}

function componentFindings(component: string, report: JSONRecord): DiagnosticFinding[] {
  const stats = asStats(report.observed)
  const cost = asStats(report.cost_stress)
  const funding = asStats(report.funding_stress)
  const historicalFunding = asStats(report.historical_funding)
  const negativeControl = asRecord(report.negative_control)
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
  const empiricalP = numberField(negativeControl.empirical_p_value)
  if (empiricalP > 0.05) {
    findings.push({
      check_id: "CAL-NEGATIVE-CONTROL-NOT-BEATEN",
      severity: "blocker",
      component,
      evidence: { empirical_p_value: empiricalP, observed_sharpe: stats.sharpe, p95_sharpe: numberField(negativeControl.p95_sharpe) },
      next_system_action: "Keep negative controls in the loop; do not accept mild positive returns as edge.",
    })
  }
  const sideFlip = asStats(negativeControl.side_flip)
  if (sideFlip.sharpe >= stats.sharpe || sideFlip.total_return > 0) {
    findings.push({
      check_id: "CAL-SIDE-FLIP-NOT-BEATEN",
      severity: "warning",
      component,
      evidence: { observed_sharpe: stats.sharpe, side_flip_sharpe: sideFlip.sharpe, side_flip_total_return: sideFlip.total_return },
      next_system_action: "Check whether the rule direction is economically meaningful before treating it as edge.",
    })
  }
  const assetShuffle = asRecord(negativeControl.asset_label_shuffle)
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

function round(value: number): number { return Number.isFinite(value) ? Number(value.toFixed(6)) : value }
function asRecord(value: unknown): JSONRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {} }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function numberField(value: unknown): number { const number = Number(value); return Number.isFinite(number) ? number : 0 }
function stringField(value: unknown): string { return typeof value === "string" ? value.trim() : "" }
function booleanField(value: unknown): boolean { return value === true }
function asStats(value: unknown): PortfolioStats { const item = asRecord(value); return { sample_count: numberField(item.sample_count), total_return: numberField(item.total_return), annualized_return: numberField(item.annualized_return), annualized_volatility: numberField(item.annualized_volatility), sharpe: numberField(item.sharpe), max_drawdown: numberField(item.max_drawdown) } }
