import assert from "node:assert/strict"
import test from "node:test"
import type { AgentHostPort, AgentRunAcceptance, AgentRunStatus } from "./agent-host-port"
import {
  validateAgentRunAcceptance,
  validateAgentRunApproval,
  validateAgentRunStatus,
} from "./agent-host-port"
import { buildAgentRunRequest, type AgentRunRequest } from "./agent-run-contract"

const SHA_A = "a".repeat(64)

test("Host port identity keeps duplicate submit idempotent and rejects drift", async () => {
  const host = new FakeHost()
  const request = fixture()
  const first = validateAgentRunAcceptance(request, await host.submit(request))
  const replay = validateAgentRunAcceptance(request, await host.submit(request))
  assert.deepEqual(first, { run_id: request.run_id, request_hash: request.request_hash, accepted: true, replayed: false })
  assert.equal(replay.replayed, true)
  await assert.rejects(() => host.submit({ ...request, request_hash: "b".repeat(64) }), /identity drift/)
})

test("Host status terminal projection and profile approvals fail closed", () => {
  const status: AgentRunStatus = {
    run_id: "agent-run-1",
    request_hash: SHA_A,
    status: "running",
    last_sequence: 2,
    terminal: false,
  }
  assert.deepEqual(validateAgentRunStatus(status), status)
  assert.throws(() => validateAgentRunStatus({ ...status, terminal: true }), /inconsistent/)
  assert.throws(() => validateAgentRunApproval({
    run_id: status.run_id,
    request_hash: status.request_hash,
    operation_ref: "operation://write",
    decision: "allow_once",
  }, "planner"), /read-only/)
})

class FakeHost implements AgentHostPort {
  private request: AgentRunRequest | null = null

  async submit(request: AgentRunRequest): Promise<AgentRunAcceptance> {
    if (this.request && this.request.request_hash !== request.request_hash) throw new Error("Agent Run identity drift")
    const replayed = this.request != null
    this.request = request
    return { run_id: request.run_id, request_hash: request.request_hash, accepted: true, replayed }
  }
  async events() { return [] }
  async status(): Promise<AgentRunStatus> {
    if (!this.request) throw new Error("missing request")
    return {
      run_id: this.request.run_id,
      request_hash: this.request.request_hash,
      status: "accepted",
      last_sequence: 0,
      terminal: false,
    }
  }
  async steer() {}
  async approve() {}
  async cancel() {}
  async result() { return null }
}

function fixture() {
  return buildAgentRunRequest({
    run_id: "agent-run-1",
    idempotency_key: "rd:planner:1",
    trace_id: "trace-agent-run-1",
    task_profile: "planner",
    objective: "Produce one typed strategy hypothesis proposal.",
    source_revision: "a2089f8197d3",
    instruction_ref: { ref: "artifact://brief-1", sha256: SHA_A, media_type: "text/markdown", bytes: 100 },
    input_refs: [],
    output_schema_version: "trade.strategy-hypothesis.v1",
    capabilities: ["owner_read", "research_read"],
    budget: {
      deadline_at: "2026-07-23T09:00:00.000Z",
      max_wall_time_ms: 60_000,
      max_turns: 8,
      max_tool_calls: 12,
      max_input_bytes: 10_000,
      max_output_bytes: 10_000,
    },
    data_classification: "project_internal",
  })
}
