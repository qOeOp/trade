import { createHash } from "node:crypto"
import assert from "node:assert/strict"
import test from "node:test"
import {
  buildAgentRunEvent,
  buildAgentRunRequest,
  buildAgentRunResult,
} from "../../../../../contracts/agent-run-contract/src/agent-run-contract"
import type { AgentHostPort } from "../../../../../contracts/agent-run-contract/src/agent-host-port"
import { executeAgentRunThroughHost } from "./agent-run-host-execution"

test("R&D waits for one complete normalized Host lifecycle", async () => {
  const instruction = artifact("instruction")
  const request = buildAgentRunRequest({
    run_id: "hosted-run",
    idempotency_key: "hosted-key",
    trace_id: "hosted-trace",
    task_profile: "planner",
    objective: "Return one proposal.",
    source_revision: "0123456789abcdef",
    instruction_ref: instruction,
    input_refs: [],
    output_schema_version: "trade.test-output.v1",
    capabilities: ["owner_read", "research_read"],
    budget: {
      deadline_at: new Date(Date.now() + 60_000).toISOString(),
      max_wall_time_ms: 60_000,
      max_turns: 8,
      max_tool_calls: 12,
      max_input_bytes: instruction.bytes,
      max_output_bytes: 10_000,
    },
    data_classification: "project_internal",
  })
  const output = artifact("{}")
  const accepted = buildAgentRunEvent({
    run_id: request.run_id,
    trace_id: request.trace_id,
    request_hash: request.request_hash,
    sequence: 1,
    occurred_at: "2026-07-23T12:00:00.000Z",
    kind: "accepted",
    summary: "accepted",
  })
  const terminal = buildAgentRunEvent({
    run_id: request.run_id,
    trace_id: request.trace_id,
    request_hash: request.request_hash,
    sequence: 2,
    occurred_at: "2026-07-23T12:00:01.000Z",
    kind: "terminal",
    summary: "completed",
    status: "completed",
  })
  const result = buildAgentRunResult({
    run_id: request.run_id,
    trace_id: request.trace_id,
    request_hash: request.request_hash,
    terminal_sequence: 2,
    finished_at: "2026-07-23T12:00:01.000Z",
    status: "completed",
    output_refs: [output],
    usage: {
      wall_time_ms: 1_000,
      turns: 1,
      tool_calls: 0,
      input_bytes: instruction.bytes,
      output_bytes: output.bytes,
    },
  })
  const host: AgentHostPort = {
    submit: async () => ({
      run_id: request.run_id,
      request_hash: request.request_hash,
      accepted: true,
      replayed: false,
    }),
    events: async (_runId, after) => [accepted, terminal].filter((event) => event.sequence > after),
    status: async () => ({
      run_id: request.run_id,
      request_hash: request.request_hash,
      status: "completed",
      last_sequence: 2,
      terminal: true,
    }),
    result: async () => result,
    cancel: async () => undefined,
    steer: async () => undefined,
    approve: async () => undefined,
  }
  const completed = await executeAgentRunThroughHost({
    host,
    request,
    poll_interval_ms: 10,
  })
  assert.equal(completed.result.result_hash, result.result_hash)
  assert.equal(completed.events.length, 2)
})

function artifact(text: string) {
  const bytes = Buffer.from(text)
  return {
    ref: `artifact://${createHash("sha256").update(bytes).digest("hex")}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    media_type: "application/json" as const,
    bytes: bytes.byteLength,
  }
}
