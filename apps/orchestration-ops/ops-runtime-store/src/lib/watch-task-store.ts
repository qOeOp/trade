import { Database } from "bun:sqlite"
import {
  compileWatchTaskDefinition,
  parseWatchTaskEvaluation,
  WATCH_TASK_STATUSES,
  type WatchTaskDefinition,
  type WatchTaskEvaluation,
  type WatchTaskStatus,
} from "../../../../contracts/watch-task-contract/src/watch-task-contract"
import { asRecord, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"

export interface WatchTaskRecord {
  definition: WatchTaskDefinition
  status: WatchTaskStatus
  observation_count: number
  error_count: number
  version: number
  updated_at: string
  terminal_reason?: string
  last_observation_ref?: string
  handoff?: JSONRecord
  handoff_receipt_ref?: string
  downstream_result_ref?: string
  transition_reason?: string
  transition_detail?: unknown
}

export function ensureWatchTaskSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS watch_task (
      task_id                TEXT PRIMARY KEY,
      intent_ref             TEXT NOT NULL,
      idempotency_key        TEXT NOT NULL UNIQUE,
      definition_hash        TEXT NOT NULL,
      definition_json        TEXT NOT NULL CHECK(json_valid(definition_json)),
      status                 TEXT NOT NULL CHECK(status IN ('created','armed','observing','triggered','handed_off','completed','expired','cancelled','blocked')),
      observation_count      INTEGER NOT NULL DEFAULT 0 CHECK(observation_count >= 0),
      error_count            INTEGER NOT NULL DEFAULT 0 CHECK(error_count >= 0),
      version                INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
      updated_at             TEXT NOT NULL,
      terminal_reason        TEXT,
      last_observation_ref   TEXT,
      handoff_json           TEXT CHECK(handoff_json IS NULL OR json_valid(handoff_json)),
      handoff_receipt_ref    TEXT,
      downstream_result_ref  TEXT
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS watch_task_transition (
      task_id          TEXT NOT NULL,
      sequence         INTEGER NOT NULL CHECK(sequence > 0),
      from_status      TEXT,
      to_status        TEXT NOT NULL CHECK(to_status IN ('created','armed','observing','triggered','handed_off','completed','expired','cancelled','blocked')),
      reason           TEXT NOT NULL,
      observation_ref  TEXT,
      transition_json  TEXT NOT NULL CHECK(json_valid(transition_json)),
      transitioned_at  TEXT NOT NULL,
      PRIMARY KEY(task_id, sequence),
      FOREIGN KEY(task_id) REFERENCES watch_task(task_id)
    )
  `)
  ensureWatchColumn(db, "handoff_receipt_ref", "TEXT")
  db.run("CREATE INDEX IF NOT EXISTS idx_watch_task_status_updated ON watch_task(status, updated_at)")
}

export function createWatchTask(db: Database, value: unknown): WatchTaskRecord {
  const definition = compileWatchTaskDefinition(value)
  const create = db.transaction((): WatchTaskRecord => {
    const existing = readWatchTask(db, definition.task_id)
    if (existing) {
      if (JSON.stringify(existing.definition) !== JSON.stringify(definition)) {
        throw new Error(`watch task definition is immutable: ${definition.task_id}`)
      }
      return existing
    }
    const idempotent = db.query("SELECT task_id FROM watch_task WHERE idempotency_key = ?").get(definition.idempotency_key) as { task_id: string } | null
    if (idempotent) throw new Error(`watch task idempotency key belongs to ${idempotent.task_id}`)
    db.query(`
      INSERT INTO watch_task(
        task_id, intent_ref, idempotency_key, definition_hash, definition_json,
        status, observation_count, error_count, version, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'created', 0, 0, 1, ?)
    `).run(
      definition.task_id,
      definition.intent_ref,
      definition.idempotency_key,
      definition.definition_hash,
      JSON.stringify(definition),
      definition.lifetime.created_at,
    )
    appendTransition(db, definition.task_id, 1, null, "created", "definition_created", undefined, {
      definition_hash: definition.definition_hash,
      execution_authority: "none",
    }, definition.lifetime.created_at)
    return requiredWatchTask(db, definition.task_id)
  })
  return create.immediate()
}

export function readWatchTask(db: Database, taskId: string): WatchTaskRecord | null {
  if (!taskId) throw new Error("task_id is required")
  const row = db.query(`
    SELECT definition_json, status, observation_count, error_count, version, updated_at,
      terminal_reason, last_observation_ref, handoff_json, handoff_receipt_ref, downstream_result_ref
    FROM watch_task WHERE task_id = ?
  `).get(taskId) as Record<string, unknown> | null
  if (!row) return null
  const status = stringField(row.status)
  if (!WATCH_TASK_STATUSES.includes(status as WatchTaskStatus)) throw new Error("stored watch task status is invalid")
  return {
    definition: compileWatchTaskDefinition(JSON.parse(stringField(row.definition_json))),
    status: status as WatchTaskStatus,
    observation_count: nonNegativeInteger(row.observation_count, "observation_count"),
    error_count: nonNegativeInteger(row.error_count, "error_count"),
    version: positiveInteger(row.version, "version"),
    updated_at: stringField(row.updated_at),
    terminal_reason: stringField(row.terminal_reason) || undefined,
    last_observation_ref: stringField(row.last_observation_ref) || undefined,
    handoff: row.handoff_json ? asRecord(JSON.parse(stringField(row.handoff_json))) : undefined,
    handoff_receipt_ref: stringField(row.handoff_receipt_ref) || undefined,
    downstream_result_ref: stringField(row.downstream_result_ref) || undefined,
  }
}

export function armWatchTask(db: Database, input: JSONRecord): WatchTaskRecord {
  const taskId = stringField(input.task_id)
  const definitionHash = stringField(input.definition_hash)
  const now = canonicalIso(input.now, "now")
  return mutate(db, taskId, positiveInteger(input.expected_version, "expected_version"), (current) => {
    if (current.status !== "created") throw new Error(`watch task cannot arm from ${current.status}`)
    if (current.definition.definition_hash !== definitionHash) throw new Error("watch task definition hash drifted")
    if (Date.parse(now) >= Date.parse(current.definition.lifetime.deadline)) {
      return transition(current, "expired", "deadline_reached_before_arm", now)
    }
    return transition(current, "armed", "definition_armed", now)
  })
}

export function applyWatchTaskEvaluation(
  db: Database,
  input: { task_id: string; expected_version: number; evaluation: WatchTaskEvaluation },
): WatchTaskRecord {
  const evaluation = parseWatchTaskEvaluation(input.evaluation)
  return mutate(db, input.task_id, positiveInteger(input.expected_version, "expected_version"), (current) => {
    if (current.status !== "armed" && current.status !== "observing") {
      throw new Error(`watch task cannot evaluate from ${current.status}`)
    }
    if (evaluation.task_id !== current.definition.task_id) throw new Error("watch task evaluation identity mismatch")
    if (evaluation.next_observation_count < current.observation_count
      || evaluation.next_observation_count > current.definition.budget.max_observations) {
      throw new Error("watch task observation count is invalid")
    }
    if (evaluation.next_error_count < current.error_count
      || evaluation.next_error_count > current.definition.budget.max_errors + 1) {
      throw new Error("watch task error count is invalid")
    }
    const nextStatus = evaluationStatus(evaluation.outcome)
    if (evaluation.handoff && (
      evaluation.handoff.intent_ref !== current.definition.intent_ref
      || evaluation.handoff.intent_content_hash !== current.definition.intent_content_hash
      || evaluation.handoff.flow_id !== current.definition.flow_id
      || evaluation.handoff.idempotency_key !== current.definition.idempotency_key
    )) throw new Error("watch task handoff identity drifted")
    return transition(current, nextStatus, evaluation.reason, evaluation.evaluated_at, {
      observation_count: evaluation.next_observation_count,
      error_count: evaluation.next_error_count,
      last_observation_ref: evaluation.observation_ref,
      handoff: evaluation.handoff,
      transition_detail: evaluation,
    })
  })
}

export function handoffWatchTask(db: Database, input: JSONRecord): WatchTaskRecord {
  const taskId = stringField(input.task_id)
  const now = canonicalIso(input.now, "now")
  const receiptRef = stringField(input.handoff_receipt_ref)
  if (!receiptRef) throw new Error("handoff_receipt_ref is required")
  return mutate(db, taskId, positiveInteger(input.expected_version, "expected_version"), (current) => {
    if (current.status !== "triggered" || !current.handoff) throw new Error("watch task is not ready for handoff")
    if (current.handoff.execution_authority !== "none") throw new Error("watch task handoff authority widened")
    return transition(current, "handed_off", "action_intent_revalidation_handed_off", now, { handoff_receipt_ref: receiptRef })
  })
}

export function completeWatchTask(db: Database, input: JSONRecord): WatchTaskRecord {
  const taskId = stringField(input.task_id)
  const now = canonicalIso(input.now, "now")
  const resultRef = stringField(input.downstream_result_ref)
  if (!resultRef) throw new Error("downstream_result_ref is required")
  const outcome = stringField(input.downstream_outcome)
  if (outcome && outcome !== "revalidation_passed" && outcome !== "blocked") {
    throw new Error("downstream_outcome is unsupported")
  }
  const downstreamReason = stringField(input.downstream_reason)
  return mutate(db, taskId, positiveInteger(input.expected_version, "expected_version"), (current) => {
    if (current.status !== "handed_off") throw new Error(`watch task cannot complete from ${current.status}`)
    return transition(current, "completed", "downstream_revalidation_completed", now, {
      downstream_result_ref: resultRef,
      transition_detail: {
        downstream_result_ref: resultRef,
        downstream_outcome: outcome || "unknown",
        downstream_reason: downstreamReason || "not_supplied",
        execution_authority: "none",
      },
    })
  })
}

export function cancelWatchTask(db: Database, input: JSONRecord): WatchTaskRecord {
  const taskId = stringField(input.task_id)
  const now = canonicalIso(input.now, "now")
  const reason = stringField(input.reason)
  if (!reason) throw new Error("cancel reason is required")
  return mutate(db, taskId, positiveInteger(input.expected_version, "expected_version"), (current) => {
    if (["completed", "expired", "cancelled", "blocked"].includes(current.status)) {
      throw new Error(`watch task cannot cancel from ${current.status}`)
    }
    return transition(current, "cancelled", reason, now)
  })
}

export function readWatchTaskTransitions(db: Database, taskId: string): JSONRecord[] {
  return (db.query(`
    SELECT sequence, from_status, to_status, reason, observation_ref, transition_json, transitioned_at
    FROM watch_task_transition WHERE task_id = ? ORDER BY sequence
  `).all(taskId) as Array<Record<string, unknown>>).map((row) => ({
    sequence: row.sequence,
    from_status: row.from_status,
    to_status: row.to_status,
    reason: row.reason,
    observation_ref: row.observation_ref,
    transition: JSON.parse(stringField(row.transition_json)),
    transitioned_at: row.transitioned_at,
  }))
}

function mutate(
  db: Database,
  taskId: string,
  expectedVersion: number,
  build: (current: WatchTaskRecord) => WatchTaskRecord,
): WatchTaskRecord {
  if (!taskId) throw new Error("task_id is required")
  const operation = db.transaction(() => {
    const current = requiredWatchTask(db, taskId)
    if (current.version !== expectedVersion) throw new Error("watch task version conflict")
    const next = build(current)
    const result = db.query(`
      UPDATE watch_task SET status = ?, observation_count = ?, error_count = ?, version = ?,
        updated_at = ?, terminal_reason = ?, last_observation_ref = ?, handoff_json = ?, handoff_receipt_ref = ?, downstream_result_ref = ?
      WHERE task_id = ? AND version = ?
    `).run(
      next.status, next.observation_count, next.error_count, next.version, next.updated_at,
      next.terminal_reason ?? null, next.last_observation_ref ?? null,
      next.handoff ? JSON.stringify(next.handoff) : null, next.handoff_receipt_ref ?? null, next.downstream_result_ref ?? null,
      taskId, expectedVersion,
    )
    if (result.changes !== 1) throw new Error("watch task compare-and-set failed")
    appendTransition(db, taskId, next.version, current.status, next.status, next.transition_reason ?? "state_transition",
      next.last_observation_ref, next.transition_detail ?? {
        status: next.status,
        handoff: next.handoff,
        handoff_receipt_ref: next.handoff_receipt_ref,
        downstream_result_ref: next.downstream_result_ref,
      }, next.updated_at)
    return requiredWatchTask(db, taskId)
  })
  return operation.immediate()
}

function transition(
  current: WatchTaskRecord,
  status: WatchTaskStatus,
  reason: string,
  now: string,
  changes: Partial<WatchTaskRecord> = {},
): WatchTaskRecord {
  canonicalIso(now, "transitioned_at")
  if (Date.parse(now) < Date.parse(current.updated_at)) throw new Error("watch task transition time moved backwards")
  const terminal = ["completed", "expired", "cancelled", "blocked"].includes(status)
  return {
    ...current,
    status,
    observation_count: changes.observation_count ?? current.observation_count,
    error_count: changes.error_count ?? current.error_count,
    version: current.version + 1,
    updated_at: now,
    terminal_reason: terminal ? reason : undefined,
    last_observation_ref: changes.last_observation_ref ?? current.last_observation_ref,
    handoff: changes.handoff ?? current.handoff,
    handoff_receipt_ref: changes.handoff_receipt_ref ?? current.handoff_receipt_ref,
    downstream_result_ref: changes.downstream_result_ref ?? current.downstream_result_ref,
    transition_reason: reason,
    transition_detail: changes.transition_detail,
  }
}

function appendTransition(
  db: Database,
  taskId: string,
  sequence: number,
  fromStatus: WatchTaskStatus | null,
  toStatus: WatchTaskStatus,
  reason: string,
  observationRef: string | undefined,
  detail: unknown,
  transitionedAt: string,
): void {
  db.query(`
    INSERT INTO watch_task_transition(
      task_id, sequence, from_status, to_status, reason, observation_ref, transition_json, transitioned_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(taskId, sequence, fromStatus, toStatus, reason, observationRef ?? null, JSON.stringify(detail), transitionedAt)
}

function requiredWatchTask(db: Database, taskId: string): WatchTaskRecord {
  const task = readWatchTask(db, taskId)
  if (!task) throw new Error(`watch task not found: ${taskId}`)
  return task
}

function evaluationStatus(outcome: WatchTaskEvaluation["outcome"]): WatchTaskStatus {
  if (outcome === "wait") return "observing"
  return outcome
}

function canonicalIso(value: unknown, field: string): string {
  const result = stringField(value)
  const millis = Date.parse(result)
  if (!result || !Number.isFinite(millis) || new Date(millis).toISOString() !== result) throw new Error(`${field} must be canonical UTC ISO`)
  return result
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${field} must be a non-negative integer`)
  return Number(value)
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error(`${field} must be a positive integer`)
  return Number(value)
}

function ensureWatchColumn(db: Database, column: string, definition: string): void {
  const columns = db.query("PRAGMA table_info(watch_task)").all() as Array<{ name: string }>
  if (!columns.some((item) => item.name === column)) db.run(`ALTER TABLE watch_task ADD COLUMN ${column} ${definition}`)
}
