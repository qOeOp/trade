import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import assert from "node:assert/strict"
import { resolve } from "node:path"
import test from "node:test"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"

test("stdio server lists only the explicit read-only MCP allowlist", async () => {
  const client = new Client({ name: "trade-agent-mcp-test", version: "0.1.0" })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(import.meta.dir, "main.ts")],
    cwd: repoRoot(),
    stderr: "pipe",
  })
  try {
    await client.connect(transport)
    const listed = await client.listTools()
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
      "artifact_catalog_query",
      "ops_cycle_summary",
      "rd_program_read",
      "trade_tool_read",
      "trade_tool_search",
    ])
    assert.ok(listed.tools.every((tool) => tool.annotations?.readOnlyHint === true))

    const called = await client.callTool({ name: "trade_tool_search", arguments: { query: "artifact", limit: 3 } })
    assert.equal(called.isError, undefined)
    assert.equal((called.structuredContent as Record<string, unknown>).schema_version, "trade.agent-mcp.tool-search-result.v1")
  } finally {
    await client.close()
  }
})
