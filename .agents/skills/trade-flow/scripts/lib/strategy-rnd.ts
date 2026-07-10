import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { defaultCatalogDbPathForGeneratedPath, registerCatalogArtifact } from "./data-catalog"
import { displayPath, resolveRepoPath } from "./paths"
import {
  readRdProgramState,
  updateRdProgramStateFromResearchResult,
  writeRdProgramState,
  type RdProgramStateCommandResult,
} from "./rd-program-state"
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
  appendRndLedgerRecord,
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
  buildFullTrialStatisticalReport,
  buildReliabilityGate,
  buildSelectionAudit,
  selectRndWinner,
  type FailureSummary,
  type FullTrialStatisticalReport,
  type ReliabilityGate,
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
  statistical_report: FullTrialStatisticalReport
  failure_summary: FailureSummary
  reliability_gate: ReliabilityGate
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
  rd_program_state?: RdProgramStateCommandResult
}

function evaluateRndSignal(input: StrategyRndSignalInput): JSONRecord {
  if (!input.manifestPath || !input.candidate.candidateId) {
    throw new Error("strategy signal requires manifestPath and candidate")
  }
  const family = input.candidate.family || "trend_pullback_v1"
  const store = loadStrategyRndFeatureStore(input.indicatorReportPath)
  const configured = getRndFamily(family).configure(input.candidate.candidateId, input.candidate.params || {}, store)
  const supplementalDataRefs = [
    ...(input.indicatorReportPath ? [input.indicatorReportPath] : []),
    ...(configured.supplementalDataRefs || []),
  ]
  return {
    candidate_id: input.candidate.candidateId,
    family,
    params: configured.params,
    candidate_hash: hashCanonical({ family, params: configured.params }),
    data_hash: replayDataHash(input.manifestPath, input.timeframe || configured.strategy.default_timeframe, supplementalDataRefs),
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

function runStrategyRndLoop(input: StrategyRndLoopInput): StrategyRndLoopReport {
  const created_at = input.now || new Date().toISOString()
  const runId = input.runId || `rnd-${created_at.replace(/[^0-9]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`
  const artifactRoot = resolveRepoPath(input.artifactRoot || "./tmp/artifacts/strategy-rnd")
  const artifactPath = join(artifactRoot, `${safeFileName(runId)}.json`)
  const artifactRef = displayPath(artifactPath)
  const catalogDbPath = input.catalogDbPath || defaultCatalogDbPathForGeneratedPath(artifactRef)
  const ledgerRef = catalogDbPath
  if (input.antiOverfitStage === "locked_holdout") {
    assertHoldoutUnused({ catalogDbPath, ledgerPath: input.ledgerPath }, holdoutKeyForInput(input))
  }
  assertRunIdUnused({ catalogDbPath, ledgerPath: input.ledgerPath }, runId)
  const batch = runStrategyRndBatch(input)
  const ledgerRecord = buildRndLedgerRecord({
    input,
    runId,
    created_at,
    artifactRef,
    batch,
  })

  writeJsonFile(artifactPath, {
    run_id: runId,
    created_at,
    artifact_ref: artifactRef,
    ledger_ref: ledgerRef,
    input: redactLoopInputForArtifact(input),
    batch,
    ledger_record: ledgerRecord,
    stop_reason: batch.outcome,
  })
  registerCatalogArtifact({
    catalogDbPath,
    path: artifactRef,
    now: created_at,
    referrerType: "run",
    referrerID: runId,
    role: "output",
  })
  appendRndLedgerRecord({ catalogDbPath, ledgerPath: input.ledgerPath }, ledgerRecord)

  const report: StrategyRndLoopReport = {
    run_id: runId,
    created_at,
    artifact_ref: artifactRef,
    ledger_ref: ledgerRef,
    batch,
    ledger_record: ledgerRecord,
    stop_reason: batch.outcome,
  }
  const rdProgramState = maybeUpdateRdProgramState(input.rdProgramStatePath, catalogDbPath, report as unknown as JSONRecord, created_at)
  return rdProgramState ? { ...report, rd_program_state: rdProgramState } : report
}

function runStrategyRndCampaign(input: StrategyRndCampaignInput): StrategyRndCampaignReport {
  const report = runStrategyRndCampaignWithDeps(input, {
    runLoop: runStrategyRndLoop,
    resolveCandidateCount,
  })
  const rdProgramState = maybeUpdateRdProgramState(input.rdProgramStatePath, input.catalogDbPath || defaultCatalogDbPathForGeneratedPath(report.artifact_ref), report as unknown as JSONRecord, report.created_at)
  return rdProgramState ? { ...report, rd_program_state: rdProgramState } : report
}

function maybeUpdateRdProgramState(path: string | undefined, catalogDbPath: string, result: JSONRecord, now: string): RdProgramStateCommandResult | undefined {
  if (!path) {
    return undefined
  }
  const state = readRdProgramState(path)
  const updated = updateRdProgramStateFromResearchResult(state, result, now)
  const written = writeRdProgramState(path, updated, catalogDbPath)
  return {
    schema_version: "trade-flow.rd-program-state-result.v1",
    action: "update",
    state_ref: written.path,
    catalog_db_path: written.catalog_db_path,
    artifact_id: written.artifact_id,
    state: updated,
    goal: {
      objective: updated.objective,
      status: updated.status,
      budget: updated.budget,
      usage: updated.usage,
      stop_conditions: updated.stop_conditions,
      latest_failure_summary: updated.latest_failure_summary,
      latest_reliability_gate: updated.latest_reliability_gate,
      rejected_mechanisms: updated.rejected_mechanisms,
      universe_lessons: updated.universe_lessons,
      next_hypothesis_queue: updated.next_hypothesis_queue,
      artifact_refs: updated.artifact_refs,
    },
  }
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
