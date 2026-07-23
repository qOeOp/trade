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
  createAgentWorkspace,
  finalizeAgentWorkspaceEvidence,
  removeAgentWorkspace,
  seedAgentWorkspacePatch,
  type AgentWorkspace,
  type AgentWorkspaceExecutionScope,
  type FinalizedAgentWorkspaceEvidence,
} from "../../../agent-workspace-manager/src/lib/workspace-manager"
import {
  CodexAppServerClient,
  type CodexAppServerClientPort,
} from "./codex-app-server-client"
import {
  DirectCodexAgentHost,
  type DirectCodexAgentHostOptions,
} from "./direct-codex-agent-host"

export interface DeveloperWorkspaceCodexHostOptions {
  db: Database
  repository_root: string
  codex_path: string
  artifact_storage?: AgentArtifactStorage
  config_overrides?: string[]
  resolve_scope(
    request: AgentRunRequest,
  ): Promise<AgentWorkspaceExecutionScope>
  build_submission(input: {
    request: AgentRunRequest
    evidence: FinalizedAgentWorkspaceEvidence
    created_at: string
  }): Promise<unknown> | unknown
  resolve_steer?(request: {
    run_id: string
    request_hash: string
    message_ref: string
    message_sha256: string
  }): Promise<string>
  create_client?(
    onNotification: (method: string, params: unknown) => void,
    onExit: (error: Error | null) => void,
  ): CodexAppServerClientPort
  after_terminal?(
    request: AgentRunRequest,
    result: AgentRunResult,
  ): Promise<void>
  report_error?: DirectCodexAgentHostOptions["report_error"]
  now?: () => Date
}

export function createDeveloperWorkspaceCodexHost(
  options: DeveloperWorkspaceCodexHostOptions,
): DirectCodexAgentHost {
  const repositoryRoot = realpathSync(resolve(options.repository_root))
  const storage = options.artifact_storage ?? "durable"
  const workspaces = new Map<string, AgentWorkspace>()
  const now = options.now ?? (() => new Date())

  return new DirectCodexAgentHost({
    db: options.db,
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
        return {
          repo_root: repositoryRoot,
          workspace_root: workspace.workspace_root,
          instruction: readAgentArtifact(
            repositoryRoot,
            request.instruction_ref,
          ),
          inputs: request.input_refs.map((artifact) =>
            readAgentArtifact(repositoryRoot, artifact)),
        }
      } catch (error) {
        workspaces.delete(request.run_id)
        removeAgentWorkspace(workspace)
        throw error
      }
    },
    store_outputs: async (request) => {
      const workspace = workspaces.get(request.run_id)
      if (!workspace) {
        throw new Error("Developer workspace is unavailable for finalization")
      }
      const scope = await options.resolve_scope(request)
      assertAgentWorkspaceExecutionScope(scope)
      validateScopeBindings(scope, request)
      const evidence = await finalizeAgentWorkspaceEvidence({
        workspace,
        package_path: scope.package_path,
        checked_at: now().toISOString(),
        write_artifact(mediaType, text) {
          return writeAgentTextArtifact({
            repository_root: repositoryRoot,
            storage,
            media_type: mediaType,
            text,
          })
        },
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
    resolve_steer: async (input) => {
      if (!options.resolve_steer) {
        throw new Error("Developer workspace Host steering is disabled")
      }
      return options.resolve_steer(input)
    },
    create_client: options.create_client
      ?? ((onNotification, onExit) => new CodexAppServerClient({
        codex_path: options.codex_path,
        cwd: repositoryRoot,
        ...(options.config_overrides == null
          ? {}
          : { config_overrides: options.config_overrides }),
        on_notification: onNotification,
        on_exit: onExit,
      })),
    after_terminal: async (request, result) => {
      const workspace = workspaces.get(request.run_id)
      if (workspace && result.status === "completed") {
        removeAgentWorkspace(workspace)
        workspaces.delete(request.run_id)
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
    throw new Error("Developer workspace Codex Host requires workspace capabilities")
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
