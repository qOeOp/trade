import { canonicalHash } from "../../../../contracts/runtime-core/src/canonical-json"
import { asRecord, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import {
  compileWatchTaskDefinition,
  evaluateWatchTask,
  parseWatchTaskObservation,
  type WatchTaskDefinition,
  type WatchTaskObservation,
} from "../../../../contracts/watch-task-contract/src/watch-task-contract"
import {
  evaluatePreflight,
  type PreflightInput,
  type PreflightOutput,
} from "../../../../contracts/preflight-contract/src/preflight"
import {
  evaluateTriggerCondition,
  type ExecutionGateResult,
} from "../../../execution-gate/src/lib/execution-gate"

export interface WatchHandoffRevalidationInput {
  definition: unknown
  handoff: unknown
  current_observation: unknown
  preflight: PreflightInput
  now: string
}

export interface WatchHandoffRevalidationResult {
  schema_version: "trade.watch-handoff-revalidation.v1"
  receipt_ref: string
  task_id: string
  status: "revalidation_passed" | "blocked"
  reason: string
  execution_gate: ExecutionGateResult
  preflight?: PreflightOutput
  evidence: {
    plan_ref: string
    intent_ref: string
    intent_content_hash: string
    original_observation_ref: string
    current_observation_ref: string
    evaluated_at: string
  }
  execution_authority: "none"
  next_step: "requires_separate_execution_authorization" | "stop"
}

interface RevalidationDependencies {
  executionGate(input: JSONRecord): ExecutionGateResult
  preflight(input: PreflightInput): PreflightOutput
}

const defaultDependencies: RevalidationDependencies = {
  executionGate: evaluateTriggerCondition,
  preflight: evaluatePreflight,
}

export function revalidateWatchHandoff(
  input: WatchHandoffRevalidationInput,
  dependencies: RevalidationDependencies = defaultDependencies,
): WatchHandoffRevalidationResult {
  const definition = compileWatchTaskDefinition(input.definition)
  const handoff = parseHandoff(input.handoff, definition)
  const observation = parseWatchTaskObservation(input.current_observation)
  const now = canonicalIso(input.now, "now")
  assertPlanIdentity(input.preflight.plan, definition)

  const watchEvaluation = evaluateWatchTask({
    definition,
    observation,
    now,
    observation_count: 0,
    error_count: 0,
  })
  const executionGate = dependencies.executionGate({
    trigger_condition: {
      price_in_range: [definition.trigger.low, definition.trigger.high],
      valid_until_at: definition.lifetime.deadline,
    },
    current_mark: observation.mark_price,
    now,
  })
  const evidence = {
    plan_ref: definition.plan_ref,
    intent_ref: handoff.intent_ref,
    intent_content_hash: handoff.intent_content_hash,
    original_observation_ref: handoff.observation_ref,
    current_observation_ref: observation.observation_ref,
    evaluated_at: now,
  }

  if (watchEvaluation.outcome !== "triggered") {
    return result(definition, evidence, executionGate, undefined, "blocked", watchEvaluation.reason)
  }
  if (executionGate.status !== "ready") {
    return result(definition, evidence, executionGate, undefined, "blocked", executionGate.reason)
  }
  const preflight = dependencies.preflight({ ...input.preflight, now })
  if (preflight.verdict !== "armable") {
    return result(definition, evidence, executionGate, preflight, "blocked", `preflight_${preflight.verdict}`)
  }
  return result(definition, evidence, executionGate, preflight, "revalidation_passed", "all_revalidation_gates_passed")
}

function result(
  definition: WatchTaskDefinition,
  evidence: WatchHandoffRevalidationResult["evidence"],
  executionGate: ExecutionGateResult,
  preflight: PreflightOutput | undefined,
  status: WatchHandoffRevalidationResult["status"],
  reason: string,
): WatchHandoffRevalidationResult {
  const receiptHash = canonicalHash({
    schema_version: "trade.watch-handoff-revalidation.v1",
    task_id: definition.task_id,
    status,
    reason,
    execution_gate: executionGate,
    preflight,
    evidence,
    execution_authority: "none",
  })
  return {
    schema_version: "trade.watch-handoff-revalidation.v1",
    receipt_ref: `watch-revalidation:${receiptHash}`,
    task_id: definition.task_id,
    status,
    reason,
    execution_gate: executionGate,
    preflight,
    evidence,
    execution_authority: "none",
    next_step: status === "revalidation_passed" ? "requires_separate_execution_authorization" : "stop",
  }
}

function parseHandoff(value: unknown, definition: WatchTaskDefinition): {
  intent_ref: string
  intent_content_hash: string
  flow_id: string
  idempotency_key: string
  observation_ref: string
} {
  const input = asRecord(value)
  exactKeys(input, [
    "handoff_kind", "intent_ref", "intent_content_hash", "flow_id", "idempotency_key",
    "observation_ref", "execution_authority",
  ], "handoff")
  if (input.handoff_kind !== "action_intent_revalidation" || input.execution_authority !== "none") {
    throw new Error("watch handoff kind or authority is unsupported")
  }
  const parsed = {
    intent_ref: requiredText(input.intent_ref, "handoff.intent_ref"),
    intent_content_hash: requiredText(input.intent_content_hash, "handoff.intent_content_hash"),
    flow_id: requiredText(input.flow_id, "handoff.flow_id"),
    idempotency_key: requiredText(input.idempotency_key, "handoff.idempotency_key"),
    observation_ref: requiredText(input.observation_ref, "handoff.observation_ref"),
  }
  if (parsed.intent_ref !== definition.intent_ref
    || parsed.intent_content_hash !== definition.intent_content_hash
    || parsed.flow_id !== definition.flow_id
    || parsed.idempotency_key !== definition.idempotency_key) {
    throw new Error("watch handoff identity drifted")
  }
  return parsed
}

function assertPlanIdentity(planValue: unknown, definition: WatchTaskDefinition): void {
  const plan = asRecord(planValue)
  if (plan.schema_version !== "trade-plan-draft.v1") throw new Error("preflight plan schema is unsupported")
  if (stringField(plan.plan_ref) !== definition.plan_ref) throw new Error("preflight plan_ref drifted")
  if (stringField(plan.content_hash) !== definition.intent_content_hash) throw new Error("preflight plan content hash drifted")
  if (stringField(plan.symbol) !== definition.symbol || stringField(plan.side) !== definition.side) {
    throw new Error("preflight plan symbol/side drifted")
  }
}

function exactKeys(value: JSONRecord, allowed: string[], field: string): void {
  const expected = new Set(allowed)
  const unknown = Object.keys(value).filter((key) => !expected.has(key))
  const missing = allowed.filter((key) => !Object.hasOwn(value, key))
  if (unknown.length > 0) throw new Error(`${field} does not allow: ${unknown.sort().join(", ")}`)
  if (missing.length > 0) throw new Error(`${field} is missing: ${missing.join(", ")}`)
}

function requiredText(value: unknown, field: string): string {
  const text = stringField(value)
  if (!text || text.trim() !== text || /[\n\r\0]/.test(text)) throw new Error(`${field} must be a non-empty trimmed string`)
  return text
}

function canonicalIso(value: unknown, field: string): string {
  const text = requiredText(value, field)
  const millis = Date.parse(text)
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== text) throw new Error(`${field} must be canonical UTC ISO`)
  return text
}

export type { RevalidationDependencies, WatchTaskObservation }
