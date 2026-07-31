import { Database } from "bun:sqlite"
import { asRecord, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"

export const PLAN_EVENT_KINDS = ["observe", "order_fill", "review"] as const
export type EventKind = typeof PLAN_EVENT_KINDS[number]
export const REVIEW_OUTCOMES = ["win", "loss", "breakeven", "scratch"] as const

export interface PlanEvent {
  event_key: string
  chain_id: string
  kind: EventKind
  body_json: JSONRecord
  created_at: string
}

export function ensureSchema(db: Database): void {
  configureEventStoreConnection(db)
  db.run(`
    CREATE TABLE IF NOT EXISTS plan_event (
      event_key   TEXT PRIMARY KEY,
      chain_id    TEXT NOT NULL,
      kind        TEXT NOT NULL CHECK(kind IN ('observe', 'order_fill', 'review')),
      body_json   TEXT NOT NULL CHECK(json_valid(body_json)),
      created_at  TEXT NOT NULL
    )
  `)
  db.run("CREATE INDEX IF NOT EXISTS idx_chain_time ON plan_event(chain_id, created_at)")
  db.run("CREATE INDEX IF NOT EXISTS idx_kind_chain ON plan_event(kind, chain_id)")
  db.run("CREATE INDEX IF NOT EXISTS idx_obs_symbol ON plan_event(json_extract(body_json, '$.symbol')) WHERE kind = 'observe'")
}

export function configureEventStoreConnection(db: Database): void {
  db.run("PRAGMA busy_timeout = 5000")
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA synchronous = NORMAL")
}

export function appendPlanEvent(db: Database, event: PlanEvent): void {
  validatePlanEvent(event)
  db.query(`
    INSERT INTO plan_event(event_key, chain_id, kind, body_json, created_at)
    VALUES ($event_key, $chain_id, $kind, $body_json, $created_at)
  `).run({
    $event_key: event.event_key,
    $chain_id: event.chain_id,
    $kind: event.kind,
    $body_json: JSON.stringify(event.body_json),
    $created_at: event.created_at,
  })
}

export function buildOrderFillEvent(input: JSONRecord): PlanEvent {
  const body = asRecord(input.body_json ?? input.body)
  const chainId = stringField(input.chain_id) || stringField(body.chain_id)
  const eventKey = stringField(input.event_key) || crypto.randomUUID()
  const created_at = stringField(input.created_at) || new Date().toISOString()

  return {
    event_key: eventKey,
    chain_id: chainId,
    kind: "order_fill",
    body_json: body,
    created_at,
  }
}

export function buildReviewEvent(input: JSONRecord): PlanEvent {
  const body = asRecord(input.body_json ?? input.body ?? input)
  const chainId = stringField(input.chain_id) || stringField(body.chain_id)
  const eventKey = stringField(input.event_key) || crypto.randomUUID()
  const created_at = stringField(input.created_at) || stringField(body.created_at) || new Date().toISOString()
  validateStrategyReviewBody(body)
  return {
    event_key: eventKey,
    chain_id: chainId,
    kind: "review",
    body_json: body,
    created_at,
  }
}

export function validatePlanEvent(event: PlanEvent): void {
  if (!event.event_key) {
    throw new Error("event_key is required")
  }
  if (!event.chain_id) {
    throw new Error("chain_id is required")
  }
  if (!PLAN_EVENT_KINDS.includes(event.kind)) {
    throw new Error(`unsupported event kind: ${event.kind}`)
  }
  if (!event.created_at) {
    throw new Error("created_at is required")
  }
  if (event.kind === "order_fill") {
    validateOrderFill(event.body_json)
  }
  if (event.kind === "review") {
    validateReview(event.body_json)
  }
}

export function validateOrderFill(body: JSONRecord): void {
  const source = stringField(body.source)
  if (!source) {
    throw new Error("order_fill.source is required")
  }
  if (source === "trade_flow") {
    if (!stringField(body.source_observe_event_key)) {
      throw new Error("order_fill.source_observe_event_key is required for source=trade_flow")
    }
    const contractSnapshot = body.execution_contract_snapshot
    const actionSnapshot = body.execution_action_snapshot
    if (
      (!contractSnapshot || typeof contractSnapshot !== "object")
      && (!actionSnapshot || typeof actionSnapshot !== "object")
    ) {
      throw new Error("order_fill.execution_contract_snapshot or execution_action_snapshot is required for source=trade_flow")
    }
  }
}

export function validateReview(body: JSONRecord): void {
  if (isNeedsReview(body)) {
    if (!stringField(body.reason)) {
      throw new Error("review.reason is required for needs_review")
    }
    return
  }
  if (!looksLikeStrategyReview(body)) {
    return
  }
  validateStrategyReviewBody(body)
}

function validateStrategyReviewBody(body: JSONRecord): void {
  if (!stringField(body.strategy_ref)) {
    throw new Error("review.strategy_ref is required")
  }
  const outcome = stringField(body.outcome)
  if (!REVIEW_OUTCOMES.includes(outcome as typeof REVIEW_OUTCOMES[number])) {
    throw new Error(`review.outcome must be one of ${REVIEW_OUTCOMES.join(", ")}`)
  }
  if (!hasNumber(body.r) && !hasNumber(body.pnl_r) && !hasNumber(body.pnl_R) && !hasNumber(body.pnl_pct)) {
    throw new Error("review.pnl_r or review.pnl_pct is required")
  }
  if (typeof body.thesis_held !== "boolean") {
    throw new Error("review.thesis_held must be boolean")
  }
  if (!stringField(body.key_lesson)) {
    throw new Error("review.key_lesson is required")
  }
  if (typeof body.promote_to_strategy !== "boolean") {
    throw new Error("review.promote_to_strategy must be boolean")
  }
}

function isNeedsReview(body: JSONRecord): boolean {
  return stringField(body.status) === "needs_review" || stringField(body.lifecycle_status) === "needs_review"
}

function looksLikeStrategyReview(body: JSONRecord): boolean {
  return Boolean(
    stringField(body.strategy_ref)
    || stringField(body.outcome)
    || hasNumber(body.r)
    || hasNumber(body.pnl_r)
    || hasNumber(body.pnl_R)
    || hasNumber(body.pnl_pct),
  )
}

function hasNumber(value: unknown): boolean {
  return Number.isFinite(Number(value))
}

export function readFlowEvents(db: Database, chainId: string): PlanEvent[] {
  if (!chainId) {
    throw new Error("chain_id is required")
  }
  const rows = db.query(`
    SELECT event_key, chain_id, kind, body_json, created_at
    FROM plan_event
    WHERE chain_id = $chain_id
    ORDER BY created_at, rowid
  `).all({ $chain_id: chainId }) as Array<{
    event_key: string
    chain_id: string
    kind: EventKind
    body_json: string
    created_at: string
  }>

  return rows.map((row) => ({
    event_key: row.event_key,
    chain_id: row.chain_id,
    kind: row.kind,
    body_json: JSON.parse(row.body_json) as JSONRecord,
    created_at: row.created_at,
  }))
}

export function listChainIds(db: Database): string[] {
  const rows = db.query(`
    SELECT DISTINCT chain_id
    FROM plan_event
    ORDER BY chain_id
  `).all() as Array<{ chain_id: string }>
  return rows.map((row) => row.chain_id)
}

export function readLatestOrderFill(db: Database, chainId: string): JSONRecord | null {
  const row = db.query(`
    SELECT event_key, chain_id, kind, body_json, created_at
    FROM plan_event
    WHERE chain_id = $chain_id AND kind = 'order_fill'
    ORDER BY created_at DESC
    LIMIT 1
  `).get({ $chain_id: chainId }) as {
    event_key: string
    chain_id: string
    kind: EventKind
    body_json: string
    created_at: string
  } | null
  if (!row) {
    return null
  }
  return {
    event_key: row.event_key,
    chain_id: row.chain_id,
    kind: row.kind,
    body_json: JSON.parse(row.body_json) as JSONRecord,
    created_at: row.created_at,
  }
}
