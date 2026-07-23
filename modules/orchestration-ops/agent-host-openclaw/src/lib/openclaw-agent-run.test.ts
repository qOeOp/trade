import { createHash } from "node:crypto"
import assert from "node:assert/strict"
import test from "node:test"
import { Database } from "bun:sqlite"
import {
  buildAgentRunEvent,
  buildAgentRunRequest,
  type AgentRunRequest,
} from "../../../../contracts/agent-run-contract/src/agent-run-contract"
import {
  admitAgentRun,
  appendAgentRunEvent,
  ensureAgentRunStoreSchema,
  recordAgentRunToolCall,
  recordAgentRunToolResult,
} from "../../../ops-runtime-store/src/lib/agent-run-store"
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
    return gatewayResult('{"schema_version":"trade.test-output.v1","proposal":"bounded"}')
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

test("OpenClaw Host accepts the pinned 2026.7.1 embedded result shape", () => {
  assert.equal(parseOpenClawOutput(JSON.stringify({
    payloads: [{ text: "{\"status\":\"ok\"}", mediaUrl: null }],
    meta: {
      aborted: false,
      agentMeta: {
        provider: "siliconflow",
        model: "Qwen/Qwen3.5-27B",
        agentHarnessId: "openclaw",
      },
      executionTrace: {
        runner: "embedded",
        fallbackUsed: false,
        attempts: [{
          provider: "siliconflow",
          model: "Qwen/Qwen3.5-27B",
          result: "success",
          stage: "assistant",
        }],
      },
    },
  }), "embedded"), "{\"status\":\"ok\"}")
})

test("OpenClaw Developer Host completes from one attested terminal tool result", async () => {
  const fixture = createFixture("developer")
  const terminal = artifact("terminal-output", "application/json", "durable")
  admitFixtureForToolResult(fixture.db, fixture.request)
  recordAgentRunToolCall(fixture.db, {
    call_id: "developer-terminal-call-1",
    run_id: fixture.request.run_id,
    request_hash: fixture.request.request_hash,
    task_profile: "developer",
    tool_name: "research_developer_submission_prepare",
    occurred_at: "2026-07-23T11:59:58.000Z",
  })
  recordAgentRunToolResult(fixture.db, {
    call_id: "developer-terminal-call-1",
    run_id: fixture.request.run_id,
    request_hash: fixture.request.request_hash,
    task_profile: "developer",
    tool_name: "research_developer_submission_prepare",
    output_schema_version: fixture.request.output_schema_version,
    artifact: terminal,
    occurred_at: "2026-07-23T11:59:59.000Z",
  })
  const host = hostFor(
    fixture.db,
    async () => gatewayResult("NO_REPLY"),
    {
      terminal_tool_outputs: {
        developer: {
          tool_name: "research_developer_submission_prepare",
          output_schema_version: fixture.request.output_schema_version,
        },
      },
      validate_output_ref: async (_request, output) => output,
    },
  )
  const result = await waitForResultAfterSubmit(host, fixture.request)
  assert.equal(result.status, "completed")
  assert.deepEqual(result.output_refs, [terminal])
  fixture.db.close()
})

test("OpenClaw Host recovers a committed Developer result without rerunning the model", async () => {
  const fixture = createFixture("developer")
  const terminal = artifact("recoverable-terminal-output", "application/json", "durable")
  admitFixtureForToolResult(fixture.db, fixture.request)
  appendAgentRunEvent(fixture.db, buildAgentRunEvent({
    run_id: fixture.request.run_id,
    trace_id: fixture.request.trace_id,
    request_hash: fixture.request.request_hash,
    sequence: 2,
    occurred_at: "2026-07-23T11:59:57.500Z",
    kind: "started",
    summary: "OpenClaw Gateway Agent Run started.",
  }))
  seedTerminalToolResult(fixture.db, fixture.request, terminal)
  let executions = 0
  const host = hostFor(
    fixture.db,
    async () => {
      executions += 1
      return gatewayResult("{}")
    },
    terminalHostOptions(fixture.request),
  )
  assert.equal(await host.recoverInterruptedRuns(), 1)
  const result = await host.result(fixture.request.run_id)
  assert.equal(result?.status, "completed")
  assert.deepEqual(result?.output_refs, [terminal])
  assert.equal(executions, 0)
  fixture.db.close()
})

function hostFor(
  db: Database,
  execute: (
    input: OpenClawExecutionRequest,
    signal: AbortSignal,
  ) => Promise<OpenClawExecutionResult>,
  extra: Partial<ConstructorParameters<typeof OpenClawAgentHost>[0]> = {},
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
    ...extra,
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

function artifact(
  text: string,
  media_type: "text/markdown" | "application/json" = "text/markdown",
  storage: "temporary" | "durable" = "temporary",
) {
  const bytes = Buffer.from(text)
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  return {
    ref: storage === "durable"
      ? `agent-artifact://durable/${sha256}`
      : `artifact://${text}`,
    sha256,
    media_type,
    bytes: bytes.byteLength,
  }
}

function admitFixtureForToolResult(db: Database, request: AgentRunRequest): void {
  admitAgentRun(db, request, "openclaw-gateway", "2026-07-23T11:59:57.000Z")
}

function seedTerminalToolResult(
  db: Database,
  request: AgentRunRequest,
  terminal: ReturnType<typeof artifact>,
): void {
  recordAgentRunToolCall(db, {
    call_id: "developer-recovery-call-1",
    run_id: request.run_id,
    request_hash: request.request_hash,
    task_profile: "developer",
    tool_name: "research_developer_submission_prepare",
    occurred_at: "2026-07-23T11:59:58.000Z",
  })
  recordAgentRunToolResult(db, {
    call_id: "developer-recovery-call-1",
    run_id: request.run_id,
    request_hash: request.request_hash,
    task_profile: "developer",
    tool_name: "research_developer_submission_prepare",
    output_schema_version: request.output_schema_version,
    artifact: terminal,
    occurred_at: "2026-07-23T11:59:59.000Z",
  })
}

function terminalHostOptions(request: AgentRunRequest) {
  return {
    terminal_tool_outputs: {
      developer: {
        tool_name: "research_developer_submission_prepare",
        output_schema_version: request.output_schema_version,
      },
    },
    validate_output_ref: async (_request: AgentRunRequest, output: ReturnType<typeof artifact>) => output,
  }
}

async function waitForResultAfterSubmit(host: OpenClawAgentHost, request: AgentRunRequest) {
  await host.submit(request)
  return waitForResult(host, request.run_id)
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
