import { createHash } from "node:crypto"
import assert from "node:assert/strict"
import test from "node:test"
import { Database } from "bun:sqlite"
import {
  buildAgentRunRequest,
  type AgentRunRequest,
} from "../../../../contracts/agent-run-contract/src/agent-run-contract"
import { ensureAgentRunStoreSchema } from "../../../ops-runtime-store/src/lib/agent-run-store"
import {
  OpenClawAgentHost,
  parseOpenClawOutput,
  type OpenClawExecutionRequest,
  type OpenClawExecutionResult,
} from "./openclaw-agent-run"

test("OpenClaw Gateway Host closes one typed Agent Run and replays identity", async () => {
  const fixture = createFixture("planner")
  let calls = 0
  const host = hostFor(fixture.db, async () => {
    calls += 1
    return gatewayResult('{"proposal":"bounded"}')
  })
  assert.equal((await host.submit(fixture.request)).replayed, false)
  const result = await waitForResult(host, fixture.request.run_id)
  assert.equal(result.status, "completed")
  assert.equal(result.output_refs.length, 1)
  assert.equal((await host.submit(fixture.request)).replayed, true)
  assert.equal(calls, 1)
  fixture.db.close()
})

test("OpenClaw Host rejects silent embedded fallback and uncertain Developer restart", async () => {
  assert.throws(() => parseOpenClawOutput(JSON.stringify({
    payloads: [{ text: "{}" }],
    meta: { transport: "embedded", fallbackFrom: "gateway" },
  }), "gateway"), /transport drifted/)

  const fixture = createFixture("developer")
  const never = async (_input: unknown, signal: AbortSignal): Promise<OpenClawExecutionResult> =>
    await new Promise((resolve) => {
      signal.addEventListener("abort", () => resolve({
        exit_code: 143,
        stdout: "",
        stderr: "",
        interrupted: true,
      }), { once: true })
    })
  const first = hostFor(fixture.db, never)
  await first.submit(fixture.request)
  await waitFor(async () => (await first.status(fixture.request.run_id)).status === "running")
  const second = hostFor(fixture.db, async () => gatewayResult("{}"))
  assert.equal((await second.submit(fixture.request)).replayed, true)
  const result = await waitForResult(second, fixture.request.run_id)
  assert.equal(result.failure?.class, "tool_effect_uncertain")
  await first.close()
  fixture.db.close()
})

function hostFor(
  db: Database,
  execute: (
    input: OpenClawExecutionRequest,
    signal: AbortSignal,
  ) => Promise<OpenClawExecutionResult>,
) {
  return new OpenClawAgentHost({
    db,
    host_profile: "openclaw-gateway",
    allowed_task_profiles: ["planner", "developer", "reviewer", "explanation"],
    agent_ids: {
      planner: "rd-planner",
      developer: "rd-developer",
      reviewer: "rd-reviewer",
      explanation: "ops-explanation",
    },
    materialize: async () => "<agent-run>Return the typed object.</agent-run>",
    store_output: async (_request, text) => {
      const bytes = Buffer.from(text)
      return {
        ref: `artifact://openclaw/${createHash("sha256").update(bytes).digest("hex")}`,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        media_type: "application/json",
        bytes: bytes.byteLength,
      }
    },
    execute,
    now: () => new Date("2026-07-23T12:00:00.000Z"),
  })
}

function createFixture(profile: "planner" | "developer"): {
  db: Database
  request: AgentRunRequest
} {
  const db = new Database(":memory:")
  ensureAgentRunStoreSchema(db)
  const instruction = artifact("instruction")
  const context = artifact("context", "application/json")
  return {
    db,
    request: buildAgentRunRequest({
      run_id: `openclaw-run-${profile}`,
      idempotency_key: `openclaw-key-${profile}`,
      trace_id: `openclaw-trace-${profile}`,
      task_profile: profile,
      objective: "Return one bounded typed proposal.",
      source_revision: "0123456789abcdef",
      instruction_ref: instruction,
      input_refs: [context],
      output_schema_version: "trade.test-output.v1",
      capabilities: profile === "developer"
        ? ["owner_read", "research_read", "workspace_read", "workspace_patch", "bounded_quality_check"]
        : ["owner_read", "research_read"],
      budget: {
        deadline_at: "2026-07-23T13:00:00.000Z",
        max_wall_time_ms: 60_000,
        max_turns: 8,
        max_tool_calls: 12,
        max_input_bytes: 10_000,
        max_output_bytes: 10_000,
      },
      data_classification: "project_internal",
    }),
  }
}

function gatewayResult(text: string): OpenClawExecutionResult {
  return {
    exit_code: 0,
    stdout: JSON.stringify({
      runId: "gateway-run",
      status: "ok",
      result: { payloads: [{ text }], meta: {} },
    }),
    stderr: "",
    interrupted: false,
  }
}

function artifact(text: string, media_type: "text/markdown" | "application/json" = "text/markdown") {
  const bytes = Buffer.from(text)
  return {
    ref: `artifact://${text}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    media_type,
    bytes: bytes.byteLength,
  }
}

async function waitForResult(host: OpenClawAgentHost, runId: string) {
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
