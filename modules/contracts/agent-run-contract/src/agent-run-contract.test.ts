import assert from "node:assert/strict"
import test from "node:test"
import {
  buildAgentRunEvent,
  buildAgentRunRequest,
  buildAgentRunResult,
  compileAgentRunEvent,
  compileAgentRunRequest,
  validateAgentRunCompletion,
  validateAgentRunEventStream,
} from "./agent-run-contract"

const SHA_A = "a".repeat(64)
const SHA_B = "b".repeat(64)

test("request is provider-neutral, ref-bound, budgeted, and canonical", () => {
  const request = requestFixture()
  assert.equal(compileAgentRunRequest(request).request_hash, request.request_hash)
  assert.equal(request.domain_authority, "none")
  assert.equal(Object.hasOwn(request, "provider"), false)
  assert.equal(Object.hasOwn(request, "model"), false)
  assert.equal(Object.hasOwn(request, "command"), false)
})

test("profile capabilities are closed-world and read-only roles cannot patch", () => {
  assert.throws(() => requestFixture({
    task_profile: "planner",
    capabilities: ["owner_read", "workspace_patch"],
  }), /planner does not allow/)
  assert.throws(() => requestFixture({
    task_profile: "reviewer",
    capabilities: ["bounded_quality_check"],
  }), /reviewer does not allow/)
})

test("request rejects secrets, paths, duplicate refs, and identity drift", () => {
  assert.throws(() => requestFixture({ objective: "Use Authorization: Bearer sk-secretsecretsecret" }), /secret-like/)
  assert.throws(() => requestFixture({
    instruction_ref: { ref: "/tmp/prompt.md", sha256: SHA_A, media_type: "text/markdown", bytes: 100 },
  }), /repository-relative/)
  assert.throws(() => requestFixture({
    input_refs: [
      { ref: "artifact://same", sha256: SHA_B, media_type: "application/json", bytes: 10 },
      { ref: "artifact://same", sha256: SHA_B, media_type: "application/json", bytes: 10 },
    ],
  }), /duplicate/)
  const request = requestFixture()
  assert.throws(() => compileAgentRunRequest({ ...request, trace_id: "trace-drift" }), /hash mismatch/)
})

test("event stream is contiguous, identity-bound, terminal, and rejects extra payload", () => {
  const request = requestFixture()
  const events = eventFixture(request)
  assert.equal(validateAgentRunEventStream(request, events).length, 3)
  assert.throws(() => validateAgentRunEventStream(request, [events[0]!, events[2]!]), /contiguous/)
  assert.throws(() => validateAgentRunEventStream(request, events.slice(0, 2)), /no terminal/)
  assert.throws(() => compileAgentRunEvent({ ...events[1], reasoning: "private chain" }), /does not allow/)
})

test("completed result closes terminal identity and request budgets", () => {
  const request = requestFixture()
  const events = eventFixture(request)
  const result = buildAgentRunResult({
    run_id: request.run_id,
    trace_id: request.trace_id,
    request_hash: request.request_hash,
    terminal_sequence: 3,
    finished_at: "2026-07-23T08:00:02.000Z",
    status: "completed",
    output_refs: [{ ref: "artifact://patch-1", sha256: SHA_B, media_type: "text/x-diff", bytes: 200 }],
    usage: { wall_time_ms: 2_000, turns: 2, tool_calls: 1, input_bytes: 1_100, output_bytes: 200 },
  })
  assert.doesNotThrow(() => validateAgentRunCompletion(request, events, result))
  assert.throws(() => validateAgentRunCompletion(request, events, { ...result, terminal_sequence: 2 }), /terminal event/)
  assert.throws(() => validateAgentRunCompletion(request, events, {
    ...result,
    usage: { ...result.usage, tool_calls: 99 },
  }), /exceeded request budget/)
})

test("uncertain tool effects fail closed and cannot auto-retry", () => {
  const request = requestFixture()
  assert.throws(() => buildAgentRunResult({
    run_id: request.run_id,
    trace_id: request.trace_id,
    request_hash: request.request_hash,
    terminal_sequence: 2,
    finished_at: "2026-07-23T08:00:02.000Z",
    status: "failed",
    output_refs: [],
    usage: { wall_time_ms: 2_000, turns: 1, tool_calls: 1, input_bytes: 1_100, output_bytes: 0 },
    failure: { class: "tool_effect_uncertain", retryable: true, effect_status: "uncertain" },
  }), /must not be retried/)
})

function requestFixture(overrides: Record<string, unknown> = {}) {
  return buildAgentRunRequest({
    run_id: "agent-run-1",
    idempotency_key: "rd:proposal-1:developer:r1",
    trace_id: "trace-agent-run-1",
    task_profile: "developer",
    objective: "Implement the frozen strategy draft in the isolated workspace and return a patch.",
    source_revision: "a2089f8197d3",
    instruction_ref: { ref: "artifact://brief-1", sha256: SHA_A, media_type: "text/markdown", bytes: 1_000 },
    input_refs: [{ ref: "artifact://context-1", sha256: SHA_B, media_type: "application/json", bytes: 100 }],
    output_schema_version: "trade.developer-patch.v1",
    capabilities: ["owner_read", "research_read", "workspace_read", "workspace_patch", "bounded_quality_check"],
    budget: {
      deadline_at: "2026-07-23T09:00:00.000Z",
      max_wall_time_ms: 60_000,
      max_turns: 8,
      max_tool_calls: 12,
      max_input_bytes: 10_000,
      max_output_bytes: 10_000,
    },
    data_classification: "project_internal",
    ...overrides,
  } as Parameters<typeof buildAgentRunRequest>[0])
}

function eventFixture(request: ReturnType<typeof requestFixture>) {
  return [
    buildAgentRunEvent({
      run_id: request.run_id,
      trace_id: request.trace_id,
      request_hash: request.request_hash,
      sequence: 1,
      occurred_at: "2026-07-23T08:00:00.000Z",
      kind: "accepted",
      summary: "Run accepted by the selected Host.",
    }),
    buildAgentRunEvent({
      run_id: request.run_id,
      trace_id: request.trace_id,
      request_hash: request.request_hash,
      sequence: 2,
      occurred_at: "2026-07-23T08:00:01.000Z",
      kind: "progress",
      summary: "Validated the isolated workspace input refs.",
    }),
    buildAgentRunEvent({
      run_id: request.run_id,
      trace_id: request.trace_id,
      request_hash: request.request_hash,
      sequence: 3,
      occurred_at: "2026-07-23T08:00:02.000Z",
      kind: "terminal",
      summary: "Patch and bounded test evidence are ready for owner validation.",
      status: "completed",
    }),
  ]
}
