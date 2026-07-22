import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import assert from "node:assert/strict"
import { mkdirSync, rmSync } from "node:fs"
import { relative, resolve } from "node:path"
import test from "node:test"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"

test("stdio server lists only the explicit MCP allowlist and marks the controlled write", async () => {
  const root = repoRoot()
  const runtimeDirectory = resolve(root, "tmp", `agent-mcp-main-test-${process.pid}-${Date.now()}`)
  const opsDbPath = resolve(runtimeDirectory, "ops.db")
  const opsDbRef = relative(root, opsDbPath).replaceAll("\\", "/")
  mkdirSync(runtimeDirectory, { recursive: true })
  const initialized = Bun.spawnSync({
    cmd: [
      process.execPath,
      resolve(root, "modules/orchestration-ops/ops-runtime-store/src/scripts/main.ts"),
      "--db",
      opsDbRef,
      "--action",
      "init",
    ],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (initialized.exitCode !== 0) {
    const detail = initialized.stderr.toString()
    rmSync(runtimeDirectory, { recursive: true, force: true })
    assert.fail(detail || `ops runtime store init exited ${initialized.exitCode}`)
  }
  const client = new Client({ name: "trade-agent-mcp-test", version: "0.1.0" })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(import.meta.dir, "main.ts")],
    cwd: root,
    env: {
      ...getDefaultEnvironment(),
      TRADE_MCP_OPS_DB: opsDbRef,
    },
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
      "runtime_parity_status",
      "trade_tool_read",
      "trade_tool_search",
    ])
    const submit = listed.tools.find((tool) => tool.name === "research_job_submit")
    const l2Audit = listed.tools.find((tool) => tool.name === "l2_retention_reference_audit")
    const l2AuditPage = listed.tools.find((tool) => tool.name === "l2_retention_reference_audit_page")
    const l2Health = listed.tools.find((tool) => tool.name === "l2_service_health")
    const l2ConsumerHealth = listed.tools.find((tool) => tool.name === "l2_book_watch_consumer_health")
    const runtimeParityStatus = listed.tools.find((tool) => tool.name === "runtime_parity_status")
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
    assert.equal(runtimeParityStatus?.annotations?.readOnlyHint, true)
    assert.equal(runtimeParityStatus?.annotations?.destructiveHint, false)
    assert.equal(runtimeParityStatus?.inputSchema.additionalProperties, false)
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
    const parityStatus = await client.callTool({ name: "runtime_parity_status", arguments: {} })
    assert.equal(parityStatus.isError, undefined)
    const parityPayload = parityStatus.structuredContent as Record<string, unknown>
    const parity = parityPayload.parity_status as Record<string, unknown>
    assert.equal(parity.schema_version, "trade.ops-runtime-parity-status.v1")
    assert.equal(JSON.stringify(parity).includes("holder_id"), false)
    assert.equal(JSON.stringify(parity).includes("detail_json"), false)
  } finally {
    await client.close()
    rmSync(runtimeDirectory, { recursive: true, force: true })
  }
})
