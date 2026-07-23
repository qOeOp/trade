import { realpathSync } from "node:fs"
import { resolve, sep } from "node:path"
import type { Database } from "bun:sqlite"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"

export const AGENT_CYCLE_SQLITE_BUSY_TIMEOUT_MS = 5_000

export interface AgentCycleCommonInput {
  repository_root: string
  db: string
  host_url: string
  host_token_env: string
  run_id: string
  trace_id: string
  idempotency_key: string
  source_revision: string
  requested_at: string
  deadline_at: string
  poll_interval_ms: number
}

export function configureAgentCycleDatabase(db: Database): void {
  db.exec(`PRAGMA busy_timeout=${AGENT_CYCLE_SQLITE_BUSY_TIMEOUT_MS}`)
}

export function parseAgentCyclePayload(
  argv: string[],
  role: string,
): JSONRecord {
  if (argv.length !== 2 || argv[0] !== "--json") {
    throw new Error(`${role} Agent cycle requires --json '<payload>'`)
  }
  return JSON.parse(argv[1]!) as JSONRecord
}

export function parseAgentCycleCommon(
  value: JSONRecord,
  deadlineMinutes: number,
): AgentCycleCommonInput {
  const requestedAt = canonicalUtc(
    stringValue(value.requested_at) || new Date().toISOString(),
    "requested_at",
  )
  return {
    repository_root: stringValue(value.repository_root)
      || process.env.TRADE_REPO_ROOT
      || process.cwd(),
    db: repositoryPath(stringValue(value.db) || "data/rd_state.db"),
    host_url: stringValue(value.host_url) || "http://agent-host:7313",
    host_token_env: environmentName(
      stringValue(value.host_token_env) || "TRADE_AGENT_HOST_HTTP_TOKEN",
    ),
    run_id: identifier(value.run_id, "run_id"),
    trace_id: identifier(value.trace_id, "trace_id"),
    idempotency_key: identifier(value.idempotency_key, "idempotency_key"),
    source_revision: revision(value.source_revision),
    requested_at: requestedAt,
    deadline_at: canonicalUtc(
      stringValue(value.deadline_at)
        || new Date(Date.parse(requestedAt) + deadlineMinutes * 60_000).toISOString(),
      "deadline_at",
    ),
    poll_interval_ms: boundedInteger(
      value.poll_interval_ms ?? 1_000,
      10,
      30_000,
      "poll_interval_ms",
    ),
  }
}

export function resolveAgentCyclePaths(
  repositoryRoot: string,
  databasePath: string,
): { root: string; dbPath: string } {
  const root = realpathSync(resolve(repositoryRoot))
  const dbPath = resolve(root, databasePath)
  const dataRoot = resolve(root, "data")
  if (dbPath !== dataRoot && !dbPath.startsWith(`${dataRoot}${sep}`)) {
    throw new Error("Agent Cycle DB escaped data root")
  }
  return { root, dbPath }
}

export function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

export function identifier(value: unknown, field: string): string {
  const text = stringValue(value)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(text)) {
    throw new Error(`${field} is invalid`)
  }
  return text
}

export function nullableIdentifier(
  value: unknown,
  field: string,
): string | null {
  return value == null ? null : identifier(value, field)
}

export function boundedText(
  value: unknown,
  field: string,
  maximum: number,
): string {
  const text = stringValue(value)
  if (!text || text.trim() !== text || text.length > maximum) {
    throw new Error(`${field} is invalid`)
  }
  return text
}

export function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${field} is invalid`)
  }
  return number
}

function revision(value: unknown): string {
  const text = stringValue(value)
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(text)) {
    throw new Error("source_revision is invalid")
  }
  return text
}

function canonicalUtc(value: string, field: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC`)
  }
  return value
}

function environmentName(value: string): string {
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(value)) {
    throw new Error("host_token_env is invalid")
  }
  return value
}

function repositoryPath(value: string): string {
  if (!value || value.startsWith("/") || value.split("/").includes("..")) {
    throw new Error("db must be repository-relative")
  }
  return value
}
