import assert from "node:assert/strict"
import test from "node:test"
import { Database } from "bun:sqlite"
import {
  buildAgentRunEvent,
  buildAgentRunRequest,
  buildAgentRunResult,
} from "../../../../contracts/agent-run-contract/src/agent-run-contract"
import {
  admitAgentRun,
  appendAgentRunEvent,
  bindAgentRunHostSession,
  completeAgentRun,
  ensureAgentRunStoreSchema,
  listRecoverableAgentRuns,
  markAgentRunCancelling,
  projectAgentRunStatus,
  readAgentRun,
  readAgentRunEvents,
} from "./agent-run-store"

const ACCEPTED_AT = "2026-07-23T01:00:00.000Z"

test("Agent Run registry is durable, idempotent, and identity-bound", () => {
  const db = new Database(":memory:")
  ensureAgentRunStoreSchema(db)
  const request = fixture()
  assert.equal(admitAgentRun(db, request, "direct-codex", ACCEPTED_AT).replayed, false)
  assert.equal(admitAgentRun(db, request, "direct-codex", ACCEPTED_AT).replayed, true)
  assert.throws(
    () => admitAgentRun(db, { ...request, request_hash: "b".repeat(64) }, "direct-codex", ACCEPTED_AT),
    /identity|request_hash/,
  )
  bindAgentRunHostSession(db, {
    run_id: request.run_id,
    request_hash: request.request_hash,
    host_thread_id: "thread-1",
    host_turn_id: "turn-1",
    observed_at: "2026-07-23T01:00:01.000Z",
  })
  assert.throws(() => bindAgentRunHostSession(db, {
    run_id: request.run_id,
    request_hash: request.request_hash,
    host_thread_id: "thread-2",
    observed_at: "2026-07-23T01:00:02.000Z",
  }), /thread identity drifted/)
  const recovered = listRecoverableAgentRuns(db)
  assert.equal(recovered.length, 1)
  assert.equal(recovered[0]!.host_thread_id, "thread-1")
  db.close()
})

test("Agent Run registry enforces contiguous terminal closure and cancel state", () => {
  const db = new Database(":memory:")
  ensureAgentRunStoreSchema(db)
  const request = fixture()
  admitAgentRun(db, request, "direct-codex", ACCEPTED_AT)
  appendAgentRunEvent(db, buildAgentRunEvent({
    run_id: request.run_id,
    trace_id: request.trace_id,
    request_hash: request.request_hash,
    sequence: 2,
    occurred_at: "2026-07-23T01:00:01.000Z",
    kind: "started",
    summary: "Codex turn started.",
  }))
  assert.throws(() => appendAgentRunEvent(db, buildAgentRunEvent({
    run_id: request.run_id,
    trace_id: request.trace_id,
    request_hash: request.request_hash,
    sequence: 4,
    occurred_at: "2026-07-23T01:00:02.000Z",
    kind: "progress",
    summary: "Invalid gap.",
  })), /not contiguous/)
  markAgentRunCancelling(db, request.run_id, request.request_hash, "2026-07-23T01:00:02.000Z")
  assert.equal(projectAgentRunStatus(readAgentRun(db, request.run_id)!).status, "cancelling")
  appendAgentRunEvent(db, buildAgentRunEvent({
    run_id: request.run_id,
    trace_id: request.trace_id,
    request_hash: request.request_hash,
    sequence: 3,
    occurred_at: "2026-07-23T01:00:03.000Z",
    kind: "terminal",
    summary: "Codex turn was interrupted.",
    status: "cancelled",
    failure_class: "cancelled",
  }))
  const result = buildAgentRunResult({
    run_id: request.run_id,
    trace_id: request.trace_id,
    request_hash: request.request_hash,
    terminal_sequence: 3,
    finished_at: "2026-07-23T01:00:03.000Z",
    status: "cancelled",
    output_refs: [],
    usage: { wall_time_ms: 3_000, turns: 1, tool_calls: 0, input_bytes: 128, output_bytes: 0 },
    failure: { class: "cancelled", retryable: false, effect_status: "none" },
  })
  assert.equal(completeAgentRun(db, result).result_hash, result.result_hash)
  assert.equal(completeAgentRun(db, result).result_hash, result.result_hash)
  assert.equal(readAgentRunEvents(db, request.run_id, 1, 10).length, 2)
  assert.equal(projectAgentRunStatus(readAgentRun(db, request.run_id)!).terminal, true)
  assert.equal(listRecoverableAgentRuns(db).length, 0)
  db.close()
})

function fixture() {
  return buildAgentRunRequest({
    run_id: "agent-run-registry-1",
    idempotency_key: "rd:planner:registry-1",
    trace_id: "trace-agent-run-registry-1",
    task_profile: "planner",
    objective: "Produce one bounded strategy hypothesis proposal.",
    source_revision: "a2089f8197d3",
    instruction_ref: {
      ref: "artifact://brief-registry-1",
      sha256: "a".repeat(64),
      media_type: "text/markdown",
      bytes: 128,
    },
    input_refs: [],
    output_schema_version: "trade.strategy-hypothesis.v1",
    capabilities: ["owner_read", "research_read"],
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
}
