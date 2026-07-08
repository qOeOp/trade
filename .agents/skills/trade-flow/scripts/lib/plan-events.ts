import { Database } from "bun:sqlite"
import { asRecord, stringField, type JSONRecord } from "./json"

export type EventKind = "observe" | "order_fill" | "review"

export interface PlanEvent {
  event_key: string
  chain_id: string
  kind: EventKind
  body_json: JSONRecord
  created_at: string
}

export function ensureSchema(db: Database): void {
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
  const createdAt = stringField(input.created_at) || new Date().toISOString()

  return {
    event_key: eventKey,
    chain_id: chainId,
    kind: "order_fill",
    body_json: body,
    created_at: createdAt,
  }
}

export function validatePlanEvent(event: PlanEvent): void {
  if (!event.event_key) {
    throw new Error("event_key is required")
  }
  if (!event.chain_id) {
    throw new Error("chain_id is required")
  }
  if (!["observe", "order_fill", "review"].includes(event.kind)) {
    throw new Error(`unsupported event kind: ${event.kind}`)
  }
  if (event.kind === "order_fill") {
    validateOrderFill(event.body_json)
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
    const snapshot = body.execution_contract_snapshot
    if (!snapshot || typeof snapshot !== "object") {
      throw new Error("order_fill.execution_contract_snapshot is required for source=trade_flow")
    }
  }
}

export function readFlowEvents(db: Database, chainId: string): PlanEvent[] {
  if (!chainId) {
    throw new Error("chain_id is required")
  }
  const rows = db.query(`
    SELECT event_key, chain_id, kind, body_json, created_at
    FROM plan_event
    WHERE chain_id = $chain_id
    ORDER BY created_at ASC, rowid ASC
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
