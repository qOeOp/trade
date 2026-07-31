import type { Database } from "bun:sqlite"
import type { AgentArtifactRef } from "../../apps/contracts/agent-run-contract/src/agent-run-contract"
import type { AgentHostPort } from "../../apps/contracts/agent-run-contract/src/agent-host-port"
import {
  readAgentArtifact,
  writeAgentTextArtifact,
} from "../../apps/orchestration-ops/agent-artifact-store/src/lib/agent-artifact-store"
import type { CodexAppServerClientPort } from "../../apps/orchestration-ops/agent-host-codex/src/lib/codex-app-server-client"
import { createDeveloperWorkspaceCodexHost } from "../../apps/orchestration-ops/agent-host-codex/src/lib/developer-workspace-codex-host"
import { createAgentWorkspaceExecutionScope } from "../../apps/orchestration-ops/agent-workspace-manager/src/lib/workspace-manager"
import { readAgentRun } from "../../apps/orchestration-ops/ops-runtime-store/src/lib/agent-run-store"
import {
  admitDeveloperAgentResult,
  createDeveloperWorkspaceAgentSubmission,
  prepareDeveloperAgentRun,
} from "../../apps/research-strategy-development/research-control-plane/agent-run-orchestrator/src/lib/developer-agent-run"
import { executeAgentRunThroughHost } from "../../apps/research-strategy-development/research-control-plane/agent-run-orchestrator/src/lib/agent-run-host-execution"
import type { AgentArtifactPort } from "../../apps/research-strategy-development/research-control-plane/agent-run-orchestrator/src/lib/planner-agent-run"
import type { DeveloperDataSnapshotBinding } from "../../apps/research-strategy-development/research-control-plane/agent-run-orchestrator/src/lib/developer-capability-assessment"

export interface DeveloperWorkspaceCycleInput {
  research_db: Database
  ops_db: Database
  repository_root: string
  codex_path: string
  allowed_write_prefixes: string[]
  package_paths: string[]
  developer_run_id: string
  trace_id: string
  idempotency_key: string
  source_revision: string
  requested_at: string
  deadline_at: string
  proposal_id: string
  proposal_revision: number
  brief_id: string
  predecessor_run_id?: string
  predecessor_patch_ref?: AgentArtifactRef
  replay_result_refs?: AgentArtifactRef[]
  data_snapshot_binding?: DeveloperDataSnapshotBinding | null
  poll_interval_ms?: number
  signal?: AbortSignal
  config_overrides?: string[]
  create_client?(
    onNotification: (method: string, params: unknown) => void,
    onExit: (error: Error | null) => void,
  ): CodexAppServerClientPort
  now?: () => Date
}

export async function runDeveloperWorkspaceCycle(
  input: DeveloperWorkspaceCycleInput,
) {
  const artifacts = directArtifactPort(input.repository_root)
  validatePredecessorPatch(input)
  const replayResultRefs = mergeInputRefs(
    input.predecessor_patch_ref,
    input.replay_result_refs ?? [],
  )
  const prepared = prepareDeveloperAgentRun({
    db: input.research_db,
    developer_run_id: input.developer_run_id,
    trace_id: input.trace_id,
    idempotency_key: input.idempotency_key,
    source_revision: input.source_revision,
    requested_at: input.requested_at,
    deadline_at: input.deadline_at,
    proposal_id: input.proposal_id,
    proposal_revision: input.proposal_revision,
    brief_id: input.brief_id,
    artifacts,
    ...(input.predecessor_run_id == null
      ? {}
      : { predecessor_run_id: input.predecessor_run_id }),
    ...(replayResultRefs.length < 1
      ? {}
      : { replay_result_refs: replayResultRefs }),
    ...(input.data_snapshot_binding == null
      ? {}
      : { data_snapshot_binding: input.data_snapshot_binding }),
  })
  if (prepared.execution_route !== "workspace_host") {
    throw new Error("Developer workspace composition requires code_change_required")
  }
  const scope = createAgentWorkspaceExecutionScope({
    run_id: prepared.request.run_id,
    request_hash: prepared.request.request_hash,
    source_revision: prepared.request.source_revision,
    allowed_write_prefixes: input.allowed_write_prefixes,
    package_paths: input.package_paths,
    seed_patch: input.predecessor_patch_ref ?? null,
    issued_at: input.requested_at,
  })
  const host = createDeveloperWorkspaceCodexHost({
    db: input.ops_db,
    repository_root: input.repository_root,
    codex_path: input.codex_path,
    resolve_scope: async () => scope,
    build_submission: ({ evidence, created_at }) =>
      createDeveloperWorkspaceAgentSubmission({
        prepared,
        workspace_patch: evidence.patch_ref,
        quality_check_refs: evidence.quality_check_refs,
        created_at,
      }),
    ...(input.config_overrides == null
      ? {}
      : { config_overrides: input.config_overrides }),
    ...(input.create_client == null
      ? {}
      : { create_client: input.create_client }),
    ...(input.now == null ? {} : { now: input.now }),
  })
  try {
    const completed = await executeAgentRunThroughHost({
      host: host as AgentHostPort,
      request: prepared.request,
      ...(input.poll_interval_ms == null
        ? {}
        : { poll_interval_ms: input.poll_interval_ms }),
      ...(input.signal == null ? {} : { signal: input.signal }),
    })
    const recordedAt = new Date(Math.max(
      Date.now(),
      Date.parse(completed.result.finished_at),
    )).toISOString()
    const admission = admitDeveloperAgentResult({
      db: input.research_db,
      prepared,
      events: completed.events,
      result: completed.result,
      artifacts,
      recorded_at: recordedAt,
    })
    return {
      schema_version: "trade.rd-developer-workspace-cycle-result.v1" as const,
      run_id: prepared.request.run_id,
      request_hash: prepared.request.request_hash,
      scope_hash: scope.scope_hash,
      result_hash: completed.result.result_hash,
      output_refs: completed.result.output_refs,
      admission,
    }
  } finally {
    await host.close()
  }
}

function validatePredecessorPatch(input: DeveloperWorkspaceCycleInput): void {
  if ((input.predecessor_run_id == null)
    !== (input.predecessor_patch_ref == null)) {
    throw new Error(
      "Developer workspace predecessor_run_id and predecessor_patch_ref must be paired",
    )
  }
  if (!input.predecessor_run_id || !input.predecessor_patch_ref) return
  const predecessor = readAgentRun(input.ops_db, input.predecessor_run_id)
  if (!predecessor?.result
    || predecessor.result.status !== "completed"
    || predecessor.request.task_profile !== "developer"
    || predecessor.request.source_revision !== input.source_revision) {
    throw new Error("Developer workspace predecessor is not one compatible completed run")
  }
  const expected = `${input.predecessor_patch_ref.ref}:${input.predecessor_patch_ref.sha256}`
  const matches = predecessor.result.output_refs.filter(
    (ref) => `${ref.ref}:${ref.sha256}` === expected
      && ref.media_type === "text/x-diff"
      && ref.bytes === input.predecessor_patch_ref!.bytes,
  )
  if (matches.length !== 1) {
    throw new Error("Developer workspace seed patch is not the predecessor output")
  }
}

function mergeInputRefs(
  predecessorPatch: AgentArtifactRef | undefined,
  refs: AgentArtifactRef[],
): AgentArtifactRef[] {
  const values = [...(predecessorPatch ? [predecessorPatch] : []), ...refs]
  const keys = values.map((ref) => `${ref.ref}:${ref.sha256}`)
  if (new Set(keys).size !== keys.length) {
    throw new Error("Developer workspace input refs contain duplicates")
  }
  return values
}

function directArtifactPort(repositoryRoot: string): AgentArtifactPort {
  return {
    put(text, mediaType) {
      return writeAgentTextArtifact({
        repository_root: repositoryRoot,
        storage: "durable",
        media_type: mediaType,
        text,
      })
    },
    read(artifact) {
      return readAgentArtifact(repositoryRoot, artifact).text
    },
  }
}
