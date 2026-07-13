const TOP_LEVEL_DOMAINS = [
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
] as const

const LOGICAL_STORES = [
  "trade_event_store",
  "flow_read_models",
  "market_data_store",
  "ohlcv_store",
  "exchange_runtime_store",
  "artifact_catalog",
  "research_state_store",
  "governance_ledger",
  "policy_registry",
  "ops_runtime_store",
] as const

const PROTOCOL_SCHEMA_IDS = {
  jobTicket: "trade.protocol.job-ticket.v1",
  railOwnershipRegistry: "trade.protocol.rail-ownership-registry.v1",
  opsRef: "trade.protocol.ops-ref.v1",
  eventWriteEnvelope: "trade.protocol.event-write-envelope.v1",
  artifactRef: "trade.protocol.artifact-ref.v1",
  marketDataManifest: "trade.protocol.market-data-manifest.v1",
  frozenCandidateRef: "trade.protocol.frozen-candidate-ref.v1",
  researchEvidenceRef: "trade.protocol.research-evidence-ref.v1",
  actionIntentRef: "trade.protocol.action-intent-ref.v1",
  exchangeCommandRef: "trade.protocol.exchange-command-ref.v1",
  policySnapshot: "trade.protocol.policy-snapshot.v1",
  logicalStoreRef: "trade.protocol.logical-store-ref.v1",
  dataLineageRef: "trade.protocol.data-lineage-ref.v1",
  governanceRef: "trade.protocol.governance-ref.v1",
  domainInboxEnvelope: "trade.protocol.domain-inbox-envelope.v1",
  domainOutboxEnvelope: "trade.protocol.domain-outbox-envelope.v1",
} as const

const RAILS = [
  "command_rail",
  "ops_rail",
  "fact_rail",
  "policy_rail",
  "market_data_rail",
  "exchange_rail",
  "store_rail",
  "data_lineage_rail",
  "artifact_rail",
  "governance_rail",
] as const

const ALL_DOMAINS = [...TOP_LEVEL_DOMAINS]

const RAIL_OWNERSHIP_REGISTRY = [
  rail("command_rail", ["orchestration-ops"], ALL_DOMAINS, PROTOCOL_SCHEMA_IDS.jobTicket, "cycle", true),
  rail("ops_rail", ["orchestration-ops"], ALL_DOMAINS, PROTOCOL_SCHEMA_IDS.opsRef, "cycle", true),
  rail("fact_rail", ["live-execution-control", "portfolio-execution-state"], ALL_DOMAINS, PROTOCOL_SCHEMA_IDS.eventWriteEnvelope, "forever", true),
  rail("policy_rail", ["policy-risk", "governance-review-compliance"], ALL_DOMAINS, PROTOCOL_SCHEMA_IDS.policySnapshot, "forever", true),
  rail("market_data_rail", ["market-data-products"], ALL_DOMAINS, PROTOCOL_SCHEMA_IDS.marketDataManifest, "dataset", true),
  rail("exchange_rail", ["exchange-gateway", "live-execution-control"], ["live-execution-control", "portfolio-execution-state", "policy-risk", "orchestration-ops"], PROTOCOL_SCHEMA_IDS.exchangeCommandRef, "audit", true),
  rail("store_rail", ALL_DOMAINS, ALL_DOMAINS, PROTOCOL_SCHEMA_IDS.logicalStoreRef, "owner-defined", true),
  rail("data_lineage_rail", ["market-data-products", "research-strategy-development", "artifact-knowledge"], ALL_DOMAINS, PROTOCOL_SCHEMA_IDS.dataLineageRef, "dataset", true),
  rail("artifact_rail", ALL_DOMAINS, ALL_DOMAINS, PROTOCOL_SCHEMA_IDS.artifactRef, "artifact-retention", true),
  rail("governance_rail", ["governance-review-compliance", "policy-risk"], ALL_DOMAINS, PROTOCOL_SCHEMA_IDS.governanceRef, "forever", true),
] as const

type TopLevelDomain = typeof TOP_LEVEL_DOMAINS[number]
type LogicalStore = typeof LOGICAL_STORES[number]
type RailId = typeof RAILS[number]
type ProtocolSchemaId = typeof PROTOCOL_SCHEMA_IDS[keyof typeof PROTOCOL_SCHEMA_IDS]
type JSONRecord = Record<string, unknown>

interface ProtocolToolsetEntry {
  id: string
  owner_scope?: string
  module_type: string
  capability_class: string[]
  command: {
    cwd: string
    argv: string[]
  }
  writes: JSONRecord
  entry_contract: JSONRecord
  requires_preflight: boolean
  concurrency_group: string
}

interface BuildJobTicketInput {
  job_id: string
  ticket_no?: string
  stage?: string
  target_domain: TopLevelDomain | string
  handler_tool_id?: string
  tool: ProtocolToolsetEntry
  executable: boolean
  payload: JSONRecord | string
  argv: string[]
  requires?: JSONRecord[]
  input_refs?: string[]
  stop_conditions?: string[]
  handoff_summary?: string
  output_contract?: JSONRecord
}

interface BuildDomainEnvelopeInput {
  direction: "inbox" | "outbox"
  message_id: string
  source_domain?: TopLevelDomain | string
  target_domain?: TopLevelDomain | string
  rail: string
  payload_ref: string
  idempotency_key?: string
  created_at: string
}

interface BuildEventWriteEnvelopeInput {
  event: {
    event_key: string
    chain_id: string
    kind: string
    body_json?: JSONRecord
    created_at: string
  }
  source_job_id?: string
  idempotency_key?: string
  input_refs?: string[]
}

interface BuildLogicalStoreRefInput {
  store: LogicalStore
  owner_domain: TopLevelDomain | string
  owner_module: string
  ref: string
  mode: "append-only" | "upsert" | "derived" | "read-only" | "external-side-effect"
  entrypoint: string
  schema_id?: string
  path?: string
  table?: string
  idempotency_key?: string
  as_of?: string
}

interface BuildExchangeCommandRefInput {
  command_ref: string
  client_order_id: string
  action: "place_entry" | "adjust_position" | "cancel_order" | "sync_protection" | "reduce_position" | "close_position"
  status: "planned" | "submitted" | "accepted" | "rejected" | "confirmed" | "unknown"
  idempotency_key: string
  request_ref?: string
  result_ref?: string
  exchange_order_ids?: string[]
  source_intent_ref?: string
  event_write_ref?: string
}

interface BuildFrozenCandidateRefInput {
  candidate_ref: string
  strategy_id: string
  frozen_at: string
  source_evidence_refs: string[]
  assumption_refs?: string[]
  limit_refs?: string[]
  promotion_status: "draft" | "validated" | "shadow_ready" | "rejected"
  content_hash: string
}

interface BuildResearchEvidenceRefInput {
  evidence_ref: string
  evidence_kind: "experiment" | "validation" | "shadow" | "candidate" | "lesson"
  artifact_refs: string[]
  candidate_refs?: string[]
  source_refs?: string[]
  produced_at: string
  content_hash: string
}

interface BuildActionIntentRefInput {
  intent_ref: string
  intent_kind: "trade_plan" | "watchlist" | "no_action"
  status: "proposed" | "blocked" | "expired"
  symbol?: string
  side?: "long" | "short" | "flat"
  source_refs: string[]
  expires_at?: string
  no_action_reason?: string
  content_hash: string
}

interface BuildGovernanceRefInput {
  ref: string
  kind: "evidence_verdict" | "promotion_decision" | "review_batch" | "policy_feedback" | "manual_override"
  strategy_id?: string
  cycle_id?: string
  decision?: string
}

interface RailOwnershipEntry {
  id: RailId
  publishers: readonly TopLevelDomain[]
  consumers: readonly TopLevelDomain[]
  schema_id: ProtocolSchemaId
  retention: string
  replayable: boolean
}

interface ValidateRailRouteInput {
  rail: string
  source_domain?: string
  target_domain?: string
}

interface ToolsetManifest {
  tools: readonly ProtocolToolsetEntry[]
}

interface ResolveOwnerToolCommandInput {
  tool: ProtocolToolsetEntry
  repoRoot?: string
  args?: string[]
}

interface ResolvedOwnerToolCommand {
  cwd: string
  argv: string[]
  tool_id: string
  owner_scope?: string
}

function buildJobTicket(input: BuildJobTicketInput): JSONRecord {
  return removeUndefined({
    job_id: input.job_id,
    ticket_no: input.ticket_no,
    tool_id: input.tool.id,
    stage: input.stage,
    target_domain: input.target_domain,
    handler_tool_id: input.handler_tool_id,
    module_type: input.tool.module_type,
    capability_class: input.tool.capability_class,
    writes: input.tool.writes,
    concurrency_group: input.tool.concurrency_group,
    requires_preflight: input.tool.requires_preflight,
    requires: input.requires,
    input_refs: input.input_refs,
    stop_conditions: input.stop_conditions,
    handoff_summary: input.handoff_summary,
    payload: input.payload,
    entry_contract: input.tool.entry_contract,
    output_contract: input.output_contract,
    command_spec: buildCommandSpec(input.tool, input.executable, input.argv),
  })
}

function buildCommandSpec(tool: ProtocolToolsetEntry, executable: boolean, argv: string[]): JSONRecord {
  return {
    executable,
    cwd: tool.command.cwd,
    argv: normalizeToolArgv(tool, argv),
  }
}

function normalizeToolArgv(tool: ProtocolToolsetEntry, argv: string[]): string[] {
  const prefix = `${tool.command.cwd}/`
  return argv.map((part, index) => index === 1 && part.startsWith(prefix) ? part.slice(prefix.length) : part)
}

function findToolsetEntry(manifest: ToolsetManifest, toolId: string): ProtocolToolsetEntry {
  const entry = manifest.tools.find((tool) => tool.id === toolId)
  if (!entry) {
    throw new Error(`unknown owner tool: ${toolId}`)
  }
  return entry
}

function resolveOwnerToolCommand(input: ResolveOwnerToolCommandInput): ResolvedOwnerToolCommand {
  const baseArgv = input.tool.command.argv.slice(0, 2)
  if (baseArgv.length < 2) {
    throw new Error(`owner tool ${input.tool.id} command must include runtime and entrypoint`)
  }
  const cwd = input.repoRoot ? `${trimTrailingSlash(input.repoRoot)}/${input.tool.command.cwd}` : input.tool.command.cwd
  return {
    cwd,
    argv: [...baseArgv, ...(input.args ?? [])],
    tool_id: input.tool.id,
    ...(input.tool.owner_scope ? { owner_scope: input.tool.owner_scope } : {}),
  }
}

function buildDomainEnvelope(input: BuildDomainEnvelopeInput): JSONRecord {
  validateRailRoute({
    rail: input.rail,
    source_domain: input.source_domain,
    target_domain: input.target_domain,
  })
  return removeUndefined({
    schema_id: input.direction === "inbox" ? PROTOCOL_SCHEMA_IDS.domainInboxEnvelope : PROTOCOL_SCHEMA_IDS.domainOutboxEnvelope,
    message_id: input.message_id,
    source_domain: input.source_domain,
    target_domain: input.target_domain,
    rail: input.rail,
    payload_ref: input.payload_ref,
    idempotency_key: input.idempotency_key,
    created_at: input.created_at,
  })
}

function buildEventWriteEnvelope(input: BuildEventWriteEnvelopeInput): JSONRecord {
  const idempotencyKey = input.idempotency_key || `${input.event.chain_id}:${input.event.event_key}`
  return removeUndefined({
    schema_version: PROTOCOL_SCHEMA_IDS.eventWriteEnvelope,
    event_ref: `trade_event_store:plan_event/${input.event.event_key}`,
    owner_store: "trade_event_store",
    event_kind: input.event.kind,
    flow_id: input.event.chain_id,
    source_job_id: input.source_job_id,
    idempotency_key: idempotencyKey,
    body_ref: `inline:${input.event.event_key}`,
    event_inline: input.event,
    input_refs: input.input_refs,
  })
}

function buildLogicalStoreRef(input: BuildLogicalStoreRefInput): JSONRecord {
  return removeUndefined({
    store: input.store,
    owner_domain: input.owner_domain,
    owner_module: input.owner_module,
    physical_locator: removeUndefined({
      kind: input.path || input.table ? "sqlite" : undefined,
      path: input.path,
      table: input.table,
    }),
    write_contract: {
      entrypoint: input.entrypoint,
      mode: input.mode,
    },
    ref: input.ref,
    schema_id: input.schema_id,
    idempotency_key: input.idempotency_key,
    freshness: input.as_of ? { as_of: input.as_of } : undefined,
  })
}

function buildExchangeCommandRef(input: BuildExchangeCommandRefInput): JSONRecord {
  return removeUndefined({
    schema_version: PROTOCOL_SCHEMA_IDS.exchangeCommandRef,
    command_ref: input.command_ref,
    client_order_id: input.client_order_id,
    action: input.action,
    status: input.status,
    idempotency_key: input.idempotency_key,
    request_ref: input.request_ref,
    result_ref: input.result_ref,
    exchange_order_ids: input.exchange_order_ids,
    source_intent_ref: input.source_intent_ref,
    event_write_ref: input.event_write_ref,
  })
}

function buildFrozenCandidateRef(input: BuildFrozenCandidateRefInput): JSONRecord {
  return removeUndefined({
    schema_version: PROTOCOL_SCHEMA_IDS.frozenCandidateRef,
    candidate_ref: input.candidate_ref,
    strategy_id: input.strategy_id,
    frozen_at: input.frozen_at,
    source_evidence_refs: input.source_evidence_refs,
    assumption_refs: input.assumption_refs,
    limit_refs: input.limit_refs,
    promotion_status: input.promotion_status,
    content_hash: input.content_hash,
  })
}

function buildResearchEvidenceRef(input: BuildResearchEvidenceRefInput): JSONRecord {
  return removeUndefined({
    schema_version: PROTOCOL_SCHEMA_IDS.researchEvidenceRef,
    evidence_ref: input.evidence_ref,
    evidence_kind: input.evidence_kind,
    artifact_refs: input.artifact_refs,
    candidate_refs: input.candidate_refs,
    source_refs: input.source_refs,
    produced_at: input.produced_at,
    content_hash: input.content_hash,
  })
}

function buildActionIntentRef(input: BuildActionIntentRefInput): JSONRecord {
  return removeUndefined({
    schema_version: PROTOCOL_SCHEMA_IDS.actionIntentRef,
    intent_ref: input.intent_ref,
    intent_kind: input.intent_kind,
    status: input.status,
    symbol: input.symbol,
    side: input.side,
    source_refs: input.source_refs,
    expires_at: input.expires_at,
    no_action_reason: input.no_action_reason,
    content_hash: input.content_hash,
  })
}

function buildGovernanceRef(input: BuildGovernanceRefInput): JSONRecord {
  return removeUndefined({
    ref: input.ref,
    kind: input.kind,
    strategy_id: input.strategy_id,
    cycle_id: input.cycle_id,
    decision: input.decision,
  })
}

function validateRailRoute(input: ValidateRailRouteInput): RailOwnershipEntry {
  const entry = railOwnership(input.rail)
  if (input.source_domain) {
    assertDomain(input.source_domain)
    if (!entry.publishers.includes(input.source_domain as TopLevelDomain)) {
      throw new Error(`domain ${input.source_domain} cannot publish ${input.rail}`)
    }
  }
  if (input.target_domain) {
    assertDomain(input.target_domain)
    if (!entry.consumers.includes(input.target_domain as TopLevelDomain)) {
      throw new Error(`domain ${input.target_domain} cannot consume ${input.rail}`)
    }
  }
  return entry
}

function railOwnership(railId: string): RailOwnershipEntry {
  const entry = RAIL_OWNERSHIP_REGISTRY.find((railEntry) => railEntry.id === railId)
  if (!entry) {
    throw new Error(`unknown rail: ${railId}`)
  }
  return entry
}

function rail(
  id: RailId,
  publishers: readonly TopLevelDomain[],
  consumers: readonly TopLevelDomain[],
  schema_id: ProtocolSchemaId,
  retention: string,
  replayable: boolean,
): RailOwnershipEntry {
  return { id, publishers, consumers, schema_id, retention, replayable }
}

function assertDomain(domain: string): void {
  if (!TOP_LEVEL_DOMAINS.includes(domain as TopLevelDomain)) {
    throw new Error(`unknown domain: ${domain}`)
  }
}

function removeUndefined<T extends JSONRecord>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) {
      delete value[key]
    }
  }
  return value
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "")
}

export {
  PROTOCOL_SCHEMA_IDS,
  LOGICAL_STORES,
  RAILS,
  RAIL_OWNERSHIP_REGISTRY,
  TOP_LEVEL_DOMAINS,
  buildCommandSpec,
  buildActionIntentRef,
  buildDomainEnvelope,
  buildExchangeCommandRef,
  buildEventWriteEnvelope,
  buildFrozenCandidateRef,
  buildGovernanceRef,
  buildJobTicket,
  buildLogicalStoreRef,
  buildResearchEvidenceRef,
  findToolsetEntry,
  normalizeToolArgv,
  railOwnership,
  resolveOwnerToolCommand,
  validateRailRoute,
  type BuildJobTicketInput,
  type BuildDomainEnvelopeInput,
  type BuildEventWriteEnvelopeInput,
  type BuildExchangeCommandRefInput,
  type BuildActionIntentRefInput,
  type BuildFrozenCandidateRefInput,
  type BuildGovernanceRefInput,
  type BuildLogicalStoreRefInput,
  type BuildResearchEvidenceRefInput,
  type LogicalStore,
  type ProtocolSchemaId,
  type RailId,
  type RailOwnershipEntry,
  type ProtocolToolsetEntry,
  type ResolvedOwnerToolCommand,
  type ResolveOwnerToolCommandInput,
  type TopLevelDomain,
  type ToolsetManifest,
}
