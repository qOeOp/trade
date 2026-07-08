import { randomUUID } from "node:crypto"
import { join } from "node:path"
import {
  hashCanonical,
  evaluateLatestSignal,
  replayDataHash,
} from "./replay-core"
import type { FactorResearchReport } from "./factor-research"
import { getRndFamily } from "./rnd-family"
import {
  strategyRndBatchInputFromJson,
  strategyRndCampaignInputFromJson,
  strategyRndLoopInputFromJson,
  strategyRndSignalInputFromJson,
  type CandidateSource,
  type StrategyRndBatchInput,
  type StrategyRndCandidateInput,
  type StrategyRndCampaignInput,
  type StrategyRndLoopInput,
  type StrategyRndSignalInput,
} from "./strategy-rnd-inputs"
import {
  appendJsonLine,
  assertHoldoutUnused,
  assertRunIdUnused,
  buildRndLedgerRecord,
  holdoutKeyForInput,
  redactLoopInputForArtifact,
  safeFileName,
  writeJsonFile,
  type StrategyRndLedgerRecord,
} from "./strategy-rnd-ledger"
import {
  runCandidate,
  type StrategyRndCandidateReport,
} from "./strategy-rnd-evaluation"
import {
  buildFailureSummary,
  buildSelectionAudit,
  selectRndWinner,
  type FailureSummary,
  type SelectionAudit,
} from "./strategy-rnd-selection"
import {
  runStrategyRndCampaignWithDeps,
  type StrategyRndCampaignReport,
} from "./strategy-rnd-campaign"
import {
  assertUniqueCandidateIds,
  buildFactorResearch,
  loadStrategyRndFeatureStore,
  resolveCandidateCount,
  resolveRndCandidates,
} from "./strategy-rnd-candidates"

type JSONRecord = Record<string, unknown>
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
  failure_summary: FailureSummary
  next_action: string
}

interface StrategyRndLoopReport {
  run_id: string
  created_at: string
  artifact_ref: string
  ledger_ref: string
  batch: StrategyRndBatchReport
  ledger_record: StrategyRndLedgerRecord
  stop_reason: "candidate_found" | "no_promote"
}

function evaluateRndSignal(input: StrategyRndSignalInput): JSONRecord {
  if (!input.manifestPath || !input.candidate.candidateId) {
    throw new Error("strategy signal requires manifestPath and candidate")
  }
  const family = input.candidate.family || "trend_pullback_v1"
  const store = loadStrategyRndFeatureStore(input.indicatorReportPath)
  const configured = getRndFamily(family).configure(input.candidate.candidateId, input.candidate.params || {}, store)
  return {
    candidate_id: input.candidate.candidateId,
    family,
    params: configured.params,
    candidate_hash: hashCanonical({ family, params: configured.params }),
    data_hash: replayDataHash(input.manifestPath, input.timeframe || configured.strategy.default_timeframe, input.indicatorReportPath ? [input.indicatorReportPath] : []),
    ...evaluateLatestSignal(
      configured.strategy,
      { manifestPath: input.manifestPath, timeframe: input.timeframe },
      input.entryPrice,
      { now: input.now, maxAgeBars: input.maxSignalAgeBars },
    ),
  }
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
  const winner = selectRndWinner(reports, selectionAudit)
  const failureSummary = buildFailureSummary(reports, selectionAudit)

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
    failure_summary: failureSummary,
    next_action: winner
      ? "Draft a strategy policy for the winning candidate, then append replay evidence and run strategy-review before any shadow promotion."
      : failureSummary.next_system_actions[0] || "Stop this hypothesis batch; predeclare a new edge hypothesis before running more trials.",
  }
}

function runStrategyRndLoop(input: StrategyRndLoopInput): StrategyRndLoopReport {
  const createdAt = input.now || new Date().toISOString()
  const runId = input.runId || `rnd-${createdAt.replace(/[^0-9]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`
  const artifactRoot = input.artifactRoot || "./data/artifacts/strategy-rnd"
  const ledgerPath = input.ledgerPath || "./data/strategy-rnd-ledger.jsonl"
  const artifactRef = join(artifactRoot, `${safeFileName(runId)}.json`)
  if (input.antiOverfitStage === "locked_holdout") {
    assertHoldoutUnused(ledgerPath, holdoutKeyForInput(input))
  }
  assertRunIdUnused(ledgerPath, runId)
  const batch = runStrategyRndBatch(input)
  const ledgerRecord = buildRndLedgerRecord({
    input,
    runId,
    createdAt,
    artifactRef,
    batch,
  })

  writeJsonFile(artifactRef, {
    run_id: runId,
    created_at: createdAt,
    input: redactLoopInputForArtifact(input),
    batch,
    ledger_record: ledgerRecord,
    stop_reason: batch.outcome,
  })
  appendJsonLine(ledgerPath, ledgerRecord)

  return {
    run_id: runId,
    created_at: createdAt,
    artifact_ref: artifactRef,
    ledger_ref: ledgerPath,
    batch,
    ledger_record: ledgerRecord,
    stop_reason: batch.outcome,
  }
}

function runStrategyRndCampaign(input: StrategyRndCampaignInput): StrategyRndCampaignReport {
  return runStrategyRndCampaignWithDeps(input, {
    runLoop: runStrategyRndLoop,
    resolveCandidateCount,
  })
}

export {
  evaluateRndSignal,
  runStrategyRndBatch,
  runStrategyRndCampaign,
  runStrategyRndLoop,
  strategyRndBatchInputFromJson,
  strategyRndCampaignInputFromJson,
  strategyRndLoopInputFromJson,
  strategyRndSignalInputFromJson,
  type StrategyRndBatchInput,
  type StrategyRndBatchReport,
  type StrategyRndCandidateInput,
  type StrategyRndCampaignInput,
  type StrategyRndCampaignReport,
  type StrategyRndLoopInput,
  type StrategyRndLoopReport,
  type StrategyRndSignalInput,
}
