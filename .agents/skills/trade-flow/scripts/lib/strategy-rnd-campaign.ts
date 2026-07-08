import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { assertHoldoutUnused, holdoutKeyForInput, safeFileName, writeJsonFile } from "./strategy-rnd-ledger"
import type { JSONRecord } from "./json"
import type { StrategyRndCampaignInput, StrategyRndLoopInput } from "./strategy-rnd-inputs"

export interface StrategyRndCampaignReport {
  campaign_id: string
  created_at: string
  artifact_ref: string
  ledger_ref: string
  outcome: "validated_candidate_found" | "no_validated_candidate"
  stop_reason: "validated_candidate_found" | "hypothesis_queue_exhausted" | "trial_budget_exhausted" | "locked_holdout_failed" | "calibration_failed" | "panel_null_failed"
  calibration_gate: JSONRecord | null
  panel_report_ref: string | null
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
    panel_null_gate: JSONRecord | null
    validation_run_ref: string | null
    validation_outcome: "candidate_found" | "no_promote" | null
  }>
}

export interface StrategyRndCampaignLoopResult {
  artifact_ref: string
  batch: {
    outcome: "candidate_found" | "no_promote"
    trial_count: number
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
    const trialCount = deps.resolveCandidateCount(hypothesis)
    if (trialsUsed + trialCount > trialBudget) {
      stopReason = "trial_budget_exhausted"
      break
    }
    ensureNonOverlappingManifests(
      hypothesis.manifestPath,
      hypothesis.validationManifestPath,
      hypothesis.timeframe || "4h",
    )

    const discovery = deps.runLoop({
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
      panel_null_gate: null,
      validation_run_ref: null,
      validation_outcome: null,
    }
    runs.push(runSummary)
    if (!discovery.batch.winner) {
      continue
    }

    const winner = discovery.batch.winner
    const panelNullGate = input.panelReportPath ? readPanelNullGate(input.panelReportPath, winner.candidate_id) : null
    runSummary.panel_null_gate = panelNullGate
    if (panelNullGate?.blocked === true) {
      stopReason = "panel_null_failed"
      break
    }
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
    const validation = deps.runLoop({
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
      parameterStability: asRecord(asRecord(asRecord(winner.replay).assumptions).robustness).parameter_stability as JSONRecord,
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
    panel_report_ref: input.panelReportPath ?? null,
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

export function readPanelNullGate(path: string, candidateId: string): JSONRecord {
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
  const panelNull = asRecord(candidate.panel_null_controls)
  const status = stringField(panelNull.status)
  const blockedBy = [...gateBlocks]
  if (status !== "evaluated") {
    blockedBy.push("PANEL-ASSET-SHUFFLE-NOT-EVALUATED")
  } else if (panelNull.passed !== true) {
    blockedBy.push("PANEL-ASSET-SHUFFLE")
  }
  return {
    report_ref: path,
    candidate_id: stringField(candidate.candidate_id),
    requested_candidate_id: candidateId,
    status,
    blocked: blockedBy.length > 0,
    blocked_by: Array.from(new Set(blockedBy)),
    panel_null_controls: panelNull,
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

export function ensureNonOverlappingManifests(discoveryPath: string, validationPath: string, timeframe: string): void {
  const discovery = readManifestRange(discoveryPath, timeframe)
  const validation = readManifestRange(validationPath, timeframe)
  if (discovery.first <= validation.last && validation.first <= discovery.last) {
    throw new Error(`discovery and validation manifests overlap for ${timeframe}`)
  }
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

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
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
