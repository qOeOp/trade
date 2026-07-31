import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { asRecord, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { runOwnerToolRecordSync } from "../../../../contracts/runtime-core/src/owner-tool-client"
import { ensureOpsRuntimeSchema, recordRuntimeHealth, type HealthStatus, type RuntimeHealth } from "../../../ops-runtime-store/src/lib/ops-runtime-store"

export interface HealthCheck {
  name: string
  status: "ok" | "warn" | "fail"
  detail?: string
  evidence?: JSONRecord
}

export interface RuntimeHealthGuardDependencies {
  readL2OwnerHealth?: () => JSONRecord
  readL2WatchConsumer?: () => JSONRecord
}

export interface RuntimeHealthResult {
  ok: boolean
  processor_id: "runtime_health_guard"
  lifecycle_phase: "pre_cycle"
  status: HealthStatus
  health_ref: string
  health: RuntimeHealth
}

export function runRuntimeHealthGuard(
  db: Database,
  input: JSONRecord,
  env: Record<string, string | undefined> = process.env,
  dependencies: RuntimeHealthGuardDependencies = {},
): RuntimeHealthResult {
  ensureOpsRuntimeSchema(db)
  const observedAt = stringField(input.observed_at) || stringField(input.now) || new Date().toISOString()
  const checks = buildHealthChecks(input, env, dependencies)
  const status = deriveHealthStatus(Boolean(input.safe_mode), checks)
  const health: RuntimeHealth = {
    health_id: stringField(input.health_id) || `health-${observedAt.replace(/[^0-9]/g, "") || crypto.randomUUID()}`,
    cycle_id: stringField(input.cycle_id) || undefined,
    status,
    observed_at: observedAt,
    checks_json: {
      safe_mode: Boolean(input.safe_mode),
      checks,
    },
  }
  recordRuntimeHealth(db, health)
  return {
    ok: status === "ok",
    processor_id: "runtime_health_guard",
    lifecycle_phase: "pre_cycle",
    status,
    health_ref: `ops_runtime_store:runtime_health/${health.health_id}`,
    health,
  }
}

export function buildHealthChecks(
  input: JSONRecord,
  env: Record<string, string | undefined> = process.env,
  dependencies: RuntimeHealthGuardDependencies = {},
): HealthCheck[] {
  const checks: HealthCheck[] = []
  for (const key of stringList(input.required_env)) {
    checks.push(env[key] ? ok(`env:${key}`) : fail(`env:${key}`, "missing required environment variable"))
  }
  for (const path of stringList(input.required_paths)) {
    checks.push(existsSync(path) ? ok(`path:${path}`) : fail(`path:${path}`, "missing required path"))
  }
  for (const spec of recordList(input.sqlite_stores)) {
    checks.push(checkSqliteStore(spec))
  }
  if (Object.hasOwn(input, "require_l2_ready") && typeof input.require_l2_ready !== "boolean") {
    checks.push(fail("config:require_l2_ready", "require_l2_ready must be boolean"))
  } else if (input.require_l2_ready === true) {
    checks.push(checkL2OwnerHealth(dependencies.readL2OwnerHealth ?? readL2OwnerHealth))
  }
  if (Object.hasOwn(input, "require_l2_watch_consumer_ready") && typeof input.require_l2_watch_consumer_ready !== "boolean") {
    checks.push(fail("config:require_l2_watch_consumer_ready", "require_l2_watch_consumer_ready must be boolean"))
  } else if (input.require_l2_watch_consumer_ready === true) {
    checks.push(checkL2WatchConsumer(dependencies.readL2WatchConsumer ?? readL2WatchConsumer))
  }
  if (checks.length === 0) {
    checks.push(ok("runtime:default"))
  }
  if (input.safe_mode) {
    checks.push({ name: "safe_mode", status: "warn", detail: "safe mode explicitly enabled" })
  }
  return checks
}

function readL2OwnerHealth(): JSONRecord {
  const response = runOwnerToolRecordSync("market-data.l2-service-health", [], "L2 service health")
  const health = asRecord(response.health)
  if (Object.keys(health).length === 0) throw new Error("L2 owner health response is missing health")
  return health
}

function readL2WatchConsumer(): JSONRecord {
  const response = runOwnerToolRecordSync("ops.l2-book-watch-consumer", [], "L2 watch consumer")
  if (response.ok !== true || response.action !== "read_active_l2_book_watch_consumer") {
    throw new Error("L2 watch consumer owner response identity drifted")
  }
  const consumer = asRecord(response.consumer)
  if (Object.keys(consumer).length === 0) throw new Error("L2 watch consumer response is missing consumer")
  return consumer
}

function checkL2OwnerHealth(readHealth: () => JSONRecord): HealthCheck {
  const name = "l2_service:owner_health"
  try {
    const health = readHealth()
    const evidence = projectL2HealthEvidence(health)
    const readiness = asRecord(health.readiness)
    const ready = readiness.overall_ready === true && health.status === "healthy"
    return ready
      ? { name, status: "ok", detail: "owner reported healthy/overall_ready=true", evidence }
      : { name, status: "fail", detail: `owner reported ${stringField(health.status)}/overall_ready=${String(readiness.overall_ready)}`, evidence }
  } catch {
    return fail(name, "L2 owner health read failed closed")
  }
}

function projectL2HealthEvidence(health: JSONRecord): JSONRecord {
  if (health.schema_version !== "trade.l2-service-owner-health.v1") {
    throw new Error("unsupported L2 owner health schema")
  }
  const observedAt = stringField(health.observed_at)
  const status = stringField(health.status)
  if (!observedAt || !L2_HEALTH_STATUSES.has(status)) throw new Error("invalid L2 owner health identity")
  if (health.lifecycle_authority !== "none") throw new Error("L2 owner health authority drifted")
  if (health.symbol !== null && typeof health.symbol !== "string") throw new Error("invalid L2 owner health symbol")

  const readiness = asRecord(health.readiness)
  const readinessFields = ["supervisor_alive", "service_alive", "control_state_fresh", "control_ready", "source_read_ready", "overall_ready"]
  for (const field of readinessFields) {
    if (typeof readiness[field] !== "boolean") throw new Error(`invalid L2 owner readiness ${field}`)
  }

  const control = health.control == null ? null : asRecord(health.control)
  const source = health.source == null ? null : asRecord(health.source)
  return {
    schema_version: "trade.l2-service-owner-health.v1",
    observed_at: observedAt,
    status,
    symbol: health.symbol,
    readiness: Object.fromEntries(readinessFields.map((field) => [field, readiness[field]])),
    control: control == null ? null : {
      runtime_status: stringField(control.runtime_status),
      state_age_ms: finiteNumberOrNull(control.state_age_ms),
      state_stale_after_ms: finiteNumberOrNull(control.state_stale_after_ms),
      attempt: finiteNumberOrNull(control.attempt),
      consecutive_failures: finiteNumberOrNull(control.consecutive_failures),
      disk_status: stringField(control.disk_status),
      admission_status: stringField(control.admission_status),
    },
    source: source == null ? null : {
      continuity_status: stringField(source.continuity_status),
      read_ready: source.read_ready === true,
      freshness_ms: finiteNumberOrNull(source.freshness_ms),
      incident_count: finiteNumberOrNull(source.incident_count),
    },
    lifecycle_authority: "none",
  }
}

function checkL2WatchConsumer(readConsumer: () => JSONRecord): HealthCheck {
  const name = "l2_watch_consumer:owner_health"
  try {
    const consumer = readConsumer()
    const evidence = projectL2WatchConsumerEvidence(consumer)
    const readiness = asRecord(consumer.readiness)
    const ready = consumer.status === "healthy"
      && readiness.baseline_ready === true
      && readiness.overall_ready === true
      && evidence.control != null
      && evidence.latest_baseline != null
    return ready
      ? { name, status: "ok", detail: "owner reported healthy baseline/overall_ready=true", evidence }
      : { name, status: "fail", detail: `owner reported ${stringField(consumer.status)}/overall_ready=${String(readiness.overall_ready)}`, evidence }
  } catch {
    return fail(name, "L2 watch consumer owner read failed closed")
  }
}

function projectL2WatchConsumerEvidence(consumer: JSONRecord): JSONRecord {
  if (consumer.schema_version !== "trade.ops-l2-watch-consumer-owner-read.v1") {
    throw new Error("unsupported L2 watch consumer owner schema")
  }
  const observedAt = requiredUtc(consumer.observed_at, "consumer observed_at")
  const status = stringField(consumer.status)
  if (!L2_HEALTH_STATUSES.has(status)) throw new Error("invalid L2 watch consumer status")
  if (consumer.consumer_authority !== "non_economic_observation_only" || consumer.lifecycle_authority !== "none") {
    throw new Error("L2 watch consumer authority drifted")
  }
  if (!Array.isArray(consumer.writes) || consumer.writes.length !== 0) {
    throw new Error("L2 watch consumer write authority drifted")
  }

  const readiness = asRecord(consumer.readiness)
  for (const field of L2_WATCH_READINESS_FIELDS) {
    if (typeof readiness[field] !== "boolean") throw new Error(`invalid L2 watch consumer readiness ${field}`)
  }
  const control = consumer.control == null ? null : asRecord(consumer.control)
  const projectedControl = control == null ? null : {
    runtime_status: requiredString(control.runtime_status, "consumer control runtime_status"),
    state_age_ms: nonNegativeFinite(control.state_age_ms, "consumer control state_age_ms"),
    state_stale_after_ms: nonNegativeFinite(control.state_stale_after_ms, "consumer control state_stale_after_ms"),
    attempt: nonNegativeInteger(control.attempt, "consumer control attempt"),
    restart_total: nonNegativeInteger(control.restart_total, "consumer control restart_total"),
    consecutive_failures: nonNegativeInteger(control.consecutive_failures, "consumer control consecutive_failures"),
  }

  const baseline = consumer.latest_baseline == null ? null : asRecord(consumer.latest_baseline)
  const projectedBaseline = baseline == null ? null : {
    stream_epoch: requiredString(baseline.stream_epoch, "consumer baseline stream_epoch"),
    book_hash: sha256(baseline.book_hash, "consumer baseline book_hash"),
    snapshot_observed_at: requiredUtc(baseline.snapshot_observed_at, "consumer baseline snapshot_observed_at"),
    snapshot_freshness_ms: nonNegativeFinite(baseline.snapshot_freshness_ms, "consumer baseline snapshot_freshness_ms"),
    last_watch_at: baseline.last_watch_at == null ? null : requiredUtc(baseline.last_watch_at, "consumer baseline last_watch_at"),
    last_watch_event_count: boundedInteger(baseline.last_watch_event_count, 0, 100, "consumer baseline last_watch_event_count"),
  }
  const metrics = asRecord(consumer.metrics)
  const projectedMetrics = Object.fromEntries(L2_WATCH_METRIC_FIELDS.map((field) => [
    field,
    nonNegativeInteger(metrics[field], `consumer metrics ${field}`),
  ]))
  const lastFailure = consumer.last_failure == null ? null : asRecord(consumer.last_failure)
  const projectedLastFailure = lastFailure == null ? null : {
    observed_at: requiredUtc(lastFailure.observed_at, "consumer last failure observed_at"),
    operation: l2WatchFailureOperation(lastFailure.operation),
    error_class: l2WatchFailureClass(lastFailure.error_class),
    attempt: boundedInteger(lastFailure.attempt, 1, 6, "consumer last failure attempt"),
  }

  return {
    schema_version: "trade.ops-l2-watch-consumer-owner-read.v1",
    observed_at: observedAt,
    status,
    readiness: Object.fromEntries(L2_WATCH_READINESS_FIELDS.map((field) => [field, readiness[field]])),
    control: projectedControl,
    latest_baseline: projectedBaseline,
    metrics: projectedMetrics,
    last_failure: projectedLastFailure,
    consumer_authority: "non_economic_observation_only",
    lifecycle_authority: "none",
    writes: [],
  }
}

function checkSqliteStore(spec: JSONRecord): HealthCheck {
  const name = stringField(spec.name) || stringField(spec.path) || "sqlite_store"
  const path = stringField(spec.path)
  const table = stringField(spec.table)
  if (!path) {
    return fail(`sqlite:${name}`, "missing sqlite path")
  }
  try {
    const db = new Database(path, { readonly: true, create: false })
    try {
      if (table) {
        const row = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name=$table").get({ $table: table }) as { name: string } | null
        if (!row) {
          return fail(`sqlite:${name}`, `missing table ${table}`)
        }
      }
      return ok(`sqlite:${name}`)
    } finally {
      db.close()
    }
  } catch (error) {
    return fail(`sqlite:${name}`, error instanceof Error ? error.message : String(error))
  }
}

function deriveHealthStatus(safeMode: boolean, checks: HealthCheck[]): HealthStatus {
  if (safeMode) {
    return "safe_mode"
  }
  if (checks.some((check) => check.status === "fail")) {
    return "blocked"
  }
  if (checks.some((check) => check.status === "warn")) {
    return "degraded"
  }
  return "ok"
}

function ok(name: string): HealthCheck {
  return { name, status: "ok" }
}

function fail(name: string, detail: string): HealthCheck {
  return { name, status: "fail", detail }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringField).filter(Boolean) : []
}

function recordList(value: unknown): JSONRecord[] {
  return Array.isArray(value) ? value.map(asRecord) : []
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function requiredString(value: unknown, name: string): string {
  const result = stringField(value)
  if (!result) throw new Error(`${name} is required`)
  return result
}

function requiredUtc(value: unknown, name: string): string {
  const result = requiredString(value, name)
  if (!result.endsWith("Z") || !Number.isFinite(Date.parse(result))) throw new Error(`${name} must be UTC`)
  return result
}

function nonNegativeFinite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${name} must be non-negative finite number`)
  return value
}

function nonNegativeInteger(value: unknown, name: string): number {
  return boundedInteger(value, 0, Number.MAX_SAFE_INTEGER, name)
}

function boundedInteger(value: unknown, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return value as number
}

function sha256(value: unknown, name: string): string {
  const result = requiredString(value, name)
  if (!/^[a-f0-9]{64}$/i.test(result)) throw new Error(`${name} must be SHA-256`)
  return result.toLowerCase()
}

const L2_HEALTH_STATUSES = new Set(["healthy", "degraded", "starting", "stopped", "failed", "orphaned", "unavailable"])
const L2_WATCH_READINESS_FIELDS = [
  "supervisor_alive",
  "consumer_alive",
  "runtime_state_fresh",
  "observation_state_fresh",
  "baseline_ready",
  "overall_ready",
] as const
const L2_WATCH_METRIC_FIELDS = [
  "worker_start_total",
  "watch_cycle_total",
  "snapshot_total",
  "resnapshot_total",
  "retry_total",
  "watch_failure_total",
  "snapshot_failure_total",
  "reconnect_total",
  "resync_signal_total",
  "epoch_change_total",
  "observed_event_total",
] as const
const L2_WATCH_FAILURE_CLASSES = new Set([
  "owner_health_unavailable",
  "owner_health_not_ready",
  "current_book_unavailable",
  "current_book_stale",
  "snapshot_contract_drift",
  "snapshot_unavailable",
  "watch_contract_drift",
  "watch_unavailable",
])

function l2WatchFailureOperation(value: unknown): "snapshot" | "watch" {
  if (value !== "snapshot" && value !== "watch") throw new Error("invalid L2 watch consumer failure operation")
  return value
}

function l2WatchFailureClass(value: unknown): string {
  const result = requiredString(value, "consumer last failure error_class")
  if (!L2_WATCH_FAILURE_CLASSES.has(result)) throw new Error("invalid L2 watch consumer failure class")
  return result
}
