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

export const DOMAIN_MESSAGE_STATUSES = ["queued", "published", "consumed", "failed"] as const
export type DomainMessageStatus = typeof DOMAIN_MESSAGE_STATUSES[number]

export const DOMAIN_MESSAGE_DIRECTIONS = ["inbox", "outbox"] as const
export type DomainMessageDirection = typeof DOMAIN_MESSAGE_DIRECTIONS[number]

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
      expires_at    TEXT NOT NULL
    )
  `)
  db.run("CREATE INDEX IF NOT EXISTS idx_job_run_cycle ON job_run(cycle_id, ticket_no)")
  db.run("CREATE INDEX IF NOT EXISTS idx_runtime_health_time ON runtime_health(observed_at DESC)")
  db.run("CREATE INDEX IF NOT EXISTS idx_domain_message_cycle ON domain_message(cycle_id, job_id, direction)")
  db.run("CREATE INDEX IF NOT EXISTS idx_domain_message_target ON domain_message(target_domain, status, created_at)")
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
    ORDER BY created_at ASC, rowid ASC
  `).all({
    $cycle_id: cycleId,
    $target_domain: targetDomain,
    $status: status,
  }) as DomainMessageRow[]
  return rows.map(domainMessageFromRow)
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
    ORDER BY ticket_no ASC, rowid ASC
  `).all({ $cycle_id: cycleId }) as JobRunSummaryRow[]
  const health = db.query(`
    SELECT health_id, cycle_id, status, checks_json, observed_at
    FROM runtime_health
    WHERE cycle_id = $cycle_id
    ORDER BY observed_at DESC, rowid DESC
    LIMIT 1
  `).get({ $cycle_id: cycleId }) as RuntimeHealthRow | null
  const messages = readDomainMessages(db, { cycle_id: cycleId })
  const cycleRecord = cycle ? cycleRunFromRow(cycle) : null
  const latestHealth = health ? runtimeHealthFromRow(health) : null
  const jobRecords = jobs.map(jobRunSummaryFromRow)
  return {
    cycle: cycleRecord,
    latest_health: latestHealth,
    jobs: jobRecords,
    messages,
    ops_summary: buildOpsCycleSummary(cycleRecord, latestHealth, jobRecords, messages),
  }
}

export function buildOpsCycleSummary(
  cycle: CycleRun | null,
  latestHealth: RuntimeHealth | null,
  jobs: JSONRecord[],
  messages: DomainMessage[],
): JSONRecord {
  const counts = countStatuses(jobs)
  const failedJobs = jobs.filter((job) => stringField(job.status) === "failed")
  const blockedJobs = jobs.filter((job) => stringField(job.status) === "blocked")
  const failedMessages = messages.filter((message) => message.status === "failed")
  const healthStatus = latestHealth?.status
  const criticalReasons = [
    ...failedJobs.map((job) => `job_failed:${stringField(job.ticket_no) || stringField(job.job_id)}`),
    ...blockedJobs.map((job) => `job_blocked:${stringField(job.ticket_no) || stringField(job.job_id)}`),
    ...failedMessages.map((message) => `message_failed:${message.message_id}`),
  ]
  if (healthStatus === "blocked" || healthStatus === "safe_mode") {
    criticalReasons.push(`runtime_health:${healthStatus}`)
  }
  const warningReasons = healthStatus === "degraded" ? [`runtime_health:${healthStatus}`] : []
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
