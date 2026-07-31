import { createHash } from "node:crypto"
import assert from "node:assert/strict"
import test from "node:test"
import { Database } from "bun:sqlite"
import { buildAgentRunRequest } from "../../../../contracts/agent-run-contract/src/agent-run-contract"
import { ensureAgentRunStoreSchema } from "../../../ops-runtime-store/src/lib/agent-run-store"
import type { CodexAppServerClientPort } from "./codex-app-server-client"
import type { CodexAgentRunMaterialization, MaterializedAgentArtifact } from "./codex-agent-run-mapping"
import { DirectCodexAgentHost } from "./direct-codex-agent-host"

test("Direct Codex Host runs a typed request to one durable terminal result", async () => {
  const fixture = createFixture("planner")
  const fake = new FakeClient("complete")
  const host = createHost(fixture.db, fake, fixture.materialization)
  const acceptance = await host.submit(fixture.request)
  assert.equal(acceptance.replayed, false)
  const result = await waitForResult(host, fixture.request.run_id)
  assert.equal(result.status, "completed")
  assert.equal(result.output_refs.length, 1)
  assert.equal((await host.events(fixture.request.run_id, 0, 10))[0]!.kind, "accepted")
  assert.equal((await host.submit(fixture.request)).replayed, true)
  assert.equal(fake.startCount, 1)
  await host.close()
  fixture.db.close()
})

test("Direct Codex Host interrupts cancel and preserves one terminal closure", async () => {
  const fixture = createFixture("planner")
  const fake = new FakeClient("wait")
  const host = createHost(fixture.db, fake, fixture.materialization)
  await host.submit(fixture.request)
  await waitFor(() => fake.turnId != null)
  await host.cancel(fixture.request.run_id, fixture.request.request_hash)
  const result = await waitForResult(host, fixture.request.run_id)
  assert.equal(result.status, "cancelled")
  assert.equal(result.failure?.class, "cancelled")
  assert.equal(fake.interruptCount, 1)
  await host.close()
  fixture.db.close()
})

test("a restarted Host fails closed instead of replaying an interrupted workspace effect", async () => {
  const fixture = createFixture("developer")
  const firstClient = new FakeClient("wait")
  const first = createHost(fixture.db, firstClient, fixture.materialization)
  await first.submit(fixture.request)
  await waitFor(() => firstClient.turnId != null)
  await first.close()
  const secondClient = new FakeClient("complete")
  const second = createHost(fixture.db, secondClient, fixture.materialization)
  assert.equal((await second.submit(fixture.request)).replayed, true)
  const result = await waitForResult(second, fixture.request.run_id)
  assert.equal(result.status, "failed")
  assert.equal(result.failure?.class, "tool_effect_uncertain")
  assert.equal(result.failure?.effect_status, "uncertain")
  assert.equal(secondClient.startCount, 0)
  await second.close()
  fixture.db.close()
})

test("Direct Codex Host persists Host-derived workspace evidence with the typed output", async () => {
  const fixture = createFixture("developer")
  const fake = new FakeClient("complete")
  const host = new DirectCodexAgentHost({
    db: fixture.db,
    materialize: async () => fixture.materialization,
    store_outputs: async (_request, text) => [
      outputArtifact("submission", text, "application/json"),
      outputArtifact("patch", "diff --git a/a b/a\n", "text/x-diff"),
      outputArtifact("check", "{\"exit_code\":0}", "application/json"),
    ],
    resolve_steer: async () => "continue",
    create_client: (onNotification) => fake.connect(onNotification),
    now: () => new Date("2026-07-23T01:00:00.000Z"),
  })
  await host.submit(fixture.request)
  const result = await waitForResult(host, fixture.request.run_id)
  assert.equal(result.status, "completed")
  assert.deepEqual(
    result.output_refs.map((ref) => ref.media_type),
    ["application/json", "text/x-diff", "application/json"],
  )
  await host.close()
  fixture.db.close()
})

test("Direct Codex Host closes failed output finalization and proactively recovers interrupted runs", async () => {
  const fixture = createFixture("developer")
  const fake = new FakeClient("complete")
  const terminal: string[] = []
  const first = new DirectCodexAgentHost({
    db: fixture.db,
    materialize: async () => fixture.materialization,
    store_outputs: async () => {
      throw new Error("quality failed")
    },
    resolve_steer: async () => "continue",
    create_client: (onNotification) => fake.connect(onNotification),
    after_terminal: async (_request, result) => {
      terminal.push(result.status)
    },
    now: () => new Date("2026-07-23T01:00:00.000Z"),
  })
  await first.submit(fixture.request)
  const failed = await waitForResult(first, fixture.request.run_id)
  assert.equal(failed.status, "failed")
  assert.equal(failed.failure?.class, "validation_failed")
  assert.deepEqual(terminal, ["failed"])
  await first.close()
  fixture.db.close()

  const interrupted = createFixture("developer")
  const waitingClient = new FakeClient("wait")
  const waitingHost = createHost(
    interrupted.db,
    waitingClient,
    interrupted.materialization,
  )
  await waitingHost.submit(interrupted.request)
  await waitFor(() => waitingClient.turnId != null)
  await waitingHost.close()
  const recovering = createHost(
    interrupted.db,
    new FakeClient("complete"),
    interrupted.materialization,
  )
  assert.equal(await recovering.recoverInterruptedRuns(), 1)
  const recovered = await waitForResult(recovering, interrupted.request.run_id)
  assert.equal(recovered.failure?.class, "tool_effect_uncertain")
  await recovering.close()
  interrupted.db.close()
})

class FakeClient implements CodexAppServerClientPort {
  private onNotification: (method: string, params: unknown) => void = () => undefined
  startCount = 0
  interruptCount = 0
  turnId: string | null = null

  constructor(private readonly mode: "complete" | "wait") {}

  connect(onNotification: (method: string, params: unknown) => void): this {
    this.onNotification = onNotification
    return this
  }

  async initialize(): Promise<void> {}

  async startThread(): Promise<string> {
    this.startCount += 1
    return "thread-fixture"
  }

  async startTurn(): Promise<string> {
    this.turnId = "turn-fixture"
    queueMicrotask(() => {
      this.onNotification("turn/started", { turn: { id: this.turnId } })
      if (this.mode === "complete") {
        this.onNotification("item/completed", {
          item: { id: "message-fixture", type: "agentMessage", text: "{\"proposal\":\"bounded\"}" },
        })
        this.onNotification("turn/completed", { turn: { id: this.turnId, status: "completed" } })
      }
    })
    return this.turnId
  }

  async steer(): Promise<void> {}

  async interrupt(): Promise<void> {
    this.interruptCount += 1
    this.onNotification("turn/completed", { turn: { id: this.turnId, status: "interrupted" } })
  }

  async close(): Promise<void> {}
}

function createHost(db: Database, fake: FakeClient, materialization: CodexAgentRunMaterialization) {
  return new DirectCodexAgentHost({
    db,
    materialize: async () => materialization,
    store_output: async (_request, text) => {
      const bytes = Buffer.from(text)
      return {
        ref: `artifact://agent-output-${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}`,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        media_type: "application/json",
        bytes: bytes.byteLength,
      }
    },
    resolve_steer: async () => "continue",
    create_client: (onNotification) => fake.connect(onNotification),
    now: () => new Date("2026-07-23T01:00:00.000Z"),
  })
}

function createFixture(profile: "planner" | "developer") {
  const db = new Database(":memory:")
  ensureAgentRunStoreSchema(db)
  const instruction = materialized("artifact://instruction", "Follow the bounded role contract.")
  const input = materialized("artifact://context", "{\"program\":\"rd-program\"}", "application/json")
  const request = buildAgentRunRequest({
    run_id: `agent-run-host-${profile}`,
    idempotency_key: `rd:${profile}:host-fixture`,
    trace_id: `trace-agent-run-host-${profile}`,
    task_profile: profile,
    objective: "Return one bounded typed proposal.",
    source_revision: "a2089f8197d3",
    instruction_ref: instruction.artifact,
    input_refs: [input.artifact],
    output_schema_version: "trade.test-output.v1",
    capabilities: profile === "developer"
      ? ["owner_read", "research_read", "workspace_read", "workspace_patch", "bounded_quality_check"]
      : ["owner_read", "research_read"],
    budget: {
      deadline_at: "2026-07-23T02:00:00.000Z",
      max_wall_time_ms: 60_000,
      max_turns: 8,
      max_tool_calls: 12,
      max_input_bytes: 10_000,
      max_output_bytes: 10_000,
    },
    data_classification: "project_internal",
  })
  return {
    db,
    request,
    materialization: {
      repo_root: "/repo",
      workspace_root: profile === "developer"
        ? `/repo/tmp/agent-workspaces/${request.run_id}`
        : "/repo/tmp/agent-snapshots/read-only",
      instruction,
      inputs: [input],
      output_schema: {
        type: "object",
        additionalProperties: false,
        required: ["proposal"],
        properties: { proposal: { type: "string" } },
      },
    },
  }
}

async function waitForResult(host: DirectCodexAgentHost, runId: string) {
  await waitFor(async () => (await host.result(runId)) != null)
  return (await host.result(runId))!
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error("condition did not become true")
}

function materialized(
  ref: string,
  text: string,
  media_type: MaterializedAgentArtifact["artifact"]["media_type"] = "text/markdown",
): MaterializedAgentArtifact {
  const bytes = Buffer.from(text)
  return {
    artifact: {
      ref,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      media_type,
      bytes: bytes.byteLength,
    },
    text,
  }
}

function outputArtifact(
  name: string,
  text: string,
  mediaType: MaterializedAgentArtifact["artifact"]["media_type"],
) {
  const bytes = Buffer.from(text)
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  return {
    ref: `artifact://${name}-${sha256.slice(0, 16)}`,
    sha256,
    media_type: mediaType,
    bytes: bytes.byteLength,
  }
}
