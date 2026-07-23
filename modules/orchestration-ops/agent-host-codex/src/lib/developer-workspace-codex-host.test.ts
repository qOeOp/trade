import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
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
import { ensureAgentRunStoreSchema } from "../../../ops-runtime-store/src/lib/agent-run-store"
import type { CodexAppServerClientPort } from "./codex-app-server-client"
import { createDeveloperWorkspaceCodexHost } from "./developer-workspace-codex-host"

test("Developer workspace Codex composition owns worktree, check, artifacts, Result, and cleanup", async () => {
  const root = fixtureRepository()
  const db = new Database(":memory:")
  ensureAgentRunStoreSchema(db)
  const instruction = writeAgentTextArtifact({
    repository_root: root,
    storage: "temporary",
    media_type: "text/markdown",
    text: "Modify the bounded sample implementation and its test.",
  })
  const context = writeAgentTextArtifact({
    repository_root: root,
    storage: "temporary",
    media_type: "application/json",
    text: "{\"reason\":\"implementation_missing\"}",
  })
  const request = buildRequest(instruction, context)
  const workspaceRoot = join(root, "tmp", "agent-workspaces", request.run_id)
  const scope = createAgentWorkspaceExecutionScope({
    run_id: request.run_id,
    request_hash: request.request_hash,
    source_revision: request.source_revision,
    allowed_write_prefixes: ["modules/sample"],
    package_path: "modules/sample",
    seed_patch: null,
    issued_at: "2026-07-23T01:00:00.000Z",
  })
  const client = new EditingClient(workspaceRoot)
  const errors: string[] = []
  const host = createDeveloperWorkspaceCodexHost({
    db,
    repository_root: root,
    codex_path: "/unused/codex",
    resolve_scope: async () => scope,
    build_submission: ({ request: run, evidence, created_at }) => ({
      schema_version: "trade.fixture-developer-submission.v1",
      run_id: run.run_id,
      patch_ref: evidence.patch_ref,
      quality_check_refs: evidence.quality_check_refs,
      created_at,
      domain_authority: "none",
    }),
    create_client: (onNotification) => client.connect(onNotification),
    report_error: (error) => errors.push(error.stage),
    now: () => new Date("2026-07-23T01:00:00.000Z"),
  })
  try {
    await host.submit(request)
    const result = await waitForResult(host, request.run_id)
    assert.equal(result.status, "completed", errors.join(","))
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
    assert.match(
      readAgentArtifact(root, result.output_refs[1]!).text,
      /value = 2/,
    )
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
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})

class EditingClient implements CodexAppServerClientPort {
  private onNotification: (method: string, params: unknown) => void =
    () => undefined

  constructor(private readonly workspaceRoot: string) {}

  connect(onNotification: (method: string, params: unknown) => void): this {
    this.onNotification = onNotification
    return this
  }

  async initialize(): Promise<void> {}
  async startThread(): Promise<string> {
    return "thread-developer-workspace"
  }
  async startTurn(): Promise<string> {
    writeFileSync(
      join(this.workspaceRoot, "modules/sample/index.ts"),
      "export const value = 2\n",
    )
    queueMicrotask(() => {
      this.onNotification("item/completed", {
        item: {
          id: "message-developer-workspace",
          type: "agentMessage",
          text: "Changed the bounded implementation and ran its package check.",
        },
      })
      this.onNotification("turn/completed", {
        turn: { id: "turn-developer-workspace", status: "completed" },
      })
    })
    return "turn-developer-workspace"
  }
  async steer(): Promise<void> {}
  async interrupt(): Promise<void> {}
  async close(): Promise<void> {}
}

function buildRequest(
  instruction: AgentRunRequest["instruction_ref"],
  context: AgentRunRequest["input_refs"][number],
): AgentRunRequest {
  return buildAgentRunRequest({
    run_id: "developer-workspace-composition",
    idempotency_key: "developer-workspace-composition-key",
    trace_id: "developer-workspace-composition-trace",
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
  const root = mkdtempSync(join(tmpdir(), "developer-workspace-host-"))
  mkdirSync(join(root, "modules/sample"), { recursive: true })
  writeFileSync(join(root, ".gitignore"), "data/\ntmp/\n")
  writeFileSync(
    join(root, "modules/sample/index.ts"),
    "export const value = 1\n",
  )
  writeFileSync(join(root, "modules/sample/package.json"), JSON.stringify({
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
  host: ReturnType<typeof createDeveloperWorkspaceCodexHost>,
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
