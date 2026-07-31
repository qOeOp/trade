import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import assert from "node:assert/strict"
import test from "node:test"
import { startTradeMcpHttpServer } from "./http-server"

const TOKEN = "mcp-test-token-with-at-least-thirty-two-bytes"

test("private MCP HTTP requires bearer auth and projects the selected profile", async () => {
  const server = startTradeMcpHttpServer({
    hostname: "127.0.0.1",
    port: 0,
    bearer_token: TOKEN,
    profile: "planner",
    allowed_hosts: ["127.0.0.1"],
  })
  try {
    const unauthorized = await fetch(server.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    })
    assert.equal(unauthorized.status, 401)
    const client = new Client({ name: "mcp-http-test", version: "0.1.0" })
    const transport = new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
    })
    await client.connect(transport)
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name)
      assert.ok(names.includes("research_hypothesis_brief"))
      assert.equal(names.includes("research_job_submit"), false)
    } finally {
      await client.close()
    }
  } finally {
    await server.stop()
  }
})

test("private MCP HTTP rejects host confusion, oversized declarations, and weak tokens", async () => {
  assert.throws(() => startTradeMcpHttpServer({
    hostname: "127.0.0.1",
    port: 0,
    bearer_token: "weak",
    profile: "explanation",
    allowed_hosts: ["127.0.0.1"],
  }), /32 to 512/)
  const server = startTradeMcpHttpServer({
    hostname: "127.0.0.1",
    port: 0,
    bearer_token: TOKEN,
    profile: "explanation",
    allowed_hosts: ["private-mcp:7312"],
    max_body_bytes: 1_024,
  })
  try {
    const response = await fetch(server.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    })
    assert.equal(response.status, 421)
  } finally {
    await server.stop()
  }
})
