#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import type { AgentArtifactRef } from "../modules/contracts/agent-run-contract/src/agent-run-contract"
import {
  createAgentWorkspaceExecutionScope,
} from "../modules/orchestration-ops/agent-workspace-manager/src/lib/workspace-manager"
import {
  ensureAgentRunStoreSchema,
  readAgentRun,
} from "../modules/orchestration-ops/ops-runtime-store/src/lib/agent-run-store"
import {
  registerAgentWorkspaceExecutionScope,
} from "../modules/orchestration-ops/ops-runtime-store/src/lib/agent-workspace-scope-store"
import { ensureResearchStateSchema } from "../modules/research-strategy-development/research-control-plane/state-store/src/lib/research-state-store"
import {
  configureAgentCycleDatabase,
  parseAgentCyclePayload,
  resolveAgentCyclePaths,
  stringValue,
} from "../modules/research-strategy-development/research-control-plane/agent-run-orchestrator/src/lib/agent-cycle-cli"
import { createAgentArtifactCliPort } from "../modules/research-strategy-development/research-control-plane/agent-run-orchestrator/src/lib/agent-artifact-cli-port"
import { AgentHostHttpClient } from "../modules/research-strategy-development/research-control-plane/agent-run-orchestrator/src/lib/agent-host-http-client"
import { runDeveloperAgentCycle } from "../modules/research-strategy-development/research-control-plane/agent-run-orchestrator/src/lib/developer-agent-cycle"
import {
  parseDeveloperAgentCycleInput,
  type DeveloperAgentCycleInput,
} from "../modules/research-strategy-development/research-control-plane/agent-run-orchestrator/src/lib/developer-agent-cycle-cli"
import type { PreparedDeveloperAgentRun } from "../modules/research-strategy-development/research-control-plane/agent-run-orchestrator/src/lib/developer-agent-run"
import { resolveDeveloperWorkspacePolicy } from "../modules/research-strategy-development/research-control-plane/agent-run-orchestrator/src/lib/developer-workspace-policy"

async function main(): Promise<void> {
  const input = parseArgs(Bun.argv.slice(2))
  const { root, dbPath } = resolveAgentCyclePaths(input.repository_root, input.db)
  const semanticToken = requiredSecret(input.host_token_env)
  const workspaceToken = requiredSecret(input.workspace_host_token_env)
  const opsPath = resolveAgentCyclePaths(root, input.ops_db).dbPath
  const researchDb = new Database(dbPath)
  const opsDb = new Database(opsPath)
  try {
    configureAgentCycleDatabase(researchDb)
    configureAgentCycleDatabase(opsDb)
    ensureResearchStateSchema(researchDb)
    ensureAgentRunStoreSchema(opsDb)
    const result = await runDeveloperAgentCycle({
      db: researchDb,
      host: new AgentHostHttpClient({
        base_url: input.host_url,
        bearer_token: semanticToken,
      }),
      workspace_host: new AgentHostHttpClient({
        base_url: input.workspace_host_url,
        bearer_token: workspaceToken,
      }),
      register_workspace_scope: (prepared) =>
        registerWorkspaceScope(opsDb, prepared),
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
    opsDb.close()
    researchDb.close()
  }
}

function registerWorkspaceScope(
  opsDb: Database,
  prepared: PreparedDeveloperAgentRun,
): { scope_hash: string } {
  const policy = resolveDeveloperWorkspacePolicy(prepared)
  const scope = createAgentWorkspaceExecutionScope({
    run_id: prepared.request.run_id,
    request_hash: prepared.request.request_hash,
    source_revision: prepared.request.source_revision,
    allowed_write_prefixes: policy.allowed_write_prefixes,
    package_paths: policy.package_paths,
    seed_patch: predecessorPatch(opsDb, prepared),
    issued_at: prepared.context_pack.requested_at,
  })
  const stored = registerAgentWorkspaceExecutionScope(opsDb, {
    scope,
    registered_at: prepared.context_pack.requested_at,
  })
  return { scope_hash: stored.scope_hash }
}

function predecessorPatch(
  opsDb: Database,
  prepared: PreparedDeveloperAgentRun,
): AgentArtifactRef | null {
  const predecessorRunId = prepared.context_pack.predecessor_run_id
  if (!predecessorRunId) return null
  const predecessor = readAgentRun(opsDb, predecessorRunId)
  if (!predecessor?.result
    || predecessor.result.status !== "completed"
    || predecessor.request.task_profile !== "developer"
    || predecessor.request.source_revision !== prepared.request.source_revision) {
    throw new Error("Developer workspace predecessor is not compatible")
  }
  const patches = predecessor.result.output_refs.filter(
    (ref) => ref.media_type === "text/x-diff",
  )
  if (patches.length !== 1) {
    throw new Error("Developer workspace predecessor has ambiguous patch evidence")
  }
  const patch = patches[0]!
  const inputIdentities = new Set(
    prepared.request.input_refs.map((ref) => `${ref.ref}:${ref.sha256}`),
  )
  if (!inputIdentities.has(`${patch.ref}:${patch.sha256}`)) {
    throw new Error("Developer workspace predecessor patch is absent from inputs")
  }
  return patch
}

function parseArgs(argv: string[]): DeveloperAgentCycleInput & {
  ops_db: string
  workspace_host_url: string
  workspace_host_token_env: string
} {
  const value = parseAgentCyclePayload(argv, "Server Developer")
  return {
    ...parseDeveloperAgentCycleInput(value),
    ops_db: repositoryPath(
      stringValue(value.ops_db)
        || process.env.TRADE_AGENT_OPS_DB
        || "data/ops_runtime.db",
    ),
    workspace_host_url: httpUrl(
      stringValue(value.workspace_host_url)
        || "http://agent-host-code:7314",
      "workspace_host_url",
    ),
    workspace_host_token_env: environmentName(
      stringValue(value.workspace_host_token_env)
        || "TRADE_AGENT_CODE_HOST_HTTP_TOKEN",
    ),
  }
}

function requiredSecret(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`required environment variable is missing: ${name}`)
  return value
}

function environmentName(value: string): string {
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(value)) {
    throw new Error("Developer Agent environment variable name is invalid")
  }
  return value
}

function repositoryPath(value: string): string {
  if (!value || value.startsWith("/") || value.split("/").includes("..")) {
    throw new Error("Developer Agent database path must be repository-relative")
  }
  return value
}

function httpUrl(value: string, field: string): string {
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol)
    || url.username || url.password || url.search || url.hash) {
    throw new Error(`${field} is invalid`)
  }
  return url.toString().replace(/\/$/, "")
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }))
  process.exit(1)
})
