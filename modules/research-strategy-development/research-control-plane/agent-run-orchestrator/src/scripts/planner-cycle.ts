#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { realpathSync } from "node:fs"
import { resolve, sep } from "node:path"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { ensureResearchStateSchema } from "../../../state-store/src/lib/research-state-store"
import { createAgentArtifactCliPort } from "../lib/agent-artifact-cli-port"
import { AgentHostHttpClient } from "../lib/agent-host-http-client"
import { runPlannerAgentCycle } from "../lib/planner-agent-cycle"

async function main(): Promise<void> {
  const input = parseArgs(Bun.argv.slice(2))
  const root = realpathSync(resolve(input.repository_root))
  const dbPath = resolve(root, input.db)
  assertInside(resolve(root, "data"), dbPath)
  const token = process.env[input.host_token_env]
  if (!token) throw new Error(`required environment variable is missing: ${input.host_token_env}`)
  const db = new Database(dbPath)
  try {
    ensureResearchStateSchema(db)
    const result = await runPlannerAgentCycle({
      db,
      host: new AgentHostHttpClient({
        base_url: input.host_url,
        bearer_token: token,
      }),
      artifacts: createAgentArtifactCliPort(root, "durable"),
      planner_run_id: input.run_id,
      trace_id: input.trace_id,
      idempotency_key: input.idempotency_key,
      objective: input.objective,
      source_revision: input.source_revision,
      requested_at: input.requested_at,
      deadline_at: input.deadline_at,
      poll_interval_ms: input.poll_interval_ms,
    })
    console.log(JSON.stringify({ ok: true, result }))
  } finally {
    db.close()
  }
}

function parseArgs(argv: string[]): {
  repository_root: string
  db: string
  host_url: string
  host_token_env: string
  run_id: string
  trace_id: string
  idempotency_key: string
  objective: string
  source_revision: string
  requested_at: string
  deadline_at: string
  poll_interval_ms: number
} {
  if (argv.length !== 2 || argv[0] !== "--json") {
    throw new Error("Planner Agent cycle requires --json '<payload>'")
  }
  const value = JSON.parse(argv[1]!) as JSONRecord
  const requestedAt = utc(string(value.requested_at) || new Date().toISOString(), "requested_at")
  return {
    repository_root: string(value.repository_root)
      || process.env.TRADE_REPO_ROOT
      || process.cwd(),
    db: repoPath(string(value.db) || "data/rd_state.db"),
    host_url: string(value.host_url) || "http://agent-host:7313",
    host_token_env: environmentName(
      string(value.host_token_env) || "TRADE_AGENT_HOST_HTTP_TOKEN",
    ),
    run_id: identifier(value.run_id, "run_id"),
    trace_id: identifier(value.trace_id, "trace_id"),
    idempotency_key: identifier(value.idempotency_key, "idempotency_key"),
    objective: boundedText(value.objective, "objective", 2_000),
    source_revision: revision(value.source_revision),
    requested_at: requestedAt,
    deadline_at: utc(
      string(value.deadline_at)
        || new Date(Date.parse(requestedAt) + 10 * 60_000).toISOString(),
      "deadline_at",
    ),
    poll_interval_ms: integer(value.poll_interval_ms ?? 1_000, 10, 30_000),
  }
}

function string(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function identifier(value: unknown, field: string): string {
  const text = string(value)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(text)) {
    throw new Error(`${field} is invalid`)
  }
  return text
}

function boundedText(value: unknown, field: string, maximum: number): string {
  const text = string(value)
  if (!text || text.trim() !== text || text.length > maximum) {
    throw new Error(`${field} is invalid`)
  }
  return text
}

function revision(value: unknown): string {
  const text = string(value)
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(text)) {
    throw new Error("source_revision is invalid")
  }
  return text
}

function utc(value: string, field: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC`)
  }
  return value
}

function integer(value: unknown, minimum: number, maximum: number): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error("poll_interval_ms is invalid")
  }
  return number
}

function environmentName(value: string): string {
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(value)) {
    throw new Error("host_token_env is invalid")
  }
  return value
}

function repoPath(value: string): string {
  if (!value || value.startsWith("/") || value.split("/").includes("..")) {
    throw new Error("db must be repository-relative")
  }
  return value
}

function assertInside(root: string, path: string): void {
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error("Planner Agent DB escaped data root")
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }))
  process.exit(1)
})
