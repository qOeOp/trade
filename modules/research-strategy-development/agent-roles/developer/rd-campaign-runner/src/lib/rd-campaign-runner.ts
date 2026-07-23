import { randomUUID } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { defaultCatalogDbPathForGeneratedPath, registerCatalogArtifact } from "../../../../../../contracts/catalog-contract/src/catalog-client"
import { displayPath, resolveReadablePath, resolveRepoPath } from "../../../../../../contracts/runtime-core/src/paths"
import { resolveCandidateCount } from "../../../candidate-batch-engine/src/lib/strategy-rnd-candidates"
import type { RdProgramStateCommandResult } from "../../../../../research-control-plane/program-control/src/lib/rd-program-state"
import type { StrategyRndCampaignHypothesisInput, StrategyRndCampaignInput, StrategyRndLoopInput } from "../../../candidate-batch-engine/src/lib/strategy-rnd-inputs"
import { maybeUpdateRdProgramState, runStrategyRndLoop } from "../../../rd-loop-runner/src/lib/rd-loop-runner"
import { safeFileName, writeJsonFile } from "../../../../../research-control-plane/experiment-ledger/src/lib/rd-ledger"

type JSONRecord = Record<string, unknown>

export interface StrategyRndCampaignReport {
  campaign_id: string
  created_at: string
  artifact_ref: string
  dossier_ref: string
  ledger_ref: string
  outcome: "validated_candidate_found" | "no_validated_candidate"
  stop_reason: "validated_candidate_found" | "hypothesis_queue_exhausted" | "trial_budget_exhausted" | "external_validation_failed" | "locked_holdout_failed" | "calibration_failed" | "hypothesis_certificate_failed" | "panel_negative_control_failed"
  calibration_gate: JSONRecord | null
  hypothesis_certificates: HypothesisCertificateGate[]
  panel_report_ref: string | null
  trial_budget: number
  trials_used: number
  hypotheses_run: number
  validation_evaluations: number
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
    discovery_failure_summary: JSONRecord | null
    discovery_reliability_gate: JSONRecord | null
    panel_negative_control_gate: JSONRecord | null
    validation_run_ref: string | null
    validation_outcome: "candidate_found" | "no_promote" | null
  }>
  rd_program_state?: RdProgramStateCommandResult
}

export interface HypothesisCertificateGate {
  hypothesis_id: string
  accepted: boolean
  blocked_by: string[]
  certificate: JSONRecord | null
}

export interface StrategyRndCampaignLoopResult {
  artifact_ref: string
    batch: {
      outcome: "candidate_found" | "no_promote"
      trial_count: number
      failure_summary?: unknown
      reliability_gate?: unknown
      winner: {
        candidate_id: string
        description: string
      family: string
      parameter_count: number
      params: JSONRecord
      replay: unknown
    } | null
  }
}

export interface StrategyRndCampaignDeps {
  runLoop: (input: StrategyRndLoopInput) => StrategyRndCampaignLoopResult
  resolveCandidateCount: (input: StrategyRndLoopInput) => number
}

export function runStrategyRndCampaign(input: StrategyRndCampaignInput): StrategyRndCampaignReport {
  const report = runStrategyRndCampaignWithDeps(input, {
    runLoop: runStrategyRndLoop,
    resolveCandidateCount,
  })
  const rdProgramState = maybeUpdateRdProgramState(
    input.rdProgramRef,
    input.rdStateDb,
    input.catalogDbPath || defaultCatalogDbPathForGeneratedPath(report.artifact_ref),
    report as unknown as JSONRecord,
    report.created_at,
  )
  return rdProgramState ? { ...report, rd_program_state: rdProgramState } : report
}

export function runStrategyRndCampaignWithDeps(
  input: StrategyRndCampaignInput,
  deps: StrategyRndCampaignDeps,
): StrategyRndCampaignReport {
  if (!Array.isArray(input.hypotheses) || input.hypotheses.length === 0) {
    throw new Error("strategy R&D campaign requires at least one hypothesis")
  }
  const trialBudget = input.maxTotalTrials ?? 10
  if (!Number.isInteger(trialBudget) || trialBudget < 1 || trialBudget > 10) {
    throw new Error("strategy R&D campaign maxTotalTrials must be an integer from 1 to 10")
  }

  const created_at = input.now || new Date().toISOString()
  const campaignId = input.campaignId || `rnd-campaign-${created_at.replace(/[^0-9]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`
  const artifactRoot = resolveRepoPath(input.artifactRoot || "./tmp/artifacts/strategy-rnd")
  const catalogDbPath = input.catalogDbPath || defaultCatalogDbPathForGeneratedPath(artifactRoot)
  const ledgerRef = catalogDbPath
  const runs: StrategyRndCampaignReport["runs"] = []
  const calibrationGate = input.calibrationReportPath ? readCalibrationGate(input.calibrationReportPath) : null
  const hypothesisCertificates = input.hypotheses.map(readHypothesisCertificateGate)
  const certificateBlocked = hypothesisCertificates.some((gate) => !gate.accepted)
  let trialsUsed = 0
  let validatedCandidate: StrategyRndCampaignReport["validated_candidate"] = null
  let stopReason: StrategyRndCampaignReport["stop_reason"] = calibrationGate?.blocked === true
    ? "calibration_failed"
    : certificateBlocked
      ? "hypothesis_certificate_failed"
      : "hypothesis_queue_exhausted"
  let holdoutEvaluations = 0
  let validationEvaluations = 0

  for (const hypothesis of calibrationGate?.blocked === true || certificateBlocked ? [] : input.hypotheses) {
    if (!hypothesis.hypothesisId) {
      throw new Error("strategy R&D campaign hypothesis_id is required")
    }
    if (!hypothesis.manifestPath) {
      throw new Error(`strategy R&D campaign ${hypothesis.hypothesisId} requires discovery_manifest_path`)
    }
    if (!hypothesis.validationManifestPath) {
      throw new Error(`strategy R&D campaign ${hypothesis.hypothesisId} requires validation_manifest_path`)
    }
    const trialCount = deps.resolveCandidateCount(hypothesis)
    if (trialsUsed + trialCount > trialBudget) {
      stopReason = "trial_budget_exhausted"
      break
    }
    ensureNonOverlappingManifests(
      hypothesis.manifestPath,
      hypothesis.validationManifestPath,
      hypothesis.timeframe || "4h",
      holdoutEmbargoMs(hypothesis),
    )

    const discovery = deps.runLoop({
      ...hypothesis,
      runId: `${campaignId}-${hypothesis.hypothesisId}-discovery`,
      batchId: `${campaignId}-${hypothesis.hypothesisId}-discovery`,
      environmentId: input.environmentId,
      artifactRoot,
      ledgerPath: input.ledgerPath,
      catalogDbPath,
      now: created_at,
    })
    trialsUsed += discovery.batch.trial_count
    const runSummary: StrategyRndCampaignReport["runs"][number] = {
      hypothesis_id: hypothesis.hypothesisId,
      discovery_run_ref: discovery.artifact_ref,
      discovery_outcome: discovery.batch.outcome,
      discovery_failure_summary: asNullableRecord(discovery.batch.failure_summary),
      discovery_reliability_gate: asNullableRecord(discovery.batch.reliability_gate),
      panel_negative_control_gate: null,
      validation_run_ref: null,
      validation_outcome: null,
    }
    runs.push(runSummary)
    if (!discovery.batch.winner) {
      continue
    }

    const winner = discovery.batch.winner
    const panelNegativeControlGate = input.panelReportPath ? readPanelNegativeControlGate(input.panelReportPath, winner.candidate_id) : null
    runSummary.panel_negative_control_gate = panelNegativeControlGate
    if (panelNegativeControlGate?.blocked === true) {
      stopReason = "panel_negative_control_failed"
      break
    }
    const winnerFilters = Array.isArray(winner.params.factor_conditions) ? winner.params.factor_conditions : []
    if (winnerFilters.length > 0 && !hypothesis.validationIndicatorReportPath) {
      throw new Error(`strategy R&D campaign ${hypothesis.hypothesisId} requires validation_indicator_report_path for frozen indicator filters`)
    }
    const validation = deps.runLoop({
      ...hypothesis,
      runId: `${campaignId}-${hypothesis.hypothesisId}-validation`,
      batchId: `${campaignId}-${hypothesis.hypothesisId}-validation`,
      environmentId: input.environmentId,
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
      antiOverfitStage: "external_validation",
      searchTrialCount: trialsUsed,
      parameterStability: asRecord(asRecord(asRecord(winner.replay).assumptions).robustness).parameter_stability as JSONRecord,
      artifactRoot,
      ledgerPath: input.ledgerPath,
      catalogDbPath,
      now: created_at,
    })
    validationEvaluations += 1
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
    stopReason = "external_validation_failed"
    break
  }

  const artifactPath = join(artifactRoot, `${safeFileName(campaignId)}.campaign.json`)
  const artifactRef = displayPath(artifactPath)
  const dossierPath = join(artifactRoot, `${safeFileName(campaignId)}.dossier.md`)
  const dossierRef = displayPath(dossierPath)
  const report: StrategyRndCampaignReport = {
    campaign_id: campaignId,
    created_at,
    artifact_ref: artifactRef,
    dossier_ref: dossierRef,
    ledger_ref: ledgerRef,
    outcome: validatedCandidate ? "validated_candidate_found" : "no_validated_candidate",
    stop_reason: stopReason,
    calibration_gate: calibrationGate,
    hypothesis_certificates: hypothesisCertificates,
    panel_report_ref: input.panelReportPath ?? null,
    trial_budget: trialBudget,
    trials_used: trialsUsed,
    hypotheses_run: runs.length,
    validation_evaluations: validationEvaluations,
    holdout_evaluations: holdoutEvaluations,
    validated_candidate: validatedCandidate,
    runs,
  }
  writeJsonFile(artifactPath, report)
  writeFileSync(dossierPath, renderCampaignDossier(report))
  registerCatalogArtifact({
    catalogDbPath,
    environmentId: input.environmentId,
    path: artifactRef,
    now: created_at,
    referrerType: "run",
    referrerID: campaignId,
    role: "output",
  })
  registerCatalogArtifact({
    catalogDbPath,
    environmentId: input.environmentId,
    path: dossierRef,
    now: created_at,
    referrerType: "run",
    referrerID: campaignId,
    role: "report",
  })
  return report
}

function renderCampaignDossier(report: StrategyRndCampaignReport): string {
  const lines = [
    `# R&D Campaign Dossier: ${report.campaign_id}`,
    "",
    `- Created: ${report.created_at}`,
    `- Outcome: ${report.outcome}`,
    `- Stop reason: ${report.stop_reason}`,
    `- Trials used: ${report.trials_used}/${report.trial_budget}`,
    `- Hypotheses run: ${report.hypotheses_run}`,
    `- External validation evaluations: ${report.validation_evaluations}`,
    `- Locked holdout evaluations: ${report.holdout_evaluations}`,
    `- JSON artifact: ${report.artifact_ref}`,
    "",
    "## Hypothesis Gates",
    ...report.hypothesis_certificates.map((gate) => `- ${gate.hypothesis_id}: ${gate.accepted ? "accepted" : `blocked (${gate.blocked_by.join(", ")})`}`),
    "",
    "## Runs",
    ...report.runs.flatMap((run) => {
      const failure = asNullableRecord(run.discovery_failure_summary)
      const blockers = array(failure?.top_blockers).map(asRecord).map((item) => stringField(item.check_id)).filter(Boolean)
      return [
        `- ${run.hypothesis_id}`,
        `  - Discovery: ${run.discovery_outcome} (${run.discovery_run_ref})`,
        `  - Validation: ${run.validation_outcome || "not_run"}${run.validation_run_ref ? ` (${run.validation_run_ref})` : ""}`,
        `  - Top blockers: ${blockers.length > 0 ? blockers.join(", ") : "none"}`,
      ]
    }),
    "",
    "## Decision",
    report.validated_candidate
      ? `Validated candidate found: ${report.validated_candidate.candidate_id}`
      : "No validated candidate. Do not draft or promote a strategy from this campaign.",
    "",
  ]
  return `${lines.join("\n")}\n`
}

export function readHypothesisCertificateGate(hypothesis: StrategyRndCampaignHypothesisInput): HypothesisCertificateGate {
  const certificate = hypothesis.thesisCertificate
  if (!certificate) {
    return {
      hypothesis_id: hypothesis.hypothesisId,
      accepted: false,
      blocked_by: ["RND-HYPOTHESIS-CERTIFICATE-MISSING"],
      certificate: null,
    }
  }
  const blockedBy = [
    requiredText(certificate.edgeType, "RND-HYPOTHESIS-EDGE-TYPE"),
    requiredText(certificate.behavioralHypothesis, "RND-HYPOTHESIS-BEHAVIOR"),
    requiredText(certificate.marketParticipants, "RND-HYPOTHESIS-PARTICIPANTS"),
    requiredText(certificate.regime, "RND-HYPOTHESIS-REGIME"),
    requiredText(certificate.invalidation, "RND-HYPOTHESIS-INVALIDATION"),
    requiredText(certificate.costSensitivity, "RND-HYPOTHESIS-COST-SENSITIVITY"),
    requiredStructured(certificate.candidateUniverse, "RND-HYPOTHESIS-CANDIDATE-UNIVERSE"),
    certificate.negativeControls && certificate.negativeControls.length > 0 ? "" : "RND-HYPOTHESIS-NEGATIVE-CONTROLS",
  ].filter(Boolean)
  return {
    hypothesis_id: hypothesis.hypothesisId,
    accepted: blockedBy.length === 0,
    blocked_by: blockedBy,
    certificate: {
      edge_type: certificate.edgeType ?? "",
      behavioral_hypothesis: certificate.behavioralHypothesis ?? "",
      market_participants: certificate.marketParticipants ?? "",
      regime: certificate.regime ?? "",
      invalidation: certificate.invalidation ?? "",
      cost_sensitivity: certificate.costSensitivity ?? "",
      candidate_universe: certificate.candidateUniverse ?? null,
      negative_controls: certificate.negativeControls ?? [],
    },
  }
}

export function readPanelNegativeControlGate(path: string, candidateId: string): JSONRecord {
  const raw = asRecord(JSON.parse(readFileSync(path, "utf8")))
  const report = asRecord(raw.data ?? raw)
  const candidates = array(report.candidates).map(asRecord)
  const candidate = candidates.find((item) => panelCandidateMatches(candidateId, stringField(item.candidate_id)))
  if (!candidate) {
    return {
      report_ref: path,
      candidate_id: candidateId,
      blocked: true,
      status: "missing_candidate",
      blocked_by: ["PANEL-CANDIDATE-MISSING"],
    }
  }
  const gate = asRecord(candidate.gate)
  const gateBlocks = array(gate.blocked_by).map(asRecord).map((item) => stringField(item.check_id)).filter(Boolean)
  const panelNegativeControl = asRecord(candidate.panel_negative_controls)
  const status = stringField(panelNegativeControl.status)
  const blockedBy = [...gateBlocks]
  if (status !== "evaluated") {
    blockedBy.push("PANEL-ASSET-SHUFFLE-NOT-EVALUATED")
  } else if (panelNegativeControl.passed !== true) {
    blockedBy.push("PANEL-ASSET-SHUFFLE")
  }
  return {
    report_ref: path,
    candidate_id: stringField(candidate.candidate_id),
    requested_candidate_id: candidateId,
    status,
    blocked: blockedBy.length > 0,
    blocked_by: Array.from(new Set(blockedBy)),
    panel_negative_controls: panelNegativeControl,
  }
}

export function readCalibrationGate(path: string): JSONRecord {
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

export function ensureNonOverlappingManifests(discoveryPath: string, validationPath: string, timeframe: string, embargoMs = 0): void {
  const discovery = readManifestRange(discoveryPath, timeframe)
  const validation = readManifestRange(validationPath, timeframe)
  if (discovery.first <= validation.last && validation.first <= discovery.last) {
    throw new Error(`discovery and validation manifests overlap for ${timeframe}`)
  }
  if (embargoMs > 0) {
    const gap = validation.first > discovery.last
      ? validation.first - discovery.last
      : discovery.first - validation.last
    if (gap < embargoMs) {
      throw new Error(`discovery and validation manifests violate locked holdout embargo for ${timeframe}: gap ${gap}ms is below ${embargoMs}ms`)
    }
  }
}

function holdoutEmbargoMs(input: StrategyRndCampaignHypothesisLike): number {
  const timeframe = input.timeframe || "4h"
  const bars = Math.max(
    input.maxHoldBars ?? 18,
    Number(asRecord(input.factorResearchOptions).lookback) || 0,
    Math.ceil(8 * 3_600_000 / timeframeMilliseconds(timeframe)),
  )
  return bars * timeframeMilliseconds(timeframe)
}

interface StrategyRndCampaignHypothesisLike {
  timeframe?: string
  maxHoldBars?: number
  factorResearchOptions?: unknown
}

function timeframeMilliseconds(timeframe: string): number {
  const match = timeframe.match(/^(\d+)([mhdw])$/)
  if (!match) throw new Error(`unsupported campaign timeframe: ${timeframe}`)
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[match[2]] || 0
  return Number(match[1]) * unit
}

function readManifestRange(manifestPath: string, timeframe: string): { first: number; last: number } {
  const resolvedManifestPath = resolveReadablePath(manifestPath)
  const manifest = asRecord(JSON.parse(readFileSync(resolvedManifestPath, "utf8")))
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
  const rows = readFileSync(join(dirname(resolvedManifestPath), file), "utf8").trim().split(/\r?\n/).slice(1)
  const timestamps = rows
    .map((row) => Number(row.split(",")[1]))
    .filter((timestamp) => Number.isFinite(timestamp))
  if (timestamps.length === 0) {
    throw new Error(`manifest timeframe ${timeframe} has no candles`)
  }
  return { first: Math.min(...timestamps), last: Math.max(...timestamps) }
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function asNullableRecord(value: unknown): JSONRecord | null {
  const record = asRecord(value)
  return Object.keys(record).length > 0 ? record : null
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function panelCandidateMatches(requested: string, panelCandidate: string): boolean {
  return panelCandidate === requested || requested.startsWith(`${panelCandidate}-`)
}

function requiredText(value: unknown, checkId: string): string {
  return stringField(value).length >= 8 ? "" : checkId
}

function requiredStructured(value: unknown, checkId: string): string {
  if (typeof value === "string") {
    return value.trim().length >= 8 ? "" : checkId
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? "" : checkId
  }
  if (value && typeof value === "object") {
    return Object.keys(value).length > 0 ? "" : checkId
  }
  return checkId
}
