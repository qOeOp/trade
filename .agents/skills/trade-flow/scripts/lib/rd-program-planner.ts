import type { JSONRecord } from "./json"
import type { RdProgramBudget, RdProgramState, RdSupervisorNextPlan } from "./rd-program-types"

function buildRdSupervisorNextPlan(state: RdProgramState, statePath: string, input: JSONRecord = {}): RdSupervisorNextPlan {
  const now = normalizeDate(stringField(input.now) || undefined)
  const remaining = budgetRemaining(state)
  const base = {
    schema_version: "trade-flow.rd-supervisor-next-plan.v1" as const,
    plan_id: stringField(input.plan_id) || `rd-next-${state.program_id}-${now.replace(/[^0-9]/g, "").slice(0, 14)}`,
    created_at: now,
    selected_hypothesis: null,
    scout_subagent_plan: buildScoutSubagentPlan(state, statePath, null),
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
    scout_subagent_plan: buildScoutSubagentPlan(state, statePath, hypothesis),
  }
}

function buildScoutSubagentPlan(state: RdProgramState, statePath: string, hypothesis: JSONRecord | null): JSONRecord {
  const hypothesisId = hypothesis ? hypothesisID(hypothesis) : ""
  return {
    schema_version: "trade-flow.rd-scout-subagent-plan.v1",
    enabled: state.status === "active" && hypothesis !== null,
    dispatch_timing: "before_research_command",
    execution_model: "supervisor_fanout_readonly_scouts_then_single_writer_research_run",
    state_ref: statePath,
    selected_hypothesis_id: hypothesisId || null,
    single_writer_rule: "Scouts are read-only. Only strategy-rd-supervisor may execute the R&D command or write rd_program_state.",
    scouts: [
      {
        role: "rd-history-scout",
        agent_type: "explorer",
        purpose: "Summarize rejected mechanisms, latest blockers, artifact refs, and avoid-list before spending new trials.",
        inputs: ["rd_program_state.rejected_mechanisms", "rd_program_state.latest_failure_summary", "rd_program_state.artifact_refs"],
        required_output: "history_constraints",
        may_write_files: false,
        may_write_state: false,
      },
      {
        role: "rd-data-scout",
        agent_type: "explorer",
        purpose: "Verify manifests, feature reports, split boundaries, indicator factor availability, and catalog references.",
        inputs: ["selected_hypothesis.manifest_path", "selected_hypothesis.validation_manifest_path", "selected_hypothesis.indicator_report_path", "catalog_db_path"],
        required_output: "data_readiness_report",
        may_write_files: false,
        may_write_state: false,
      },
      {
        role: "rd-edge-scout",
        agent_type: "explorer",
        purpose: "Challenge the behavioral edge, propose falsification checks, and suggest distinct follow-up edge directions if this one fails.",
        inputs: ["selected_hypothesis.hypothesis", "selected_hypothesis.thesis_certificate", "rd_program_state.universe_lessons"],
        required_output: "edge_review",
        may_write_files: false,
        may_write_state: false,
      },
    ],
  }
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

function hypothesisReady(hypothesis: JSONRecord): boolean {
  if (Object.keys(hypothesis).length === 0) return false
  if (hypothesis.ready === false) return false
  if (stringField(hypothesis.blocked_reason)) return false
  return true
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

function normalizeDate(value: unknown): string {
  const date = value ? new Date(String(value)) : new Date()
  if (!Number.isFinite(date.getTime())) {
    throw new Error("rd program planner date must be valid")
  }
  return date.toISOString()
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

function safeID(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "rd-program"
}

export {
  buildRdSupervisorNextPlan,
}
