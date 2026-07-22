import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import assert from "node:assert/strict"
import { resolve } from "node:path"
import test from "node:test"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"

test("stdio server lists only the explicit MCP allowlist and marks the controlled write", async () => {
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
      "artifact_read",
      "l2_book_watch_consumer_health",
      "l2_retention_reference_audit",
      "l2_retention_reference_audit_page",
      "l2_service_health",
      "ops_cycle_summary",
      "rd_program_read",
      "research_hypothesis_brief",
      "research_hypothesis_prepare",
      "research_job_result",
      "research_job_status",
      "research_job_submit",
      "trade_tool_read",
      "trade_tool_search",
    ])
    const submit = listed.tools.find((tool) => tool.name === "research_job_submit")
    const l2Audit = listed.tools.find((tool) => tool.name === "l2_retention_reference_audit")
    const l2AuditPage = listed.tools.find((tool) => tool.name === "l2_retention_reference_audit_page")
    const l2Health = listed.tools.find((tool) => tool.name === "l2_service_health")
    const l2ConsumerHealth = listed.tools.find((tool) => tool.name === "l2_book_watch_consumer_health")
    assert.equal(submit?.annotations?.readOnlyHint, false)
    assert.equal(submit?.annotations?.destructiveHint, false)
    assert.equal(submit?.annotations?.idempotentHint, true)
    assert.equal(l2Audit?.annotations?.readOnlyHint, true)
    assert.equal(l2Audit?.annotations?.destructiveHint, false)
    assert.deepEqual(l2Audit?.inputSchema.required, ["epoch_id"])
    assert.equal(l2Audit?.inputSchema.additionalProperties, false)
    assert.equal(l2AuditPage?.annotations?.readOnlyHint, true)
    assert.equal(l2AuditPage?.annotations?.destructiveHint, false)
    assert.equal(l2AuditPage?.inputSchema.additionalProperties, false)
    assert.equal(l2Health?.annotations?.readOnlyHint, true)
    assert.equal(l2Health?.annotations?.destructiveHint, false)
    assert.equal(l2Health?.inputSchema.additionalProperties, false)
    assert.equal(l2ConsumerHealth?.annotations?.readOnlyHint, true)
    assert.equal(l2ConsumerHealth?.annotations?.destructiveHint, false)
    assert.equal(l2ConsumerHealth?.inputSchema.additionalProperties, false)
    assert.ok(listed.tools.filter((tool) => tool !== submit).every((tool) => tool.annotations?.readOnlyHint === true))

    const called = await client.callTool({ name: "trade_tool_search", arguments: { query: "artifact", limit: 3 } })
    assert.equal(called.isError, undefined)
    assert.equal((called.structuredContent as Record<string, unknown>).schema_version, "trade.agent-mcp.tool-search-result.v1")
    const consumerHealth = await client.callTool({ name: "l2_book_watch_consumer_health", arguments: {} })
    assert.equal(consumerHealth.isError, undefined)
    const consumerPayload = consumerHealth.structuredContent as Record<string, unknown>
    assert.equal(consumerPayload.action, "read_active_l2_book_watch_consumer")
    const consumer = consumerPayload.consumer as Record<string, unknown>
    assert.equal(consumer.schema_version, "trade.ops-l2-watch-consumer-owner-read.v1")
    const serializedConsumer = JSON.stringify(consumer)
    assert.equal(serializedConsumer.includes("pid"), false)
    assert.equal(serializedConsumer.includes("path"), false)
  } finally {
    await client.close()
  }
})
