import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { defaultCatalogDbPathForGeneratedPath, registerCatalogArtifact } from "./data-catalog"
import { displayPath, resolveReadablePath } from "./paths"
import type { JSONRecord } from "./json"

type RdProgramStatus = "active" | "shadow_candidate_found" | "budget_exhausted" | "data_or_tool_blocked" | "paused"

interface RdProgramBudget {
  max_hypotheses: number
  max_trials_total: number
  max_locked_holdout_uses: number
}

interface RdProgramUsage {
  hypotheses_run: number
  trials_used: number
  locked_holdout_uses: number
}

interface RdProgramState {
  schema_version: "trade-flow.rd-program-state.v1"
  program_id: string
  objective: string
  status: RdProgramStatus
  created_at: string
  updated_at: string
  budget: RdProgramBudget
  usage: RdProgramUsage
  stop_conditions: ["shadow_candidate_found", "budget_exhausted", "data_or_tool_blocked"]
  latest_failure_summary: JSONRecord | null
  latest_reliability_gate: JSONRecord | null
  rejected_mechanisms: JSONRecord[]
  universe_lessons: JSONRecord[]
  next_hypothesis_queue: JSONRecord[]
  artifact_refs: string[]
  guardrails: {
    may_write_trade_db: false
    may_call_binance_write: false
    evidence_status: "research_memory_not_strategy_evidence"
  }
}

interface CreateRdProgramStateInput {
  programId?: string
  objective: string
  now?: string
  budget?: Partial<RdProgramBudget>
  nextHypothesisQueue?: JSONRecord[]
}

interface RdProgramStateUpdateInput {
  now?: string
  status?: RdProgramStatus
  usageDelta?: Partial<RdProgramUsage>
  latestFailureSummary?: JSONRecord | null
  latestReliabilityGate?: JSONRecord | null
  rejectedMechanisms?: JSONRecord[]
  universeLessons?: JSONRecord[]
  completedHypothesisIds?: string[]
  followupHypotheses?: JSONRecord[]
  nextHypothesisQueue?: JSONRecord[]
  artifactRefs?: string[]
}

interface RdProgramStateCommandInput {
  path: string
  input: JSONRecord
  catalogDbPath?: string
}

interface RdProgramStateCommandResult {
  schema_version: "trade-flow.rd-program-state-result.v1"
  action: "init" | "read" | "update" | "plan_next"
  state_ref: string
  catalog_db_path?: string
  artifact_id?: string
  state: RdProgramState
  goal: JSONRecord
  next_plan?: RdSupervisorNextPlan
}

interface RdSupervisorNextPlan {
  schema_version: "trade-flow.rd-supervisor-next-plan.v1"
  plan_id: string
  created_at: string
  status: "ready" | "blocked" | "stopped"
  reason: string
  command: string | null
  payload: JSONRecord | null
  selected_hypothesis: JSONRecord | null
  budget_remaining: RdProgramBudget
  guardrails: {
    read_only_plan: true
    may_write_trade_db: false
    may_call_binance_write: false
    requires_explicit_execution: true
  }
}

function createRdProgramState(input: CreateRdProgramStateInput): RdProgramState {
  const now = normalizeDate(input.now)
  const budget = normalizeBudget(input.budget)
  return {
    schema_version: "trade-flow.rd-program-state.v1",
    program_id: safeID(input.programId || "rd-program"),
    objective: requiredText(input.objective, "rd program objective is required"),
    status: "active",
    created_at: now,
    updated_at: now,
    budget,
    usage: {
      hypotheses_run: 0,
      trials_used: 0,
      locked_holdout_uses: 0,
    },
    stop_conditions: ["shadow_candidate_found", "budget_exhausted", "data_or_tool_blocked"],
    latest_failure_summary: null,
    latest_reliability_gate: null,
    rejected_mechanisms: [],
    universe_lessons: [],
    next_hypothesis_queue: input.nextHypothesisQueue || [],
    artifact_refs: [],
    guardrails: {
      may_write_trade_db: false,
      may_call_binance_write: false,
      evidence_status: "research_memory_not_strategy_evidence",
    },
  }
}

function updateRdProgramState(state: RdProgramState, input: RdProgramStateUpdateInput): RdProgramState {
  const nextHypothesisQueue = input.nextHypothesisQueue ?? advanceHypothesisQueue(
    state.next_hypothesis_queue,
    input.completedHypothesisIds || [],
    input.followupHypotheses || [],
  )
  const updated: RdProgramState = {
    ...state,
    updated_at: normalizeDate(input.now),
    usage: {
      hypotheses_run: state.usage.hypotheses_run + nonNegativeInteger(input.usageDelta?.hypotheses_run),
      trials_used: state.usage.trials_used + nonNegativeInteger(input.usageDelta?.trials_used),
      locked_holdout_uses: state.usage.locked_holdout_uses + nonNegativeInteger(input.usageDelta?.locked_holdout_uses),
    },
    latest_failure_summary: input.latestFailureSummary === undefined ? state.latest_failure_summary : input.latestFailureSummary,
    latest_reliability_gate: input.latestReliabilityGate === undefined ? state.latest_reliability_gate : input.latestReliabilityGate,
    rejected_mechanisms: appendUniqueObjects(state.rejected_mechanisms, input.rejectedMechanisms || []),
    universe_lessons: appendUniqueObjects(state.universe_lessons, input.universeLessons || []),
    next_hypothesis_queue: nextHypothesisQueue,
    artifact_refs: appendUniqueStrings(state.artifact_refs, input.artifactRefs || []),
  }
  updated.status = input.status || statusAfterBudget(updated)
  return updated
}

function rdProgramGoalFromState(state: RdProgramState): JSONRecord {
  return {
    objective: state.objective,
    status: state.status,
    budget: state.budget,
    usage: state.usage,
    stop_conditions: state.stop_conditions,
    latest_failure_summary: state.latest_failure_summary,
    latest_reliability_gate: state.latest_reliability_gate,
    rejected_mechanisms: state.rejected_mechanisms,
    universe_lessons: state.universe_lessons,
    next_hypothesis_queue: state.next_hypothesis_queue,
    artifact_refs: state.artifact_refs,
  }
}

function readRdProgramState(path: string): RdProgramState {
  return normalizeRdProgramState(JSON.parse(readFileSync(resolveReadablePath(path), "utf8")))
}

function writeRdProgramState(path: string, state: RdProgramState, catalogDbPath?: string): { path: string; catalog_db_path: string; artifact_id: string } {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`)
  const registered = registerCatalogArtifact({
    catalogDbPath: catalogDbPath || defaultCatalogDbPathForGeneratedPath(path),
    path,
    now: state.updated_at,
    referrerType: "rd_program",
    referrerID: state.program_id,
    role: "state",
  })
  return {
    path: displayPath(path),
    catalog_db_path: registered.catalog_db_path,
    artifact_id: registered.artifact_id,
  }
}

function runRdProgramStateCommand(input: RdProgramStateCommandInput): RdProgramStateCommandResult {
  const action = readAction(input.input.action)
  if (!input.path) {
    throw new Error("--rd-program-state requires --state")
  }
  if (action === "init") {
    const state = createRdProgramState({
      programId: stringField(input.input.program_id) || undefined,
      objective: requiredText(input.input.objective, "rd program init requires objective"),
      now: stringField(input.input.now) || undefined,
      budget: asRecord(input.input.budget),
      nextHypothesisQueue: array(input.input.next_hypothesis_queue).map(asRecord),
    })
    const write = writeRdProgramState(input.path, state, input.catalogDbPath)
    return commandResult("init", write.path, state, write)
  }
  if (action === "read") {
    const state = readRdProgramState(input.path)
    return commandResult("read", displayPath(input.path), state)
  }
  if (action === "plan_next") {
    const state = readRdProgramState(input.path)
    return {
      ...commandResult("plan_next", displayPath(input.path), state),
      next_plan: buildRdSupervisorNextPlan(state, input.path, input.input),
    }
  }
  const state = updateRdProgramState(readRdProgramState(input.path), updateInputFromJson(input.input))
  const write = writeRdProgramState(input.path, state, input.catalogDbPath)
  return commandResult("update", write.path, state, write)
}

function buildRdSupervisorNextPlan(state: RdProgramState, statePath: string, input: JSONRecord = {}): RdSupervisorNextPlan {
  const now = normalizeDate(stringField(input.now) || undefined)
  const remaining = budgetRemaining(state)
  const base = {
    schema_version: "trade-flow.rd-supervisor-next-plan.v1" as const,
    plan_id: stringField(input.plan_id) || `rd-next-${state.program_id}-${now.replace(/[^0-9]/g, "").slice(0, 14)}`,
    created_at: now,
    selected_hypothesis: null,
    budget_remaining: remaining,
    guardrails: {
      read_only_plan: true as const,
      may_write_trade_db: false as const,
      may_call_binance_write: false as const,
      requires_explicit_execution: true as const,
    },
  }
  if (state.status !== "active") {
    return { ...base, status: "stopped", reason: `rd_program_state status is ${state.status}`, command: null, payload: null }
  }
  if (remaining.max_hypotheses <= 0 || remaining.max_trials_total <= 0 || remaining.max_locked_holdout_uses <= 0) {
    return { ...base, status: "stopped", reason: "rd program budget is exhausted", command: null, payload: null }
  }
  const hypothesis = state.next_hypothesis_queue.map(asRecord).find((item) => hypothesisReady(item))
  if (!hypothesis) {
    const hasBlockedQueue = state.next_hypothesis_queue.length > 0
    return {
      ...base,
      status: "blocked",
      reason: hasBlockedQueue ? "next_hypothesis_queue has no ready hypothesis" : "next_hypothesis_queue is empty",
      command: null,
      payload: null,
    }
  }
  const mode = stringField(hypothesis.mode)
  const useLoop = mode === "loop" || (!stringField(hypothesis.validation_manifest_path) && !stringField(hypothesis.validationManifestPath))
  const payload = useLoop
    ? loopPayloadFromHypothesis(state, statePath, hypothesis, input, now, remaining)
    : campaignPayloadFromHypothesis(state, statePath, hypothesis, input, now, remaining)
  return {
    ...base,
    status: "ready",
    reason: useLoop ? "next hypothesis can run as one R&D loop" : "next hypothesis can run as one R&D campaign",
    command: useLoop ? "--strategy-rnd-loop" : "--strategy-rnd-campaign",
    payload,
    selected_hypothesis: hypothesis,
  }
}

function updateRdProgramStateFromResearchResult(state: RdProgramState, result: JSONRecord, now?: string): RdProgramState {
  if (stringField(result.run_id) && asRecord(result.batch).batch_id !== undefined) {
    return updateRdProgramState(state, updateInputFromLoopReport(state, result, now))
  }
  if (stringField(result.campaign_id)) {
    return updateRdProgramState(state, updateInputFromCampaignReport(state, result, now))
  }
  return updateRdProgramState(state, {
    now,
    artifactRefs: [stringField(result.artifact_ref)].filter(Boolean),
  })
}

function updateRdProgramStateFromStrategyReview(state: RdProgramState, report: JSONRecord, now?: string): RdProgramState {
  const gate = asRecord(report.gate)
  const diagnostics = asRecord(report.diagnostics)
  const failureAttribution = array(diagnostics.failure_attribution).map(asRecord)
  const blockedBy = array(gate.blocked_by).map(asRecord)
  return updateRdProgramState(state, {
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
  })
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

function normalizeRdProgramState(raw: unknown): RdProgramState {
  const input = asRecord(raw)
  const createdAt = stringField(input.created_at) || new Date(0).toISOString()
  const budget = normalizeBudget(asRecord(input.budget))
  const usage = asRecord(input.usage)
  return {
    schema_version: "trade-flow.rd-program-state.v1",
    program_id: requiredText(stringField(input.program_id), "rd program state requires program_id"),
    objective: requiredText(stringField(input.objective), "rd program state requires objective"),
    status: readStatus(input.status),
    created_at: createdAt,
    updated_at: stringField(input.updated_at) || createdAt,
    budget,
    usage: {
      hypotheses_run: nonNegativeInteger(usage.hypotheses_run),
      trials_used: nonNegativeInteger(usage.trials_used),
      locked_holdout_uses: nonNegativeInteger(usage.locked_holdout_uses),
    },
    stop_conditions: ["shadow_candidate_found", "budget_exhausted", "data_or_tool_blocked"],
    latest_failure_summary: nullableRecord(input.latest_failure_summary),
    latest_reliability_gate: nullableRecord(input.latest_reliability_gate),
    rejected_mechanisms: array(input.rejected_mechanisms).map(asRecord),
    universe_lessons: array(input.universe_lessons).map(asRecord),
    next_hypothesis_queue: array(input.next_hypothesis_queue).map(asRecord),
    artifact_refs: array(input.artifact_refs).map(String).filter(Boolean),
    guardrails: {
      may_write_trade_db: false,
      may_call_binance_write: false,
      evidence_status: "research_memory_not_strategy_evidence",
    },
  }
}

function statusAfterBudget(state: RdProgramState): RdProgramStatus {
  if (
    state.usage.hypotheses_run >= state.budget.max_hypotheses ||
    state.usage.trials_used >= state.budget.max_trials_total ||
    state.usage.locked_holdout_uses >= state.budget.max_locked_holdout_uses
  ) {
    return "budget_exhausted"
  }
  return state.status
}

function budgetRemaining(state: RdProgramState): RdProgramBudget {
  return {
    max_hypotheses: Math.max(0, state.budget.max_hypotheses - state.usage.hypotheses_run),
    max_trials_total: Math.max(0, state.budget.max_trials_total - state.usage.trials_used),
    max_locked_holdout_uses: Math.max(0, state.budget.max_locked_holdout_uses - state.usage.locked_holdout_uses),
  }
}

function loopPayloadFromHypothesis(state: RdProgramState, statePath: string, hypothesis: JSONRecord, input: JSONRecord, now: string, remaining: RdProgramBudget): JSONRecord {
  const hypothesisId = hypothesisID(hypothesis)
  return compactRecord({
    run_id: stringField(hypothesis.run_id) || `${state.program_id}-${hypothesisId}-${now.replace(/[^0-9]/g, "").slice(0, 14)}`,
    batch_id: stringField(hypothesis.batch_id) || `${state.program_id}-${hypothesisId}`,
    hypothesis: stringField(hypothesis.hypothesis) || state.objective,
    manifest_path: stringField(hypothesis.manifest_path) || stringField(hypothesis.discovery_manifest_path),
    rd_program_state_path: statePath,
    now,
    max_total_trials: undefined,
    ...sharedRndPayloadFields(hypothesis, input, remaining),
  })
}

function campaignPayloadFromHypothesis(state: RdProgramState, statePath: string, hypothesis: JSONRecord, input: JSONRecord, now: string, remaining: RdProgramBudget): JSONRecord {
  const hypothesisId = hypothesisID(hypothesis)
  return compactRecord({
    campaign_id: stringField(hypothesis.campaign_id) || `${state.program_id}-${hypothesisId}-${now.replace(/[^0-9]/g, "").slice(0, 14)}`,
    max_total_trials: boundedTrials(hypothesis.max_total_trials ?? input.max_total_trials, remaining.max_trials_total),
    artifact_root: stringField(hypothesis.artifact_root) || stringField(input.artifact_root),
    ledger_path: stringField(hypothesis.ledger_path) || stringField(input.ledger_path),
    catalog_db_path: stringField(hypothesis.catalog_db_path) || stringField(input.catalog_db_path),
    calibration_report_path: stringField(hypothesis.calibration_report_path) || stringField(input.calibration_report_path),
    panel_report_path: stringField(hypothesis.panel_report_path) || stringField(input.panel_report_path),
    rd_program_state_path: statePath,
    now,
    hypotheses: [compactRecord({
      hypothesis_id: hypothesisId,
      thesis_certificate: asRecord(hypothesis.thesis_certificate),
      discovery_manifest_path: stringField(hypothesis.discovery_manifest_path) || stringField(hypothesis.manifest_path),
      validation_manifest_path: stringField(hypothesis.validation_manifest_path),
      validation_indicator_report_path: stringField(hypothesis.validation_indicator_report_path),
      hypothesis: stringField(hypothesis.hypothesis) || state.objective,
      ...sharedRndPayloadFields(hypothesis, input, remaining),
    })],
  })
}

function sharedRndPayloadFields(hypothesis: JSONRecord, input: JSONRecord, remaining: RdProgramBudget): JSONRecord {
  const searchTrialCount = boundedTrials(hypothesis.search_trial_count ?? input.search_trial_count, remaining.max_trials_total)
  return compactRecord({
    timeframe: stringField(hypothesis.timeframe) || stringField(input.timeframe),
    max_hold_bars: optionalPositiveNumber(hypothesis.max_hold_bars ?? input.max_hold_bars),
    fee_bps: optionalNumber(hypothesis.fee_bps ?? input.fee_bps),
    slippage_bps: optionalNumber(hypothesis.slippage_bps ?? input.slippage_bps),
    funding_bps_per_8h: optionalNumber(hypothesis.funding_bps_per_8h ?? input.funding_bps_per_8h),
    oos_split: optionalNumber(hypothesis.oos_split ?? input.oos_split),
    indicator_report_path: stringField(hypothesis.indicator_report_path) || stringField(input.indicator_report_path),
    factor_compose: optionalBoolean(hypothesis.factor_compose ?? input.factor_compose),
    factor_discover: optionalBoolean(hypothesis.factor_discover ?? input.factor_discover),
    factor_research_options: optionalRecord(hypothesis.factor_research_options ?? input.factor_research_options),
    factor_seeds: optionalArray(hypothesis.factor_seeds ?? input.factor_seeds),
    max_factors_per_candidate: optionalPositiveNumber(hypothesis.max_factors_per_candidate ?? input.max_factors_per_candidate),
    diagnostic_mode: optionalBoolean(hypothesis.diagnostic_mode ?? input.diagnostic_mode),
    anti_overfit_stage: stringField(hypothesis.anti_overfit_stage) || stringField(input.anti_overfit_stage),
    parameter_stability: optionalRecord(hypothesis.parameter_stability),
    search_trial_count: searchTrialCount,
    candidates: array(hypothesis.candidates).map(asRecord).slice(0, searchTrialCount),
  })
}

function advanceHypothesisQueue(existing: JSONRecord[], completedIds: string[], followups: JSONRecord[]): JSONRecord[] {
  const completed = new Set(completedIds.map(safeID).filter(Boolean))
  const remaining = existing.map(asRecord).filter((item) => !hypothesisMatchesAny(item, completed))
  return appendUniqueHypotheses(remaining, followups.map(asRecord).filter((item) => Object.keys(item).length > 0))
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

function hypothesisReady(hypothesis: JSONRecord): boolean {
  if (Object.keys(hypothesis).length === 0) return false
  if (hypothesis.ready === false) return false
  if (stringField(hypothesis.blocked_reason)) return false
  return true
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
    return [blockedDifferentMechanismFollowup(state, source, failureSourceId(blockers[0], failureSource), action, failureSummary, failureSource)]
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

function blockedDifferentMechanismFollowup(state: RdProgramState, source: JSONRecord, suffix: string, hypothesis: string, failureSummary: JSONRecord | null, failureSource: string): JSONRecord {
  const predecessorId = hypothesisID(source)
  return compactRecord({
    hypothesis_id: `${predecessorId}-${safeID(suffix)}-needs-new-mechanism`,
    predecessor_hypothesis_id: predecessorId,
    source: "rd_learning_memory",
    ready: false,
    blocked_reason: "previous result rejected this setup mechanism; provide a distinct predeclared market edge before consuming more trial budget",
    hypothesis,
    generated_from: {
      program_id: state.program_id,
      predecessor_hypothesis_id: predecessorId,
      source: failureSource,
      previous_failure_summary: failureSummary || {},
      required_next_step: "predeclare_distinct_market_edge",
    },
    previous_failure_summary: failureSummary || {},
  })
}

function blockerAction(blocker: JSONRecord | undefined): string {
  const checkId = stringField(blocker?.check_id)
  if (checkId === "RND-NULL-NOT-BEATEN") return "Redesign the mechanism so it beats side-flip and entry-lag null controls before validation."
  if (checkId === "RND-COST-DRAG") return "Reduce churn and retest only cost-robust variants of the mechanism."
  if (checkId === "RND-STAT-PBO") return "Reduce selection complexity and retest a simpler mechanism with lower parameter pressure."
  return ""
}

function failureSourceId(blocker: JSONRecord | undefined, fallback: string): string {
  return stringField(blocker?.check_id) || fallback
}

function requiresDifferentMechanism(action: string): boolean {
  const normalized = action.toLowerCase()
  return normalized.includes("reject this setup mechanism") || normalized.includes("predeclare a different market edge")
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

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function optionalRecord(value: unknown): JSONRecord | undefined {
  const record = asRecord(value)
  return Object.keys(record).length > 0 ? record : undefined
}

function optionalArray(value: unknown): unknown[] | undefined {
  const items = array(value)
  return items.length > 0 ? items : undefined
}

function commandResult(
  action: RdProgramStateCommandResult["action"],
  stateRef: string,
  state: RdProgramState,
  write?: { catalog_db_path: string; artifact_id: string },
): RdProgramStateCommandResult {
  return {
    schema_version: "trade-flow.rd-program-state-result.v1",
    action,
    state_ref: stateRef,
    ...(write ? { catalog_db_path: write.catalog_db_path, artifact_id: write.artifact_id } : {}),
    state,
    goal: rdProgramGoalFromState(state),
  }
}

function updateInputFromJson(input: JSONRecord): RdProgramStateUpdateInput {
  return {
    now: stringField(input.now) || undefined,
    status: readOptionalStatus(input.status),
    usageDelta: usageDeltaFromJson(input.usage_delta),
    latestFailureSummary: input.latest_failure_summary === undefined ? undefined : nullableRecord(input.latest_failure_summary),
    latestReliabilityGate: input.latest_reliability_gate === undefined ? undefined : nullableRecord(input.latest_reliability_gate),
    rejectedMechanisms: array(input.rejected_mechanisms).map(asRecord),
    universeLessons: array(input.universe_lessons).map(asRecord),
    completedHypothesisIds: array(input.completed_hypothesis_ids).map(String).filter(Boolean),
    followupHypotheses: array(input.followup_hypotheses).map(asRecord),
    nextHypothesisQueue: input.next_hypothesis_queue === undefined ? undefined : array(input.next_hypothesis_queue).map(asRecord),
    artifactRefs: array(input.artifact_refs).map(String).filter(Boolean),
  }
}

function usageDeltaFromJson(value: unknown): Partial<RdProgramUsage> {
  const input = asRecord(value)
  return {
    hypotheses_run: nonNegativeInteger(input.hypotheses_run),
    trials_used: nonNegativeInteger(input.trials_used),
    locked_holdout_uses: nonNegativeInteger(input.locked_holdout_uses),
  }
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
  if (stopReason === "panel_null_failed") return ["Inspect panel null failure before drafting strategy policy."]
  if (stopReason === "locked_holdout_failed") return ["Reject the frozen mechanism and open a new hypothesis with a fresh holdout."]
  if (stopReason === "trial_budget_exhausted") return ["Stop campaign; review rejected mechanisms before allocating a new budget."]
  return ["Review campaign stop reason before scheduling the next hypothesis."]
}

function readAction(value: unknown): RdProgramStateCommandResult["action"] {
  const action = stringField(value) || "read"
  if (action === "init" || action === "read" || action === "update" || action === "plan_next") {
    return action
  }
  throw new Error("rd program state action must be init, read, update, or plan_next")
}

function readOptionalStatus(value: unknown): RdProgramStatus | undefined {
  const status = stringField(value)
  if (!status) return undefined
  if (status === "active" || status === "shadow_candidate_found" || status === "budget_exhausted" || status === "data_or_tool_blocked" || status === "paused") {
    return status
  }
  throw new Error("rd program state status is invalid")
}

function normalizeBudget(input: Partial<RdProgramBudget> | JSONRecord | undefined): RdProgramBudget {
  return {
    max_hypotheses: positiveInteger(asRecord(input).max_hypotheses, 5),
    max_trials_total: positiveInteger(asRecord(input).max_trials_total, 30),
    max_locked_holdout_uses: positiveInteger(asRecord(input).max_locked_holdout_uses, 1),
  }
}

function appendUniqueObjects(existing: JSONRecord[], incoming: JSONRecord[]): JSONRecord[] {
  const seen = new Set(existing.map((item) => JSON.stringify(item)))
  const merged = [...existing]
  for (const item of incoming) {
    const key = JSON.stringify(item)
    if (!seen.has(key)) {
      seen.add(key)
      merged.push(item)
    }
  }
  return merged
}

function appendUniqueStrings(existing: string[], incoming: string[]): string[] {
  return Array.from(new Set([...existing, ...incoming.filter(Boolean)])).sort()
}

function normalizeDate(value: unknown): string {
  const date = value ? new Date(String(value)) : new Date()
  if (!Number.isFinite(date.getTime())) {
    throw new Error("rd program state date must be valid")
  }
  return date.toISOString()
}

function readStatus(value: unknown): RdProgramStatus {
  return value === "shadow_candidate_found" || value === "budget_exhausted" || value === "data_or_tool_blocked" || value === "paused" ? value : "active"
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

function requiredText(value: unknown, message: string): string {
  const text = stringField(value)
  if (!text) throw new Error(message)
  return text
}

function positiveInteger(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

function nonNegativeInteger(value: unknown): number {
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 ? number : 0
}

function safeID(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "rd-program"
}

export {
  createRdProgramState,
  normalizeRdProgramState,
  rdProgramGoalFromState,
  readRdProgramState,
  runRdProgramStateCommand,
  updateRdProgramState,
  updateRdProgramStateFromResearchResult,
  updateRdProgramStateFromStrategyReview,
  writeRdProgramState,
  type RdProgramState,
  type RdProgramStateCommandResult,
  type RdProgramStateUpdateInput,
}
