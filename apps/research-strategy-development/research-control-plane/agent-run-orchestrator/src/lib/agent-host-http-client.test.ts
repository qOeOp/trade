import assert from "node:assert/strict"
import test from "node:test"
import { buildAgentRunRequest } from "../../../../../contracts/agent-run-contract/src/agent-run-contract"
import { AgentHostHttpClient } from "./agent-host-http-client"
import { memoryArtifacts } from "./agent-artifact-port.test-fixture"

test("R&D Agent Host HTTP client submits identity and treats pending result as null", async () => {
  const artifacts = memoryArtifacts()
  const instruction = artifacts.put("bounded", "text/plain")
  const context = artifacts.put("{}", "application/json")
  const request = buildAgentRunRequest({
    run_id: "http-client-run",
    idempotency_key: "http-client-key",
    trace_id: "http-client-trace",
    task_profile: "planner",
    objective: "Return one proposal.",
    source_revision: "0123456789abcdef",
    instruction_ref: instruction,
    input_refs: [context],
    output_schema_version: "trade.test-output.v1",
    capabilities: ["owner_read", "research_read"],
    budget: {
      deadline_at: "2026-07-24T00:00:00.000Z",
      max_wall_time_ms: 60_000,
      max_turns: 8,
      max_tool_calls: 12,
      max_input_bytes: instruction.bytes + context.bytes,
      max_output_bytes: 10_000,
    },
    data_classification: "project_internal",
  })
  const calls: string[] = []
  const client = new AgentHostHttpClient({
    base_url: "http://agent-host:7313",
    bearer_token: "x".repeat(64),
    fetch: async (url, init) => {
      calls.push(`${init.method ?? "GET"} ${new URL(url).pathname}`)
      if (url.endsWith("/result")) {
        return Response.json({
          error: {
            schema_version: "trade.agent-host-http-error.v1",
            code: "result_not_ready",
          },
        }, { status: 404 })
      }
      return Response.json({
        run_id: request.run_id,
        request_hash: request.request_hash,
        accepted: true,
        replayed: false,
      }, { status: 202 })
    },
  })
  assert.equal((await client.submit(request)).accepted, true)
  assert.equal(await client.result(request.run_id), null)
  assert.deepEqual(calls, [
    "POST /v1/agent-runs",
    "GET /v1/agent-runs/http-client-run/result",
  ])
})
