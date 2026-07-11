import type { FactorResearchReport } from "../../../strategy-family-engine/src/lib/factor-research"
import {
  assertUniqueCandidateIds,
  buildFactorResearch,
  loadStrategyRndFeatureStore,
  resolveRndCandidates,
} from "./strategy-rnd-candidates"
import {
  runCandidate,
  type StrategyRndCandidateReport,
} from "./strategy-rnd-evaluation"
import {
  buildFailureSummary,
  buildFullTrialStatisticalReport,
  buildReliabilityGate,
  buildSelectionAudit,
  selectRndWinner,
  type FailureSummary,
  type FullTrialStatisticalReport,
  type ReliabilityGate,
  type SelectionAudit,
} from "./strategy-rnd-selection"
import type { CandidateSource, StrategyRndBatchInput } from "./strategy-rnd-inputs"

interface StrategyRndBatchReport {
  batch_id: string
  hypothesis: string
  trial_count: number
  accepted_count: number
  candidate_source: CandidateSource
  outcome: "candidate_found" | "no_promote"
  winner: StrategyRndCandidateReport | null
  candidates: StrategyRndCandidateReport[]
  guardrails: {
    max_trials: 10
    max_parameter_count: 8
    oos_required: true
    no_auto_promote: true
  }
  factor_research: FactorResearchReport | null
  selection_audit: SelectionAudit
  statistical_report: FullTrialStatisticalReport
  failure_summary: FailureSummary
  reliability_gate: ReliabilityGate
  next_action: string
}

function runStrategyRndBatch(input: StrategyRndBatchInput): StrategyRndBatchReport {
  if (!input.manifestPath) {
    throw new Error("strategy R&D batch requires manifestPath")
  }
  const featureStore = loadStrategyRndFeatureStore(input.indicatorReportPath)
  const factorResearch = buildFactorResearch(input, featureStore)
  const resolved = resolveRndCandidates(input, factorResearch)
  const candidates = resolved.candidates
  if (!Array.isArray(candidates) || (candidates.length === 0 && !factorResearch)) {
    throw new Error("strategy R&D batch requires at least one candidate")
  }
  assertUniqueCandidateIds(candidates)
  if (candidates.length > 10) {
    throw new Error(`strategy R&D batch trial_count ${candidates.length} exceeds 10`)
  }

  const batch = { ...input, candidates }
  const reports = candidates.map((candidate) => runCandidate(batch, candidate, featureStore))
  const accepted = reports.filter((report) => report.gate.accepted)
  const selectionAudit = buildSelectionAudit(reports, input.searchTrialCount ?? candidates.length)
  const selectedWinner = selectRndWinner(reports, selectionAudit)
  const statisticalReport = buildFullTrialStatisticalReport(reports, selectionAudit, selectedWinner)
  const winner = statisticalReport.status === "candidate_ready" ? selectedWinner : null
  const failureSummary = buildFailureSummary(reports, selectionAudit)
  const reliabilityGate = buildReliabilityGate(reports, selectionAudit, winner, failureSummary, statisticalReport)

  return {
    batch_id: input.batchId || "strategy-rnd-batch",
    hypothesis: input.hypothesis || "",
    trial_count: candidates.length,
    accepted_count: accepted.length,
    candidate_source: resolved.source,
    outcome: winner ? "candidate_found" : "no_promote",
    winner,
    candidates: reports,
    guardrails: {
      max_trials: 10,
      max_parameter_count: 8,
      oos_required: true,
      no_auto_promote: true,
    },
    factor_research: factorResearch,
    selection_audit: selectionAudit,
    statistical_report: statisticalReport,
    failure_summary: failureSummary,
    reliability_gate: reliabilityGate,
    next_action: winner
      ? "Draft a strategy policy for the winning candidate, then append replay evidence and run strategy-review before any shadow promotion."
      : failureSummary.next_system_actions[0] || "Stop this hypothesis batch; predeclare a new edge hypothesis before running more trials.",
  }
}

export { runStrategyRndBatch, type StrategyRndBatchReport }
