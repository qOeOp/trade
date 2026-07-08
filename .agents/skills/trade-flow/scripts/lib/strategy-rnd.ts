import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  evaluateLatestSignal,
  hashCanonical,
  loadCandlesFromManifest,
  replayDataHash,
  replayStrategy,
  type ReplaySignal,
  type ReplayResult,
  type ReplayStrategy,
} from "./replay-core"
import {
  composeFactorCandidates,
  factorConditionsToJson,
  loadFactorFeatureStore,
  readFactorConditions,
  type FactorCondition,
  type FactorFeatureStore,
} from "./factor-engine"
import { researchFactorSeeds, type FactorResearchOptions, type FactorResearchReport } from "./factor-research"
import { getRndFamily, type RndFamilyConfigured } from "./rnd-family"

type JSONRecord = Record<string, unknown>
type CandidateSource = "provided" | "bounded_factor_composition" | "scientific_factor_discovery"
const fundingEventCache = new Map<string, Array<{ timestamp: string; value: number }>>()

interface StrategyRndBatchInput {
  batchId?: string
  hypothesis?: string
  manifestPath: string
  timeframe?: string
  maxHoldBars?: number
  feeBps?: number
  slippageBps?: number
  fundingBpsPer8h?: number
  oosSplitRatio?: number
  indicatorReportPath?: string
  factorCompose?: boolean
  factorDiscover?: boolean
  factorResearchOptions?: FactorResearchOptions
  factorSeeds?: FactorCondition[]
  maxFactorsPerCandidate?: number
  candidates: StrategyRndCandidateInput[]
  antiOverfitStage?: "selection_validation" | "external_validation" | "locked_holdout"
  parameterStability?: JSONRecord
  searchTrialCount?: number
}

interface StrategyRndLoopInput extends StrategyRndBatchInput {
  runId?: string
  artifactRoot?: string
  ledgerPath?: string
  now?: string
}

interface StrategyRndSignalInput {
  manifestPath: string
  indicatorReportPath?: string
  timeframe?: string
  entryPrice: number
  now?: string
  maxSignalAgeBars?: number
  candidate: StrategyRndCandidateInput
}

interface StrategyRndCampaignHypothesisInput extends StrategyRndBatchInput {
  hypothesisId: string
  validationManifestPath: string
  validationIndicatorReportPath?: string
}

interface StrategyRndCampaignInput {
  campaignId?: string
  hypotheses: StrategyRndCampaignHypothesisInput[]
  calibrationReportPath?: string
  maxTotalTrials?: number
  artifactRoot?: string
  ledgerPath?: string
  now?: string
}

interface StrategyRndCandidateInput {
  candidateId: string
  description?: string
  family?: string
  parameterCount?: number
  params?: JSONRecord
}

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

interface SelectionAudit {
  method: "four_block_rank_reversal"
  declared_trials: number
  candidate_count: number
  evaluated_folds: number
  rank_reversal_rate: number | null
  blocked: boolean
}

interface FailureSummary {
  rejected_candidate_count: number
  accepted_candidate_count: number
  top_blockers: Array<{ check_id: string; count: number }>
  selection_blocked: boolean
  primary_failure_area: string
  next_system_actions: string[]
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

interface StrategyRndCampaignReport {
  campaign_id: string
  created_at: string
  artifact_ref: string
  ledger_ref: string
  outcome: "validated_candidate_found" | "no_validated_candidate"
  stop_reason: "validated_candidate_found" | "hypothesis_queue_exhausted" | "trial_budget_exhausted" | "locked_holdout_failed" | "calibration_failed"
  calibration_gate: JSONRecord | null
  trial_budget: number
  trials_used: number
  hypotheses_run: number
  holdout_evaluations: number
  validated_candidate: {
    candidate_id: string
    family: string
    parameter_count: number
    params: JSONRecord
    validation_run_ref: string
  } | null
  runs: Array<{
    hypothesis_id: string
    discovery_run_ref: string
    discovery_outcome: "candidate_found" | "no_promote"
    validation_run_ref: string | null
    validation_outcome: "candidate_found" | "no_promote" | null
  }>
}

interface StrategyRndLedgerRecord {
  run_id: string
  created_at: string
  batch_id: string
  hypothesis: string
  manifest_ref: string
  indicator_report_ref: string
  artifact_ref: string
  candidate_source: CandidateSource
  outcome: "candidate_found" | "no_promote"
  trial_count: number
  accepted_count: number
  winner_candidate_id: string | null
  stage: "selection_validation" | "external_validation" | "locked_holdout"
  data_hash: string
  holdout_key: string | null
  rejected_reasons: Array<{
    check_id: string
    count: number
  }>
}

interface StrategyRndCandidateReport {
  candidate_id: string
  description: string
  family: string
  parameter_count: number
  params: JSONRecord
  replay: ReplayResult
  null_controls: CandidateNullControlReport
  gate: {
    accepted: boolean
    blocked_by: Array<{ check_id: string; reason: string }>
  }
}

interface CandidateNullControlReport {
  method: "side_flip_and_entry_lag"
  observed_total_r: number
  controls: Array<{
    control_id: string
    sample_count: number
    avg_r: number
    total_r: number
    profit_factor: number
  }>
  blocked_by: Array<{ check_id: string; reason: string }>
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
  const winner = selectionAudit.blocked ? null : accepted.sort(compareCandidates)[0] ?? null
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

function buildFailureSummary(candidates: StrategyRndCandidateReport[], selectionAudit: SelectionAudit): FailureSummary {
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

function summarizeCandidateBlockers(candidates: StrategyRndCandidateReport[]): FailureSummary["top_blockers"] {
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

function failureAreaForCheck(checkId: string): string {
  if (!checkId) return "none"
  if (checkId.includes("FUNDING-COVERAGE")) return "data_funding_coverage"
  if (checkId.includes("NULL-NOT-BEATEN")) return "negative_control"
  if (checkId.includes("SAMPLE")) return "sample_efficiency"
  if (checkId.includes("EXPECTANCY") || checkId.includes("PROFIT-FACTOR")) return "edge_expectancy"
  if (checkId.includes("DRAWDOWN")) return "risk_shape"
  if (checkId.includes("ROBUSTNESS-COST")) return "execution_cost"
  if (checkId.includes("ROBUSTNESS-REGIME")) return "regime_fragility"
  if (checkId.includes("ROBUSTNESS-PARAM")) return "parameter_fragility"
  if (checkId.includes("PARAM-COUNT") || checkId.includes("SEARCH-BUDGET")) return "research_complexity"
  return "gate_blocker"
}

function nextSystemActions(primary: string, blockers: FailureSummary["top_blockers"], selectionAudit: SelectionAudit): string[] {
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

function buildSelectionAudit(candidates: StrategyRndCandidateReport[], declaredTrials: number): SelectionAudit {
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
  if (!Array.isArray(input.hypotheses) || input.hypotheses.length === 0) {
    throw new Error("strategy R&D campaign requires at least one hypothesis")
  }
  const trialBudget = input.maxTotalTrials ?? 10
  if (!Number.isInteger(trialBudget) || trialBudget < 1 || trialBudget > 10) {
    throw new Error("strategy R&D campaign maxTotalTrials must be an integer from 1 to 10")
  }

  const createdAt = input.now || new Date().toISOString()
  const campaignId = input.campaignId || `rnd-campaign-${createdAt.replace(/[^0-9]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`
  const artifactRoot = input.artifactRoot || "./data/artifacts/strategy-rnd"
  const ledgerPath = input.ledgerPath || "./data/strategy-rnd-ledger.jsonl"
  const runs: StrategyRndCampaignReport["runs"] = []
  const calibrationGate = input.calibrationReportPath ? readCalibrationGate(input.calibrationReportPath) : null
  let trialsUsed = 0
  let validatedCandidate: StrategyRndCampaignReport["validated_candidate"] = null
  let stopReason: StrategyRndCampaignReport["stop_reason"] = calibrationGate?.blocked === true ? "calibration_failed" : "hypothesis_queue_exhausted"
  let holdoutEvaluations = 0

  for (const hypothesis of calibrationGate?.blocked === true ? [] : input.hypotheses) {
    if (!hypothesis.hypothesisId) {
      throw new Error("strategy R&D campaign hypothesis_id is required")
    }
    if (!hypothesis.validationManifestPath) {
      throw new Error(`strategy R&D campaign ${hypothesis.hypothesisId} requires validation_manifest_path`)
    }
    const trialCount = resolveCandidateCount(hypothesis)
    if (trialsUsed + trialCount > trialBudget) {
      stopReason = "trial_budget_exhausted"
      break
    }
    ensureNonOverlappingManifests(
      hypothesis.manifestPath,
      hypothesis.validationManifestPath,
      hypothesis.timeframe || "4h",
    )

    const discovery = runStrategyRndLoop({
      ...hypothesis,
      runId: `${campaignId}-${hypothesis.hypothesisId}-discovery`,
      batchId: `${campaignId}-${hypothesis.hypothesisId}-discovery`,
      artifactRoot,
      ledgerPath,
      now: createdAt,
    })
    trialsUsed += discovery.batch.trial_count
    const runSummary: StrategyRndCampaignReport["runs"][number] = {
      hypothesis_id: hypothesis.hypothesisId,
      discovery_run_ref: discovery.artifact_ref,
      discovery_outcome: discovery.batch.outcome,
      validation_run_ref: null,
      validation_outcome: null,
    }
    runs.push(runSummary)
    if (!discovery.batch.winner) {
      continue
    }

    const winner = discovery.batch.winner
    const winnerFilters = Array.isArray(winner.params.factorConditions) ? winner.params.factorConditions : []
    if (winnerFilters.length > 0 && !hypothesis.validationIndicatorReportPath) {
      throw new Error(`strategy R&D campaign ${hypothesis.hypothesisId} requires validation_indicator_report_path for frozen indicator filters`)
    }
    assertHoldoutUnused(ledgerPath, holdoutKeyForInput({
      ...hypothesis,
      manifestPath: hypothesis.validationManifestPath,
      indicatorReportPath: hypothesis.validationIndicatorReportPath,
      antiOverfitStage: "locked_holdout",
    }))
    const validation = runStrategyRndLoop({
      ...hypothesis,
      runId: `${campaignId}-${hypothesis.hypothesisId}-validation`,
      batchId: `${campaignId}-${hypothesis.hypothesisId}-validation`,
      hypothesis: `External validation of frozen candidate ${winner.candidate_id}: ${hypothesis.hypothesis || ""}`.trim(),
      manifestPath: hypothesis.validationManifestPath,
      indicatorReportPath: hypothesis.validationIndicatorReportPath,
      candidates: [{
        candidateId: `${winner.candidate_id}-external-validation`,
        description: winner.description,
        family: winner.family,
        parameterCount: winner.parameter_count,
        params: winner.params,
      }],
      antiOverfitStage: "locked_holdout",
      searchTrialCount: trialsUsed,
      parameterStability: asRecord(asRecord(winner.replay.assumptions.robustness).parameter_stability),
      artifactRoot,
      ledgerPath,
      now: createdAt,
    })
    holdoutEvaluations += 1
    runSummary.validation_run_ref = validation.artifact_ref
    runSummary.validation_outcome = validation.batch.outcome
    if (validation.batch.winner) {
      validatedCandidate = {
        candidate_id: validation.batch.winner.candidate_id,
        family: validation.batch.winner.family,
        parameter_count: validation.batch.winner.parameter_count,
        params: validation.batch.winner.params,
        validation_run_ref: validation.artifact_ref,
      }
      stopReason = "validated_candidate_found"
      break
    }
    stopReason = "locked_holdout_failed"
    break
  }

  const artifactRef = join(artifactRoot, `${safeFileName(campaignId)}.campaign.json`)
  const report: StrategyRndCampaignReport = {
    campaign_id: campaignId,
    created_at: createdAt,
    artifact_ref: artifactRef,
    ledger_ref: ledgerPath,
    outcome: validatedCandidate ? "validated_candidate_found" : "no_validated_candidate",
    stop_reason: stopReason,
    calibration_gate: calibrationGate,
    trial_budget: trialBudget,
    trials_used: trialsUsed,
    hypotheses_run: runs.length,
    holdout_evaluations: holdoutEvaluations,
    validated_candidate: validatedCandidate,
    runs,
  }
  writeJsonFile(artifactRef, report)
  return report
}

function readCalibrationGate(path: string): JSONRecord {
  const raw = asRecord(JSON.parse(readFileSync(path, "utf8")))
  const report = asRecord(raw.data ?? raw)
  const findings = array(asRecord(report.failure_analysis).findings).map(asRecord)
  const blockers = findings.filter((finding) => stringField(finding.severity) === "blocker")
  const warnings = findings.filter((finding) => stringField(finding.severity) === "warning")
  const calibrated = report.calibrated === true
  const blocked = !calibrated || blockers.length > 0
  return {
    report_ref: path,
    calibrated,
    blocked,
    blocker_count: blockers.length,
    warning_count: warnings.length,
    blocked_by: blockers.map((finding) => stringField(finding.check_id)).filter(Boolean),
  }
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

function ensureNonOverlappingManifests(discoveryPath: string, validationPath: string, timeframe: string): void {
  const discovery = readManifestRange(discoveryPath, timeframe)
  const validation = readManifestRange(validationPath, timeframe)
  if (discovery.first <= validation.last && validation.first <= discovery.last) {
    throw new Error(`discovery and validation manifests overlap for ${timeframe}`)
  }
}

function loadFundingEvents(path?: string): Array<{ timestamp: string; value: number }> {
  if (!path) return []
  const cached = fundingEventCache.get(path)
  if (cached) return cached
  const report = asRecord(JSON.parse(readFileSync(path, "utf8")))
  const raw = asRecord(asRecord(report.data).market_events).funding
  const events = (Array.isArray(raw) ? raw : []).map((item) => {
    const value = asRecord(item)
    return { timestamp: stringField(value.timestamp), value: Number(value.value) }
  }).filter((item) => item.timestamp && Number.isFinite(item.value))
  fundingEventCache.set(path, events)
  return events
}

function readManifestRange(manifestPath: string, timeframe: string): { first: number; last: number } {
  const manifest = asRecord(JSON.parse(readFileSync(manifestPath, "utf8")))
  const entry = asRecord(asRecord(manifest.timeframes)[timeframe])
  const first = Number(entry.first_open_ts)
  const last = Number(entry.last_open_ts)
  if (Number.isFinite(first) && first > 0 && Number.isFinite(last) && last >= first) {
    return { first, last }
  }
  const file = stringField(entry.file)
  if (!file) {
    throw new Error(`manifest missing timeframe ${timeframe}`)
  }
  const rows = readFileSync(join(dirname(manifestPath), file), "utf8").trim().split(/\r?\n/).slice(1)
  const timestamps = rows
    .map((row) => Number(row.split(",")[1]))
    .filter((timestamp) => Number.isFinite(timestamp))
  if (timestamps.length === 0) {
    throw new Error(`manifest timeframe ${timeframe} has no candles`)
  }
  return { first: Math.min(...timestamps), last: Math.max(...timestamps) }
}

function buildRndLedgerRecord(input: {
  input: StrategyRndLoopInput
  runId: string
  createdAt: string
  artifactRef: string
  batch: StrategyRndBatchReport
}): StrategyRndLedgerRecord {
  const stage = input.input.antiOverfitStage || "selection_validation"
  const dataHash = replayDataHash(
    input.input.manifestPath,
    input.input.timeframe || "4h",
    input.input.indicatorReportPath ? [input.input.indicatorReportPath] : [],
  )
  return {
    run_id: input.runId,
    created_at: input.createdAt,
    batch_id: input.batch.batch_id,
    hypothesis: input.batch.hypothesis,
    manifest_ref: input.input.manifestPath,
    indicator_report_ref: input.input.indicatorReportPath || "",
    artifact_ref: input.artifactRef,
    candidate_source: input.batch.candidate_source,
    outcome: input.batch.outcome,
    trial_count: input.batch.trial_count,
    accepted_count: input.batch.accepted_count,
    winner_candidate_id: input.batch.winner?.candidate_id ?? null,
    stage,
    data_hash: dataHash,
    holdout_key: stage === "locked_holdout" ? hashCanonical({ stage, data_hash: dataHash }) : null,
    rejected_reasons: summarizeRejectedReasons(input.batch),
  }
}

function summarizeRejectedReasons(batch: StrategyRndBatchReport): StrategyRndLedgerRecord["rejected_reasons"] {
  const counts = new Map<string, number>()
  for (const candidate of batch.candidates) {
    if (candidate.gate.accepted) {
      continue
    }
    for (const block of candidate.gate.blocked_by) {
      counts.set(block.check_id, (counts.get(block.check_id) || 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .map(([check_id, count]) => ({ check_id, count }))
    .sort((a, b) => b.count - a.count || a.check_id.localeCompare(b.check_id))
}

function redactLoopInputForArtifact(input: StrategyRndLoopInput): JSONRecord {
  return {
    batchId: input.batchId,
    hypothesis: input.hypothesis,
    manifestPath: input.manifestPath,
    timeframe: input.timeframe,
    maxHoldBars: input.maxHoldBars,
    feeBps: input.feeBps,
    slippageBps: input.slippageBps,
    fundingBpsPer8h: input.fundingBpsPer8h,
    oosSplitRatio: input.oosSplitRatio,
    searchTrialCount: input.searchTrialCount,
    indicatorReportPath: input.indicatorReportPath,
    factorCompose: input.factorCompose,
    factorDiscover: input.factorDiscover,
    factorResearchOptions: input.factorResearchOptions,
    factorSeeds: factorConditionsToJson(input.factorSeeds || []),
    maxFactorsPerCandidate: input.maxFactorsPerCandidate,
    candidates: input.candidates,
  }
}

function runCandidate(input: StrategyRndBatchInput, candidate: StrategyRndCandidateInput, featureStore: FactorFeatureStore): StrategyRndCandidateReport {
  const family = candidate.family || "trend_pullback_v1"
  const parameterCount = candidate.parameterCount ?? countActiveParameters(candidate.params || {})
  const rawParams = candidate.params || {}
  const configured = getRndFamily(family).configure(candidate.candidateId, rawParams, featureStore)
  const replay = replayStrategy(configured.strategy, {
    manifestPath: input.manifestPath,
    timeframe: input.timeframe,
    maxHoldBars: input.maxHoldBars,
    rewardRisk: configured.rewardRisk,
    feeBps: input.feeBps,
    slippageBps: input.slippageBps,
    fundingBpsPer8h: input.fundingBpsPer8h,
    fundingEvents: loadFundingEvents(input.indicatorReportPath),
    oosSplitRatio: input.oosSplitRatio ?? 0.3,
    trialCount: input.searchTrialCount ?? input.candidates.length,
    parameterCount,
    antiOverfitStage: input.antiOverfitStage,
    supplementalDataRefs: input.indicatorReportPath ? [input.indicatorReportPath] : [],
  })
  const robustness = asRecord(replay.assumptions.robustness)
  robustness.parameter_stability = Object.keys(input.parameterStability || {}).length > 0
    ? input.parameterStability
    : evaluateParameterStability(input, candidate, featureStore)
  replay.assumptions.robustness = robustness
  replay.provenance.assumptions_hash = hashCanonical(replay.assumptions)
  const nullControls = buildCandidateNullControls(input, candidate, configured, featureStore, replay)
  return {
    candidate_id: candidate.candidateId,
    description: candidate.description || "",
    family,
    parameter_count: parameterCount,
    params: configured.params,
    replay,
    null_controls: nullControls,
    gate: evaluateRndCandidate(replay, parameterCount, nullControls.blocked_by),
  }
}

function buildCandidateNullControls(
  input: StrategyRndBatchInput,
  candidate: StrategyRndCandidateInput,
  configured: RndFamilyConfigured,
  featureStore: FactorFeatureStore,
  observed: ReplayResult,
): CandidateNullControlReport {
  const parameterCount = candidate.parameterCount ?? countActiveParameters(candidate.params || {})
  const controls: CandidateNullControlReport["controls"] = []
  const sideFlipped = flippedSideParams(candidate.params || {})
  if (sideFlipped) {
    const flipped = getRndFamily(candidate.family || "trend_pullback_v1").configure(`${candidate.candidateId}-null-side-flip`, sideFlipped, featureStore)
    controls.push(summarizeNullControl("side_flip", runConfiguredReplay(input, flipped, countActiveParameters(sideFlipped))))
  }
  controls.push(summarizeNullControl(
    "entry_lag_3",
    runConfiguredReplay(input, { ...configured, strategy: laggedEntryStrategy(configured.strategy, 3) }, parameterCount),
  ))
  const eligible = controls.filter((control) => control.sample_count >= 10)
  const blocked = observed.total_r > 0
    && observed.avg_r > 0
    && eligible.some((control) => control.total_r >= observed.total_r || control.avg_r >= observed.avg_r)
  return {
    method: "side_flip_and_entry_lag",
    observed_total_r: observed.total_r,
    controls,
    blocked_by: blocked
      ? [{ check_id: "RND-NULL-NOT-BEATEN", reason: "candidate does not beat side-flip or delayed-entry null control" }]
      : [],
  }
}

function runConfiguredReplay(input: StrategyRndBatchInput, configured: RndFamilyConfigured, parameterCount: number): ReplayResult {
  return replayStrategy(configured.strategy, {
    manifestPath: input.manifestPath,
    timeframe: input.timeframe,
    maxHoldBars: input.maxHoldBars,
    rewardRisk: configured.rewardRisk,
    feeBps: input.feeBps,
    slippageBps: input.slippageBps,
    fundingBpsPer8h: input.fundingBpsPer8h,
    fundingEvents: loadFundingEvents(input.indicatorReportPath),
    oosSplitRatio: input.oosSplitRatio ?? 0.3,
    trialCount: input.searchTrialCount ?? input.candidates.length,
    parameterCount,
    antiOverfitStage: input.antiOverfitStage,
    supplementalDataRefs: input.indicatorReportPath ? [input.indicatorReportPath] : [],
  })
}

function summarizeNullControl(controlId: string, replay: ReplayResult): CandidateNullControlReport["controls"][number] {
  return {
    control_id: controlId,
    sample_count: replay.sample_count,
    avg_r: replay.avg_r,
    total_r: replay.total_r,
    profit_factor: replay.profit_factor,
  }
}

function flippedSideParams(params: JSONRecord): JSONRecord | null {
  const side = stringField(params.side).toLowerCase()
  if (side === "long") return { ...params, side: "short" }
  if (side === "short") return { ...params, side: "long" }
  return null
}

function laggedEntryStrategy(strategy: ReplayStrategy, lagBars: number): ReplayStrategy {
  return {
    ...strategy,
    strategy_id: `${strategy.strategy_id}-null-entry-lag-${lagBars}`,
    generateSignal(input) {
      const sourceIndex = input.index - lagBars
      if (sourceIndex < strategy.warmup_bars) return null
      const original = strategy.generateSignal({ ...input, index: sourceIndex })
      return original ? rebuildSignalAtEntry(original, input.index, input.entryIndex, input.entryPrice) : null
    },
  }
}

function rebuildSignalAtEntry(signal: ReplaySignal, signalIndex: number, entryIndex: number, entry: number): ReplaySignal | null {
  const originalRisk = Math.abs(signal.entry - signal.stop)
  const originalReward = Math.abs(signal.target - signal.entry)
  const rewardRisk = originalRisk > 0 ? originalReward / originalRisk : 0
  const risk = Math.abs(entry - signal.stop)
  if (!Number.isFinite(rewardRisk) || rewardRisk <= 0 || risk <= 0) return null
  return {
    ...signal,
    signal_index: signalIndex,
    entry_index: entryIndex,
    entry,
    target: signal.side === "long" ? entry + risk * rewardRisk : entry - risk * rewardRisk,
    reason: `${signal.reason} null entry lag`,
  }
}

function evaluateParameterStability(
  input: StrategyRndBatchInput,
  candidate: StrategyRndCandidateInput,
  featureStore: FactorFeatureStore,
): JSONRecord {
  const raw = candidate.params || {}
  const keys = Object.entries(raw)
    .filter(([key, value]) => {
      const normalized = key.toLowerCase()
      return typeof value === "number" && value > 0 && !normalized.includes("ema") && !normalized.includes("lookback")
    })
    .map(([key]) => key)
    .slice(0, 3)
  const results: Array<{ parameter: string; multiplier: number; avg_r: number; total_r: number }> = []
  for (const key of keys) {
    for (const multiplier of [0.9, 1.1]) {
      const params = { ...raw, [key]: Number(raw[key]) * multiplier }
      const configured = getRndFamily(candidate.family || "trend_pullback_v1").configure(`${candidate.candidateId}-stability`, params, featureStore)
      const replay = replayStrategy(configured.strategy, {
        manifestPath: input.manifestPath,
        timeframe: input.timeframe,
        maxHoldBars: input.maxHoldBars,
        rewardRisk: configured.rewardRisk,
        feeBps: input.feeBps,
        slippageBps: input.slippageBps,
        fundingBpsPer8h: input.fundingBpsPer8h,
        fundingEvents: loadFundingEvents(input.indicatorReportPath),
        supplementalDataRefs: input.indicatorReportPath ? [input.indicatorReportPath] : [],
      })
      results.push({ parameter: key, multiplier, avg_r: replay.avg_r, total_r: replay.total_r })
    }
  }
  const positive = results.filter((item) => item.avg_r > 0 && item.total_r > 0)
  return {
    method: "fixed_plus_minus_10pct",
    evaluation_count: results.length,
    positive_ratio: results.length > 0 ? Number((positive.length / results.length).toFixed(6)) : 0,
    worst_avg_r: results.length > 0 ? Math.min(...results.map((item) => item.avg_r)) : 0,
    results,
  }
}



function evaluateRndCandidate(
  replay: ReplayResult,
  parameterCount: number,
  nullBlocks: Array<{ check_id: string; reason: string }> = [],
): StrategyRndCandidateReport["gate"] {
  const blockedBy = [...replay.gate.blocked_by]
  const proof = replay.assumptions.anti_overfit as { oos_stats?: { sample_count: number; avg_r: number; total_r: number; max_drawdown_r: number; profit_factor: number }; trial_count?: number; parameter_count?: number } | undefined
  if (!proof || !proof.oos_stats) {
    blockedBy.push({ check_id: "RND-OOS-MISSING", reason: "candidate replay must include OOS proof" })
  } else {
    if (proof.oos_stats.sample_count < 10) {
      blockedBy.push({ check_id: "RND-OOS-SAMPLE", reason: `oos sample_count ${proof.oos_stats.sample_count} is below 10` })
    }
    if (proof.oos_stats.avg_r <= 0 || proof.oos_stats.total_r <= 0) {
      blockedBy.push({ check_id: "RND-OOS-EXPECTANCY", reason: "OOS expectancy is not positive after costs" })
    }
    if (proof.oos_stats.profit_factor < 1.05) {
      blockedBy.push({ check_id: "RND-OOS-PROFIT-FACTOR", reason: `OOS profit_factor ${proof.oos_stats.profit_factor} is below 1.05` })
    }
    if (proof.oos_stats.max_drawdown_r > 10) {
      blockedBy.push({ check_id: "RND-OOS-DRAWDOWN", reason: `OOS max_drawdown_r ${proof.oos_stats.max_drawdown_r} exceeds 10R` })
    }
    if ((proof.trial_count ?? 1) > 10) {
      blockedBy.push({ check_id: "RND-SEARCH-BUDGET", reason: `trial_count ${proof.trial_count} exceeds 10` })
    }
    if ((proof.parameter_count ?? parameterCount) > 8) {
      blockedBy.push({ check_id: "RND-PARAM-COUNT", reason: `parameter_count ${proof.parameter_count ?? parameterCount} exceeds 8` })
    }
  }
  if (parameterCount > 8) {
    blockedBy.push({ check_id: "RND-PARAM-COUNT", reason: `parameter_count ${parameterCount} exceeds 8` })
  }
  blockedBy.push(...evaluateRndRobustness(replay))
  blockedBy.push(...nullBlocks)
  return {
    accepted: blockedBy.length === 0,
    blocked_by: blockedBy,
  }
}

function evaluateRndRobustness(replay: ReplayResult): Array<{ check_id: string; reason: string }> {
  const robustness = asRecord(replay.assumptions.robustness)
  const slices = Array.isArray(robustness.regime_slices) ? robustness.regime_slices.map(asRecord) : []
  const eligible = slices.filter((slice) => Number(slice.sample_count) >= 5)
  const positive = eligible.filter((slice) => Number(slice.avg_r) > 0 && Number(slice.total_r) > 0)
  const blocked: Array<{ check_id: string; reason: string }> = []
  if (eligible.length < 2 || positive.length < 2) {
    blocked.push({ check_id: "RND-ROBUSTNESS-REGIME", reason: "at least two regime slices with five samples each must be positive" })
  }
  const costStress = asRecord(robustness.cost_stress)
  const costStats = asRecord(costStress.stats)
  if (Number(costStress.extra_bps_per_side) < 5 || Number(costStats.avg_r) <= 0 || Number(costStats.total_r) <= 0) {
    blocked.push({ check_id: "RND-ROBUSTNESS-COST", reason: "candidate must remain positive under at least 5 bps extra cost per side" })
  }
  const stability = asRecord(robustness.parameter_stability)
  if (stringField(stability.method) !== "fixed_plus_minus_10pct"
    || Number(stability.evaluation_count) < 2
    || Number(stability.positive_ratio) < 0.5
    || Number(stability.worst_avg_r) <= 0) {
    blocked.push({ check_id: "RND-ROBUSTNESS-PARAM", reason: "fixed +/-10% parameter perturbations are not stable" })
  }
  return blocked
}


function emptyFeatureStore(): FactorFeatureStore {
  return {
    definitions() {
      return []
    },
    series() {
      return undefined
    },
    read() {
      return undefined
    },
  }
}


function compareCandidates(a: StrategyRndCandidateReport, b: StrategyRndCandidateReport): number {
  const aOos = (a.replay.assumptions.anti_overfit as { oos_stats?: { total_r?: number; avg_r?: number } } | undefined)?.oos_stats
  const bOos = (b.replay.assumptions.anti_overfit as { oos_stats?: { total_r?: number; avg_r?: number } } | undefined)?.oos_stats
  return (bOos?.total_r ?? b.replay.total_r) - (aOos?.total_r ?? a.replay.total_r)
    || (bOos?.avg_r ?? b.replay.avg_r) - (aOos?.avg_r ?? a.replay.avg_r)
}

function countActiveParameters(params: JSONRecord): number {
  return Object.values(params).reduce<number>((count, value) => {
    if (Array.isArray(value)) {
      return count + value.length
    }
    return value !== undefined && value !== null && value !== "" ? count + 1 : count
  }, 0)
}


function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value
  }
  return fallback
}

function strategyRndBatchInputFromJson(input: JSONRecord): StrategyRndBatchInput {
  return {
    batchId: stringField(input.batch_id ?? input.batchId) || undefined,
    hypothesis: stringField(input.hypothesis) || undefined,
    manifestPath: stringField(input.manifest_path ?? input.manifestPath),
    timeframe: stringField(input.timeframe) || undefined,
    maxHoldBars: optionalNumber(input.max_hold_bars ?? input.maxHoldBars),
    feeBps: optionalNumber(input.fee_bps ?? input.feeBps),
    slippageBps: optionalNumber(input.slippage_bps ?? input.slippageBps),
    fundingBpsPer8h: optionalNumber(input.funding_bps_per_8h ?? input.fundingBpsPer8h),
    oosSplitRatio: optionalNumber(input.oos_split ?? input.oosSplitRatio),
    antiOverfitStage: readAntiOverfitStage(input.anti_overfit_stage ?? input.antiOverfitStage),
    searchTrialCount: optionalNumber(input.search_trial_count ?? input.searchTrialCount),
    indicatorReportPath: stringField(input.indicator_report_path ?? input.indicatorReportPath) || undefined,
    factorCompose: readBoolean(input.factor_compose ?? input.factorCompose, false),
    factorDiscover: readBoolean(input.factor_discover ?? input.factorDiscover, false),
    factorResearchOptions: factorResearchOptionsFromJson(input.factor_research_options ?? input.factorResearchOptions),
    factorSeeds: readFactorConditions(input.factor_seeds ?? input.factorSeeds),
    maxFactorsPerCandidate: optionalNumber(input.max_factors_per_candidate ?? input.maxFactorsPerCandidate),
    candidates: Array.isArray(input.candidates)
      ? input.candidates.map((candidate) => candidateFromJson(candidate as JSONRecord))
      : [],
  }
}

function strategyRndLoopInputFromJson(input: JSONRecord): StrategyRndLoopInput {
  return {
    ...strategyRndBatchInputFromJson(input),
    runId: stringField(input.run_id ?? input.runId) || undefined,
    artifactRoot: stringField(input.artifact_root ?? input.artifactRoot) || undefined,
    ledgerPath: stringField(input.ledger_path ?? input.ledgerPath) || undefined,
    now: stringField(input.now) || undefined,
  }
}

function strategyRndCampaignInputFromJson(input: JSONRecord): StrategyRndCampaignInput {
  const rawHypotheses = Array.isArray(input.hypotheses) ? input.hypotheses : []
  return {
    campaignId: stringField(input.campaign_id ?? input.campaignId) || undefined,
    calibrationReportPath: stringField(input.calibration_report_path ?? input.calibrationReportPath) || undefined,
    maxTotalTrials: optionalNumber(input.max_total_trials ?? input.maxTotalTrials),
    artifactRoot: stringField(input.artifact_root ?? input.artifactRoot) || undefined,
    ledgerPath: stringField(input.ledger_path ?? input.ledgerPath) || undefined,
    now: stringField(input.now) || undefined,
    hypotheses: rawHypotheses.map((raw) => {
      const hypothesis = asRecord(raw)
      return {
        ...strategyRndBatchInputFromJson({
          ...hypothesis,
          manifest_path: hypothesis.discovery_manifest_path
            ?? hypothesis.discoveryManifestPath
            ?? hypothesis.manifest_path
            ?? hypothesis.manifestPath,
        }),
        hypothesisId: stringField(hypothesis.hypothesis_id ?? hypothesis.hypothesisId),
        validationManifestPath: stringField(hypothesis.validation_manifest_path ?? hypothesis.validationManifestPath),
        validationIndicatorReportPath: stringField(hypothesis.validation_indicator_report_path ?? hypothesis.validationIndicatorReportPath) || undefined,
      }
    }),
  }
}

function strategyRndSignalInputFromJson(input: JSONRecord): StrategyRndSignalInput {
  return {
    manifestPath: stringField(input.manifest_path ?? input.manifestPath),
    indicatorReportPath: stringField(input.indicator_report_path ?? input.indicatorReportPath) || undefined,
    timeframe: stringField(input.timeframe) || undefined,
    entryPrice: Number(input.entry_price ?? input.entryPrice),
    now: stringField(input.now) || undefined,
    maxSignalAgeBars: optionalNumber(input.max_signal_age_bars ?? input.maxSignalAgeBars),
    candidate: candidateFromJson(asRecord(input.candidate)),
  }
}

function candidateFromJson(input: JSONRecord): StrategyRndCandidateInput {
  return {
    candidateId: stringField(input.candidate_id ?? input.candidateId),
    description: stringField(input.description) || undefined,
    family: stringField(input.family) || undefined,
    parameterCount: optionalNumber(input.parameter_count ?? input.parameterCount),
    params: asRecord(input.params),
  }
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function optionalNumber(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function factorResearchOptionsFromJson(value: unknown): FactorResearchOptions {
  const input = asRecord(value)
  return {
    horizonBars: optionalNumber(input.horizon_bars ?? input.horizonBars),
    lookback: optionalNumber(input.lookback),
    minSamples: optionalNumber(input.min_samples ?? input.minSamples),
    minAbsIc: optionalNumber(input.min_abs_ic ?? input.minAbsIc),
    maxCorrelation: optionalNumber(input.max_correlation ?? input.maxCorrelation),
    maxSelected: optionalNumber(input.max_selected ?? input.maxSelected),
  }
}

function readAntiOverfitStage(value: unknown): StrategyRndBatchInput["antiOverfitStage"] {
  return value === "external_validation" || value === "locked_holdout" || value === "selection_validation" ? value : undefined
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-")
}

function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function holdoutKeyForInput(input: StrategyRndBatchInput): string {
  const dataHash = replayDataHash(
    input.manifestPath,
    input.timeframe || "4h",
    input.indicatorReportPath ? [input.indicatorReportPath] : [],
  )
  return hashCanonical({ stage: "locked_holdout", data_hash: dataHash })
}

function loadRndLedger(path: string): StrategyRndLedgerRecord[] {
  if (!existsSync(path)) {
    return []
  }
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StrategyRndLedgerRecord)
}

function assertRunIdUnused(ledgerPath: string, runId: string): void {
  if (loadRndLedger(ledgerPath).some((record) => record.run_id === runId)) {
    throw new Error(`strategy R&D run_id already exists: ${runId}`)
  }
}

function assertHoldoutUnused(ledgerPath: string, holdoutKey: string): void {
  if (loadRndLedger(ledgerPath).some((record) => record.holdout_key === holdoutKey)) {
    throw new Error("locked holdout has already been evaluated")
  }
}

function appendJsonLine(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value)}\n`, { flag: "a" })
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
