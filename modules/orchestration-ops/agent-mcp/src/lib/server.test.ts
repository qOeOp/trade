import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import assert from "node:assert/strict"
import test from "node:test"
import { createTradeMcpServer, type TradeMcpProfile } from "./server"

test("MCP task profiles project a closed capability subset", async () => {
  const expected: Record<Exclude<TradeMcpProfile, "interactive">, string[]> = {
    planner: [
      "research_hypothesis_brief",
      "research_hypothesis_prepare",
      "research_planner_proposal_prepare",
    ],
    "planner-proposal": ["research_planner_proposal_prepare"],
    developer: [
      "research_developer_submission_prepare",
      "research_hypothesis_prepare",
      "research_job_result",
      "research_job_status",
      "research_job_submit",
    ],
    "developer-contract": ["research_developer_submission_prepare"],
    reviewer: ["research_job_result", "research_job_status"],
    "reviewer-decision": ["research_reviewer_submission_prepare"],
    explanation: [],
  }
  for (const [profile, additions] of Object.entries(expected)) {
    const server = createTradeMcpServer(undefined, undefined, profile as TradeMcpProfile)
    const client = new Client({ name: `profile-test-${profile}`, version: "0.1.0" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    try {
      const tools = (await client.listTools()).tools.map((tool) => tool.name)
      assert.equal(
        tools.includes("artifact_read"),
        profile !== "planner-proposal"
          && profile !== "developer-contract"
          && profile !== "reviewer-decision",
      )
      assert.equal(tools.includes("research_job_submit"), profile === "developer")
      assert.deepEqual(
        tools.filter((tool) => tool.startsWith("research_")).sort(),
        additions.sort(),
      )
    } finally {
      await client.close()
      await server.close()
    }
  }
})
