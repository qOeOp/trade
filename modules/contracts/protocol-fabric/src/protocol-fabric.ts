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
  "exchange_runtime_store",
  "artifact_catalog",
  "research_state_store",
  "governance_ledger",
  "policy_registry",
  "ops_runtime_store",
] as const

const PROTOCOL_SCHEMA_IDS = {
  jobTicket: "trade.protocol.job-ticket.v1",
  eventWriteEnvelope: "trade.protocol.event-write-envelope.v1",
  artifactRef: "trade.protocol.artifact-ref.v1",
  marketDataManifest: "trade.protocol.market-data-manifest.v1",
  exchangeCommandRef: "trade.protocol.exchange-command-ref.v1",
  policySnapshot: "trade.protocol.policy-snapshot.v1",
  logicalStoreRef: "trade.protocol.logical-store-ref.v1",
} as const

type TopLevelDomain = typeof TOP_LEVEL_DOMAINS[number]
type LogicalStore = typeof LOGICAL_STORES[number]
type ProtocolSchemaId = typeof PROTOCOL_SCHEMA_IDS[keyof typeof PROTOCOL_SCHEMA_IDS]
type JSONRecord = Record<string, unknown>

interface ProtocolToolsetEntry {
  id: string
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

function removeUndefined<T extends JSONRecord>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) {
      delete value[key]
    }
  }
  return value
}

export {
  PROTOCOL_SCHEMA_IDS,
  LOGICAL_STORES,
  TOP_LEVEL_DOMAINS,
  buildCommandSpec,
  buildJobTicket,
  normalizeToolArgv,
  type BuildJobTicketInput,
  type LogicalStore,
  type ProtocolSchemaId,
  type ProtocolToolsetEntry,
  type TopLevelDomain,
}
