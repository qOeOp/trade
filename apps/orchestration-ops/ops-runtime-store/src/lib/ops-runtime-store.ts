import { Database } from "bun:sqlite"
import { asRecord, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { ensureWatchTaskSchema } from "./watch-task-store"
import { ensureAgentRunStoreSchema } from "./agent-run-store"

export const CYCLE_STATUSES = ["running", "completed", "failed", "blocked"] as const
export type CycleStatus = typeof CYCLE_STATUSES[number]

export const JOB_STATUSES = ["planned", "running", "completed", "skipped", "failed", "blocked"] as const
export type JobStatus = typeof JOB_STATUSES[number]

export const HEALTH_STATUSES = ["ok", "degraded", "safe_mode", "blocked"] as const
export type HealthStatus = typeof HEALTH_STATUSES[number]

export const NOTIFY_STATUSES = ["planned", "sent", "failed", "skipped"] as const
export type NotifyStatus = typeof NOTIFY_STATUSES[number]

export const DOMAIN_MESSAGE_STATUSES = ["queued", "published", "consumed", "failed"] as const
export type DomainMessageStatus = typeof DOMAIN_MESSAGE_STATUSES[number]

export const DOMAIN_MESSAGE_DIRECTIONS = ["inbox", "outbox"] as const
export type DomainMessageDirection = typeof DOMAIN_MESSAGE_DIRECTIONS[number]

export const INCIDENT_SEVERITIES = ["info", "warning", "critical"] as const
export type IncidentSeverity = typeof INCIDENT_SEVERITIES[number]

export const INCIDENT_STATUSES = ["open", "acknowledged", "resolved", "ignored"] as const
export type IncidentStatus = typeof INCIDENT_STATUSES[number]

export const INCIDENT_SOURCES = ["runtime_health", "job_run", "domain_bus", "lifecycle_processor", "post_processor", "manual"] as const
export type IncidentSource = typeof INCIDENT_SOURCES[number]

export const INCIDENT_ACTIONS = ["acknowledge", "resolve", "ignore", "reopen"] as const
export type IncidentAction = typeof INCIDENT_ACTIONS[number]

export interface CycleRun {
  cycle_id: string
  triggered_at: string
  status: CycleStatus
  completed_at?: string
  summary_json?: JSONRecord
}

export interface JobRun {
  job_run_id: string
  cycle_id: string
  ticket_no: string
  job_id: string
  target_domain: string
  status: JobStatus
  command_ref?: string
  started_at?: string
  completed_at?: string
  result_ref?: string
  error_json?: JSONRecord
}

export interface RuntimeHealth {
  health_id: string
  cycle_id?: string
  status: HealthStatus
  checks_json: JSONRecord
  observed_at: string
}

export interface NotifyAttempt {
  notify_id: string
  cycle_id?: string
  channel: string
  status: NotifyStatus
  payload_ref?: string
  result_json?: JSONRecord
  attempted_at: string
}

export interface OpsLock {
  lock_key: string
  holder_id: string
  acquired_at: string
  expires_at: string
  fencing_token?: number
}

export interface OpsLockAcquisition {
  acquired: boolean
  lock: OpsLock
  recovered_stale: boolean
}

export interface DomainMessage {
  message_id: string
  cycle_id?: string
  job_id?: string
  direction: DomainMessageDirection
  source_domain?: string
  target_domain?: string
  rail: string
  payload_ref: string
  idempotency_key?: string
  status: DomainMessageStatus
  envelope_json: JSONRecord
  created_at: string
  processed_at?: string
  error_json?: JSONRecord
}

export interface Incident {
  incident_id: string
  cycle_id?: string
  source: IncidentSource
  severity: IncidentSeverity
  status: IncidentStatus
  title: string
  detail_json?: JSONRecord
  refs_json?: string[]
  first_seen_at: string
  last_seen_at: string
}

export interface IncidentEvent {
  event_id: string
  incident_id: string
  action: IncidentAction
  status_after: IncidentStatus
  actor?: string
  note?: string
  detail_json?: JSONRecord
  created_at: string
}

export interface ControlReview {
  review_id: string
  cycle_id?: string
  status: "ok" | "needs_attention"
  summary_json: JSONRecord
  items_json: JSONRecord[]
  constraints_json: JSONRecord[]
  created_at: string
}

export const PARITY_OBSERVATION_STATUSES = ["match", "mismatch"] as const
export type ParityObservationStatus = typeof PARITY_OBSERVATION_STATUSES[number]

export interface RuntimeParityObservation {
  observation_id: string
  program_cycle_id: string
  agent_cycle_id: string
  program_projection_hash: string
  agent_projection_hash: string
  status: ParityObservationStatus
  detail_json: JSONRecord
  observed_at: string
}

export function ensureOpsRuntimeSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS cycle_run (
      cycle_id      TEXT PRIMARY KEY,
      triggered_at  TEXT NOT NULL,
      completed_at  TEXT,
      status        TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'blocked')),
      summary_json  TEXT CHECK(summary_json IS NULL OR json_valid(summary_json))
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS job_run (
      job_run_id    TEXT PRIMARY KEY,
      cycle_id      TEXT NOT NULL,
      ticket_no     TEXT NOT NULL,
      job_id        TEXT NOT NULL,
      target_domain TEXT NOT NULL,
      status        TEXT NOT NULL CHECK(status IN ('planned', 'running', 'completed', 'skipped', 'failed', 'blocked')),
      command_ref   TEXT,
      started_at    TEXT,
      completed_at  TEXT,
      result_ref    TEXT,
      error_json    TEXT CHECK(error_json IS NULL OR json_valid(error_json)),
      FOREIGN KEY (cycle_id) REFERENCES cycle_run(cycle_id)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS runtime_health (
      health_id     TEXT PRIMARY KEY,
      cycle_id      TEXT,
      status        TEXT NOT NULL CHECK(status IN ('ok', 'degraded', 'safe_mode', 'blocked')),
      checks_json   TEXT NOT NULL CHECK(json_valid(checks_json)),
      observed_at   TEXT NOT NULL,
      FOREIGN KEY (cycle_id) REFERENCES cycle_run(cycle_id)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS notify_attempt (
      notify_id     TEXT PRIMARY KEY,
      cycle_id      TEXT,
      channel       TEXT NOT NULL,
      status        TEXT NOT NULL CHECK(status IN ('planned', 'sent', 'failed', 'skipped')),
      payload_ref   TEXT,
      result_json   TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
      attempted_at  TEXT NOT NULL,
      FOREIGN KEY (cycle_id) REFERENCES cycle_run(cycle_id)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS domain_message (
      message_id       TEXT PRIMARY KEY,
      cycle_id         TEXT,
      job_id           TEXT,
      direction        TEXT NOT NULL CHECK(direction IN ('inbox', 'outbox')),
      source_domain    TEXT,
      target_domain    TEXT,
      rail             TEXT NOT NULL,
      payload_ref      TEXT NOT NULL,
      idempotency_key  TEXT,
      status           TEXT NOT NULL CHECK(status IN ('queued', 'published', 'consumed', 'failed')),
      envelope_json    TEXT NOT NULL CHECK(json_valid(envelope_json)),
      created_at       TEXT NOT NULL,
      processed_at     TEXT,
      error_json       TEXT CHECK(error_json IS NULL OR json_valid(error_json)),
      FOREIGN KEY (cycle_id) REFERENCES cycle_run(cycle_id)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS ops_lock (
      lock_key      TEXT PRIMARY KEY,
      holder_id     TEXT NOT NULL,
      acquired_at   TEXT NOT NULL,
      expires_at    TEXT NOT NULL,
      fencing_token INTEGER NOT NULL DEFAULT 1 CHECK(fencing_token > 0)
    )
  `)
  ensureColumn(db, "ops_lock", "fencing_token", "INTEGER NOT NULL DEFAULT 1 CHECK(fencing_token > 0)")
  db.run(`
    CREATE TABLE IF NOT EXISTS ops_lock_generation (
      lock_key           TEXT PRIMARY KEY,
      last_fencing_token INTEGER NOT NULL CHECK(last_fencing_token > 0)
    )
  `)
  db.run(`
    INSERT INTO ops_lock_generation(lock_key, last_fencing_token)
    SELECT lock_key, fencing_token FROM ops_lock
    WHERE true
    ON CONFLICT(lock_key) DO UPDATE SET
      last_fencing_token = MAX(ops_lock_generation.last_fencing_token, excluded.last_fencing_token)
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS incident (
      incident_id   TEXT PRIMARY KEY,
      cycle_id      TEXT,
      source        TEXT NOT NULL CHECK(source IN ('runtime_health', 'job_run', 'domain_bus', 'lifecycle_processor', 'post_processor', 'manual')),
      severity      TEXT NOT NULL CHECK(severity IN ('info', 'warning', 'critical')),
      status        TEXT NOT NULL CHECK(status IN ('open', 'acknowledged', 'resolved', 'ignored')),
      title         TEXT NOT NULL,
      detail_json   TEXT CHECK(detail_json IS NULL OR json_valid(detail_json)),
      refs_json     TEXT CHECK(refs_json IS NULL OR json_valid(refs_json)),
      first_seen_at TEXT NOT NULL,
      last_seen_at  TEXT NOT NULL,
      FOREIGN KEY (cycle_id) REFERENCES cycle_run(cycle_id)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS incident_event (
      event_id      TEXT PRIMARY KEY,
      incident_id   TEXT NOT NULL,
      action        TEXT NOT NULL CHECK(action IN ('acknowledge', 'resolve', 'ignore', 'reopen')),
      status_after  TEXT NOT NULL CHECK(status_after IN ('open', 'acknowledged', 'resolved', 'ignored')),
      actor         TEXT,
      note          TEXT,
      detail_json   TEXT CHECK(detail_json IS NULL OR json_valid(detail_json)),
      created_at    TEXT NOT NULL,
      FOREIGN KEY (incident_id) REFERENCES incident(incident_id)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS control_review (
      review_id        TEXT PRIMARY KEY,
      cycle_id         TEXT,
      status           TEXT NOT NULL CHECK(status IN ('ok', 'needs_attention')),
      summary_json     TEXT NOT NULL CHECK(json_valid(summary_json)),
      items_json       TEXT NOT NULL CHECK(json_valid(items_json)),
      constraints_json TEXT NOT NULL CHECK(json_valid(constraints_json)),
      created_at       TEXT NOT NULL,
      FOREIGN KEY (cycle_id) REFERENCES cycle_run(cycle_id)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS runtime_parity_observation (
      observation_id          TEXT PRIMARY KEY,
      program_cycle_id        TEXT NOT NULL,
      agent_cycle_id          TEXT NOT NULL,
      program_projection_hash TEXT NOT NULL,
      agent_projection_hash   TEXT NOT NULL,
      status                  TEXT NOT NULL CHECK(status IN ('match', 'mismatch')),
      detail_json             TEXT NOT NULL CHECK(json_valid(detail_json)),
      observed_at             TEXT NOT NULL,
      FOREIGN KEY (program_cycle_id) REFERENCES cycle_run(cycle_id),
      FOREIGN KEY (agent_cycle_id) REFERENCES cycle_run(cycle_id)
    )
  `)
  db.run("CREATE INDEX IF NOT EXISTS idx_job_run_cycle ON job_run(cycle_id, ticket_no)")
  db.run("CREATE INDEX IF NOT EXISTS idx_runtime_health_time ON runtime_health(observed_at DESC)")
  db.run("CREATE INDEX IF NOT EXISTS idx_domain_message_cycle ON domain_message(cycle_id, job_id, direction)")
  db.run("CREATE INDEX IF NOT EXISTS idx_domain_message_target ON domain_message(target_domain, status, created_at)")
  db.run("CREATE INDEX IF NOT EXISTS idx_incident_cycle ON incident(cycle_id, status, severity)")
  db.run("CREATE INDEX IF NOT EXISTS idx_incident_event_incident ON incident_event(incident_id, created_at)")
  db.run("CREATE INDEX IF NOT EXISTS idx_control_review_cycle ON control_review(cycle_id, created_at)")
  db.run("CREATE INDEX IF NOT EXISTS idx_runtime_parity_observed ON runtime_parity_observation(observed_at DESC)")
  ensureWatchTaskSchema(db)
  ensureAgentRunStoreSchema(db)
}

export function upsertCycleRun(db: Database, run: CycleRun): void {
  validateCycleRun(run)
  db.query(`
    INSERT INTO cycle_run(cycle_id, triggered_at, completed_at, status, summary_json)
    VALUES ($cycle_id, $triggered_at, $completed_at, $status, $summary_json)
    ON CONFLICT(cycle_id) DO UPDATE SET
      triggered_at = excluded.triggered_at,
      completed_at = excluded.completed_at,
      status = excluded.status,
      summary_json = excluded.summary_json
  `).run({
    $cycle_id: run.cycle_id,
    $triggered_at: run.triggered_at,
    $completed_at: run.completed_at ?? null,
    $status: run.status,
    $summary_json: run.summary_json ? JSON.stringify(run.summary_json) : null,
  })
}

export function upsertJobRun(db: Database, run: JobRun): void {
  validateJobRun(run)
  db.query(`
    INSERT INTO job_run(
      job_run_id, cycle_id, ticket_no, job_id, target_domain, status,
      command_ref, started_at, completed_at, result_ref, error_json
    )
    VALUES (
      $job_run_id, $cycle_id, $ticket_no, $job_id, $target_domain, $status,
      $command_ref, $started_at, $completed_at, $result_ref, $error_json
    )
    ON CONFLICT(job_run_id) DO UPDATE SET
      cycle_id = excluded.cycle_id,
      ticket_no = excluded.ticket_no,
      job_id = excluded.job_id,
      target_domain = excluded.target_domain,
      status = excluded.status,
      command_ref = excluded.command_ref,
      started_at = excluded.started_at,
      completed_at = excluded.completed_at,
      result_ref = excluded.result_ref,
      error_json = excluded.error_json
  `).run({
    $job_run_id: run.job_run_id,
    $cycle_id: run.cycle_id,
    $ticket_no: run.ticket_no,
    $job_id: run.job_id,
    $target_domain: run.target_domain,
    $status: run.status,
    $command_ref: run.command_ref ?? null,
    $started_at: run.started_at ?? null,
    $completed_at: run.completed_at ?? null,
    $result_ref: run.result_ref ?? null,
    $error_json: run.error_json ? JSON.stringify(run.error_json) : null,
  })
}

export function recordRuntimeHealth(db: Database, health: RuntimeHealth): void {
  validateRuntimeHealth(health)
  db.query(`
    INSERT INTO runtime_health(health_id, cycle_id, status, checks_json, observed_at)
    VALUES ($health_id, $cycle_id, $status, $checks_json, $observed_at)
  `).run({
    $health_id: health.health_id,
    $cycle_id: health.cycle_id ?? null,
    $status: health.status,
    $checks_json: JSON.stringify(health.checks_json),
    $observed_at: health.observed_at,
  })
}

export function recordNotifyAttempt(db: Database, attempt: NotifyAttempt): void {
  validateNotifyAttempt(attempt)
  db.query(`
    INSERT INTO notify_attempt(notify_id, cycle_id, channel, status, payload_ref, result_json, attempted_at)
    VALUES ($notify_id, $cycle_id, $channel, $status, $payload_ref, $result_json, $attempted_at)
  `).run({
    $notify_id: attempt.notify_id,
    $cycle_id: attempt.cycle_id ?? null,
    $channel: attempt.channel,
    $status: attempt.status,
    $payload_ref: attempt.payload_ref ?? null,
    $result_json: attempt.result_json ? JSON.stringify(attempt.result_json) : null,
    $attempted_at: attempt.attempted_at,
  })
}

export function upsertOpsLock(db: Database, lock: OpsLock): void {
  const result = acquireOpsLock(db, lock)
  if (!result.acquired) {
    throw new Error(`ops lock ${lock.lock_key} is held by another active owner`)
  }
}

export function acquireOpsLock(db: Database, lock: OpsLock): OpsLockAcquisition {
  validateOpsLock(lock)
  const acquire = db.transaction((candidate: OpsLock): OpsLockAcquisition => {
    const active = readOpsLock(db, candidate.lock_key)
    const candidateAt = Date.parse(candidate.acquired_at)
    if (active && Date.parse(active.expires_at) > candidateAt) {
      if (active.holder_id !== candidate.holder_id) {
        return { acquired: false, lock: active, recovered_stale: false }
      }
      db.query(`
        UPDATE ops_lock
        SET acquired_at = $acquired_at, expires_at = $expires_at
        WHERE lock_key = $lock_key AND holder_id = $holder_id AND fencing_token = $fencing_token
      `).run({
        $lock_key: candidate.lock_key,
        $holder_id: candidate.holder_id,
        $fencing_token: positiveInteger(active.fencing_token) || 1,
        $acquired_at: candidate.acquired_at,
        $expires_at: candidate.expires_at,
      })
      return { acquired: true, lock: readOpsLock(db, candidate.lock_key) ?? active, recovered_stale: false }
    }

    const generation = db.query(`
      INSERT INTO ops_lock_generation(lock_key, last_fencing_token)
      VALUES ($lock_key, 1)
      ON CONFLICT(lock_key) DO UPDATE SET
        last_fencing_token = ops_lock_generation.last_fencing_token + 1
      RETURNING last_fencing_token
    `).get({ $lock_key: candidate.lock_key }) as { last_fencing_token: number }
    db.query(`
      INSERT INTO ops_lock(lock_key, holder_id, acquired_at, expires_at, fencing_token)
      VALUES ($lock_key, $holder_id, $acquired_at, $expires_at, $fencing_token)
      ON CONFLICT(lock_key) DO UPDATE SET
        holder_id = excluded.holder_id,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at,
        fencing_token = excluded.fencing_token
    `).run({
      $lock_key: candidate.lock_key,
      $holder_id: candidate.holder_id,
      $acquired_at: candidate.acquired_at,
      $expires_at: candidate.expires_at,
      $fencing_token: generation.last_fencing_token,
    })
    const acquired = readOpsLock(db, candidate.lock_key)
    if (!acquired) throw new Error("ops lock disappeared after acquisition")
    return { acquired: true, lock: acquired, recovered_stale: active !== null }
  })
  return acquire.immediate(lock)
}

export function readOpsLock(db: Database, lockKey: string): OpsLock | null {
  const row = db.query(`
    SELECT lock_key, holder_id, acquired_at, expires_at, fencing_token
    FROM ops_lock
    WHERE lock_key = $lock_key
  `).get({ $lock_key: lockKey }) as OpsLock | null
  return row ?? null
}

export function renewOpsLock(db: Database, input: {
  lock_key: string
  holder_id: string
  fencing_token: number
  renewed_at: string
  expires_at: string
}): { renewed: boolean; lock: OpsLock | null } {
  if (!input.lock_key || !input.holder_id || !positiveInteger(input.fencing_token)) {
    throw new Error("lock_key, holder_id, and positive fencing_token are required")
  }
  if (!Number.isFinite(Date.parse(input.renewed_at)) || !Number.isFinite(Date.parse(input.expires_at))) {
    throw new Error("ops lock renewal timestamps must be valid dates")
  }
  if (Date.parse(input.expires_at) <= Date.parse(input.renewed_at)) {
    throw new Error("ops lock renewal expires_at must be after renewed_at")
  }
  const result = db.query(`
    UPDATE ops_lock
    SET expires_at = $expires_at
    WHERE lock_key = $lock_key
      AND holder_id = $holder_id
      AND fencing_token = $fencing_token
      AND expires_at > $renewed_at
  `).run({
    $lock_key: input.lock_key,
    $holder_id: input.holder_id,
    $fencing_token: input.fencing_token,
    $renewed_at: input.renewed_at,
    $expires_at: input.expires_at,
  })
  return { renewed: result.changes === 1, lock: readOpsLock(db, input.lock_key) }
}

export function releaseOpsLock(db: Database, lockKey: string, holderId: string, fencingToken?: number): boolean {
  if (!lockKey || !holderId) throw new Error("lock_key and holder_id are required")
  const result = db.query(`
    DELETE FROM ops_lock
    WHERE lock_key = $lock_key
      AND holder_id = $holder_id
      AND ($fencing_token = 0 OR fencing_token = $fencing_token)
  `).run({
    $lock_key: lockKey,
    $holder_id: holderId,
    $fencing_token: positiveInteger(fencingToken) || 0,
  })
  return result.changes === 1
}

function ensureColumn(db: Database, table: string, column: string, definition: string): void {
  const columns = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!columns.some((item) => item.name === column)) {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

function positiveInteger(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0
}

function validateOpsLock(lock: OpsLock): void {
  if (!lock.lock_key || !lock.holder_id || !lock.acquired_at || !lock.expires_at) {
    throw new Error("lock_key, holder_id, acquired_at, and expires_at are required")
  }
  if (!Number.isFinite(Date.parse(lock.acquired_at)) || !Number.isFinite(Date.parse(lock.expires_at))) {
    throw new Error("ops lock timestamps must be valid dates")
  }
  if (Date.parse(lock.expires_at) <= Date.parse(lock.acquired_at)) {
    throw new Error("ops lock expires_at must be after acquired_at")
  }
}

export function upsertDomainMessage(db: Database, message: DomainMessage): void {
  validateDomainMessage(message)
  db.query(`
    INSERT INTO domain_message(
      message_id, cycle_id, job_id, direction, source_domain, target_domain,
      rail, payload_ref, idempotency_key, status, envelope_json,
      created_at, processed_at, error_json
    )
    VALUES (
      $message_id, $cycle_id, $job_id, $direction, $source_domain, $target_domain,
      $rail, $payload_ref, $idempotency_key, $status, $envelope_json,
      $created_at, $processed_at, $error_json
    )
    ON CONFLICT(message_id) DO UPDATE SET
      cycle_id = excluded.cycle_id,
      job_id = excluded.job_id,
      direction = excluded.direction,
      source_domain = excluded.source_domain,
      target_domain = excluded.target_domain,
      rail = excluded.rail,
      payload_ref = excluded.payload_ref,
      idempotency_key = excluded.idempotency_key,
      status = excluded.status,
      envelope_json = excluded.envelope_json,
      created_at = excluded.created_at,
      processed_at = excluded.processed_at,
      error_json = excluded.error_json
  `).run({
    $message_id: message.message_id,
    $cycle_id: message.cycle_id ?? null,
    $job_id: message.job_id ?? null,
    $direction: message.direction,
    $source_domain: message.source_domain ?? null,
    $target_domain: message.target_domain ?? null,
    $rail: message.rail,
    $payload_ref: message.payload_ref,
    $idempotency_key: message.idempotency_key ?? null,
    $status: message.status,
    $envelope_json: JSON.stringify(message.envelope_json),
    $created_at: message.created_at,
    $processed_at: message.processed_at ?? null,
    $error_json: message.error_json ? JSON.stringify(message.error_json) : null,
  })
}

export function recordIncident(db: Database, incident: Incident): void {
  validateIncident(incident)
  db.query(`
    INSERT INTO incident(
      incident_id, cycle_id, source, severity, status, title,
      detail_json, refs_json, first_seen_at, last_seen_at
    )
    VALUES (
      $incident_id, $cycle_id, $source, $severity, $status, $title,
      $detail_json, $refs_json, $first_seen_at, $last_seen_at
    )
    ON CONFLICT(incident_id) DO UPDATE SET
      cycle_id = excluded.cycle_id,
      source = excluded.source,
      severity = excluded.severity,
      status = CASE
        WHEN incident.status IN ('acknowledged', 'resolved', 'ignored') AND excluded.status = 'open'
          THEN incident.status
        ELSE excluded.status
      END,
      title = excluded.title,
      detail_json = excluded.detail_json,
      refs_json = excluded.refs_json,
      last_seen_at = excluded.last_seen_at
  `).run({
    $incident_id: incident.incident_id,
    $cycle_id: incident.cycle_id ?? null,
    $source: incident.source,
    $severity: incident.severity,
    $status: incident.status,
    $title: incident.title,
    $detail_json: incident.detail_json ? JSON.stringify(incident.detail_json) : null,
    $refs_json: incident.refs_json ? JSON.stringify(incident.refs_json) : null,
    $first_seen_at: incident.first_seen_at,
    $last_seen_at: incident.last_seen_at,
  })
}

export function updateIncidentStatus(db: Database, input: JSONRecord): Incident {
  const incidentId = stringField(input.incident_id)
  const action = parseIncidentAction(input.action)
  if (!incidentId || !action) {
    throw new Error("incident_id and supported action are required")
  }
  const existing = readIncidents(db, { incident_id: incidentId })[0]
  if (!existing) {
    throw new Error(`incident not found: ${incidentId}`)
  }
  const statusAfter = statusAfterAction(existing.status, action)
  const now = stringField(input.created_at) || new Date().toISOString()
  const actor = stringField(input.actor) || undefined
  const note = stringField(input.note) || undefined
  const detail = asOptionalRecord(input.detail_json ?? input.detail)
  const event: IncidentEvent = {
    event_id: stringField(input.event_id) || incidentEventIdFrom(incidentId, action, now),
    incident_id: incidentId,
    action,
    status_after: statusAfter,
    actor,
    note,
    detail_json: detail,
    created_at: now,
  }
  recordIncidentEvent(db, event)
  db.query(`
    UPDATE incident
    SET status = $status, last_seen_at = $last_seen_at
    WHERE incident_id = $incident_id
  `).run({
    $incident_id: incidentId,
    $status: statusAfter,
    $last_seen_at: now,
  })
  return readIncidents(db, { incident_id: incidentId })[0]
}

export function recordIncidentEvent(db: Database, event: IncidentEvent): void {
  validateIncidentEvent(event)
  db.query(`
    INSERT INTO incident_event(
      event_id, incident_id, action, status_after, actor, note, detail_json, created_at
    )
    VALUES (
      $event_id, $incident_id, $action, $status_after, $actor, $note, $detail_json, $created_at
    )
    ON CONFLICT(event_id) DO UPDATE SET
      action = excluded.action,
      status_after = excluded.status_after,
      actor = excluded.actor,
      note = excluded.note,
      detail_json = excluded.detail_json,
      created_at = excluded.created_at
  `).run({
    $event_id: event.event_id,
    $incident_id: event.incident_id,
    $action: event.action,
    $status_after: event.status_after,
    $actor: event.actor ?? null,
    $note: event.note ?? null,
    $detail_json: event.detail_json ? JSON.stringify(event.detail_json) : null,
    $created_at: event.created_at,
  })
}

export function recordControlReview(db: Database, review: ControlReview): void {
  validateControlReview(review)
  db.query(`
    INSERT INTO control_review(
      review_id, cycle_id, status, summary_json, items_json, constraints_json, created_at
    )
    VALUES (
      $review_id, $cycle_id, $status, $summary_json, $items_json, $constraints_json, $created_at
    )
    ON CONFLICT(review_id) DO UPDATE SET
      cycle_id = excluded.cycle_id,
      status = excluded.status,
      summary_json = excluded.summary_json,
      items_json = excluded.items_json,
      constraints_json = excluded.constraints_json,
      created_at = excluded.created_at
  `).run({
    $review_id: review.review_id,
    $cycle_id: review.cycle_id ?? null,
    $status: review.status,
    $summary_json: JSON.stringify(review.summary_json),
    $items_json: JSON.stringify(review.items_json),
    $constraints_json: JSON.stringify(review.constraints_json),
    $created_at: review.created_at,
  })
}

export function recordRuntimeParityObservation(
  db: Database,
  observation: RuntimeParityObservation,
): RuntimeParityObservation {
  validateRuntimeParityObservation(observation)
  const write = db.transaction((candidate: RuntimeParityObservation): RuntimeParityObservation => {
    const existing = readRuntimeParityObservations(db, { observation_id: candidate.observation_id })[0]
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(candidate)) {
        throw new Error(`runtime parity observation is immutable: ${candidate.observation_id}`)
      }
      return existing
    }
    db.query(`
      INSERT INTO runtime_parity_observation(
        observation_id, program_cycle_id, agent_cycle_id,
        program_projection_hash, agent_projection_hash, status,
        detail_json, observed_at
      )
      VALUES (
        $observation_id, $program_cycle_id, $agent_cycle_id,
        $program_projection_hash, $agent_projection_hash, $status,
        $detail_json, $observed_at
      )
    `).run({
      $observation_id: candidate.observation_id,
      $program_cycle_id: candidate.program_cycle_id,
      $agent_cycle_id: candidate.agent_cycle_id,
      $program_projection_hash: candidate.program_projection_hash,
      $agent_projection_hash: candidate.agent_projection_hash,
      $status: candidate.status,
      $detail_json: JSON.stringify(candidate.detail_json),
      $observed_at: candidate.observed_at,
    })
    return candidate
  })
  return write.immediate(observation)
}

export function readRuntimeParityObservations(
  db: Database,
  filter: JSONRecord = {},
): RuntimeParityObservation[] {
  const observationId = stringField(filter.observation_id)
  const status = stringField(filter.status)
  const limit = positiveInteger(filter.limit) || 100
  const rows = db.query(`
    SELECT observation_id, program_cycle_id, agent_cycle_id,
      program_projection_hash, agent_projection_hash, status,
      detail_json, observed_at
    FROM runtime_parity_observation
    WHERE ($observation_id = '' OR observation_id = $observation_id)
      AND ($status = '' OR status = $status)
    ORDER BY observed_at DESC, rowid DESC
    LIMIT $limit
  `).all({
    $observation_id: observationId,
    $status: status,
    $limit: limit,
  }) as RuntimeParityObservationRow[]
  return rows.map(runtimeParityObservationFromRow)
}

export function readRuntimeParityStatus(db: Database, asOf = new Date()): JSONRecord {
  if (!Number.isFinite(asOf.getTime())) throw new Error("runtime parity status as_of must be a valid date")
  const counts = db.query(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(status = 'match'), 0) AS matched,
      COALESCE(SUM(status = 'mismatch'), 0) AS mismatched,
      COUNT(DISTINCT program_projection_hash) AS distinct_program_hashes,
      COUNT(DISTINCT agent_projection_hash) AS distinct_agent_hashes,
      MIN(observed_at) AS first_observed_at,
      MAX(observed_at) AS last_observed_at
    FROM runtime_parity_observation
  `).get() as RuntimeParityStatusRow
  const methodologyCounts = db.query(`
    SELECT
      COALESCE(SUM(comparison_basis = 'shared_owner_result_replay_v1'), 0) AS shared_total,
      COALESCE(SUM(comparison_basis = 'shared_owner_result_replay_v1' AND status = 'match'), 0) AS shared_matched,
      COALESCE(SUM(comparison_basis = 'shared_owner_result_replay_v1' AND status = 'mismatch'), 0) AS shared_mismatched,
      COALESCE(SUM(comparison_basis = 'sequential_live_reads_v1'), 0) AS sequential_total,
      COALESCE(SUM(comparison_basis = 'sequential_live_reads_v1' AND status = 'match'), 0) AS sequential_matched,
      COALESCE(SUM(comparison_basis = 'sequential_live_reads_v1' AND status = 'mismatch'), 0) AS sequential_mismatched
    FROM (
      SELECT status, COALESCE(
        json_extract(detail_json, '$.comparison_basis'),
        'sequential_live_reads_v1'
      ) AS comparison_basis
      FROM runtime_parity_observation
    )
  `).get() as RuntimeParityMethodologyStatusRow
  const latest = readRuntimeParityObservations(db, { limit: 1 })[0]
  const supervisorLease = readOpsLock(db, "program-runtime-shadow-supervisor")
  const leaseState = !supervisorLease
    ? "absent"
    : Date.parse(supervisorLease.expires_at) > asOf.getTime()
      ? "active"
      : "expired"
  const total = Number(counts.total)
  const matched = Number(counts.matched)
  const mismatched = Number(counts.mismatched)
  const comparableTotal = Number(methodologyCounts.shared_total)
  const comparableMatched = Number(methodologyCounts.shared_matched)
  const comparableMismatched = Number(methodologyCounts.shared_mismatched)
  const latestBasis = latest
    ? stringField(latest.detail_json.comparison_basis) || "sequential_live_reads_v1"
    : ""
  return {
    schema_version: "trade.ops-runtime-parity-status.v1",
    as_of: asOf.toISOString(),
    observation_state: comparableTotal === 0
      ? "no_comparable_evidence"
      : comparableMismatched > 0
        ? "mismatch_observed"
        : "matches_only",
    counts: {
      total,
      matched,
      mismatched,
      distinct_program_hashes: Number(counts.distinct_program_hashes),
      distinct_agent_hashes: Number(counts.distinct_agent_hashes),
    },
    comparable_counts: {
      comparison_basis: "shared_owner_result_replay_v1",
      total: comparableTotal,
      matched: comparableMatched,
      mismatched: comparableMismatched,
    },
    legacy_sequential_counts: {
      comparison_basis: "sequential_live_reads_v1",
      total: Number(methodologyCounts.sequential_total),
      matched: Number(methodologyCounts.sequential_matched),
      mismatched: Number(methodologyCounts.sequential_mismatched),
    },
    window: {
      first_observed_at: counts.first_observed_at ?? null,
      last_observed_at: counts.last_observed_at ?? null,
    },
    latest: latest ? {
      observation_id: latest.observation_id,
      program_cycle_id: latest.program_cycle_id,
      agent_cycle_id: latest.agent_cycle_id,
      program_projection_hash: latest.program_projection_hash,
      agent_projection_hash: latest.agent_projection_hash,
      status: latest.status,
      comparison_basis: latestBasis,
      observed_at: latest.observed_at,
    } : null,
    supervisor_lease: {
      state: leaseState,
      active: leaseState === "active",
      ...(supervisorLease ? {
        expires_at: supervisorLease.expires_at,
        fencing_token: supervisorLease.fencing_token,
      } : {}),
    },
    limitations: [
      "semantic_shadow_observation_only",
      "no_domain_job_or_live_write_authority",
      "not_a_cutover_or_strategy_verdict",
      "legacy_sequential_live_reads_are_not_comparable_input_evidence",
    ],
  }
}

export function buildDomainMessage(input: JSONRecord): DomainMessage {
  const envelope = asRecord(input.envelope_json ?? input.envelope)
  const now = stringField(input.created_at) || new Date().toISOString()
  const direction = parseDomainMessageDirection(input.direction) || parseDomainMessageDirection(envelopeDirectionFromSchemaId(stringField(envelope.schema_id))) || "outbox"
  const messageId = stringField(input.message_id) || stringField(envelope.message_id)
  return {
    message_id: messageId,
    cycle_id: stringField(input.cycle_id) || undefined,
    job_id: stringField(input.job_id) || undefined,
    direction,
    source_domain: stringField(input.source_domain) || stringField(envelope.source_domain) || undefined,
    target_domain: stringField(input.target_domain) || stringField(envelope.target_domain) || undefined,
    rail: stringField(input.rail) || stringField(envelope.rail),
    payload_ref: stringField(input.payload_ref) || stringField(envelope.payload_ref),
    idempotency_key: stringField(input.idempotency_key) || stringField(envelope.idempotency_key) || undefined,
    status: parseDomainMessageStatus(input.status) || "published",
    envelope_json: Object.keys(envelope).length > 0 ? envelope : asRecord(input),
    created_at: now,
    processed_at: stringField(input.processed_at) || undefined,
    error_json: asOptionalRecord(input.error_json ?? input.error),
  }
}

export function buildIncident(input: JSONRecord): Incident {
  const now = stringField(input.now) || stringField(input.first_seen_at) || new Date().toISOString()
  const source = parseIncidentSource(input.source) || "manual"
  const severity = parseIncidentSeverity(input.severity) || "warning"
  const title = stringField(input.title) || `${source}:${severity}`
  return {
    incident_id: stringField(input.incident_id) || incidentIdFrom(input, source, title, now),
    cycle_id: stringField(input.cycle_id) || undefined,
    source,
    severity,
    status: parseIncidentStatus(input.status) || "open",
    title,
    detail_json: asOptionalRecord(input.detail_json ?? input.detail),
    refs_json: stringArray(input.refs_json ?? input.refs),
    first_seen_at: now,
    last_seen_at: stringField(input.last_seen_at) || now,
  }
}

export function readDomainMessages(db: Database, filter: JSONRecord = {}): DomainMessage[] {
  const cycleId = stringField(filter.cycle_id)
  const targetDomain = stringField(filter.target_domain)
  const status = stringField(filter.status)
  const rows = db.query(`
    SELECT message_id, cycle_id, job_id, direction, source_domain, target_domain,
      rail, payload_ref, idempotency_key, status, envelope_json,
      created_at, processed_at, error_json
    FROM domain_message
    WHERE ($cycle_id = '' OR cycle_id = $cycle_id)
      AND ($target_domain = '' OR target_domain = $target_domain)
      AND ($status = '' OR status = $status)
    ORDER BY created_at, rowid
  `).all({
    $cycle_id: cycleId,
    $target_domain: targetDomain,
    $status: status,
  }) as DomainMessageRow[]
  return rows.map(domainMessageFromRow)
}

export function readIncidents(db: Database, filter: JSONRecord = {}): Incident[] {
  const cycleId = stringField(filter.cycle_id)
  const incidentId = stringField(filter.incident_id)
  const status = stringField(filter.status)
  const severity = stringField(filter.severity)
  const rows = db.query(`
    SELECT incident_id, cycle_id, source, severity, status, title,
      detail_json, refs_json, first_seen_at, last_seen_at
    FROM incident
    WHERE ($cycle_id = '' OR cycle_id = $cycle_id)
      AND ($incident_id = '' OR incident_id = $incident_id)
      AND ($status = '' OR status = $status)
      AND ($severity = '' OR severity = $severity)
    ORDER BY first_seen_at, rowid
  `).all({
    $cycle_id: cycleId,
    $incident_id: incidentId,
    $status: status,
    $severity: severity,
  }) as IncidentRow[]
  return rows.map(incidentFromRow)
}

export function readIncidentEvents(db: Database, filter: JSONRecord = {}): IncidentEvent[] {
  const incidentId = stringField(filter.incident_id)
  const rows = db.query(`
    SELECT event_id, incident_id, action, status_after, actor, note, detail_json, created_at
    FROM incident_event
    WHERE ($incident_id = '' OR incident_id = $incident_id)
    ORDER BY created_at, rowid
  `).all({
    $incident_id: incidentId,
  }) as IncidentEventRow[]
  return rows.map(incidentEventFromRow)
}

export function readNotifyAttempts(db: Database, filter: JSONRecord = {}): NotifyAttempt[] {
  const cycleId = stringField(filter.cycle_id)
  const status = stringField(filter.status)
  const rows = db.query(`
    SELECT notify_id, cycle_id, channel, status, payload_ref, result_json, attempted_at
    FROM notify_attempt
    WHERE ($cycle_id = '' OR cycle_id = $cycle_id)
      AND ($status = '' OR status = $status)
    ORDER BY attempted_at, rowid
  `).all({
    $cycle_id: cycleId,
    $status: status,
  }) as NotifyAttemptRow[]
  return rows.map(notifyAttemptFromRow)
}

export function readJobRuns(db: Database, filter: JSONRecord = {}): JobRun[] {
  const cycleId = stringField(filter.cycle_id)
  const status = stringField(filter.status)
  const rows = db.query(`
    SELECT job_run_id, cycle_id, ticket_no, job_id, target_domain, status,
      command_ref, started_at, completed_at, result_ref, error_json
    FROM job_run
    WHERE ($cycle_id = '' OR cycle_id = $cycle_id)
      AND ($status = '' OR status = $status)
    ORDER BY started_at, rowid
  `).all({
    $cycle_id: cycleId,
    $status: status,
  }) as JobRunRow[]
  return rows.map(jobRunFromRow)
}

export function readControlReviews(db: Database, filter: JSONRecord = {}): ControlReview[] {
  const cycleId = stringField(filter.cycle_id)
  const rows = db.query(`
    SELECT review_id, cycle_id, status, summary_json, items_json, constraints_json, created_at
    FROM control_review
    WHERE ($cycle_id = '' OR cycle_id = $cycle_id)
    ORDER BY created_at, rowid
  `).all({
    $cycle_id: cycleId,
  }) as ControlReviewRow[]
  return rows.map(controlReviewFromRow)
}

export function readLatestRuntimeHealth(db: Database): RuntimeHealth | null {
  const row = db.query(`
    SELECT health_id, cycle_id, status, checks_json, observed_at
    FROM runtime_health
    ORDER BY observed_at DESC, rowid DESC
    LIMIT 1
  `).get() as RuntimeHealthRow | null
  return row ? runtimeHealthFromRow(row) : null
}

export function readCycleSummary(db: Database, cycleId: string): JSONRecord {
  if (!cycleId) {
    throw new Error("cycle_id is required")
  }
  const cycle = db.query(`
    SELECT cycle_id, triggered_at, completed_at, status, summary_json
    FROM cycle_run
    WHERE cycle_id = $cycle_id
  `).get({ $cycle_id: cycleId }) as CycleRunRow | null
  const jobs = db.query(`
    SELECT ticket_no, job_id, target_domain, status, command_ref, result_ref, error_json
    FROM job_run
    WHERE cycle_id = $cycle_id
    ORDER BY ticket_no, rowid
  `).all({ $cycle_id: cycleId }) as JobRunSummaryRow[]
  const health = db.query(`
    SELECT health_id, cycle_id, status, checks_json, observed_at
    FROM runtime_health
    WHERE cycle_id = $cycle_id
    ORDER BY observed_at DESC, rowid DESC
    LIMIT 1
  `).get({ $cycle_id: cycleId }) as RuntimeHealthRow | null
  const messages = readDomainMessages(db, { cycle_id: cycleId })
  const incidents = readIncidents(db, { cycle_id: cycleId })
  const cycleRecord = cycle ? cycleRunFromRow(cycle) : null
  const latestHealth = health ? runtimeHealthFromRow(health) : null
  const jobRecords = jobs.map(jobRunSummaryFromRow)
  return {
    cycle: cycleRecord,
    latest_health: latestHealth,
    jobs: jobRecords,
    messages,
    incidents,
    ops_summary: buildOpsCycleSummary(cycleRecord, latestHealth, jobRecords, messages, incidents),
  }
}

export function buildOpsCycleSummary(
  cycle: CycleRun | null,
  latestHealth: RuntimeHealth | null,
  jobs: JSONRecord[],
  messages: DomainMessage[],
  incidents: Incident[] = [],
): JSONRecord {
  const counts = countStatuses(jobs)
  const failedJobs = jobs.filter((job) => stringField(job.status) === "failed")
  const blockedJobs = jobs.filter((job) => stringField(job.status) === "blocked")
  const failedMessages = messages.filter((message) => message.status === "failed")
  const openIncidents = incidents.filter((incident) => incident.status === "open")
  const acknowledgedIncidents = incidents.filter((incident) => incident.status === "acknowledged")
  const activeIncidents = [...openIncidents, ...acknowledgedIncidents]
  const criticalIncidents = activeIncidents.filter((incident) => incident.severity === "critical")
  const warningIncidents = activeIncidents.filter((incident) => incident.severity === "warning")
  const healthStatus = latestHealth?.status
  const criticalReasons = [
    ...failedJobs.map((job) => `job_failed:${stringField(job.ticket_no) || stringField(job.job_id)}`),
    ...blockedJobs.map((job) => `job_blocked:${stringField(job.ticket_no) || stringField(job.job_id)}`),
    ...failedMessages.map((message) => `message_failed:${message.message_id}`),
    ...criticalIncidents.map((incident) => `incident:${incident.incident_id}`),
  ]
  if (healthStatus === "blocked" || healthStatus === "safe_mode") {
    criticalReasons.push(`runtime_health:${healthStatus}`)
  }
  const warningReasons = [
    ...(healthStatus === "degraded" ? [`runtime_health:${healthStatus}`] : []),
    ...warningIncidents.map((incident) => `incident:${incident.incident_id}`),
  ]
  const severity = criticalReasons.length > 0 ? "critical" : warningReasons.length > 0 ? "warning" : "none"

  return {
    cycle_id: cycle?.cycle_id,
    status: cycle?.status ?? "missing",
    mode: stringField(cycle?.summary_json?.mode),
    counts,
    stages: summarizeBy(jobs, "stage"),
    domains: summarizeBy(jobs, "target_domain"),
    messages: {
      total: messages.length,
      inbox: messages.filter((message) => message.direction === "inbox").length,
      outbox: messages.filter((message) => message.direction === "outbox").length,
      published: messages.filter((message) => message.status === "published").length,
      failed: failedMessages.length,
    },
    incidents: {
      total: incidents.length,
      open: openIncidents.length,
      acknowledged: acknowledgedIncidents.length,
      active: activeIncidents.length,
      critical: criticalIncidents.length,
      warning: warningIncidents.length,
    },
    attention: {
      needs_human: criticalReasons.length > 0,
      severity,
      reasons: [...criticalReasons, ...warningReasons],
      failed_jobs: failedJobs.map(jobAttentionRef),
      blocked_jobs: blockedJobs.map(jobAttentionRef),
      failed_messages: failedMessages.map((message) => ({
        message_id: message.message_id,
        job_id: message.job_id,
        target_domain: message.target_domain,
        payload_ref: message.payload_ref,
      })),
      open_incidents: openIncidents.map(incidentAttentionRef),
      active_incidents: activeIncidents.map(incidentAttentionRef),
      latest_health_status: healthStatus,
    },
    result_refs: jobs
      .filter((job) => stringField(job.result_ref))
      .map((job) => ({
        ticket_no: stringField(job.ticket_no),
        job_id: stringField(job.job_id),
        result_ref: stringField(job.result_ref),
      })),
  }
}

export function buildCycleRun(input: JSONRecord): CycleRun {
  const now = stringField(input.now) || new Date().toISOString()
  return {
    cycle_id: stringField(input.cycle_id) || `cycle-${now.replace(/[^0-9]/g, "") || crypto.randomUUID()}`,
    triggered_at: stringField(input.triggered_at) || now,
    completed_at: stringField(input.completed_at) || undefined,
    status: parseCycleStatus(input.status) || "running",
    summary_json: asOptionalRecord(input.summary_json ?? input.summary),
  }
}

export function buildJobRun(input: JSONRecord): JobRun {
  const ticketNo = stringField(input.ticket_no)
  const jobId = stringField(input.job_id)
  return {
    job_run_id: stringField(input.job_run_id) || `${stringField(input.cycle_id)}-${ticketNo}-${jobId}`,
    cycle_id: stringField(input.cycle_id),
    ticket_no: ticketNo,
    job_id: jobId,
    target_domain: stringField(input.target_domain),
    status: parseJobStatus(input.status) || "planned",
    command_ref: stringField(input.command_ref) || undefined,
    started_at: stringField(input.started_at) || undefined,
    completed_at: stringField(input.completed_at) || undefined,
    result_ref: stringField(input.result_ref) || undefined,
    error_json: asOptionalRecord(input.error_json ?? input.error),
  }
}

function incidentIdFrom(input: JSONRecord, source: string, title: string, now: string): string {
  const cycle = stringField(input.cycle_id) || "cycle"
  const ref = stringField(input.ref) || stringField(input.job_id) || stringField(input.message_id) || title
  const suffix = `${cycle}:${source}:${ref}:${now}`.replace(/[^A-Za-z0-9_.:-]+/g, "-")
  return `incident-${suffix || crypto.randomUUID()}`
}

function incidentEventIdFrom(incidentId: string, action: IncidentAction, now: string): string {
  const suffix = `${incidentId}:${action}:${now}`.replace(/[^A-Za-z0-9_.:-]+/g, "-")
  return `incident-event-${suffix || crypto.randomUUID()}`
}

function statusAfterAction(current: IncidentStatus, action: IncidentAction): IncidentStatus {
  if (action === "acknowledge") {
    if (current !== "open") {
      throw new Error(`incident action acknowledge requires open status, got ${current}`)
    }
    return "acknowledged"
  }
  if (action === "resolve") {
    if (current !== "open" && current !== "acknowledged") {
      throw new Error(`incident action resolve requires open or acknowledged status, got ${current}`)
    }
    return "resolved"
  }
  if (action === "ignore") {
    if (current !== "open" && current !== "acknowledged") {
      throw new Error(`incident action ignore requires open or acknowledged status, got ${current}`)
    }
    return "ignored"
  }
  if (current === "open") {
    throw new Error("incident action reopen requires acknowledged, resolved, or ignored status")
  }
  return "open"
}

function validateCycleRun(run: CycleRun): void {
  if (!run.cycle_id || !run.triggered_at) {
    throw new Error("cycle_id and triggered_at are required")
  }
  if (!CYCLE_STATUSES.includes(run.status)) {
    throw new Error(`unsupported cycle status: ${run.status}`)
  }
}

function validateJobRun(run: JobRun): void {
  if (!run.job_run_id || !run.cycle_id || !run.ticket_no || !run.job_id || !run.target_domain) {
    throw new Error("job_run_id, cycle_id, ticket_no, job_id, and target_domain are required")
  }
  if (!JOB_STATUSES.includes(run.status)) {
    throw new Error(`unsupported job status: ${run.status}`)
  }
}

function validateRuntimeHealth(health: RuntimeHealth): void {
  if (!health.health_id || !health.observed_at) {
    throw new Error("health_id and observed_at are required")
  }
  if (!HEALTH_STATUSES.includes(health.status)) {
    throw new Error(`unsupported health status: ${health.status}`)
  }
}

function validateNotifyAttempt(attempt: NotifyAttempt): void {
  if (!attempt.notify_id || !attempt.channel || !attempt.attempted_at) {
    throw new Error("notify_id, channel, and attempted_at are required")
  }
  if (!NOTIFY_STATUSES.includes(attempt.status)) {
    throw new Error(`unsupported notify status: ${attempt.status}`)
  }
}

function validateDomainMessage(message: DomainMessage): void {
  if (!message.message_id || !message.rail || !message.payload_ref || !message.created_at) {
    throw new Error("message_id, rail, payload_ref, and created_at are required")
  }
  if (!DOMAIN_MESSAGE_DIRECTIONS.includes(message.direction)) {
    throw new Error(`unsupported domain message direction: ${message.direction}`)
  }
  if (!DOMAIN_MESSAGE_STATUSES.includes(message.status)) {
    throw new Error(`unsupported domain message status: ${message.status}`)
  }
}

function validateIncident(incident: Incident): void {
  if (!incident.incident_id || !incident.title || !incident.first_seen_at || !incident.last_seen_at) {
    throw new Error("incident_id, title, first_seen_at, and last_seen_at are required")
  }
  if (!INCIDENT_SOURCES.includes(incident.source)) {
    throw new Error(`unsupported incident source: ${incident.source}`)
  }
  if (!INCIDENT_SEVERITIES.includes(incident.severity)) {
    throw new Error(`unsupported incident severity: ${incident.severity}`)
  }
  if (!INCIDENT_STATUSES.includes(incident.status)) {
    throw new Error(`unsupported incident status: ${incident.status}`)
  }
}

function validateIncidentEvent(event: IncidentEvent): void {
  if (!event.event_id || !event.incident_id || !event.created_at) {
    throw new Error("event_id, incident_id, and created_at are required")
  }
  if (!INCIDENT_ACTIONS.includes(event.action)) {
    throw new Error(`unsupported incident action: ${event.action}`)
  }
  if (!INCIDENT_STATUSES.includes(event.status_after)) {
    throw new Error(`unsupported incident status_after: ${event.status_after}`)
  }
}

function validateControlReview(review: ControlReview): void {
  if (!review.review_id || !review.created_at) {
    throw new Error("review_id and created_at are required")
  }
  if (review.status !== "ok" && review.status !== "needs_attention") {
    throw new Error(`unsupported control review status: ${review.status}`)
  }
  if (!Array.isArray(review.items_json) || !Array.isArray(review.constraints_json)) {
    throw new Error("items_json and constraints_json must be arrays")
  }
}

function validateRuntimeParityObservation(observation: RuntimeParityObservation): void {
  if (!observation.observation_id || !observation.program_cycle_id || !observation.agent_cycle_id) {
    throw new Error("observation_id, program_cycle_id, and agent_cycle_id are required")
  }
  if (!observation.program_projection_hash || !observation.agent_projection_hash) {
    throw new Error("program_projection_hash and agent_projection_hash are required")
  }
  if (!PARITY_OBSERVATION_STATUSES.includes(observation.status)) {
    throw new Error(`unsupported runtime parity observation status: ${observation.status}`)
  }
  if (!Number.isFinite(Date.parse(observation.observed_at))) {
    throw new Error("runtime parity observed_at must be a valid date")
  }
  if (observation.status === "match" && observation.program_projection_hash !== observation.agent_projection_hash) {
    throw new Error("matching runtime parity observation requires equal projection hashes")
  }
  if (observation.status === "mismatch" && observation.program_projection_hash === observation.agent_projection_hash) {
    throw new Error("mismatching runtime parity observation requires different projection hashes")
  }
}

function parseCycleStatus(value: unknown): CycleStatus | "" {
  const status = stringField(value)
  return CYCLE_STATUSES.includes(status as CycleStatus) ? status as CycleStatus : ""
}

function parseJobStatus(value: unknown): JobStatus | "" {
  const status = stringField(value)
  return JOB_STATUSES.includes(status as JobStatus) ? status as JobStatus : ""
}

function parseDomainMessageStatus(value: unknown): DomainMessageStatus | "" {
  const status = stringField(value)
  return DOMAIN_MESSAGE_STATUSES.includes(status as DomainMessageStatus) ? status as DomainMessageStatus : ""
}

function parseDomainMessageDirection(value: unknown): DomainMessageDirection | "" {
  const direction = stringField(value)
  return DOMAIN_MESSAGE_DIRECTIONS.includes(direction as DomainMessageDirection) ? direction as DomainMessageDirection : ""
}

function parseIncidentSource(value: unknown): IncidentSource | "" {
  const source = stringField(value)
  return INCIDENT_SOURCES.includes(source as IncidentSource) ? source as IncidentSource : ""
}

function parseIncidentSeverity(value: unknown): IncidentSeverity | "" {
  const severity = stringField(value)
  return INCIDENT_SEVERITIES.includes(severity as IncidentSeverity) ? severity as IncidentSeverity : ""
}

function parseIncidentStatus(value: unknown): IncidentStatus | "" {
  const status = stringField(value)
  return INCIDENT_STATUSES.includes(status as IncidentStatus) ? status as IncidentStatus : ""
}

function parseIncidentAction(value: unknown): IncidentAction | "" {
  const action = stringField(value)
  return INCIDENT_ACTIONS.includes(action as IncidentAction) ? action as IncidentAction : ""
}

function envelopeDirectionFromSchemaId(schemaId: string): string {
  if (schemaId.endsWith("domain-inbox-envelope.v1")) {
    return "inbox"
  }
  if (schemaId.endsWith("domain-outbox-envelope.v1")) {
    return "outbox"
  }
  return ""
}

function asOptionalRecord(value: unknown): JSONRecord | undefined {
  const record = asRecord(value)
  return Object.keys(record).length > 0 ? record : undefined
}

interface RuntimeHealthRow {
  health_id: string
  cycle_id: string | null
  status: HealthStatus
  checks_json: string
  observed_at: string
}

interface CycleRunRow {
  cycle_id: string
  triggered_at: string
  completed_at: string | null
  status: CycleStatus
  summary_json: string | null
}

interface JobRunSummaryRow {
  ticket_no: string
  job_id: string
  target_domain: string
  status: JobStatus
  command_ref: string | null
  result_ref: string | null
  error_json: string | null
}

interface JobRunRow extends JobRunSummaryRow {
  job_run_id: string
  cycle_id: string
  started_at: string | null
  completed_at: string | null
}

interface NotifyAttemptRow {
  notify_id: string
  cycle_id: string | null
  channel: string
  status: NotifyStatus
  payload_ref: string | null
  result_json: string | null
  attempted_at: string
}

interface DomainMessageRow {
  message_id: string
  cycle_id: string | null
  job_id: string | null
  direction: DomainMessageDirection
  source_domain: string | null
  target_domain: string | null
  rail: string
  payload_ref: string
  idempotency_key: string | null
  status: DomainMessageStatus
  envelope_json: string
  created_at: string
  processed_at: string | null
  error_json: string | null
}

interface IncidentRow {
  incident_id: string
  cycle_id: string | null
  source: IncidentSource
  severity: IncidentSeverity
  status: IncidentStatus
  title: string
  detail_json: string | null
  refs_json: string | null
  first_seen_at: string
  last_seen_at: string
}

interface IncidentEventRow {
  event_id: string
  incident_id: string
  action: IncidentAction
  status_after: IncidentStatus
  actor: string | null
  note: string | null
  detail_json: string | null
  created_at: string
}

interface ControlReviewRow {
  review_id: string
  cycle_id: string | null
  status: "ok" | "needs_attention"
  summary_json: string
  items_json: string
  constraints_json: string
  created_at: string
}

interface RuntimeParityObservationRow {
  observation_id: string
  program_cycle_id: string
  agent_cycle_id: string
  program_projection_hash: string
  agent_projection_hash: string
  status: ParityObservationStatus
  detail_json: string
  observed_at: string
}

interface RuntimeParityStatusRow {
  total: number
  matched: number
  mismatched: number
  distinct_program_hashes: number
  distinct_agent_hashes: number
  first_observed_at: string | null
  last_observed_at: string | null
}

interface RuntimeParityMethodologyStatusRow {
  shared_total: number
  shared_matched: number
  shared_mismatched: number
  sequential_total: number
  sequential_matched: number
  sequential_mismatched: number
}

function runtimeHealthFromRow(row: RuntimeHealthRow): RuntimeHealth {
  return {
    health_id: row.health_id,
    cycle_id: row.cycle_id ?? undefined,
    status: row.status,
    checks_json: JSON.parse(row.checks_json) as JSONRecord,
    observed_at: row.observed_at,
  }
}

function notifyAttemptFromRow(row: NotifyAttemptRow): NotifyAttempt {
  return {
    notify_id: row.notify_id,
    cycle_id: row.cycle_id ?? undefined,
    channel: row.channel,
    status: row.status,
    payload_ref: row.payload_ref ?? undefined,
    result_json: row.result_json ? JSON.parse(row.result_json) as JSONRecord : undefined,
    attempted_at: row.attempted_at,
  }
}

function jobRunFromRow(row: JobRunRow): JobRun {
  return {
    job_run_id: row.job_run_id,
    cycle_id: row.cycle_id,
    ticket_no: row.ticket_no,
    job_id: row.job_id,
    target_domain: row.target_domain,
    status: row.status,
    command_ref: row.command_ref ?? undefined,
    started_at: row.started_at ?? undefined,
    completed_at: row.completed_at ?? undefined,
    result_ref: row.result_ref ?? undefined,
    error_json: row.error_json ? JSON.parse(row.error_json) as JSONRecord : undefined,
  }
}

function cycleRunFromRow(row: CycleRunRow): CycleRun {
  return {
    cycle_id: row.cycle_id,
    triggered_at: row.triggered_at,
    completed_at: row.completed_at ?? undefined,
    status: row.status,
    summary_json: row.summary_json ? JSON.parse(row.summary_json) as JSONRecord : undefined,
  }
}

function jobRunSummaryFromRow(row: JobRunSummaryRow): JSONRecord {
  return {
    ticket_no: row.ticket_no,
    job_id: row.job_id,
    target_domain: row.target_domain,
    status: row.status,
    command_ref: row.command_ref ?? undefined,
    stage: stageFromCommandRef(row.command_ref, row.job_id),
    result_ref: row.result_ref ?? undefined,
    error_json: row.error_json ? JSON.parse(row.error_json) as JSONRecord : undefined,
  }
}

function stageFromCommandRef(commandRef: string | null, jobId: string): string {
  if (!commandRef || !commandRef.endsWith(`:${jobId}`)) {
    return "unspecified"
  }
  return commandRef.slice(0, -jobId.length - 1) || "unspecified"
}

function countStatuses(jobs: JSONRecord[]): JSONRecord {
  return {
    total: jobs.length,
    completed: countJobsByStatus(jobs, "completed"),
    skipped: countJobsByStatus(jobs, "skipped"),
    failed: countJobsByStatus(jobs, "failed"),
    blocked: countJobsByStatus(jobs, "blocked"),
    running: countJobsByStatus(jobs, "running"),
    planned: countJobsByStatus(jobs, "planned"),
  }
}

function countJobsByStatus(jobs: JSONRecord[], status: string): number {
  return jobs.filter((job) => stringField(job.status) === status).length
}

function summarizeBy(jobs: JSONRecord[], field: string): JSONRecord[] {
  const groups = new Map<string, JSONRecord[]>()
  for (const job of jobs) {
    const key = stringField(job[field]) || "unspecified"
    groups.set(key, [...(groups.get(key) ?? []), job])
  }
  return Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, group]) => ({
      [field]: key,
      ...countStatuses(group),
      jobs: group.map((job) => ({
        ticket_no: stringField(job.ticket_no),
        job_id: stringField(job.job_id),
        status: stringField(job.status),
      })),
    }))
}

function jobAttentionRef(job: JSONRecord): JSONRecord {
  return {
    ticket_no: stringField(job.ticket_no),
    job_id: stringField(job.job_id),
    target_domain: stringField(job.target_domain),
    result_ref: stringField(job.result_ref) || undefined,
    error: asOptionalRecord(job.error_json),
  }
}

function incidentAttentionRef(incident: Incident): JSONRecord {
  return {
    incident_id: incident.incident_id,
    source: incident.source,
    severity: incident.severity,
    title: incident.title,
    refs: incident.refs_json ?? [],
  }
}

function domainMessageFromRow(row: DomainMessageRow): DomainMessage {
  return {
    message_id: row.message_id,
    cycle_id: row.cycle_id ?? undefined,
    job_id: row.job_id ?? undefined,
    direction: row.direction,
    source_domain: row.source_domain ?? undefined,
    target_domain: row.target_domain ?? undefined,
    rail: row.rail,
    payload_ref: row.payload_ref,
    idempotency_key: row.idempotency_key ?? undefined,
    status: row.status,
    envelope_json: JSON.parse(row.envelope_json) as JSONRecord,
    created_at: row.created_at,
    processed_at: row.processed_at ?? undefined,
    error_json: row.error_json ? JSON.parse(row.error_json) as JSONRecord : undefined,
  }
}

function incidentFromRow(row: IncidentRow): Incident {
  return {
    incident_id: row.incident_id,
    cycle_id: row.cycle_id ?? undefined,
    source: row.source,
    severity: row.severity,
    status: row.status,
    title: row.title,
    detail_json: row.detail_json ? JSON.parse(row.detail_json) as JSONRecord : undefined,
    refs_json: row.refs_json ? JSON.parse(row.refs_json) as string[] : undefined,
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
  }
}

function incidentEventFromRow(row: IncidentEventRow): IncidentEvent {
  return {
    event_id: row.event_id,
    incident_id: row.incident_id,
    action: row.action,
    status_after: row.status_after,
    actor: row.actor ?? undefined,
    note: row.note ?? undefined,
    detail_json: row.detail_json ? JSON.parse(row.detail_json) as JSONRecord : undefined,
    created_at: row.created_at,
  }
}

function controlReviewFromRow(row: ControlReviewRow): ControlReview {
  return {
    review_id: row.review_id,
    cycle_id: row.cycle_id ?? undefined,
    status: row.status,
    summary_json: JSON.parse(row.summary_json) as JSONRecord,
    items_json: JSON.parse(row.items_json) as JSONRecord[],
    constraints_json: JSON.parse(row.constraints_json) as JSONRecord[],
    created_at: row.created_at,
  }
}

function runtimeParityObservationFromRow(row: RuntimeParityObservationRow): RuntimeParityObservation {
  return {
    observation_id: row.observation_id,
    program_cycle_id: row.program_cycle_id,
    agent_cycle_id: row.agent_cycle_id,
    program_projection_hash: row.program_projection_hash,
    agent_projection_hash: row.agent_projection_hash,
    status: row.status,
    detail_json: JSON.parse(row.detail_json) as JSONRecord,
    observed_at: row.observed_at,
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}
