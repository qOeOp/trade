import { Database } from "bun:sqlite"
import { asRecord, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"

export const CYCLE_STATUSES = ["running", "completed", "failed", "blocked"] as const
export type CycleStatus = typeof CYCLE_STATUSES[number]

export const JOB_STATUSES = ["planned", "running", "completed", "skipped", "failed", "blocked"] as const
export type JobStatus = typeof JOB_STATUSES[number]

export const HEALTH_STATUSES = ["ok", "degraded", "safe_mode", "blocked"] as const
export type HealthStatus = typeof HEALTH_STATUSES[number]

export const NOTIFY_STATUSES = ["planned", "sent", "failed", "skipped"] as const
export type NotifyStatus = typeof NOTIFY_STATUSES[number]

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
    CREATE TABLE IF NOT EXISTS ops_lock (
      lock_key      TEXT PRIMARY KEY,
      holder_id     TEXT NOT NULL,
      acquired_at   TEXT NOT NULL,
      expires_at    TEXT NOT NULL
    )
  `)
  db.run("CREATE INDEX IF NOT EXISTS idx_job_run_cycle ON job_run(cycle_id, ticket_no)")
  db.run("CREATE INDEX IF NOT EXISTS idx_runtime_health_time ON runtime_health(observed_at DESC)")
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
  if (!lock.lock_key || !lock.holder_id || !lock.acquired_at || !lock.expires_at) {
    throw new Error("lock_key, holder_id, acquired_at, and expires_at are required")
  }
  db.query(`
    INSERT INTO ops_lock(lock_key, holder_id, acquired_at, expires_at)
    VALUES ($lock_key, $holder_id, $acquired_at, $expires_at)
    ON CONFLICT(lock_key) DO UPDATE SET
      holder_id = excluded.holder_id,
      acquired_at = excluded.acquired_at,
      expires_at = excluded.expires_at
  `).run({
    $lock_key: lock.lock_key,
    $holder_id: lock.holder_id,
    $acquired_at: lock.acquired_at,
    $expires_at: lock.expires_at,
  })
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
    SELECT ticket_no, job_id, target_domain, status, result_ref, error_json
    FROM job_run
    WHERE cycle_id = $cycle_id
    ORDER BY ticket_no ASC, rowid ASC
  `).all({ $cycle_id: cycleId }) as JobRunSummaryRow[]
  const health = db.query(`
    SELECT health_id, cycle_id, status, checks_json, observed_at
    FROM runtime_health
    WHERE cycle_id = $cycle_id
    ORDER BY observed_at DESC, rowid DESC
    LIMIT 1
  `).get({ $cycle_id: cycleId }) as RuntimeHealthRow | null
  return {
    cycle: cycle ? cycleRunFromRow(cycle) : null,
    latest_health: health ? runtimeHealthFromRow(health) : null,
    jobs: jobs.map(jobRunSummaryFromRow),
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

function parseCycleStatus(value: unknown): CycleStatus | "" {
  const status = stringField(value)
  return CYCLE_STATUSES.includes(status as CycleStatus) ? status as CycleStatus : ""
}

function parseJobStatus(value: unknown): JobStatus | "" {
  const status = stringField(value)
  return JOB_STATUSES.includes(status as JobStatus) ? status as JobStatus : ""
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
  result_ref: string | null
  error_json: string | null
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
    result_ref: row.result_ref ?? undefined,
    error_json: row.error_json ? JSON.parse(row.error_json) as JSONRecord : undefined,
  }
}

