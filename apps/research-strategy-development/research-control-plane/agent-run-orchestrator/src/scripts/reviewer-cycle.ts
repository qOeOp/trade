#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { ensureResearchStateSchema } from "../../../state-store/src/lib/research-state-store"
import {
  configureAgentCycleDatabase,
  identifier,
  parseAgentCycleCommon,
  parseAgentCyclePayload,
  resolveAgentCyclePaths,
} from "../lib/agent-cycle-cli"
import { createAgentArtifactCliPort } from "../lib/agent-artifact-cli-port"
import { AgentHostHttpClient } from "../lib/agent-host-http-client"
import { runReviewerAgentCycle } from "../lib/reviewer-agent-cycle"

async function main(): Promise<void> {
  const input = parseArgs(Bun.argv.slice(2))
  const { root, dbPath } = resolveAgentCyclePaths(input.repository_root, input.db)
  const token = process.env[input.host_token_env]
  if (!token) throw new Error(`required environment variable is missing: ${input.host_token_env}`)
  const db = new Database(dbPath)
  try {
    configureAgentCycleDatabase(db)
    ensureResearchStateSchema(db)
    const result = await runReviewerAgentCycle({
      db,
      host: new AgentHostHttpClient({
        base_url: input.host_url,
        bearer_token: token,
      }),
      artifacts: createAgentArtifactCliPort(root, "durable"),
      reviewer_run_id: input.run_id,
      trace_id: input.trace_id,
      idempotency_key: input.idempotency_key,
      source_revision: input.source_revision,
      requested_at: input.requested_at,
      deadline_at: input.deadline_at,
      experiment_id: input.experiment_id,
      stage_id: input.stage_id,
      result_ids: input.result_ids,
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
  source_revision: string
  requested_at: string
  deadline_at: string
  experiment_id: string
  stage_id: string
  result_ids: string[]
  poll_interval_ms: number
} {
  const value = parseAgentCyclePayload(argv, "Reviewer")
  return {
    ...parseAgentCycleCommon(value, 15),
    experiment_id: identifier(value.experiment_id, "experiment_id"),
    stage_id: identifier(value.stage_id, "stage_id"),
    result_ids: identifiers(value.result_ids, "result_ids"),
  }
}

function identifiers(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    throw new Error(`${field} must be bounded and non-empty`)
  }
  const values = value.map((item) => identifier(item, field)).sort()
  if (new Set(values).size !== values.length) throw new Error(`${field} must be unique`)
  return values
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }))
  process.exit(1)
})
