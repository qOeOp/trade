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
  status: "candidate_ready" | "blocked"
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
