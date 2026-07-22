import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { ReadToolService } from "./read-tools"
import type { OwnerCliCommand } from "./owner-cli"

function fixtureToolset(root: string): void {
  writeFileSync(join(root, "toolset.json"), JSON.stringify({
    schema_version: "trade-toolset.manifest.v1",
    tools: [
      {
        id: "artifact-catalog",
        domain: "artifact-knowledge",
        intent: ["catalog", "query"],
        capability_class: ["A", "V"],
        purpose: "Query indexed artifacts and evidence.",
        writes: { trade_db: false, catalog: true, artifacts: true, binance: false, config: false },
      },
      {
        id: "binance.order-place",
        domain: "exchange-gateway",
        intent: ["order"],
        capability_class: ["T"],
        purpose: "Place an exchange order.",
        writes: { trade_db: false, catalog: false, artifacts: false, binance: true, config: false },
      },
    ],
  }))
}

test("tool search is compact, ranked, and never claims execution authority", () => {
  const root = mkdtempSync(join(tmpdir(), "trade-agent-mcp-"))
  try {
    fixtureToolset(root)
    const service = new ReadToolService({ root })
    const result = service.searchTools({ query: "artifact", limit: 10 })
    const tools = result.tools as Array<Record<string, unknown>>
    assert.equal(tools.length, 1)
    assert.equal(tools[0].tool_id, "artifact-catalog")
    assert.equal(tools[0].mutates_registered_surfaces, true)
    assert.match(String(result.execution_note), /does not authorize/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("tool read describes dangerous capabilities without executing them", () => {
  const root = mkdtempSync(join(tmpdir(), "trade-agent-mcp-"))
  try {
    fixtureToolset(root)
    const service = new ReadToolService({ root })
    const result = service.readTool("binance.order-place")
    assert.equal(result.mcp_execution_available, false)
    assert.equal((result.tool as Record<string, unknown>).id, "binance.order-place")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("owner adapters use fixed scripts and only pass typed payloads", async () => {
  const root = mkdtempSync(join(tmpdir(), "trade-agent-mcp-"))
  const commands: OwnerCliCommand[] = []
  try {
    fixtureToolset(root)
    const service = new ReadToolService({
      root,
      catalogDbPath: "tmp/mcp/catalog.db",
      marketDataDbPath: "tmp/mcp/market-data.db",
      rdStateDbPath: "tmp/mcp/rd.db",
      opsRuntimeDbPath: "tmp/mcp/ops.db",
      execute: async (command) => {
        commands.push(command)
        return { ok: true }
      },
    })
    await service.queryArtifactCatalog({ symbol: "BTCUSDT", limit: 5 })
    await service.readArtifact("artifact_demo", 4096)
    await service.auditL2RetentionReference("binance-usdm:BTCUSDT:epoch-1")
    await service.listL2RetentionReferenceAudits({
      after_epoch_id: "binance-usdm:BTCUSDT:epoch-1",
      limit: 10,
    })
    await service.readL2ServiceHealth()
    await service.readL2BookWatchConsumerHealth()
    await service.readRdProgram("rd-program")
    await service.readOpsCycleSummary("cycle-1")
    await service.readRuntimeParityStatus()
    assert.equal(commands.length, 9)
    assert.equal(commands[0].script, "modules/artifact-knowledge/artifact-catalog/src/scripts/main.ts")
    assert.deepEqual(JSON.parse(commands[0].args.at(-1) ?? "{}"), { symbol: "BTCUSDT", limit: 5 })
    assert.deepEqual(JSON.parse(commands[1].args.at(-1) ?? "{}"), { artifact_id: "artifact_demo", max_bytes: 4096 })
    assert.equal(commands[2].script, "modules/market-data-products/market-data-store/src/scripts/main.ts")
    assert.deepEqual(commands[2].args.slice(0, 4), [
      "--db", "tmp/mcp/market-data.db", "--action", "audit_l2_retention_reference_closure",
    ])
    assert.deepEqual(JSON.parse(commands[2].args.at(-1) ?? "{}"), {
      epoch_id: "binance-usdm:BTCUSDT:epoch-1",
    })
    assert.equal(commands[3].script, "modules/market-data-products/market-data-store/src/scripts/main.ts")
    assert.deepEqual(commands[3].args.slice(0, 4), [
      "--db", "tmp/mcp/market-data.db", "--action", "list_l2_retention_reference_audits",
    ])
    assert.deepEqual(JSON.parse(commands[3].args.at(-1) ?? "{}"), {
      after_epoch_id: "binance-usdm:BTCUSDT:epoch-1",
      limit: 10,
    })
    assert.deepEqual(commands[4], {
      script: "modules/market-data-products/l2-order-book-service/src/scripts/owner-health.ts",
      args: [],
    })
    assert.deepEqual(commands[5], {
      script: "modules/orchestration-ops/l2-current-book-probe/src/scripts/consumer-read.ts",
      args: [],
    })
    assert.equal(commands[6].args.at(-1), "{\"action\":\"read\"}")
    assert.deepEqual(JSON.parse(commands[7].args.at(-1) ?? "{}"), { cycle_id: "cycle-1" })
    assert.deepEqual(commands[8], {
      script: "modules/orchestration-ops/ops-runtime-store/src/scripts/main.ts",
      args: ["--db", "tmp/mcp/ops.db", "--action", "parity_status"],
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
