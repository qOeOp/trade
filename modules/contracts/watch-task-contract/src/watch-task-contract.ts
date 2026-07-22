import { canonicalHash } from "../../runtime-core/src/canonical-json"

export const WATCH_TASK_DEFINITION_SCHEMA = "trade.watch-task-definition.v1" as const
export const WATCH_TASK_OBSERVATION_SCHEMA = "trade.watch-task-observation.v1" as const
export const WATCH_TASK_EVALUATION_SCHEMA = "trade.watch-task-evaluation.v1" as const

export const WATCH_TASK_STATUSES = [
  "created", "armed", "observing", "triggered", "handed_off", "completed",
  "expired", "cancelled", "blocked",
] as const
export type WatchTaskStatus = typeof WATCH_TASK_STATUSES[number]

export interface WatchTaskDefinition {
  schema_version: typeof WATCH_TASK_DEFINITION_SCHEMA
  task_id: string
  plan_ref: string
  flow_id: string
  intent_ref: string
  intent_content_hash: string
  symbol: string
  side: "long" | "short"
  source_refs: string[]
  trigger: {
    kind: "mark_price_in_range"
    low: number
    high: number
  }
  invalidation: {
    kind: "mark_price_at_or_beyond"
    operator: "lte" | "gte"
    price: number
  }
  lifetime: {
    created_at: string
    not_before: string
    deadline: string
  }
  budget: {
    poll_interval_ms: number
    max_observations: number
    max_errors: number
    max_fact_age_ms: number
  }
  idempotency_key: string
  definition_hash: string
}

export interface WatchTaskObservation {
  schema_version: typeof WATCH_TASK_OBSERVATION_SCHEMA
  observation_ref: string
  symbol: string
  observed_at: string
  source_observed_at: string
  mark_price: number
  continuity: "continuous" | "point_in_time" | "resynced" | "unknown"
}

export interface WatchTaskEvaluation {
  schema_version: typeof WATCH_TASK_EVALUATION_SCHEMA
  task_id: string
  evaluated_at: string
  outcome: "wait" | "triggered" | "expired" | "blocked"
  reason: string
  observation_ref?: string
  next_observation_count: number
  next_error_count: number
  handoff?: {
    handoff_kind: "action_intent_revalidation"
    intent_ref: string
    intent_content_hash: string
    flow_id: string
    idempotency_key: string
    observation_ref: string
    execution_authority: "none"
  }
}

export function compileWatchTaskDefinition(value: unknown): WatchTaskDefinition {
  const input = record(value, "watch_task")
  exactKeys(input, [
    "schema_version", "task_id", "plan_ref", "flow_id", "intent_ref", "intent_content_hash",
    "symbol", "side", "source_refs", "trigger", "invalidation", "lifetime", "budget",
    "idempotency_key", "definition_hash",
  ], "watch_task")
  if (input.schema_version !== WATCH_TASK_DEFINITION_SCHEMA) throw new Error("unsupported watch task definition schema")
  if (input.side !== "long" && input.side !== "short") throw new Error("side must be long or short")
  const side = input.side as WatchTaskDefinition["side"]
  const sourceRefs = stringArray(input.source_refs, "source_refs")
  const triggerInput = record(input.trigger, "trigger")
  exactKeys(triggerInput, ["kind", "low", "high"], "trigger")
  if (triggerInput.kind !== "mark_price_in_range") throw new Error("trigger kind must be mark_price_in_range")
  const low = positiveFinite(triggerInput.low, "trigger.low")
  const high = positiveFinite(triggerInput.high, "trigger.high")
  if (low > high) throw new Error("trigger.low must not exceed trigger.high")
  const invalidationInput = record(input.invalidation, "invalidation")
  exactKeys(invalidationInput, ["kind", "operator", "price"], "invalidation")
  if (invalidationInput.kind !== "mark_price_at_or_beyond") throw new Error("invalidation kind must be mark_price_at_or_beyond")
  const expectedOperator: WatchTaskDefinition["invalidation"]["operator"] = side === "long" ? "lte" : "gte"
  if (invalidationInput.operator !== expectedOperator) throw new Error(`${side} invalidation operator must be ${expectedOperator}`)
  const invalidationPrice = positiveFinite(invalidationInput.price, "invalidation.price")
  if (side === "long" && invalidationPrice >= low) throw new Error("long invalidation price must be below trigger.low")
  if (side === "short" && invalidationPrice <= high) throw new Error("short invalidation price must be above trigger.high")

  const lifetimeInput = record(input.lifetime, "lifetime")
  exactKeys(lifetimeInput, ["created_at", "not_before", "deadline"], "lifetime")
  const createdAt = iso(lifetimeInput.created_at, "lifetime.created_at")
  const notBefore = iso(lifetimeInput.not_before, "lifetime.not_before")
  const deadline = iso(lifetimeInput.deadline, "lifetime.deadline")
  const createdMs = Date.parse(createdAt)
  const notBeforeMs = Date.parse(notBefore)
  const deadlineMs = Date.parse(deadline)
  if (notBeforeMs < createdMs) throw new Error("lifetime.not_before must not precede created_at")
  if (deadlineMs <= notBeforeMs) throw new Error("lifetime.deadline must be after not_before")
  if (deadlineMs - createdMs > 86_400_000) throw new Error("watch task lifetime must not exceed 24 hours")

  const budgetInput = record(input.budget, "budget")
  exactKeys(budgetInput, ["poll_interval_ms", "max_observations", "max_errors", "max_fact_age_ms"], "budget")
  const definitionWithoutHash = {
    schema_version: WATCH_TASK_DEFINITION_SCHEMA,
    task_id: identifier(input.task_id, "task_id"),
    plan_ref: text(input.plan_ref, "plan_ref"),
    flow_id: identifier(input.flow_id, "flow_id"),
    intent_ref: text(input.intent_ref, "intent_ref"),
    intent_content_hash: hash(input.intent_content_hash, "intent_content_hash"),
    symbol: symbol(input.symbol),
    side,
    source_refs: sourceRefs,
    trigger: { kind: "mark_price_in_range" as const, low, high },
    invalidation: {
      kind: "mark_price_at_or_beyond" as const,
      operator: expectedOperator,
      price: invalidationPrice,
    },
    lifetime: { created_at: createdAt, not_before: notBefore, deadline },
    budget: {
      poll_interval_ms: integer(budgetInput.poll_interval_ms, 250, 60_000, "budget.poll_interval_ms"),
      max_observations: integer(budgetInput.max_observations, 1, 100_000, "budget.max_observations"),
      max_errors: integer(budgetInput.max_errors, 0, 1_000, "budget.max_errors"),
      max_fact_age_ms: integer(budgetInput.max_fact_age_ms, 100, 60_000, "budget.max_fact_age_ms"),
    },
    idempotency_key: identifier(input.idempotency_key, "idempotency_key"),
  }
  const definitionHash = canonicalHash(definitionWithoutHash)
  const suppliedHash = text(input.definition_hash, "definition_hash")
  if (suppliedHash !== definitionHash) throw new Error("definition_hash does not match canonical definition")
  return { ...definitionWithoutHash, definition_hash: definitionHash }
}

export function buildWatchTaskDefinition(value: Omit<WatchTaskDefinition, "schema_version" | "definition_hash">): WatchTaskDefinition {
  const input = value as Omit<WatchTaskDefinition, "schema_version" | "definition_hash"> & {
    schema_version?: unknown
    definition_hash?: unknown
  }
  const { schema_version: _schemaVersion, definition_hash: _definitionHash, ...fields } = input
  const candidate = { schema_version: WATCH_TASK_DEFINITION_SCHEMA, ...fields }
  return compileWatchTaskDefinition({ ...candidate, definition_hash: canonicalHash(candidate) })
}

export function parseWatchTaskObservation(value: unknown): WatchTaskObservation {
  const input = record(value, "observation")
  exactKeys(input, [
    "schema_version", "observation_ref", "symbol", "observed_at", "source_observed_at", "mark_price", "continuity",
  ], "observation")
  if (input.schema_version !== WATCH_TASK_OBSERVATION_SCHEMA) throw new Error("unsupported watch task observation schema")
  if (!(["continuous", "point_in_time", "resynced", "unknown"] as unknown[]).includes(input.continuity)) throw new Error("observation continuity is unsupported")
  return {
    schema_version: WATCH_TASK_OBSERVATION_SCHEMA,
    observation_ref: text(input.observation_ref, "observation_ref"),
    symbol: symbol(input.symbol),
    observed_at: iso(input.observed_at, "observed_at"),
    source_observed_at: iso(input.source_observed_at, "source_observed_at"),
    mark_price: positiveFinite(input.mark_price, "mark_price"),
    continuity: input.continuity as WatchTaskObservation["continuity"],
  }
}

export function parseWatchTaskEvaluation(value: unknown): WatchTaskEvaluation {
  const input = record(value, "evaluation")
  shapeKeys(input, [
    "schema_version", "task_id", "evaluated_at", "outcome", "reason", "observation_ref",
    "next_observation_count", "next_error_count", "handoff",
  ], [
    "schema_version", "task_id", "evaluated_at", "outcome", "reason",
    "next_observation_count", "next_error_count",
  ], "evaluation")
  if (input.schema_version !== WATCH_TASK_EVALUATION_SCHEMA) throw new Error("unsupported watch task evaluation schema")
  if (!(["wait", "triggered", "expired", "blocked"] as unknown[]).includes(input.outcome)) {
    throw new Error("watch task evaluation outcome is unsupported")
  }
  let handoff: WatchTaskEvaluation["handoff"]
  if (input.handoff !== undefined) {
    const handoffInput = record(input.handoff, "evaluation.handoff")
    exactKeys(handoffInput, [
      "handoff_kind", "intent_ref", "intent_content_hash", "flow_id", "idempotency_key",
      "observation_ref", "execution_authority",
    ], "evaluation.handoff")
    if (handoffInput.handoff_kind !== "action_intent_revalidation" || handoffInput.execution_authority !== "none") {
      throw new Error("watch task handoff authority is unsupported")
    }
    handoff = {
      handoff_kind: "action_intent_revalidation",
      intent_ref: text(handoffInput.intent_ref, "evaluation.handoff.intent_ref"),
      intent_content_hash: hash(handoffInput.intent_content_hash, "evaluation.handoff.intent_content_hash"),
      flow_id: identifier(handoffInput.flow_id, "evaluation.handoff.flow_id"),
      idempotency_key: identifier(handoffInput.idempotency_key, "evaluation.handoff.idempotency_key"),
      observation_ref: text(handoffInput.observation_ref, "evaluation.handoff.observation_ref"),
      execution_authority: "none",
    }
  }
  const outcome = input.outcome as WatchTaskEvaluation["outcome"]
  if ((outcome === "triggered") !== Boolean(handoff)) throw new Error("only triggered evaluation may carry a handoff")
  const observationRef = input.observation_ref === undefined ? undefined : text(input.observation_ref, "evaluation.observation_ref")
  if (handoff && handoff.observation_ref !== observationRef) throw new Error("watch task handoff observation ref mismatch")
  return {
    schema_version: WATCH_TASK_EVALUATION_SCHEMA,
    task_id: identifier(input.task_id, "evaluation.task_id"),
    evaluated_at: iso(input.evaluated_at, "evaluation.evaluated_at"),
    outcome,
    reason: identifier(input.reason, "evaluation.reason"),
    observation_ref: observationRef,
    next_observation_count: integer(input.next_observation_count, 0, 100_000, "evaluation.next_observation_count"),
    next_error_count: integer(input.next_error_count, 0, 1_001, "evaluation.next_error_count"),
    handoff,
  }
}

export function evaluateWatchTask(input: {
  definition: WatchTaskDefinition
  observation?: WatchTaskObservation
  now: string
  observation_count: number
  error_count: number
}): WatchTaskEvaluation {
  const definition = compileWatchTaskDefinition(input.definition)
  const now = iso(input.now, "now")
  const nowMs = Date.parse(now)
  const observationCount = integer(input.observation_count, 0, definition.budget.max_observations, "observation_count")
  const errorCount = integer(input.error_count, 0, definition.budget.max_errors + 1, "error_count")
  const base = {
    schema_version: WATCH_TASK_EVALUATION_SCHEMA,
    task_id: definition.task_id,
    evaluated_at: now,
    next_observation_count: observationCount,
    next_error_count: errorCount,
  } as const
  if (nowMs >= Date.parse(definition.lifetime.deadline)) return { ...base, outcome: "expired", reason: "deadline_reached" }
  if (nowMs < Date.parse(definition.lifetime.not_before)) return { ...base, outcome: "wait", reason: "not_before_pending" }
  if (observationCount >= definition.budget.max_observations) {
    return { ...base, outcome: "blocked", reason: "observation_budget_exhausted" }
  }
  if (!input.observation) return observationError(base, definition, "observation_unavailable")
  const observation = parseWatchTaskObservation(input.observation)
  const nextObservationCount = observationCount + 1
  const withObservation = { ...base, observation_ref: observation.observation_ref, next_observation_count: nextObservationCount }
  if (observation.symbol !== definition.symbol) return { ...withObservation, outcome: "blocked", reason: "observation_symbol_mismatch" }
  const factAgeMs = nowMs - Date.parse(observation.source_observed_at)
  if (factAgeMs < 0) return observationError(withObservation, definition, "source_time_in_future")
  if (factAgeMs > definition.budget.max_fact_age_ms) return observationError(withObservation, definition, "source_fact_stale")
  if (observation.continuity !== "continuous" && observation.continuity !== "point_in_time") {
    return observationError(withObservation, definition, "source_continuity_not_ready")
  }
  if (invalidationHit(definition, observation.mark_price)) {
    return { ...withObservation, outcome: "blocked", reason: "invalidation_hit" }
  }
  if (observation.mark_price >= definition.trigger.low && observation.mark_price <= definition.trigger.high) {
    return {
      ...withObservation,
      outcome: "triggered",
      reason: "mark_price_in_range",
      handoff: {
        handoff_kind: "action_intent_revalidation",
        intent_ref: definition.intent_ref,
        intent_content_hash: definition.intent_content_hash,
        flow_id: definition.flow_id,
        idempotency_key: definition.idempotency_key,
        observation_ref: observation.observation_ref,
        execution_authority: "none",
      },
    }
  }
  return { ...withObservation, outcome: "wait", reason: "trigger_not_satisfied" }
}

function observationError(
  base: Omit<WatchTaskEvaluation, "outcome" | "reason">,
  definition: WatchTaskDefinition,
  reason: string,
): WatchTaskEvaluation {
  const nextErrorCount = base.next_error_count + 1
  return nextErrorCount > definition.budget.max_errors
    ? { ...base, next_error_count: nextErrorCount, outcome: "blocked", reason: "error_budget_exhausted" }
    : { ...base, next_error_count: nextErrorCount, outcome: "wait", reason }
}

function invalidationHit(definition: WatchTaskDefinition, markPrice: number): boolean {
  return definition.invalidation.operator === "lte"
    ? markPrice <= definition.invalidation.price
    : markPrice >= definition.invalidation.price
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: string[], field: string): void {
  const expected = new Set(allowed)
  const unknown = Object.keys(value).filter((key) => !expected.has(key))
  const missing = allowed.filter((key) => !Object.hasOwn(value, key))
  if (unknown.length > 0) throw new Error(`${field} does not allow: ${unknown.sort().join(", ")}`)
  if (missing.length > 0) throw new Error(`${field} is missing: ${missing.join(", ")}`)
}

function shapeKeys(value: Record<string, unknown>, allowed: string[], required: string[], field: string): void {
  const expected = new Set(allowed)
  const unknown = Object.keys(value).filter((key) => !expected.has(key))
  const missing = required.filter((key) => !Object.hasOwn(value, key))
  if (unknown.length > 0) throw new Error(`${field} does not allow: ${unknown.sort().join(", ")}`)
  if (missing.length > 0) throw new Error(`${field} is missing: ${missing.join(", ")}`)
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value || value.trim() !== value || /[\n\r\0]/.test(value)) {
    throw new Error(`${field} must be a non-empty trimmed string`)
  }
  return value
}

function identifier(value: unknown, field: string): string {
  const result = text(value, field)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(result)) throw new Error(`${field} is invalid`)
  return result
}

function hash(value: unknown, field: string): string {
  const result = text(value, field)
  if (result.length < 8 || result.length > 256) throw new Error(`${field} is invalid`)
  return result
}

function symbol(value: unknown): string {
  const result = text(value, "symbol")
  if (!/^[A-Z0-9]{5,20}$/.test(result)) throw new Error("symbol is invalid")
  return result
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) throw new Error(`${field} must be a non-empty bounded array`)
  const result = value.map((item) => text(item, field))
  if (new Set(result).size !== result.length) throw new Error(`${field} must not contain duplicates`)
  return result
}

function iso(value: unknown, field: string): string {
  const result = text(value, field)
  const millis = Date.parse(result)
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== result) throw new Error(`${field} must be canonical UTC ISO`)
  return result
}

function positiveFinite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${field} must be positive and finite`)
  return value
}

function integer(value: unknown, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`)
  }
  return Number(value)
}
