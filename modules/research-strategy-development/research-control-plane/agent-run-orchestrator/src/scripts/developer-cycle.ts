#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import type { AgentArtifactRef } from "../../../../../contracts/agent-run-contract/src/agent-run-contract"
import { ensureResearchStateSchema } from "../../../state-store/src/lib/research-state-store"
import {
  boundedInteger,
  identifier,
  nullableIdentifier,
  parseAgentCycleCommon,
  parseAgentCyclePayload,
  resolveAgentCyclePaths,
  stringValue,
} from "../lib/agent-cycle-cli"
import { createAgentArtifactCliPort } from "../lib/agent-artifact-cli-port"
import { AgentHostHttpClient } from "../lib/agent-host-http-client"
import { runDeveloperAgentCycle } from "../lib/developer-agent-cycle"

async function main(): Promise<void> {
  const input = parseArgs(Bun.argv.slice(2))
  const { root, dbPath } = resolveAgentCyclePaths(input.repository_root, input.db)
  const token = process.env[input.host_token_env]
  if (!token) throw new Error(`required environment variable is missing: ${input.host_token_env}`)
  const db = new Database(dbPath)
  try {
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
  proposal_id: string
  proposal_revision: number
  brief_id: string
  predecessor_run_id: string | null
  replay_result_refs: AgentArtifactRef[]
  poll_interval_ms: number
} {
  const value = parseAgentCyclePayload(argv, "Developer")
  return {
    ...parseAgentCycleCommon(value, 30),
    proposal_id: identifier(value.proposal_id, "proposal_id"),
    proposal_revision: boundedInteger(value.proposal_revision, 1, 1_000_000, "proposal_revision"),
    brief_id: identifier(value.brief_id, "brief_id"),
    predecessor_run_id: nullableIdentifier(value.predecessor_run_id, "predecessor_run_id"),
    replay_result_refs: artifactRefs(value.replay_result_refs),
  }
}

function artifactRefs(value: unknown): AgentArtifactRef[] {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > 32) {
    throw new Error("replay_result_refs must be a bounded array")
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`replay_result_refs[${index}] is invalid`)
    }
    const ref = item as Record<string, unknown>
    const path = stringValue(ref.ref)
    const sha256 = stringValue(ref.sha256)
    const mediaType = stringValue(ref.media_type)
    const bytes = Number(ref.bytes)
    if (!path || path.startsWith("/") || path.split("/").includes("..")
      || !/^[a-f0-9]{64}$/.test(sha256)
      || !["application/json", "text/markdown", "text/x-diff", "text/plain"].includes(mediaType)
      || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > 16 * 1024 * 1024) {
      throw new Error(`replay_result_refs[${index}] is invalid`)
    }
    return {
      ref: path,
      sha256,
      media_type: mediaType as AgentArtifactRef["media_type"],
      bytes,
    }
  })
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }))
  process.exit(1)
})
