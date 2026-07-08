import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  hashCanonical,
  evaluateLatestSignal,
  loadCandlesFromManifest,
  replayDataHash,
  replayStrategy,
} from "./replay-core"
import {
  composeFactorCandidates,
  loadFactorFeatureStore,
  type FactorFeatureStore,
} from "./factor-engine"
import { researchFactorSeeds, type FactorResearchReport } from "./factor-research"
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
  emptyFeatureStore,
  loadFundingEvents,
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
  const store = input.indicatorReportPath ? loadFactorFeatureStore(input.indicatorReportPath) : emptyFeatureStore()
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
  const featureStore = input.indicatorReportPath ? loadFactorFeatureStore(input.indicatorReportPath) : emptyFeatureStore()
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

function assertUniqueCandidateIds(candidates: StrategyRndCandidateInput[]): void {
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (!candidate.candidateId || seen.has(candidate.candidateId)) {
      throw new Error(`strategy R&D candidate_id must be unique: ${candidate.candidateId || "<empty>"}`)
    }
    seen.add(candidate.candidateId)
  }
}

function resolveRndCandidates(
  input: StrategyRndBatchInput,
  factorResearch: FactorResearchReport | null,
): { candidates: StrategyRndCandidateInput[]; source: CandidateSource } {
  const bases = input.candidates
  if (!input.factorCompose) {
    return {
      candidates: bases,
      source: "provided",
    }
  }
  const seeds = input.factorSeeds && input.factorSeeds.length > 0 ? input.factorSeeds : factorResearch?.seeds || []
  const candidates = composeFactorCandidates(bases, seeds, {
    maxCandidates: 10,
    maxFactorsPerCandidate: input.maxFactorsPerCandidate,
    maxParameterCount: 8,
  }) as StrategyRndCandidateInput[]
  return { candidates, source: factorResearch ? "scientific_factor_discovery" : "bounded_factor_composition" }
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

function resolveCandidateCount(input: StrategyRndBatchInput): number {
  const featureStore = input.indicatorReportPath ? loadFactorFeatureStore(input.indicatorReportPath) : emptyFeatureStore()
  const count = resolveRndCandidates(input, buildFactorResearch(input, featureStore)).candidates.length
  if (count === 0 && !input.factorDiscover) {
    throw new Error("strategy R&D campaign hypothesis requires at least one candidate")
  }
  return count
}

function buildFactorResearch(input: StrategyRndBatchInput, featureStore: FactorFeatureStore): FactorResearchReport | null {
  if (!input.factorDiscover || !input.indicatorReportPath) {
    return null
  }
  if (input.candidates.length !== 1) {
    throw new Error("setup-conditioned factor discovery requires exactly one base candidate")
  }
  const timeframe = input.timeframe || "4h"
  const base = input.candidates[0]
  const configured = getRndFamily(base.family || "trend_pullback_v1").configure(base.candidateId, base.params || {}, featureStore)
  const setupReplay = replayStrategy(configured.strategy, {
    manifestPath: input.manifestPath,
    timeframe,
    maxHoldBars: input.maxHoldBars,
    rewardRisk: configured.rewardRisk,
    feeBps: input.feeBps,
    slippageBps: input.slippageBps,
    fundingBpsPer8h: input.fundingBpsPer8h,
    fundingEvents: loadFundingEvents(input.indicatorReportPath),
  })
  return researchFactorSeeds(
    featureStore,
    loadCandlesFromManifest(
      input.manifestPath,
      JSON.parse(readFileSync(input.manifestPath, "utf8")) as JSONRecord,
      timeframe,
    ),
    timeframe,
    {
      ...input.factorResearchOptions,
      targets: setupReplay.trades.map((trade) => ({ timestamp: trade.signal_time, value: trade.r, regime: trade.regime })),
    },
  )
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
