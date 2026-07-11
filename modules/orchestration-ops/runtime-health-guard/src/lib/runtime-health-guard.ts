import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { asRecord, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { ensureOpsRuntimeSchema, recordRuntimeHealth, type HealthStatus, type RuntimeHealth } from "../../../ops-runtime-store/src/lib/ops-runtime-store"

export interface HealthCheck {
  name: string
  status: "ok" | "warn" | "fail"
  detail?: string
}

export interface RuntimeHealthResult {
  ok: boolean
  ticket_no: "J01"
  job_id: "runtime_health_guard"
  status: HealthStatus
  health_ref: string
  health: RuntimeHealth
}

export function runRuntimeHealthGuard(db: Database, input: JSONRecord, env: Record<string, string | undefined> = process.env): RuntimeHealthResult {
  ensureOpsRuntimeSchema(db)
  const observedAt = stringField(input.observed_at) || stringField(input.now) || new Date().toISOString()
  const checks = buildHealthChecks(input, env)
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
    ticket_no: "J01",
    job_id: "runtime_health_guard",
    status,
    health_ref: `ops_runtime_store:runtime_health/${health.health_id}`,
    health,
  }
}

export function buildHealthChecks(input: JSONRecord, env: Record<string, string | undefined> = process.env): HealthCheck[] {
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
  if (checks.length === 0) {
    checks.push(ok("runtime:default"))
  }
  if (Boolean(input.safe_mode)) {
    checks.push({ name: "safe_mode", status: "warn", detail: "safe mode explicitly enabled" })
  }
  return checks
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

