import type { ReplayResult } from "./replay-core"
import { compareCandidates, type StrategyRndCandidateReport } from "./strategy-rnd-evaluation"

export interface SelectionAudit {
  method: "four_block_rank_reversal"
  declared_trials: number
  candidate_count: number
  evaluated_folds: number
  rank_reversal_rate: number | null
  blocked: boolean
}

export interface FailureSummary {
  rejected_candidate_count: number
  accepted_candidate_count: number
  top_blockers: Array<{ check_id: string; count: number }>
  selection_blocked: boolean
  primary_failure_area: string
  next_system_actions: string[]
}

export interface ReliabilityGate {
  status: "candidate_ready" | "statistically_unresolved" | "blocked"
  decision: "draft_policy" | "stop_selection" | "fix_data" | "move_to_panel" | "reject_hypothesis" | "fix_cost_model" | "define_regime_scope" | "simplify_rules" | "inspect_blockers"
  more_trials_allowed: false
  reason: string
  sample_profile: {
    candidate_count: number
    total_trade_count: number
    min_sample_count: number
    median_sample_count: number
    min_oos_sample_count: number
  }
  layer_counts: Array<{ area: string; count: number }>
}

export interface FullTrialStatisticalReport {
  method: "full_trial_statistical_report_v1"
  multiple_testing_adjustment: "deflated_edge_probability_and_cscv_pbo"
  status: "candidate_ready" | "statistically_unresolved" | "blocked"
  blocked_by: Array<{ check_id: string; reason: string }>
  trial_universe: {
    declared_trials: number
    evaluated_candidates: number
    accepted_candidates: number
    rejected_candidates: number
    candidate_ids: string[]
    winner_candidate_id: string | null
  }
  sample_profile: {
    total_trade_count: number
    min_oos_sample_count: number
    median_oos_sample_count: number
    min_effective_oos_sample_count: number
  }
  edge_margin: {
    best_candidate_id: string | null
    avg_r: number
    total_r: number
    profit_factor: number
    required_avg_r: number
    required_total_r: number
    required_profit_factor: number
  }
  deflated_edge_probability: {
    method: "deflated_mean_r_probability_v1"
    status: "evaluated" | "no_winner" | "insufficient_data"
    candidate_id: string | null
    trade_count: number
    declared_trials: number
    observed_avg_r: number
    standard_error_r: number | null
    expected_max_null_avg_r: number
    probability_edge_after_trials: number | null
    required_probability: number
    passed: boolean
  }
  pbo: {
    method: "four_block_cscv_pbo_v1"
    status: "evaluated" | "not_applicable" | "insufficient_data"
    evaluated_splits: number
    overfit_probability: number | null
    required_max_overfit_probability: number
    passed: boolean
    reason: string | null
  }
  notes: string[]
}

const MIN_STAT_EFFECTIVE_OOS_SAMPLE_COUNT = 10
const MIN_STAT_OOS_AVG_R = 0.05
const MIN_STAT_OOS_TOTAL_R = 1
const MIN_STAT_OOS_PROFIT_FACTOR = 1.1
const MIN_DEFLATED_EDGE_PROBABILITY = 0.6
const MAX_PBO_PROBABILITY = 0.5

export function selectRndWinner(
  candidates: StrategyRndCandidateReport[],
  selectionAudit: SelectionAudit,
): StrategyRndCandidateReport | null {
  if (selectionAudit.blocked) {
    return null
  }
  return candidates.filter((candidate) => candidate.gate.accepted).sort(compareCandidates)[0] ?? null
}

export function buildFailureSummary(candidates: StrategyRndCandidateReport[], selectionAudit: SelectionAudit): FailureSummary {
  const topBlockers = summarizeCandidateBlockers(candidates)
  const primary = selectionAudit.blocked
    ? "selection_instability"
    : failureAreaForCheck(topBlockers[0]?.check_id || "")
  const actions = nextSystemActions(primary, topBlockers, selectionAudit)
  return {
    rejected_candidate_count: candidates.filter((candidate) => !candidate.gate.accepted).length,
    accepted_candidate_count: candidates.filter((candidate) => candidate.gate.accepted).length,
    top_blockers: topBlockers,
    selection_blocked: selectionAudit.blocked,
    primary_failure_area: primary || "none",
    next_system_actions: actions,
  }
}

export function buildReliabilityGate(
  candidates: StrategyRndCandidateReport[],
  selectionAudit: SelectionAudit,
  winner: StrategyRndCandidateReport | null,
  failureSummary: FailureSummary,
  statisticalReport?: FullTrialStatisticalReport,
): ReliabilityGate {
  const sampleProfile = buildSampleProfile(candidates)
  const layerCounts = summarizeFailureLayers(failureSummary.top_blockers)
  if (winner) {
    return {
      status: "candidate_ready",
      decision: "draft_policy",
      more_trials_allowed: false,
      reason: "candidate passed current R&D gate; stop searching and draft a strategy policy for evidence review",
      sample_profile: sampleProfile,
      layer_counts: layerCounts,
    }
  }
  if (statisticalReport?.status === "statistically_unresolved") {
    return {
      status: "statistically_unresolved",
      decision: "move_to_panel",
      more_trials_allowed: false,
      reason: "full trial report is statistically unresolved; use broader independent data instead of continuing this search",
      sample_profile: sampleProfile,
      layer_counts: layerCounts,
    }
  }
  const decision = decisionForFailure(failureSummary.primary_failure_area, selectionAudit)
  return {
    status: "blocked",
    decision,
    more_trials_allowed: false,
    reason: reasonForDecision(decision),
    sample_profile: sampleProfile,
    layer_counts: layerCounts,
  }
}

export function buildFullTrialStatisticalReport(
  candidates: StrategyRndCandidateReport[],
  selectionAudit: SelectionAudit,
  winner: StrategyRndCandidateReport | null,
): FullTrialStatisticalReport {
  const accepted = candidates.filter((candidate) => candidate.gate.accepted)
  const oosCounts = candidates.map((candidate) => oosStats(candidate).sample_count).sort((a, b) => a - b)
  const effectiveCounts = candidates.map((candidate) => effectiveOosSampleCount(oosStats(candidate).sample_count, selectionAudit.declared_trials)).sort((a, b) => a - b)
  const bestStats = winner ? oosStats(winner) : null
  const deflatedEdge = buildDeflatedEdgeProbability(winner, bestStats, selectionAudit.declared_trials)
  const pbo = buildPboReport(candidates)
  const blockedBy: FullTrialStatisticalReport["blocked_by"] = []
  if (selectionAudit.blocked) {
    blockedBy.push({ check_id: "RND-STAT-SELECTION-INSTABILITY", reason: "winner selection is unstable across chronological folds" })
  }
  if (candidates.length === 0) {
    blockedBy.push({ check_id: "RND-STAT-EMPTY-UNIVERSE", reason: "no candidate trials were evaluated" })
  }
  if (!winner && candidates.length > 0) {
    for (const blocker of summarizeCandidateBlockers(candidates)) {
      blockedBy.push({
        check_id: `RND-STAT-CANDIDATE-${blocker.check_id}`,
        reason: `${blocker.count} rejected candidate(s) blocked by ${blocker.check_id}`,
      })
    }
  }
  if (winner && effectiveOosSampleCount(bestStats?.sample_count ?? 0, selectionAudit.declared_trials) < MIN_STAT_EFFECTIVE_OOS_SAMPLE_COUNT) {
    blockedBy.push({
      check_id: "RND-STAT-EFFECTIVE-SAMPLE",
      reason: `winner effective OOS sample_count ${effectiveOosSampleCount(bestStats?.sample_count ?? 0, selectionAudit.declared_trials)} is below ${MIN_STAT_EFFECTIVE_OOS_SAMPLE_COUNT}`,
    })
  }
  if (winner && bestStats && (bestStats.avg_r < MIN_STAT_OOS_AVG_R || bestStats.total_r < MIN_STAT_OOS_TOTAL_R || bestStats.profit_factor < MIN_STAT_OOS_PROFIT_FACTOR)) {
    blockedBy.push({
      check_id: "RND-STAT-EDGE-MARGIN",
      reason: `winner OOS edge margin is too thin: avg_r ${bestStats.avg_r}, total_r ${bestStats.total_r}, profit_factor ${bestStats.profit_factor}`,
    })
  }
  if (winner && deflatedEdge.status === "evaluated" && !deflatedEdge.passed) {
    blockedBy.push({
      check_id: "RND-STAT-DEFLATED-EDGE",
      reason: `winner deflated edge probability ${deflatedEdge.probability_edge_after_trials} is below ${MIN_DEFLATED_EDGE_PROBABILITY}`,
    })
  }
  if (winner && pbo.status === "evaluated" && !pbo.passed) {
    blockedBy.push({
      check_id: "RND-STAT-PBO",
      reason: `estimated probability of backtest overfitting ${pbo.overfit_probability} exceeds ${MAX_PBO_PROBABILITY}`,
    })
  }
  const unresolved = blockedBy.some((item) => item.check_id === "RND-STAT-EFFECTIVE-SAMPLE")
  const status = winner && blockedBy.length === 0
    ? "candidate_ready"
    : unresolved
      ? "statistically_unresolved"
      : "blocked"
  return {
    method: "full_trial_statistical_report_v1",
    multiple_testing_adjustment: "deflated_edge_probability_and_cscv_pbo",
    status,
    blocked_by: blockedBy,
    trial_universe: {
      declared_trials: selectionAudit.declared_trials,
      evaluated_candidates: candidates.length,
      accepted_candidates: accepted.length,
      rejected_candidates: candidates.length - accepted.length,
      candidate_ids: candidates.map((candidate) => candidate.candidate_id),
      winner_candidate_id: status === "candidate_ready" ? winner?.candidate_id ?? null : null,
    },
    sample_profile: {
      total_trade_count: candidates.reduce((sum, candidate) => sum + candidate.replay.sample_count, 0),
      min_oos_sample_count: oosCounts[0] ?? 0,
      median_oos_sample_count: median(oosCounts),
      min_effective_oos_sample_count: effectiveCounts[0] ?? 0,
    },
    edge_margin: {
      best_candidate_id: winner?.candidate_id ?? null,
      avg_r: bestStats?.avg_r ?? 0,
      total_r: bestStats?.total_r ?? 0,
      profit_factor: bestStats?.profit_factor ?? 0,
      required_avg_r: MIN_STAT_OOS_AVG_R,
      required_total_r: MIN_STAT_OOS_TOTAL_R,
      required_profit_factor: MIN_STAT_OOS_PROFIT_FACTOR,
    },
    deflated_edge_probability: deflatedEdge,
    pbo,
    notes: [
      "Deflated edge probability corrects the winner's mean R by declared trial count and observed trade dispersion.",
      "Four-block CSCV PBO estimates whether the candidate selected in-sample ranks in the lower half out-of-sample.",
      "All evaluated candidates, rejected candidates, and the final winner decision share the same declared trial context.",
    ],
  }
}

export function summarizeCandidateBlockers(candidates: StrategyRndCandidateReport[]): FailureSummary["top_blockers"] {
  const counts = new Map<string, number>()
  for (const candidate of candidates) {
    if (candidate.gate.accepted) continue
    for (const block of candidate.gate.blocked_by) {
      counts.set(block.check_id, (counts.get(block.check_id) || 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .map(([check_id, count]) => ({ check_id, count }))
    .sort((a, b) => b.count - a.count || a.check_id.localeCompare(b.check_id))
    .slice(0, 5)
}

export function failureAreaForCheck(checkId: string): string {
  if (!checkId) return "none"
  if (checkId.includes("FUNDING-COVERAGE")) return "data_funding_coverage"
  if (checkId.includes("NULL-NOT-BEATEN")) return "negative_control"
  if (checkId.includes("SAMPLE")) return "sample_efficiency"
  if (checkId.includes("EDGE-MARGIN")) return "edge_expectancy"
  if (checkId.includes("EXPECTANCY") || checkId.includes("PROFIT-FACTOR")) return "edge_expectancy"
  if (checkId.includes("DRAWDOWN")) return "risk_shape"
  if (checkId.includes("ROBUSTNESS-COST")) return "execution_cost"
  if (checkId.includes("ROBUSTNESS-REGIME")) return "regime_fragility"
  if (checkId.includes("ROBUSTNESS-PARAM")) return "parameter_fragility"
  if (checkId.includes("PARAM-COUNT") || checkId.includes("SEARCH-BUDGET")) return "research_complexity"
  return "gate_blocker"
}

export function nextSystemActions(primary: string, blockers: FailureSummary["top_blockers"], selectionAudit: SelectionAudit): string[] {
  if (selectionAudit.blocked) {
    return ["Stop candidate selection; expand independent validation or reduce hypothesis overlap before more trials."]
  }
  const blockerIds = new Set(blockers.map((item) => item.check_id))
  if (blockerIds.has("R-FUNDING-COVERAGE")) {
    return ["Backfill exact funding events for the full replay interval before interpreting this candidate batch."]
  }
  switch (primary) {
    case "sample_efficiency":
      return ["Move this hypothesis to panel R&D or loosen setup frequency before spending more single-asset trials."]
    case "edge_expectancy":
      return ["Reject this setup mechanism; predeclare a different market edge instead of adding filters."]
    case "execution_cost":
      return ["Audit turnover, marketability, and fee tier assumptions before promoting any high-turnover variant."]
    case "regime_fragility":
      return ["Add regime attribution to the hypothesis and test whether the edge is state-specific, not universal."]
    case "parameter_fragility":
      return ["Simplify parameters or widen fixed rule bands; do not tune thresholds on the failed sample."]
    case "research_complexity":
      return ["Reduce parameter count and trial budget; restart as a smaller predeclared hypothesis."]
    case "risk_shape":
      return ["Redesign stop/target geometry before adding confirmation factors."]
    case "negative_control":
      return ["Reject mild positive edge until it beats side-flip and delayed-entry null controls."]
    default:
      return blockers.length > 0
        ? ["Stop this hypothesis batch; inspect top blockers before running more trials."]
        : []
  }
}

export function summarizeFailureLayers(blockers: FailureSummary["top_blockers"]): ReliabilityGate["layer_counts"] {
  const counts = new Map<string, number>()
  for (const blocker of blockers) {
    const area = failureAreaForCheck(blocker.check_id)
    counts.set(area, (counts.get(area) || 0) + blocker.count)
  }
  return Array.from(counts.entries())
    .map(([area, count]) => ({ area, count }))
    .sort((a, b) => b.count - a.count || a.area.localeCompare(b.area))
}

function buildSampleProfile(candidates: StrategyRndCandidateReport[]): ReliabilityGate["sample_profile"] {
  const sampleCounts = candidates.map((candidate) => candidate.replay.sample_count).sort((a, b) => a - b)
  const oosCounts = candidates.map((candidate) => {
    const proof = candidate.replay.assumptions.anti_overfit as { oos_stats?: { sample_count?: number } } | undefined
    return Number(proof?.oos_stats?.sample_count) || 0
  }).sort((a, b) => a - b)
  return {
    candidate_count: candidates.length,
    total_trade_count: sampleCounts.reduce((sum, value) => sum + value, 0),
    min_sample_count: sampleCounts[0] ?? 0,
    median_sample_count: median(sampleCounts),
    min_oos_sample_count: oosCounts[0] ?? 0,
  }
}

function oosStats(candidate: StrategyRndCandidateReport): { sample_count: number; avg_r: number; total_r: number; profit_factor: number } {
  const proof = candidate.replay.assumptions.anti_overfit as { oos_stats?: { sample_count?: number; avg_r?: number; total_r?: number; profit_factor?: number } } | undefined
  return {
    sample_count: Number(proof?.oos_stats?.sample_count) || candidate.replay.sample_count,
    avg_r: Number(proof?.oos_stats?.avg_r) || candidate.replay.avg_r,
    total_r: Number(proof?.oos_stats?.total_r) || candidate.replay.total_r,
    profit_factor: Number(proof?.oos_stats?.profit_factor) || candidate.replay.profit_factor,
  }
}

function effectiveOosSampleCount(sampleCount: number, declaredTrials: number): number {
  const trials = Math.max(1, Number.isFinite(declaredTrials) ? declaredTrials : 1)
  return Math.floor(sampleCount / Math.sqrt(trials))
}

function buildDeflatedEdgeProbability(
  winner: StrategyRndCandidateReport | null,
  bestStats: { sample_count: number; avg_r: number } | null,
  declaredTrials: number,
): FullTrialStatisticalReport["deflated_edge_probability"] {
  const trials = Math.max(1, Math.floor(Number.isFinite(declaredTrials) ? declaredTrials : 1))
  const base = {
    method: "deflated_mean_r_probability_v1" as const,
    candidate_id: winner?.candidate_id ?? null,
    trade_count: bestStats?.sample_count ?? 0,
    declared_trials: trials,
    observed_avg_r: round(bestStats?.avg_r ?? 0),
    standard_error_r: null,
    expected_max_null_avg_r: 0,
    probability_edge_after_trials: null,
    required_probability: MIN_DEFLATED_EDGE_PROBABILITY,
    passed: false,
  }
  if (!winner || !bestStats) return { ...base, status: "no_winner" }
  if (bestStats.sample_count < MIN_STAT_EFFECTIVE_OOS_SAMPLE_COUNT) return { ...base, status: "insufficient_data" }
  const rValues = winner.replay.trades.map((trade) => trade.r).filter(Number.isFinite)
  const stdev = sampleStdev(rValues)
  const standardError = stdev / Math.sqrt(Math.max(1, bestStats.sample_count))
  const expectedMaxNullAvg = trials > 1 ? stdev * inverseNormalCdf(1 - 1 / Math.max(2, trials)) / Math.sqrt(Math.max(1, bestStats.sample_count)) : 0
  const probability = standardError === 0
    ? bestStats.avg_r > expectedMaxNullAvg ? 1 : 0
    : normalCdf((bestStats.avg_r - expectedMaxNullAvg) / standardError)
  return {
    ...base,
    status: "evaluated",
    standard_error_r: round(standardError),
    expected_max_null_avg_r: round(expectedMaxNullAvg),
    probability_edge_after_trials: round(probability),
    passed: probability >= MIN_DEFLATED_EDGE_PROBABILITY,
  }
}

function buildPboReport(candidates: StrategyRndCandidateReport[]): FullTrialStatisticalReport["pbo"] {
  const base = {
    method: "four_block_cscv_pbo_v1" as const,
    evaluated_splits: 0,
    overfit_probability: null,
    required_max_overfit_probability: MAX_PBO_PROBABILITY,
    passed: true,
    reason: null,
  }
  if (candidates.length < 2) {
    return { ...base, status: "not_applicable", reason: "PBO requires at least two candidates" }
  }
  const timestamps = candidates.flatMap((candidate) => candidate.replay.trades.map((trade) => Date.parse(trade.signal_time))).filter(Number.isFinite)
  const first = Math.min(...timestamps)
  const last = Math.max(...timestamps)
  const folds = candidates.map((candidate) => calendarFolds(candidate.replay.trades, first, last, 4))
  if (!(last > first) || !folds.every((candidateFolds) => candidateFolds.every((fold) => fold.length >= 2))) {
    return { ...base, status: "insufficient_data", reason: "PBO requires at least two trades per candidate per time block" }
  }
  const trainSplits = combinations([0, 1, 2, 3], 2)
  let overfit = 0
  let evaluated = 0
  for (const trainFoldIndexes of trainSplits) {
    const trainSet = new Set(trainFoldIndexes)
    const scores = candidates.map((candidate, candidateIndex) => {
      const candidateFolds = folds[candidateIndex]
      const train = candidateFolds.flatMap((fold, index) => trainSet.has(index) ? fold : [])
      const test = candidateFolds.flatMap((fold, index) => trainSet.has(index) ? [] : fold)
      return { id: candidate.candidate_id, train: meanR(train), test: meanR(test) }
    })
    const selected = [...scores].sort((a, b) => b.train - a.train || a.id.localeCompare(b.id))[0]
    const testRank = [...scores].sort((a, b) => b.test - a.test || a.id.localeCompare(b.id)).findIndex((item) => item.id === selected.id) + 1
    if (testRank > Math.ceil(scores.length / 2)) overfit += 1
    evaluated += 1
  }
  const probability = evaluated > 0 ? overfit / evaluated : 0
  return {
    ...base,
    status: "evaluated",
    evaluated_splits: evaluated,
    overfit_probability: round(probability),
    passed: probability < MAX_PBO_PROBABILITY,
  }
}

function decisionForFailure(primary: string, selectionAudit: SelectionAudit): ReliabilityGate["decision"] {
  if (selectionAudit.blocked) return "stop_selection"
  switch (primary) {
    case "data_funding_coverage":
      return "fix_data"
    case "sample_efficiency":
      return "move_to_panel"
    case "edge_expectancy":
    case "negative_control":
    case "risk_shape":
      return "reject_hypothesis"
    case "execution_cost":
      return "fix_cost_model"
    case "regime_fragility":
      return "define_regime_scope"
    case "parameter_fragility":
    case "research_complexity":
      return "simplify_rules"
    default:
      return "inspect_blockers"
  }
}

function reasonForDecision(decision: ReliabilityGate["decision"]): string {
  switch (decision) {
    case "draft_policy":
      return "candidate is ready for policy drafting, not for more search"
    case "stop_selection":
      return "candidate selection is unstable across time blocks"
    case "fix_data":
      return "data coverage blocks interpretation"
    case "move_to_panel":
      return "single-symbol sample efficiency is too low; use panel R&D or a less sparse setup"
    case "reject_hypothesis":
      return "the market mechanism did not survive expectancy, risk-shape, or negative-control checks"
    case "fix_cost_model":
      return "execution cost assumptions dominate the result"
    case "define_regime_scope":
      return "edge appears regime-specific and needs an explicit state hypothesis"
    case "simplify_rules":
      return "rules are too fragile or over-parameterized for more trials"
    default:
      return "inspect top blockers before any new trial"
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const mid = Math.floor(values.length / 2)
  return values.length % 2 === 1 ? values[mid] : Number(((values[mid - 1] + values[mid]) / 2).toFixed(6))
}

function round(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : value
}

function sampleStdev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(Math.max(0, variance))
}

function combinations(values: number[], size: number): number[][] {
  if (size === 0) return [[]]
  if (values.length < size) return []
  const [head, ...tail] = values
  return [
    ...combinations(tail, size - 1).map((items) => [head, ...items]),
    ...combinations(tail, size),
  ]
}

function normalCdf(value: number): number {
  return 0.5 * (1 + erf(value / Math.SQRT2))
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1
  const x = Math.abs(value)
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911
  const t = 1 / (1 + p * x)
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)
  return sign * y
}

function inverseNormalCdf(probability: number): number {
  const p = Math.min(1 - 1e-12, Math.max(1e-12, probability))
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  const low = 0.02425
  const high = 1 - low
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > high) {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  const q = p - 0.5
  const r = q * q
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

export function buildSelectionAudit(candidates: StrategyRndCandidateReport[], declaredTrials: number): SelectionAudit {
  let reversals = 0
  let evaluated = 0
  const timestamps = candidates.flatMap((candidate) => candidate.replay.trades.map((trade) => Date.parse(trade.signal_time))).filter(Number.isFinite)
  const first = Math.min(...timestamps)
  const last = Math.max(...timestamps)
  const folds = candidates.map((candidate) => calendarFolds(candidate.replay.trades, first, last, 4))
  if (candidates.length > 1 && last > first && folds.every((candidateFolds) => candidateFolds.every((fold) => fold.length >= 5))) {
    for (let holdout = 0; holdout < 4; holdout += 1) {
      const scores = candidates.map((candidate, candidateIndex) => {
        const candidateFolds = folds[candidateIndex]
        const train = candidateFolds.flatMap((fold, index) => index === holdout ? [] : fold)
        return { id: candidate.candidate_id, train: meanR(train), test: meanR(candidateFolds[holdout]) }
      })
      const selected = [...scores].sort((a, b) => b.train - a.train)[0]
      const rank = [...scores].sort((a, b) => b.test - a.test).findIndex((item) => item.id === selected.id) + 1
      if (rank > Math.ceil(scores.length / 2)) reversals += 1
      evaluated += 1
    }
  }
  const rate = evaluated > 0 ? Number((reversals / evaluated).toFixed(6)) : null
  return {
    method: "four_block_rank_reversal",
    declared_trials: declaredTrials,
    candidate_count: candidates.length,
    evaluated_folds: evaluated,
    rank_reversal_rate: rate,
    blocked: rate !== null && rate > 0.5,
  }
}

function calendarFolds(trades: ReplayResult["trades"], first: number, last: number, count: number): Array<ReplayResult["trades"]> {
  const folds = Array.from({ length: count }, () => [] as ReplayResult["trades"])
  for (const trade of trades) {
    const index = Math.min(count - 1, Math.floor((Date.parse(trade.signal_time) - first) / (last - first + 1) * count))
    if (index >= 0) folds[index].push(trade)
  }
  return folds
}

function meanR(trades: ReplayResult["trades"]): number {
  return trades.length > 0 ? trades.reduce((sum, trade) => sum + trade.r, 0) / trades.length : Number.NEGATIVE_INFINITY
}
