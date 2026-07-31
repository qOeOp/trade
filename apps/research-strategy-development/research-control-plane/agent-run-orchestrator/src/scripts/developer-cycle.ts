#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { ensureResearchStateSchema } from "../../../state-store/src/lib/research-state-store"
import {
  configureAgentCycleDatabase,
  parseAgentCyclePayload,
  resolveAgentCyclePaths,
} from "../lib/agent-cycle-cli"
import { createAgentArtifactCliPort } from "../lib/agent-artifact-cli-port"
import { AgentHostHttpClient } from "../lib/agent-host-http-client"
import { runDeveloperAgentCycle } from "../lib/developer-agent-cycle"
import {
  parseDeveloperAgentCycleInput,
  type DeveloperAgentCycleInput,
} from "../lib/developer-agent-cycle-cli"

async function main(): Promise<void> {
  const input = parseArgs(Bun.argv.slice(2))
  const { root, dbPath } = resolveAgentCyclePaths(input.repository_root, input.db)
  const token = process.env[input.host_token_env]
  if (!token) throw new Error(`required environment variable is missing: ${input.host_token_env}`)
  const db = new Database(dbPath)
  try {
    configureAgentCycleDatabase(db)
    ensureResearchStateSchema(db)
    const result = await runDeveloperAgentCycle({
      db,
      host: new AgentHostHttpClient({
        base_url: input.host_url,
        bearer_token: token,
      }),
      artifacts: createAgentArtifactCliPort(root, "durable"),
      developer_run_id: input.run_id,
      trace_id: input.trace_id,
      idempotency_key: input.idempotency_key,
      source_revision: input.source_revision,
      requested_at: input.requested_at,
      deadline_at: input.deadline_at,
      proposal_id: input.proposal_id,
      proposal_revision: input.proposal_revision,
      brief_id: input.brief_id,
      ...(input.predecessor_run_id
        ? { predecessor_run_id: input.predecessor_run_id }
        : {}),
      replay_result_refs: input.replay_result_refs,
      data_snapshot_binding: input.data_snapshot_binding,
      poll_interval_ms: input.poll_interval_ms,
    })
    console.log(JSON.stringify({ ok: true, result }))
  } finally {
    db.close()
  }
}

function parseArgs(argv: string[]): DeveloperAgentCycleInput {
  const value = parseAgentCyclePayload(argv, "Developer")
  return parseDeveloperAgentCycleInput(value)
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }))
  process.exit(1)
})
