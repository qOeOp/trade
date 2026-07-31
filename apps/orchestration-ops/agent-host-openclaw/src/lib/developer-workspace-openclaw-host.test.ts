import assert from "node:assert/strict"
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Database } from "bun:sqlite"
import {
  buildAgentRunRequest,
  type AgentRunRequest,
} from "../../../../contracts/agent-run-contract/src/agent-run-contract"
import {
  readAgentArtifact,
  writeAgentTextArtifact,
} from "../../../agent-artifact-store/src/lib/agent-artifact-store"
import {
  createAgentWorkspaceExecutionScope,
} from "../../../agent-workspace-manager/src/lib/workspace-manager"
import {
  runIsolatedAgentWorkspacePackageCheck,
  startIsolatedAgentWorkspaceChecker,
} from "../../../agent-workspace-manager/src/lib/isolated-package-checker"
import { ensureAgentRunStoreSchema } from "../../../ops-runtime-store/src/lib/agent-run-store"
import { createDeveloperWorkspaceOpenClawHost } from "./developer-workspace-openclaw-host"
import type {
  OpenClawExecutionRequest,
  OpenClawExecutionResult,
} from "./openclaw-agent-run"

test("Developer workspace OpenClaw composition captures Host evidence and cleans fixed slot", async () => {
  const root = fixtureRepository()
  const db = new Database(":memory:")
  ensureAgentRunStoreSchema(db)
  const instruction = writeAgentTextArtifact({
    repository_root: root,
    storage: "temporary",
    media_type: "text/markdown",
    text: "Modify only apps/sample/index.ts so value equals 2.",
  })
  const context = writeAgentTextArtifact({
    repository_root: root,
    storage: "temporary",
    media_type: "application/json",
    text: "{\"reason\":\"implementation_missing\"}",
  })
  const request = buildRequest(instruction, context)
  const workspaceRoot = join(root, "tmp", "agent-workspace-slots", "active")
  const checkerSocket = join(root, "checker.sock")
  const checker = await startIsolatedAgentWorkspaceChecker({
    socket_path: checkerSocket,
    workspace_root: workspaceRoot,
  })
  const scope = createAgentWorkspaceExecutionScope({
    run_id: request.run_id,
    request_hash: request.request_hash,
    source_revision: request.source_revision,
    allowed_write_prefixes: ["apps/sample"],
    package_paths: ["apps/sample"],
    seed_patch: null,
    issued_at: "2026-07-23T01:00:00.000Z",
  })
  const executions: OpenClawExecutionRequest[] = []
  const host = createDeveloperWorkspaceOpenClawHost({
    db,
    repository_root: root,
    resolve_scope: async () => scope,
    build_submission: ({ request: run, evidence, created_at }) => ({
      schema_version: "trade.fixture-developer-submission.v1",
      run_id: run.run_id,
      patch_ref: evidence.patch_ref,
      quality_check_refs: evidence.quality_check_refs,
      created_at,
      domain_authority: "none",
    }),
    execute: async (input) => {
      executions.push(input)
      assert.equal(input.agent_id, "rd-developer-code")
      assert.equal(input.transport, "gateway")
      const envelope = JSON.parse(input.message)
      assert.equal(
        envelope.schema_version,
        "trade.openclaw-workspace-agent-message.v1",
      )
      writeFileSync(
        join(workspaceRoot, "apps/sample/index.ts"),
        "export const value = 2\n",
      )
      return gatewayResult("Model completion is not accepted as evidence.")
    },
    run_package_check: (input) =>
      runIsolatedAgentWorkspacePackageCheck({
        socket_path: checkerSocket,
        ...input,
      }),
    now: () => new Date("2026-07-23T01:00:00.000Z"),
  })
  try {
    await host.submit(request)
    const result = await waitForResult(host, request.run_id)
    assert.equal(result.status, "completed")
    assert.equal(executions.length, 1)
    assert.deepEqual(
      result.output_refs.map((ref) => ref.media_type),
      ["application/json", "text/x-diff", "application/json"],
    )
    const submission = JSON.parse(
      readAgentArtifact(root, result.output_refs[0]!).text,
    )
    assert.equal(submission.patch_ref.ref, result.output_refs[1]!.ref)
    assert.equal(
      submission.quality_check_refs[0].ref,
      result.output_refs[2]!.ref,
    )
    assert.match(readAgentArtifact(root, result.output_refs[1]!).text, /value = 2/)
    await waitFor(() => !existsSync(workspaceRoot))
    assert.equal(
      Bun.spawnSync({
        cmd: ["git", "worktree", "list", "--porcelain"],
        cwd: root,
      }).stdout.toString().includes(workspaceRoot),
      false,
    )
  } finally {
    await host.close()
    await checker.close()
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})

function buildRequest(
  instruction: AgentRunRequest["instruction_ref"],
  context: AgentRunRequest["input_refs"][number],
): AgentRunRequest {
  return buildAgentRunRequest({
    run_id: "developer-openclaw-workspace",
    idempotency_key: "developer-openclaw-workspace-key",
    trace_id: "developer-openclaw-workspace-trace",
    task_profile: "developer",
    objective: "Complete one bounded implementation gap.",
    source_revision: "HEAD",
    instruction_ref: instruction,
    input_refs: [context],
    output_schema_version: "trade.fixture-developer-submission.v1",
    capabilities: [
      "owner_read",
      "research_read",
      "workspace_read",
      "workspace_patch",
      "bounded_quality_check",
    ],
    budget: {
      deadline_at: "2026-07-23T02:00:00.000Z",
      max_wall_time_ms: 60_000,
      max_turns: 4,
      max_tool_calls: 4,
      max_input_bytes: instruction.bytes + context.bytes,
      max_output_bytes: 64 * 1024,
    },
    data_classification: "project_internal",
  })
}

function fixtureRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "developer-openclaw-workspace-host-"))
  mkdirSync(join(root, "apps/sample"), { recursive: true })
  writeFileSync(join(root, ".gitignore"), "data/\ntmp/\n")
  writeFileSync(join(root, "apps/sample/index.ts"), "export const value = 1\n")
  writeFileSync(join(root, "apps/sample/package.json"), JSON.stringify({
    name: "sample",
    private: true,
    scripts: { check: "bun -e \"process.exit(0)\"" },
  }))
  git(root, ["init"])
  git(root, ["config", "user.email", "workspace-host@example.invalid"])
  git(root, ["config", "user.name", "Workspace Host Test"])
  git(root, ["add", "."])
  git(root, ["commit", "-m", "fixture"])
  return root
}

function gatewayResult(text: string): OpenClawExecutionResult {
  return {
    exit_code: 0,
    stdout: JSON.stringify({
      runId: "gateway-run",
      status: "ok",
      result: {
        payloads: [{ text }],
        meta: { transport: "gateway", executionTrace: { runner: "gateway" } },
      },
    }),
    stderr: "",
    interrupted: false,
  }
}

function git(cwd: string, args: string[]): void {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString() || `git ${args[0]} failed`)
  }
}

async function waitForResult(
  host: ReturnType<typeof createDeveloperWorkspaceOpenClawHost>,
  runId: string,
) {
  await waitFor(async () => (await host.result(runId)) != null)
  return (await host.result(runId))!
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error("condition did not become true")
}
