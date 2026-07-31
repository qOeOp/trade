import type { Database } from "bun:sqlite"
import { realpathSync } from "node:fs"
import { resolve } from "node:path"
import type {
  AgentRunRequest,
  AgentRunResult,
} from "../../../../contracts/agent-run-contract/src/agent-run-contract"
import {
  readAgentArtifact,
  writeAgentJsonArtifact,
  writeAgentTextArtifact,
  type AgentArtifactStorage,
} from "../../../agent-artifact-store/src/lib/agent-artifact-store"
import {
  assertAgentWorkspaceExecutionScope,
  cleanupAgentWorkspaceSlot,
  createAgentWorkspace,
  finalizeAgentWorkspaceEvidence,
  removeAgentWorkspace,
  seedAgentWorkspacePatch,
  type AgentWorkspace,
  type AgentWorkspacePackageCheck,
  type AgentWorkspaceExecutionScope,
  type FinalizedAgentWorkspaceEvidence,
} from "../../../agent-workspace-manager/src/lib/workspace-manager"
import {
  OpenClawAgentHost,
  type OpenClawAgentHostOptions,
  type OpenClawExecutionRequest,
  type OpenClawExecutionResult,
} from "./openclaw-agent-run"
import { materializeOpenClawWorkspaceAgentMessage } from "./openclaw-artifact-materializer"

export interface DeveloperWorkspaceOpenClawHostOptions {
  db: Database
  repository_root: string
  workspace_slot?: string
  agent_id?: string
  group_writable_workspace?: boolean
  artifact_storage?: AgentArtifactStorage
  resolve_scope(
    request: AgentRunRequest,
  ): Promise<AgentWorkspaceExecutionScope>
  build_submission(input: {
    request: AgentRunRequest
    evidence: FinalizedAgentWorkspaceEvidence
    created_at: string
  }): Promise<unknown> | unknown
  execute(
    input: OpenClawExecutionRequest,
    signal: AbortSignal,
  ): Promise<OpenClawExecutionResult>
  run_package_check?(input: {
    workspace: AgentWorkspace
    package_path: string
    timeout_ms?: number
    max_output_bytes?: number
  }): Promise<AgentWorkspacePackageCheck>
  after_terminal?(
    request: AgentRunRequest,
    result: AgentRunResult,
  ): Promise<void>
  report_error?: OpenClawAgentHostOptions["report_error"]
  now?: () => Date
}

export function createDeveloperWorkspaceOpenClawHost(
  options: DeveloperWorkspaceOpenClawHostOptions,
): OpenClawAgentHost {
  const repositoryRoot = realpathSync(resolve(options.repository_root))
  const workspaceSlot = options.workspace_slot ?? "active"
  const storage = options.artifact_storage ?? "durable"
  const workspaces = new Map<string, AgentWorkspace>()
  const now = options.now ?? (() => new Date())

  return new OpenClawAgentHost({
    db: options.db,
    host_profile: "openclaw-workspace-gateway",
    transport: "gateway",
    allowed_task_profiles: ["developer"],
    agent_ids: {
      planner: "disabled",
      developer: options.agent_id ?? "rd-developer-code",
      reviewer: "disabled",
      explanation: "disabled",
    },
    materialize: async (request) => {
      validateDeveloperRequest(request)
      const scope = await options.resolve_scope(request)
      assertAgentWorkspaceExecutionScope(scope)
      validateScopeBindings(scope, request)
      const seed = scope.seed_patch == null
        ? null
        : readAgentArtifact(repositoryRoot, scope.seed_patch)
      const workspace = createAgentWorkspace({
        repository_root: repositoryRoot,
        run_id: request.run_id,
        workspace_slot: workspaceSlot,
        group_writable: options.group_writable_workspace ?? false,
        source_revision: scope.source_revision,
        allowed_write_prefixes: scope.allowed_write_prefixes,
        created_at: now().toISOString(),
      })
      try {
        if (seed) {
          seedAgentWorkspacePatch({
            workspace,
            artifact: seed.artifact,
            patch_text: seed.text,
          })
        }
        workspaces.set(request.run_id, workspace)
        return materializeOpenClawWorkspaceAgentMessage(repositoryRoot, request)
      } catch (error) {
        workspaces.delete(request.run_id)
        removeAgentWorkspace(workspace)
        throw error
      }
    },
    store_outputs: async (request) => {
      const workspace = workspaces.get(request.run_id)
      if (!workspace) {
        throw new Error("Developer OpenClaw workspace is unavailable for finalization")
      }
      const scope = await options.resolve_scope(request)
      assertAgentWorkspaceExecutionScope(scope)
      validateScopeBindings(scope, request)
      const evidence = await finalizeAgentWorkspaceEvidence({
        workspace,
        package_paths: scope.package_paths,
        checked_at: now().toISOString(),
        write_artifact(mediaType, text) {
          return writeAgentTextArtifact({
            repository_root: repositoryRoot,
            storage,
            media_type: mediaType,
            text,
          })
        },
        ...(options.run_package_check == null
          ? {}
          : { run_package_check: options.run_package_check }),
      })
      const submission = await options.build_submission({
        request,
        evidence,
        created_at: now().toISOString(),
      })
      const submissionRef = writeAgentJsonArtifact({
        repository_root: repositoryRoot,
        storage,
        value: submission,
      })
      return [
        submissionRef,
        evidence.patch_ref,
        ...evidence.quality_check_refs,
      ]
    },
    execute: options.execute,
    max_concurrent_runs: 1,
    after_terminal: async (request, result) => {
      const workspace = workspaces.get(request.run_id)
      if (workspace) {
        removeAgentWorkspace(workspace)
        workspaces.delete(request.run_id)
      } else {
        cleanupAgentWorkspaceSlot({
          repository_root: repositoryRoot,
          workspace_slot: workspaceSlot,
        })
      }
      await options.after_terminal?.(request, result)
    },
    ...(options.report_error == null
      ? {}
      : { report_error: options.report_error }),
    now,
  })
}

function validateDeveloperRequest(request: AgentRunRequest): void {
  if (request.task_profile !== "developer"
    || !request.capabilities.includes("workspace_read")
    || !request.capabilities.includes("workspace_patch")
    || !request.capabilities.includes("bounded_quality_check")) {
    throw new Error("Developer workspace OpenClaw Host requires workspace capabilities")
  }
}

function validateScopeBindings(
  scope: AgentWorkspaceExecutionScope,
  request: AgentRunRequest,
): void {
  if (scope.run_id !== request.run_id
    || scope.request_hash !== request.request_hash
    || scope.source_revision !== request.source_revision) {
    throw new Error("Agent workspace execution scope drifted from request")
  }
  if (scope.seed_patch) {
    const expected = `${scope.seed_patch.ref}:${scope.seed_patch.sha256}`
    const requestRefs = new Set(
      request.input_refs.map((ref) => `${ref.ref}:${ref.sha256}`),
    )
    if (!requestRefs.has(expected)) {
      throw new Error("Agent workspace seed patch is absent from request inputs")
    }
  }
}
