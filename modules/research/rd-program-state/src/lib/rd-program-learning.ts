import type { JSONRecord } from "./json"
import type { RdProgramState, RdProgramStateUpdateInput } from "./rd-program-types"

function advanceHypothesisQueue(existing: JSONRecord[], completedIds: string[], followups: JSONRecord[]): JSONRecord[] {
  const completed = new Set(completedIds.map(safeID).filter(Boolean))
  const remaining = existing.map(asRecord).filter((item) => !hypothesisMatchesAny(item, completed))
  return appendUniqueHypotheses(remaining, followups.map(asRecord).filter((item) => Object.keys(item).length > 0))
}

function updateInputFromResearchResult(state: RdProgramState, result: JSONRecord, now?: string): RdProgramStateUpdateInput {
  if (stringField(result.run_id) && asRecord(result.batch).batch_id !== undefined) {
    return updateInputFromLoopReport(state, result, now)
  }
  if (stringField(result.campaign_id)) {
    return updateInputFromCampaignReport(state, result, now)
  }
  return {
    now,
    artifactRefs: [stringField(result.artifact_ref)].filter(Boolean),
  }
}

function updateInputFromStrategyReview(report: JSONRecord, now?: string): RdProgramStateUpdateInput {
  const gate = asRecord(report.gate)
  const diagnostics = asRecord(report.diagnostics)
  const failureAttribution = array(diagnostics.failure_attribution).map(asRecord)
  const blockedBy = array(gate.blocked_by).map(asRecord)
  return {
    now,
    status: gate.shadow_candidate === true ? "shadow_candidate_found" : undefined,
    latestFailureSummary: blockedBy.length === 0 ? null : {
      primary_failure_area: stringField(failureAttribution[0]?.area) || "strategy_review_gate",
      top_blockers: blockedBy.map((item) => ({
        check_id: stringField(item.check_id),
        reason: stringField(item.reason),
      })).filter((item) => item.check_id),
      next_system_actions: failureAttribution.map((item) => stringField(item.next_action)).filter(Boolean),
    },
    latestReliabilityGate: {
      source: "strategy_review",
      strategy_id: stringField(report.strategy_id),
      status: gate.shadow_candidate === true ? "candidate_ready" : "blocked",
      shadow_candidate: gate.shadow_candidate === true,
      live_small_candidate: gate.live_small_candidate === true,
      blocked_by: blockedBy,
    },
    rejectedMechanisms: failureAttribution.map((item) => ({
      source: "strategy_review",
      area: stringField(item.area),
      count: nonNegativeInteger(item.count),
      check_ids: array(item.check_ids).map(String).filter(Boolean),
      next_action: stringField(item.next_action),
    })).filter((item) => item.area),
    universeLessons: [{
      source: "strategy_review",
      strategy_id: stringField(report.strategy_id),
      status: stringField(report.status),
      decay: asRecord(diagnostics.decay),
      cost_model_feedback: asRecord(diagnostics.cost_model_feedback),
      qualification: asRecord(diagnostics.qualification),
    }],
    artifactRefs: [stringField(report.strategy_path)].filter(Boolean),
  }
}

function updateInputFromLoopReport(state: RdProgramState, report: JSONRecord, now?: string): RdProgramStateUpdateInput {
  const batch = asRecord(report.batch)
  const failureSummary = nullableRecord(batch.failure_summary)
  const reliabilityGate = nullableRecord(batch.reliability_gate)
  const completedHypothesisIds = completedHypothesisIdsFromLoop(state, report)
  return {
    now: now || stringField(report.created_at) || undefined,
    usageDelta: {
      hypotheses_run: 1,
      trials_used: nonNegativeInteger(batch.trial_count),
      locked_holdout_uses: stringField(asRecord(report.ledger_record).holdout_key) ? 1 : 0,
    },
    latestFailureSummary: failureSummary,
    latestReliabilityGate: reliabilityGate,
    rejectedMechanisms: rejectedMechanismsFromLoop(batch),
    universeLessons: universeLessonsFromLoop(batch),
    completedHypothesisIds,
    followupHypotheses: followupHypothesesFromLoop(state, report, completedHypothesisIds),
    artifactRefs: [stringField(report.artifact_ref)].filter(Boolean),
  }
}

function updateInputFromCampaignReport(state: RdProgramState, report: JSONRecord, now?: string): RdProgramStateUpdateInput {
  const stopReason = stringField(report.stop_reason)
  const candidate = asRecord(report.validated_candidate)
  const foundCandidate = Object.keys(candidate).length > 0
  const completedHypothesisIds = completedHypothesisIdsFromCampaign(report)
  const failureSummary = campaignFailureSummary(report)
  return {
    now: now || stringField(report.created_at) || undefined,
    status: foundCandidate || stopReason === "validated_candidate_found" ? "shadow_candidate_found" : undefined,
    usageDelta: {
      hypotheses_run: nonNegativeInteger(report.hypotheses_run),
      trials_used: nonNegativeInteger(report.trials_used),
      locked_holdout_uses: nonNegativeInteger(report.holdout_evaluations),
    },
    latestFailureSummary: foundCandidate ? null : failureSummary || {
      primary_failure_area: stopReason || "campaign_stopped",
      stop_reason: stopReason,
      next_system_actions: campaignNextActions(stopReason),
    },
    latestReliabilityGate: {
      status: foundCandidate ? "candidate_ready" : "blocked",
      stop_reason: stopReason,
      validated_candidate: foundCandidate ? candidate : null,
    },
    rejectedMechanisms: rejectedMechanismsFromCampaign(report),
    universeLessons: universeLessonsFromCampaign(report),
    completedHypothesisIds,
    followupHypotheses: foundCandidate ? [] : followupHypothesesFromCampaign(state, report, completedHypothesisIds, failureSummary),
    artifactRefs: [
      stringField(report.artifact_ref),
      ...array(report.runs).map(asRecord).flatMap((run) => [
        stringField(run.discovery_run_ref),
        stringField(run.validation_run_ref),
      ]),
    ].filter(Boolean),
  }
}

function appendUniqueHypotheses(existing: JSONRecord[], incoming: JSONRecord[]): JSONRecord[] {
  const seen = new Set(existing.map(hypothesisDedupeKey))
  const merged = [...existing]
  for (const item of incoming) {
    const key = hypothesisDedupeKey(item)
    if (!seen.has(key)) {
      seen.add(key)
      merged.push(item)
    }
  }
  return merged
}

function hypothesisDedupeKey(hypothesis: JSONRecord): string {
  return [
    hypothesisID(hypothesis),
    stringField(hypothesis.mode),
    stringField(hypothesis.manifest_path) || stringField(hypothesis.discovery_manifest_path),
    stringField(hypothesis.validation_manifest_path),
    stringField(hypothesis.predecessor_hypothesis_id),
  ].join("|")
}

function hypothesisMatchesAny(hypothesis: JSONRecord, completed: Set<string>): boolean {
  for (const id of hypothesisIdentitySet(hypothesis)) {
    if (completed.has(safeID(id))) return true
  }
  return false
}

function hypothesisIdentitySet(hypothesis: JSONRecord): string[] {
  return [
    hypothesisID(hypothesis),
    stringField(hypothesis.id),
    stringField(hypothesis.batch_id),
    stringField(hypothesis.run_id),
    stringField(hypothesis.campaign_id),
  ].filter(Boolean)
}

function completedHypothesisIdsFromLoop(state: RdProgramState, report: JSONRecord): string[] {
  const batch = asRecord(report.batch)
  const explicit = [
    stringField(report.hypothesis_id),
    stringField(batch.hypothesis_id),
    stringField(batch.batch_id),
    stringField(report.run_id),
  ].filter(Boolean)
  const matched = state.next_hypothesis_queue
    .map(asRecord)
    .filter((item) => explicit.some((id) => hypothesisIdentitySet(item).includes(id) || plannedLoopBatchId(state, item) === id))
    .map(hypothesisID)
  return Array.from(new Set([...explicit, ...matched].map(safeID).filter(Boolean)))
}

function completedHypothesisIdsFromCampaign(report: JSONRecord): string[] {
  return Array.from(new Set([
    ...array(report.runs).map(asRecord).map((run) => stringField(run.hypothesis_id)),
    ...array(report.hypothesis_certificates).map(asRecord).map((gate) => stringField(gate.hypothesis_id)),
  ].map(safeID).filter(Boolean)))
}

function followupHypothesesFromLoop(state: RdProgramState, report: JSONRecord, completedIds: string[]): JSONRecord[] {
  const batch = asRecord(report.batch)
  const source = sourceHypothesis(state, completedIds)
  if (!source) return []
  const winner = nullableRecord(batch.winner)
  if (winner) {
    return validationFollowupFromWinner(state, source, winner)
  }
  return diagnosticFollowupsFromFailure(state, source, nullableRecord(batch.failure_summary), "strategy_rnd_loop")
}

function followupHypothesesFromCampaign(state: RdProgramState, report: JSONRecord, completedIds: string[], failureSummary: JSONRecord | null): JSONRecord[] {
  const source = sourceHypothesis(state, completedIds)
  if (!source) return []
  const stopReason = stringField(report.stop_reason)
  if (stopReason === "locked_holdout_failed") {
    return [learningFollowup(state, source, "fresh-holdout", "Reject the frozen mechanism; test a distinct mechanism on discovery data before any new locked holdout.", {
      source: "strategy_rnd_campaign",
      previous_stop_reason: stopReason,
      mode: "loop",
      anti_overfit_stage: "selection_validation",
    })]
  }
  if (stopReason === "hypothesis_certificate_failed") {
    return [learningFollowup(state, source, "certificate-rewrite", "Rewrite the behavioral hypothesis certificate before spending validation budget.", {
      source: "strategy_rnd_campaign",
      previous_stop_reason: stopReason,
      mode: "loop",
      diagnostic_mode: true,
    })]
  }
  return diagnosticFollowupsFromFailure(state, source, failureSummary || nullableRecord(asRecord(report).latest_failure_summary), "strategy_rnd_campaign")
}

function validationFollowupFromWinner(state: RdProgramState, source: JSONRecord, winner: JSONRecord): JSONRecord[] {
  const validationManifest = stringField(source.validation_manifest_path)
  if (!validationManifest) return []
  const predecessorId = hypothesisID(source)
  const candidateId = stringField(winner.candidate_id) || "winner"
  return [compactRecord({
    hypothesis_id: `${predecessorId}-validate-${safeID(candidateId)}`,
    predecessor_hypothesis_id: predecessorId,
    source: "rd_learning_memory",
    mode: "campaign",
    hypothesis: `Validate frozen candidate ${candidateId} from ${predecessorId} on locked external data.`,
    discovery_manifest_path: stringField(source.discovery_manifest_path) || stringField(source.manifest_path),
    validation_manifest_path: validationManifest,
    validation_indicator_report_path: stringField(source.validation_indicator_report_path),
    timeframe: stringField(source.timeframe),
    max_total_trials: 1,
    search_trial_count: 1,
    fee_bps: optionalNumber(source.fee_bps),
    slippage_bps: optionalNumber(source.slippage_bps),
    funding_bps_per_8h: optionalNumber(source.funding_bps_per_8h),
    thesis_certificate: asRecord(source.thesis_certificate),
    candidates: [{
      candidate_id: `${candidateId}-frozen-validation`,
      description: stringField(winner.description),
      family: stringField(winner.family),
      parameter_count: optionalPositiveNumber(winner.parameter_count),
      params: asRecord(winner.params),
    }],
    generated_from: {
      program_id: state.program_id,
      predecessor_hypothesis_id: predecessorId,
      reason: "discovery_candidate_found",
    },
  })]
}

function diagnosticFollowupsFromFailure(state: RdProgramState, source: JSONRecord, failureSummary: JSONRecord | null, failureSource: string): JSONRecord[] {
  const actions = array(asRecord(failureSummary).next_system_actions).map(String).filter(Boolean)
  const blockers = array(asRecord(failureSummary).top_blockers).map(asRecord)
  const action = actions[0] || blockerAction(blockers[0]) || "Open a constrained diagnostic hypothesis from the latest failed mechanism."
  if (requiresDifferentMechanism(action)) {
    return [blockedFollowup(state, source, failureSourceId(blockers[0], failureSource), action, failureSummary, failureSource, {
      blockedReason: "previous result rejected this setup mechanism; provide a distinct predeclared market edge before consuming more trial budget",
      requiredNextStep: "predeclare_distinct_market_edge",
    })]
  }
  if (requiresPredeclaredRevision(action)) {
    return [blockedFollowup(state, source, failureSourceId(blockers[0], failureSource), action, failureSummary, failureSource, {
      blockedReason: "previous result requires a predeclared candidate revision before consuming more trial budget",
      requiredNextStep: "predeclare_candidate_revision",
    })]
  }
  if (isRepeatedCostDiagnostic(source, failureSummary, action)) {
    return [blockedFollowup(state, source, failureSourceId(blockers[0], failureSource), action, failureSummary, failureSource, {
      blockedReason: "cost diagnostic already ran; review cost model assumptions or predeclare a lower-turnover revision before spending more trial budget",
      requiredNextStep: "review_cost_model_or_predeclare_cost_reduction",
    })]
  }
  if (requiresDifferentResearchSurface(action)) {
    return [blockedFollowup(state, source, failureSourceId(blockers[0], failureSource), action, failureSummary, failureSource, {
      blockedReason: "previous result requires a different research surface before consuming more single-asset loop budget",
      requiredNextStep: "move_to_panel_or_expand_independent_validation",
    })]
  }
  if (isDiagnosticHypothesis(source)) {
    return [blockedFollowup(state, source, failureSourceId(blockers[0], failureSource), action, failureSummary, failureSource, {
      blockedReason: "diagnostic follow-up already ran; predeclare a new mechanism or research surface before consuming more trial budget",
      requiredNextStep: "predeclare_new_mechanism_or_research_surface",
    })]
  }
  return [learningFollowup(state, source, failureSourceId(blockers[0], failureSource), action, {
    source: failureSource,
    previous_failure_summary: failureSummary || {},
    mode: "loop",
    diagnostic_mode: true,
  })]
}

function learningFollowup(state: RdProgramState, source: JSONRecord, suffix: string, hypothesis: string, extra: JSONRecord): JSONRecord {
  const predecessorId = hypothesisID(source)
  return compactRecord({
    ...source,
    hypothesis_id: `${predecessorId}-${safeID(suffix)}`,
    predecessor_hypothesis_id: predecessorId,
    hypothesis,
    mode: "loop",
    validation_manifest_path: undefined,
    validation_indicator_report_path: undefined,
    max_total_trials: undefined,
    search_trial_count: boundedTrials(source.search_trial_count, Math.max(1, state.budget.max_trials_total - state.usage.trials_used)),
    generated_from: {
      program_id: state.program_id,
      predecessor_hypothesis_id: predecessorId,
      ...extra,
    },
    ...extra,
    source: "rd_learning_memory",
  })
}

function blockedFollowup(
  state: RdProgramState,
  source: JSONRecord,
  suffix: string,
  hypothesis: string,
  failureSummary: JSONRecord | null,
  failureSource: string,
  input: { blockedReason: string; requiredNextStep: string },
): JSONRecord {
  const predecessorId = hypothesisID(source)
  return compactRecord({
    hypothesis_id: `${predecessorId}-${safeID(suffix)}-needs-new-mechanism`,
    predecessor_hypothesis_id: predecessorId,
    source: "rd_learning_memory",
    ready: false,
    blocked_reason: input.blockedReason,
    hypothesis,
    generated_from: {
      program_id: state.program_id,
      predecessor_hypothesis_id: predecessorId,
      source: failureSource,
      previous_failure_summary: failureSummary || {},
      required_next_step: input.requiredNextStep,
    },
    previous_failure_summary: failureSummary || {},
  })
}

function blockerAction(blocker: JSONRecord | undefined): string {
  const checkId = stringField(blocker?.check_id)
  if (checkId === "RND-NEGATIVE-CONTROL-NOT-BEATEN") return "Redesign the mechanism so it beats side-flip and entry-lag negative controls before validation."
  if (checkId === "RND-COST-DRAG") return "Reduce churn and retest only cost-robust variants of the mechanism."
  if (checkId === "RND-STAT-PBO") return "Reduce selection complexity and retest a simpler mechanism with lower parameter pressure."
  return ""
}

function failureSourceId(blocker: JSONRecord | undefined, fallback: string): string {
  return stringField(blocker?.check_id) || fallback
}

function requiresDifferentMechanism(action: string): boolean {
  const normalized = action.toLowerCase()
  return normalized.includes("reject this setup mechanism") ||
    normalized.includes("reject mild positive edge") ||
    normalized.includes("predeclare a different market edge")
}

function requiresPredeclaredRevision(action: string): boolean {
  const normalized = action.toLowerCase()
  return normalized.includes("redesign") || normalized.includes("rewrite") || normalized.includes("predeclare")
}

function requiresDifferentResearchSurface(action: string): boolean {
  const normalized = action.toLowerCase()
  return normalized.includes("move this hypothesis to panel") ||
    normalized.includes("expand independent validation") ||
    normalized.includes("stop candidate selection") ||
    normalized.includes("stop this hypothesis batch")
}

function isDiagnosticHypothesis(source: JSONRecord): boolean {
  return source.diagnostic_mode === true || asRecord(source.generated_from).diagnostic_mode === true
}

function isRepeatedCostDiagnostic(source: JSONRecord, failureSummary: JSONRecord | null, action: string): boolean {
  const primary = stringField(asRecord(failureSummary).primary_failure_area)
  const normalizedAction = action.toLowerCase()
  return isDiagnosticHypothesis(source) && (
    primary === "execution_cost" ||
    normalizedAction.includes("audit turnover") ||
    normalizedAction.includes("fee tier") ||
    normalizedAction.includes("cost")
  )
}

function sourceHypothesis(state: RdProgramState, completedIds: string[]): JSONRecord | null {
  const completed = new Set(completedIds.map(safeID).filter(Boolean))
  return state.next_hypothesis_queue.map(asRecord).find((item) => hypothesisMatchesAny(item, completed)) || null
}

function campaignFailureSummary(report: JSONRecord): JSONRecord | null {
  const runs = array(report.runs).map(asRecord).reverse()
  for (const run of runs) {
    const summary = nullableRecord(run.discovery_failure_summary)
    if (summary && Object.keys(summary).length > 0) return summary
  }
  return null
}

function plannedLoopBatchId(state: RdProgramState, hypothesis: JSONRecord): string {
  return stringField(hypothesis.batch_id) || `${state.program_id}-${hypothesisID(hypothesis)}`
}

function rejectedMechanismsFromLoop(batch: JSONRecord): JSONRecord[] {
  const failureSummary = asRecord(batch.failure_summary)
  return array(failureSummary.top_blockers).map(asRecord).map((blocker) => ({
    source: "strategy_rnd_loop",
    check_id: stringField(blocker.check_id),
    count: nonNegativeInteger(blocker.count),
    primary_failure_area: stringField(failureSummary.primary_failure_area),
  })).filter((item) => item.check_id)
}

function universeLessonsFromLoop(batch: JSONRecord): JSONRecord[] {
  return [{
    source: "strategy_rnd_loop",
    batch_id: stringField(batch.batch_id),
    hypothesis: stringField(batch.hypothesis),
    outcome: stringField(batch.outcome),
    candidate_source: stringField(batch.candidate_source),
    trial_count: nonNegativeInteger(batch.trial_count),
    accepted_count: nonNegativeInteger(batch.accepted_count),
    next_action: stringField(batch.next_action),
  }]
}

function rejectedMechanismsFromCampaign(report: JSONRecord): JSONRecord[] {
  const stopReason = stringField(report.stop_reason)
  const rejected: JSONRecord[] = []
  if (stopReason && stopReason !== "validated_candidate_found") {
    rejected.push({
      source: "strategy_rnd_campaign",
      stop_reason: stopReason,
      outcome: stringField(report.outcome),
    })
  }
  const calibrationGate = asRecord(report.calibration_gate)
  if (calibrationGate.blocked === true) {
    rejected.push({
      source: "strategy_rnd_campaign",
      stop_reason: "calibration_failed",
      blocked_by: array(calibrationGate.blocked_by).map(String).filter(Boolean),
    })
  }
  for (const gate of array(report.hypothesis_certificates).map(asRecord)) {
    if (gate.accepted === false) {
      rejected.push({
        source: "strategy_rnd_campaign",
        hypothesis_id: stringField(gate.hypothesis_id),
        stop_reason: "hypothesis_certificate_failed",
        blocked_by: array(gate.blocked_by).map(String).filter(Boolean),
      })
    }
  }
  return rejected
}

function universeLessonsFromCampaign(report: JSONRecord): JSONRecord[] {
  return [{
    source: "strategy_rnd_campaign",
    campaign_id: stringField(report.campaign_id),
    outcome: stringField(report.outcome),
    stop_reason: stringField(report.stop_reason),
    trial_budget: nonNegativeInteger(report.trial_budget),
    trials_used: nonNegativeInteger(report.trials_used),
    hypotheses_run: nonNegativeInteger(report.hypotheses_run),
    holdout_evaluations: nonNegativeInteger(report.holdout_evaluations),
  }]
}

function campaignNextActions(stopReason: string): string[] {
  if (stopReason === "calibration_failed") return ["Fix calibration blockers before running more R&D trials."]
  if (stopReason === "hypothesis_certificate_failed") return ["Rewrite the hypothesis certificate before consuming trial budget."]
  if (stopReason === "panel_negative_control_failed") return ["Inspect panel negative control failure before drafting strategy policy."]
  if (stopReason === "locked_holdout_failed") return ["Reject the frozen mechanism and open a new hypothesis with a fresh holdout."]
  if (stopReason === "trial_budget_exhausted") return ["Stop campaign; review rejected mechanisms before allocating a new budget."]
  return ["Review campaign stop reason before scheduling the next hypothesis."]
}

function compactRecord(record: JSONRecord): JSONRecord {
  for (const [key, value] of Object.entries(record)) {
    if (
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && value.length === 0) ||
      (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value as JSONRecord).length === 0)
    ) {
      delete record[key]
    }
  }
  return record
}

function hypothesisID(hypothesis: JSONRecord): string {
  return safeID(stringField(hypothesis.hypothesis_id) || stringField(hypothesis.id) || "h1")
}

function boundedTrials(value: unknown, remaining: number): number {
  const parsed = Number(value)
  const requested = Number.isInteger(parsed) && parsed > 0 ? parsed : remaining
  return Math.max(1, Math.min(10, requested, Math.max(1, remaining)))
}

function optionalNumber(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function optionalPositiveNumber(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function nullableRecord(value: unknown): JSONRecord | null {
  return value === null || value === undefined ? null : asRecord(value)
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

function nonNegativeInteger(value: unknown): number {
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 ? number : 0
}

function safeID(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "rd-program"
}

export {
  advanceHypothesisQueue,
  updateInputFromResearchResult,
  updateInputFromStrategyReview,
}
