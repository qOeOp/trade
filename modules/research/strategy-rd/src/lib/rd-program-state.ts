import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { defaultCatalogDbPathForGeneratedPath, registerCatalogArtifact } from "./data-catalog"
import { advanceHypothesisQueue, updateInputFromResearchResult, updateInputFromStrategyReview } from "./rd-program-learning"
import { buildRdSupervisorNextPlan } from "./rd-program-planner"
import { displayPath, resolveReadablePath } from "./paths"
import type { JSONRecord } from "./json"
import type { RdProgramBudget, RdProgramState, RdProgramStateCommandResult, RdProgramStateUpdateInput, RdProgramStatus, RdProgramUsage } from "./rd-program-types"

interface CreateRdProgramStateInput {
  programId?: string
  objective: string
  now?: string
  budget?: Partial<RdProgramBudget>
  nextHypothesisQueue?: JSONRecord[]
}

interface RdProgramStateCommandInput {
  path: string
  input: JSONRecord
  catalogDbPath?: string
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

function updateRdProgramStateFromResearchResult(state: RdProgramState, result: JSONRecord, now?: string): RdProgramState {
  return updateRdProgramState(state, updateInputFromResearchResult(state, result, now))
}

function updateRdProgramStateFromStrategyReview(state: RdProgramState, report: JSONRecord, now?: string): RdProgramState {
  return updateRdProgramState(state, updateInputFromStrategyReview(report, now))
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
    max_hypotheses: positiveInteger(asRecord(input).max_hypotheses, 20),
    max_trials_total: positiveInteger(asRecord(input).max_trials_total, 80),
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
