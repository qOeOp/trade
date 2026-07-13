import { readFileSync } from "node:fs"
import assert from "node:assert/strict"
import test from "node:test"
import { buildActionIntentRef, buildDomainEnvelope, buildEventWriteEnvelope, buildExchangeCommandRef, buildFrozenCandidateRef, buildGovernanceRef, buildJobTicket, buildLogicalStoreRef, buildResearchEvidenceRef, findToolsetEntry, LOGICAL_STORES, PROTOCOL_SCHEMA_IDS, RAILS, RAIL_OWNERSHIP_REGISTRY, resolveOwnerToolCommand, TOP_LEVEL_DOMAINS, validateRailRoute, type ProtocolToolsetEntry } from "./protocol-fabric"

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
    readSchema("action-intent-ref.schema.json").$id,
    readSchema("artifact-ref.schema.json").$id,
    readSchema("data-lineage-ref.schema.json").$id,
    readSchema("event-write-envelope.schema.json").$id,
    readSchema("exchange-command-ref.schema.json").$id,
    readSchema("frozen-candidate-ref.schema.json").$id,
    readSchema("governance-ref.schema.json").$id,
    readSchema("job-ticket.schema.json").$id,
    readSchema("logical-store-ref.schema.json").$id,
    readSchema("market-data-manifest.schema.json").$id,
    readSchema("ops-ref.schema.json").$id,
    readSchema("policy-snapshot.schema.json").$id,
    readSchema("rail-ownership-registry.schema.json").$id,
    readSchema("research-evidence-ref.schema.json").$id,
    readSchema("domain-inbox-envelope.schema.json").$id,
    readSchema("domain-outbox-envelope.schema.json").$id,
  ].sort()

  assert.deepEqual(actual, expected)
})

test("rail ownership registry lists v2 rails and rejects disallowed publishers", () => {
  assert.deepEqual(RAIL_OWNERSHIP_REGISTRY.map((entry) => entry.id), RAILS)
  const railSchema = readSchema("rail-ownership-registry.schema.json")
  assert.deepEqual(railSchema.items?.properties?.id?.enum, RAILS)
  assert.equal(validateRailRoute({
    rail: "command_rail",
    source_domain: "orchestration-ops",
    target_domain: "live-execution-control",
  }).schema_id, PROTOCOL_SCHEMA_IDS.jobTicket)
  assert.throws(() => validateRailRoute({
    rail: "command_rail",
    source_domain: "research-strategy-development",
    target_domain: "live-execution-control",
  }), /cannot publish command_rail/)
})

test("domain port envelopes carry inbox and outbox schema ids", () => {
  assert.deepEqual(buildDomainEnvelope({
    direction: "inbox",
    message_id: "msg-1",
    source_domain: "orchestration-ops",
    target_domain: "live-execution-control",
    rail: "command_rail",
    payload_ref: "job:J03",
    created_at: "2026-07-11T00:00:00Z",
  }), {
    schema_id: PROTOCOL_SCHEMA_IDS.domainInboxEnvelope,
    message_id: "msg-1",
    source_domain: "orchestration-ops",
    target_domain: "live-execution-control",
    rail: "command_rail",
    payload_ref: "job:J03",
    created_at: "2026-07-11T00:00:00Z",
  })
  assert.equal(buildDomainEnvelope({
    direction: "outbox",
    message_id: "msg-2",
    source_domain: "live-execution-control",
    rail: "fact_rail",
    payload_ref: "event:order_fill",
    created_at: "2026-07-11T00:00:01Z",
  }).schema_id, PROTOCOL_SCHEMA_IDS.domainOutboxEnvelope)
})

test("event write envelope wraps plan events for the fact rail", () => {
  assert.deepEqual(buildEventWriteEnvelope({
    event: {
      event_key: "observe-1",
      chain_id: "flow-1",
      kind: "observe",
      body_json: { symbol: "BTCUSDT" },
      created_at: "2026-07-11T00:00:00Z",
    },
    source_job_id: "slow_track_market_watch",
  }), {
    schema_version: PROTOCOL_SCHEMA_IDS.eventWriteEnvelope,
    event_ref: "trade_event_store:plan_event/observe-1",
    owner_store: "trade_event_store",
    event_kind: "observe",
    flow_id: "flow-1",
    source_job_id: "slow_track_market_watch",
    idempotency_key: "flow-1:observe-1",
    body_ref: "inline:observe-1",
    event_inline: {
      event_key: "observe-1",
      chain_id: "flow-1",
      kind: "observe",
      body_json: { symbol: "BTCUSDT" },
      created_at: "2026-07-11T00:00:00Z",
    },
  })
})

test("logical store ref schema lists the architecture store owners", () => {
  const schema = readSchema("logical-store-ref.schema.json")
  assert.equal(schema.$id, PROTOCOL_SCHEMA_IDS.logicalStoreRef)
  const stores = schema.properties?.store?.enum
  assert.deepEqual(stores, LOGICAL_STORES)
})

test("logical store refs describe derived flow read models", () => {
  assert.deepEqual(buildLogicalStoreRef({
    store: "flow_read_models",
    owner_domain: "portfolio-execution-state",
    owner_module: "flow-projector",
    ref: "flow_read_models:flow/flow-1",
    mode: "derived",
    entrypoint: "state.flow-projector --reduce-flow",
    path: "./data/trade.db",
    table: "plan_event",
    as_of: "2026-07-11T00:00:00Z",
  }), {
    store: "flow_read_models",
    owner_domain: "portfolio-execution-state",
    owner_module: "flow-projector",
    physical_locator: {
      kind: "sqlite",
      path: "./data/trade.db",
      table: "plan_event",
    },
    write_contract: {
      entrypoint: "state.flow-projector --reduce-flow",
      mode: "derived",
    },
    ref: "flow_read_models:flow/flow-1",
    freshness: { as_of: "2026-07-11T00:00:00Z" },
  })
})

test("exchange command refs expose command and result refs", () => {
  assert.deepEqual(buildExchangeCommandRef({
    command_ref: "exchange_runtime_store:command/exchange-command-1",
    client_order_id: "client-1",
    action: "place_entry",
    status: "submitted",
    idempotency_key: "binance_order_place:BTCUSDT:client-1",
    request_ref: "exchange_runtime_store:command/exchange-command-1:request",
    result_ref: "exchange_runtime_store:command/exchange-command-1:result",
    exchange_order_ids: ["123"],
    source_intent_ref: "job:J03",
  }), {
    schema_version: PROTOCOL_SCHEMA_IDS.exchangeCommandRef,
    command_ref: "exchange_runtime_store:command/exchange-command-1",
    client_order_id: "client-1",
    action: "place_entry",
    status: "submitted",
    idempotency_key: "binance_order_place:BTCUSDT:client-1",
    request_ref: "exchange_runtime_store:command/exchange-command-1:request",
    result_ref: "exchange_runtime_store:command/exchange-command-1:result",
    exchange_order_ids: ["123"],
    source_intent_ref: "job:J03",
  })
})

test("research refs expose frozen candidates and evidence refs", () => {
  assert.deepEqual(buildFrozenCandidateRef({
    candidate_ref: "research_state_store:frozen_candidate/trend-1",
    strategy_id: "trend-1",
    frozen_at: "2026-07-11T00:00:00Z",
    source_evidence_refs: ["artifact_catalog:artifact/replay-1"],
    assumption_refs: ["artifact_catalog:artifact/assumptions-1"],
    limit_refs: ["artifact_catalog:artifact/limits-1"],
    promotion_status: "validated",
    content_hash: "sha256:candidate",
  }), {
    schema_version: PROTOCOL_SCHEMA_IDS.frozenCandidateRef,
    candidate_ref: "research_state_store:frozen_candidate/trend-1",
    strategy_id: "trend-1",
    frozen_at: "2026-07-11T00:00:00Z",
    source_evidence_refs: ["artifact_catalog:artifact/replay-1"],
    assumption_refs: ["artifact_catalog:artifact/assumptions-1"],
    limit_refs: ["artifact_catalog:artifact/limits-1"],
    promotion_status: "validated",
    content_hash: "sha256:candidate",
  })

  assert.deepEqual(buildResearchEvidenceRef({
    evidence_ref: "artifact_catalog:artifact/research-evidence-1",
    evidence_kind: "candidate",
    artifact_refs: ["artifact_catalog:artifact/replay-1"],
    candidate_refs: ["research_state_store:frozen_candidate/trend-1"],
    source_refs: ["market_data_store:features/BTCUSDT/4h"],
    produced_at: "2026-07-11T00:00:00Z",
    content_hash: "sha256:evidence",
  }), {
    schema_version: PROTOCOL_SCHEMA_IDS.researchEvidenceRef,
    evidence_ref: "artifact_catalog:artifact/research-evidence-1",
    evidence_kind: "candidate",
    artifact_refs: ["artifact_catalog:artifact/replay-1"],
    candidate_refs: ["research_state_store:frozen_candidate/trend-1"],
    source_refs: ["market_data_store:features/BTCUSDT/4h"],
    produced_at: "2026-07-11T00:00:00Z",
    content_hash: "sha256:evidence",
  })
})

test("decision refs expose action intents for execution handoff", () => {
  assert.deepEqual(buildActionIntentRef({
    intent_ref: "artifact_catalog:artifact/action-intent-1",
    intent_kind: "trade_plan",
    status: "proposed",
    symbol: "BTCUSDT",
    side: "long",
    source_refs: ["flow_read_models:flow/flow-1", "market_data_store:features/BTCUSDT/4h"],
    expires_at: "2026-07-11T04:00:00Z",
    content_hash: "sha256:intent",
  }), {
    schema_version: PROTOCOL_SCHEMA_IDS.actionIntentRef,
    intent_ref: "artifact_catalog:artifact/action-intent-1",
    intent_kind: "trade_plan",
    status: "proposed",
    symbol: "BTCUSDT",
    side: "long",
    source_refs: ["flow_read_models:flow/flow-1", "market_data_store:features/BTCUSDT/4h"],
    expires_at: "2026-07-11T04:00:00Z",
    content_hash: "sha256:intent",
  })
})

test("governance refs expose evidence and feedback handoffs", () => {
  assert.deepEqual(buildGovernanceRef({
    ref: "governance_ledger:evidence_verdict/verdict-1",
    kind: "evidence_verdict",
    strategy_id: "trend-1",
    cycle_id: "cycle-1",
    decision: "accepted",
  }), {
    ref: "governance_ledger:evidence_verdict/verdict-1",
    kind: "evidence_verdict",
    strategy_id: "trend-1",
    cycle_id: "cycle-1",
    decision: "accepted",
  })
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

test("owner tool resolver resolves commands by manifest id", () => {
  const tool = findToolsetEntry({ tools: [toolsetEntry()] }, "trade-flow.runtime")
  assert.deepEqual(resolveOwnerToolCommand({
    tool,
    repoRoot: "/repo/",
    args: ["--db", "data/trade.db", "--track", "fast"],
  }), {
    cwd: "/repo/modules/orchestration-ops/trade-flow",
    argv: ["bun", "src/scripts/main.ts", "--db", "data/trade.db", "--track", "fast"],
    tool_id: "trade-flow.runtime",
    owner_scope: "portfolio-execution-state.runtime-event-store",
  })
})

function readSchema(name: string): {
  $id?: string
  items?: { properties?: { id?: { enum?: unknown[] } } }
  properties?: { target_domain?: { enum?: unknown[] }; store?: { enum?: unknown[] } }
} {
  return JSON.parse(readFileSync(new URL(`./schemas/${name}`, import.meta.url), "utf8")) as {
    $id?: string
    items?: { properties?: { id?: { enum?: unknown[] } } }
    properties?: { target_domain?: { enum?: unknown[] }; store?: { enum?: unknown[] } }
  }
}

function toolsetEntry(): ProtocolToolsetEntry {
  return {
    id: "trade-flow.runtime",
    owner_scope: "portfolio-execution-state.runtime-event-store",
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
