import type { Database } from "bun:sqlite"
import {
  readAgentArtifact,
} from "../../apps/orchestration-ops/agent-artifact-store/src/lib/agent-artifact-store"
import {
  createDeveloperWorkspaceOpenClawHost,
  type DeveloperWorkspaceOpenClawHostOptions,
} from "../../apps/orchestration-ops/agent-host-openclaw/src/lib/developer-workspace-openclaw-host"
import {
  assertAgentWorkspaceExecutionScope,
  type AgentWorkspaceExecutionScope,
} from "../../apps/orchestration-ops/agent-workspace-manager/src/lib/workspace-manager"
import {
  runIsolatedAgentWorkspacePackageCheck,
} from "../../apps/orchestration-ops/agent-workspace-manager/src/lib/isolated-package-checker"
import {
  readAgentWorkspaceExecutionScope,
} from "../../apps/orchestration-ops/ops-runtime-store/src/lib/agent-workspace-scope-store"
import {
  createDeveloperWorkspaceAgentSubmissionFromContextPack,
} from "../../apps/research-strategy-development/research-control-plane/agent-run-orchestrator/src/lib/developer-agent-run"

export function createResidentOpenClawWorkspaceHost(input: {
  db: Database
  repository_root: string
  checker_socket_path?: string
  execute: DeveloperWorkspaceOpenClawHostOptions["execute"]
  report_error?: DeveloperWorkspaceOpenClawHostOptions["report_error"]
  now?: () => Date
}) {
  return createDeveloperWorkspaceOpenClawHost({
    db: input.db,
    repository_root: input.repository_root,
    workspace_slot: "active",
    agent_id: "rd-developer-code",
    group_writable_workspace: true,
    resolve_scope: async (request) => {
      const stored = readAgentWorkspaceExecutionScope(input.db, request.run_id)
      if (!stored || stored.request_hash !== request.request_hash) {
        throw new Error("Developer workspace execution scope is not registered")
      }
      const scope = stored.scope as unknown as AgentWorkspaceExecutionScope
      assertAgentWorkspaceExecutionScope(scope)
      if (scope.scope_hash !== stored.scope_hash) {
        throw new Error("Developer workspace execution scope registry drifted")
      }
      return scope
    },
    build_submission: ({ request, evidence, created_at }) => {
      const contextRef = request.input_refs[0]
      if (!contextRef) {
        throw new Error("Developer workspace request omitted context pack")
      }
      const context = readAgentArtifact(input.repository_root, contextRef)
      if (context.artifact.media_type !== "application/json") {
        throw new Error("Developer workspace context pack is not JSON")
      }
      return createDeveloperWorkspaceAgentSubmissionFromContextPack({
        request,
        context_pack: JSON.parse(context.text),
        workspace_patch: evidence.patch_ref,
        quality_check_refs: evidence.quality_check_refs,
        created_at,
      })
    },
    execute: input.execute,
    run_package_check: (request) =>
      runIsolatedAgentWorkspacePackageCheck({
        socket_path: input.checker_socket_path ?? "/app/control/checker.sock",
        ...request,
      }),
    ...(input.report_error == null ? {} : { report_error: input.report_error }),
    ...(input.now == null ? {} : { now: input.now }),
  })
}
