import assert from "node:assert/strict"
import test from "node:test"
import type {
  AgentRunEvent,
  AgentRunRequest,
  AgentRunResult,
} from "../../../../contracts/agent-run-contract/src/agent-run-contract"
import type {
  AgentHostPort,
  AgentRunApproval,
  AgentRunSteer,
} from "../../../../contracts/agent-run-contract/src/agent-host-port"
import { startAgentHostHttpServer } from "./agent-host-http-server"

test("private Agent Host HTTP surface authenticates and routes lifecycle reads", async () => {
  const host = new FixtureHost()
  const token = "agent-host-".padEnd(64, "x")
  const server = startAgentHostHttpServer({
    hostname: "127.0.0.1",
    port: 0,
    bearer_token: token,
    allowed_hosts: ["127.0.0.1"],
    host,
  })
  try {
    const health = await fetch(`${server.url}/health`)
    assert.equal(health.status, 200)
    const denied = await fetch(`${server.url}/v1/agent-runs/run-1/status`, {
      headers: { host: "127.0.0.1" },
    })
    assert.equal(denied.status, 401)
    const headers = {
      authorization: `Bearer ${token}`,
      host: "127.0.0.1",
      "content-type": "application/json",
    }
    const accepted = await fetch(`${server.url}/v1/agent-runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ run_id: "run-1" }),
    })
    assert.equal(accepted.status, 202)
    assert.equal(host.submitted, true)
    const status = await fetch(`${server.url}/v1/agent-runs/run-1/status`, {
      headers,
    })
    assert.deepEqual(await status.json(), {
      run_id: "run-1",
      request_hash: "a".repeat(64),
      status: "running",
      last_sequence: 2,
      terminal: false,
    })
    const cancelled = await fetch(`${server.url}/v1/agent-runs/run-1/cancel`, {
      method: "POST",
      headers,
      body: JSON.stringify({ request_hash: "a".repeat(64) }),
    })
    assert.equal(cancelled.status, 202)
    assert.equal(host.cancelled, true)
  } finally {
    await server.stop()
  }
})

class FixtureHost implements AgentHostPort {
  submitted = false
  cancelled = false

  async submit(_request: AgentRunRequest) {
    this.submitted = true
    return {
      run_id: "run-1",
      request_hash: "a".repeat(64),
      accepted: true,
      replayed: false,
    }
  }

  async events(_runId: string, _afterSequence: number, _limit: number): Promise<AgentRunEvent[]> {
    return []
  }

  async status(_runId: string) {
    return {
      run_id: "run-1",
      request_hash: "a".repeat(64),
      status: "running" as const,
      last_sequence: 2,
      terminal: false,
    }
  }

  async steer(_input: AgentRunSteer): Promise<void> {
    throw new Error("unsupported")
  }

  async approve(_input: AgentRunApproval): Promise<void> {
    throw new Error("unsupported")
  }

  async cancel(_runId: string, _requestHash: string): Promise<void> {
    this.cancelled = true
  }

  async result(_runId: string): Promise<AgentRunResult | null> {
    return null
  }
}
