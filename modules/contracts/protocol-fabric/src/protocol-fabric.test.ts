import { readFileSync } from "node:fs"
import assert from "node:assert/strict"
import test from "node:test"
import { buildJobTicket, LOGICAL_STORES, PROTOCOL_SCHEMA_IDS, TOP_LEVEL_DOMAINS, type ProtocolToolsetEntry } from "./protocol-fabric"

test("top-level domains match the architecture boundary set", () => {
  assert.deepEqual(TOP_LEVEL_DOMAINS, [
    "orchestration-ops",
    "policy-risk",
    "portfolio-execution-state",
    "market-data-products",
    "exchange-gateway",
    "live-decision-planning",
    "live-execution-control",
    "research-strategy-development",
    "governance-review-compliance",
    "artifact-knowledge",
  ])
})

test("job ticket schema uses the protocol-fabric id and current domains", () => {
  const schema = readSchema("job-ticket.schema.json")
  assert.equal(schema.$id, PROTOCOL_SCHEMA_IDS.jobTicket)
  const domains = schema.properties?.target_domain?.enum
  assert.deepEqual(domains, TOP_LEVEL_DOMAINS)
})

test("schema registry exposes all rail envelope ids", () => {
  const expected = Object.values(PROTOCOL_SCHEMA_IDS).sort()
  const actual = [
    readSchema("artifact-ref.schema.json").$id,
    readSchema("event-write-envelope.schema.json").$id,
    readSchema("exchange-command-ref.schema.json").$id,
    readSchema("job-ticket.schema.json").$id,
    readSchema("logical-store-ref.schema.json").$id,
    readSchema("market-data-manifest.schema.json").$id,
    readSchema("policy-snapshot.schema.json").$id,
  ].sort()

  assert.deepEqual(actual, expected)
})

test("logical store ref schema lists the architecture store owners", () => {
  const schema = readSchema("logical-store-ref.schema.json")
  assert.equal(schema.$id, PROTOCOL_SCHEMA_IDS.logicalStoreRef)
  const stores = schema.properties?.store?.enum
  assert.deepEqual(stores, LOGICAL_STORES)
})

test("job ticket resolver carries the shared executable command protocol", () => {
  const ticket = buildJobTicket({
    job_id: "fast_track_guard",
    ticket_no: "J03",
    stage: "serial_trade_db_guard",
    target_domain: "live-execution-control",
    tool: toolsetEntry(),
    executable: false,
    payload: { db: "data/trade.db" },
    argv: ["bun", "modules/orchestration-ops/trade-flow/src/scripts/main.ts", "--track", "fast"],
  })

  assert.deepEqual(ticket, {
    job_id: "fast_track_guard",
    ticket_no: "J03",
    tool_id: "trade-flow.runtime",
    stage: "serial_trade_db_guard",
    target_domain: "live-execution-control",
    module_type: "suite",
    capability_class: ["R", "V"],
    writes: {
      trade_db: true,
      catalog: false,
      artifacts: false,
      binance: false,
      config: false,
    },
    concurrency_group: "trade-db",
    requires_preflight: false,
    payload: { db: "data/trade.db" },
    entry_contract: { kind: "cli-json", input_schema: "", output_schema: "" },
    command_spec: {
      executable: false,
      cwd: "modules/orchestration-ops/trade-flow",
      argv: ["bun", "src/scripts/main.ts", "--track", "fast"],
    },
  })
})

function readSchema(name: string): { $id?: string; properties?: { target_domain?: { enum?: unknown[] }; store?: { enum?: unknown[] } } } {
  return JSON.parse(readFileSync(new URL(`./schemas/${name}`, import.meta.url), "utf8")) as { $id?: string; properties?: { target_domain?: { enum?: unknown[] }; store?: { enum?: unknown[] } } }
}

function toolsetEntry(): ProtocolToolsetEntry {
  return {
    id: "trade-flow.runtime",
    module_type: "suite",
    capability_class: ["R", "V"],
    command: {
      cwd: "modules/orchestration-ops/trade-flow",
      argv: ["bun", "src/scripts/main.ts", "--db", "./data/trade.db", "<runtime-flag>"],
    },
    writes: {
      trade_db: true,
      catalog: false,
      artifacts: false,
      binance: false,
      config: false,
    },
    entry_contract: { kind: "cli-json", input_schema: "", output_schema: "" },
    requires_preflight: false,
    concurrency_group: "trade-db",
  }
}
