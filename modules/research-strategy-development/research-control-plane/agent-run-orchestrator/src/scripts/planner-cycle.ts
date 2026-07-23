#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { ensureResearchStateSchema } from "../../../state-store/src/lib/research-state-store"
import {
  boundedText,
  configureAgentCycleDatabase,
  parseAgentCycleCommon,
  parseAgentCyclePayload,
  resolveAgentCyclePaths,
} from "../lib/agent-cycle-cli"
import { createAgentArtifactCliPort } from "../lib/agent-artifact-cli-port"
import { AgentHostHttpClient } from "../lib/agent-host-http-client"
import { runPlannerAgentCycle } from "../lib/planner-agent-cycle"

async function main(): Promise<void> {
  const input = parseArgs(Bun.argv.slice(2))
  const { root, dbPath } = resolveAgentCyclePaths(input.repository_root, input.db)
  const token = process.env[input.host_token_env]
  if (!token) throw new Error(`required environment variable is missing: ${input.host_token_env}`)
  const db = new Database(dbPath)
  try {
    configureAgentCycleDatabase(db)
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
  const value = parseAgentCyclePayload(argv, "Planner")
  return {
    ...parseAgentCycleCommon(value, 10),
    objective: boundedText(value.objective, "objective", 2_000),
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }))
  process.exit(1)
})
