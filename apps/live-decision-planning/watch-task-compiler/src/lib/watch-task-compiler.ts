import {
  buildWatchTaskDefinition,
  type WatchTaskDefinition,
} from "../../../../contracts/watch-task-contract/src/watch-task-contract"

export interface WatchTaskCompileInput {
  task_id: string
  flow_id: string
  plan: unknown
  action_intent: unknown
  market_source_ref: string
  trigger_low: number
  trigger_high: number
  invalidation_price: number
  created_at: string
  not_before: string
  deadline: string
  poll_interval_ms: number
  max_observations: number
  max_errors: number
  max_fact_age_ms: number
  idempotency_key: string
}

export function compilePlanWatchTask(input: WatchTaskCompileInput): WatchTaskDefinition {
  const plan = record(input.plan, "plan")
  if (plan.schema_version !== "trade-plan-draft.v1") throw new Error("plan schema must be trade-plan-draft.v1")
  const intent = record(input.action_intent, "action_intent")
  if (intent.schema_version !== "trade.protocol.action-intent-ref.v1") throw new Error("action intent schema is unsupported")
  if (intent.intent_kind !== "trade_plan" || intent.status !== "proposed") {
    throw new Error("action intent must be a proposed trade_plan")
  }
  const planRef = text(plan.plan_ref, "plan.plan_ref")
  const planHash = text(plan.content_hash, "plan.content_hash")
  const intentHash = text(intent.content_hash, "action_intent.content_hash")
  if (planHash !== intentHash) throw new Error("plan and action intent content hash mismatch")
  const symbol = text(plan.symbol, "plan.symbol")
  const side = plan.side
  if (side !== "long" && side !== "short") throw new Error("plan side must be long or short")
  if (intent.symbol !== symbol || intent.side !== side) throw new Error("plan and action intent symbol/side mismatch")
  const intentSources = stringArray(intent.source_refs, "action_intent.source_refs")
  if (!intentSources.includes(planRef)) throw new Error("action intent source refs must include plan_ref")
  const planSources = stringArray(plan.source_refs, "plan.source_refs")
  const planExpiry = optionalIso(plan.expires_at, "plan.expires_at")
  const intentExpiry = optionalIso(intent.expires_at, "action_intent.expires_at")
  const deadline = canonicalIso(input.deadline, "deadline")
  if (planExpiry && Date.parse(deadline) > Date.parse(planExpiry)) throw new Error("watch deadline exceeds plan expiry")
  if (intentExpiry && Date.parse(deadline) > Date.parse(intentExpiry)) throw new Error("watch deadline exceeds action intent expiry")
  return buildWatchTaskDefinition({
    task_id: input.task_id,
    plan_ref: planRef,
    flow_id: input.flow_id,
    intent_ref: text(intent.intent_ref, "action_intent.intent_ref"),
    intent_content_hash: intentHash,
    symbol,
    side,
    source_refs: unique([planRef, ...planSources, ...intentSources, text(input.market_source_ref, "market_source_ref")]),
    trigger: { kind: "mark_price_in_range", low: input.trigger_low, high: input.trigger_high },
    invalidation: {
      kind: "mark_price_at_or_beyond",
      operator: side === "long" ? "lte" : "gte",
      price: input.invalidation_price,
    },
    lifetime: {
      created_at: canonicalIso(input.created_at, "created_at"),
      not_before: canonicalIso(input.not_before, "not_before"),
      deadline,
    },
    budget: {
      poll_interval_ms: input.poll_interval_ms,
      max_observations: input.max_observations,
      max_errors: input.max_errors,
      max_fact_age_ms: input.max_fact_age_ms,
    },
    idempotency_key: input.idempotency_key,
  })
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value || value.trim() !== value || /[\n\r\0]/.test(value)) {
    throw new Error(`${field} must be a non-empty trimmed string`)
  }
  return value
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${field} must be a non-empty array`)
  return value.map((item) => text(item, field))
}

function canonicalIso(value: unknown, field: string): string {
  const result = text(value, field)
  const millis = Date.parse(result)
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== result) throw new Error(`${field} must be canonical UTC ISO`)
  return result
}

function optionalIso(value: unknown, field: string): string {
  return value === undefined || value === null || value === "" ? "" : canonicalIso(value, field)
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
