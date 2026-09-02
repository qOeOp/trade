const OWNER_URL = "http://rd-owner-api:8080"
const MAX_OWNER_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_REQUEST_BYTES = 2 * 1024 * 1024

type Action = "RUN" | "RESOLVE"
type Json = Record<string, unknown>

export type DevelopComposerRunRequestV2 = {
  request_identity: string
  research_custody_reference: string
  design: Json
  binding_requests: Json[]
  plugin_source_capsules: Json[]
}

export type DevelopComposerOperationResponseV2 = {
  schema_version: 2
  request_identity: string
  disposition: "SUCCESS" | "CONFLICT" | "UNSUPPORTED" | "NEEDS_RESEARCH_REFINEMENT"
    | "UNAVAILABLE" | "SUBMITTED_OR_UNKNOWN"
  receipt_identity: number[] | null
  artifact: Json | null
  coordinate: string | null
  reason: string | null
}

function object(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function exactKeys(value: Json, expected: string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function exactKeysWithOptional(value: Json, required: string[], optional: string[]): boolean {
  const actual = Object.keys(value)
  const admitted = new Set([...required, ...optional])
  return required.every((key) => Object.hasOwn(value, key))
    && actual.every((key) => admitted.has(key))
}

function identity(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
    && new TextEncoder().encode(value).length <= 256
}

function locator(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function byteArray(value: unknown, exactLength?: number): value is number[] {
  return Array.isArray(value) && (exactLength === undefined || value.length === exactLength)
    && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
}

function oneOf(value: unknown, values: readonly string[]): value is string {
  return typeof value === "string" && values.includes(value)
}

function unsigned(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum
}

function signed(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
}

const VALUE_TYPES = [
  "I32", "I64", "U64", "I128", "BYTES", "DIGEST32", "STABLE_IDENTITY16",
  "POSITION_INTENT_V1", "TARGET_VARIANT_V1", "PROTECTION_VARIANT_V1",
] as const
const FACT_CLASSES = [
  "RESEARCH", "MARKET_DATA", "EXECUTION_RUNTIME", "BACKTEST_SIM_EXCHANGE", "PORTFOLIO", "RISK",
] as const
const LIFECYCLE_KINDS = ["START", "BAR", "EVENT", "FILL", "TIMER", "STOP"] as const
const LIFECYCLE_CONTEXTS = [
  "INTENT_IDENTITY", "ENVELOPE_DIGEST", "CURRENT_POSITION_UNITS", "REBALANCE_SEQUENCE",
  "STRATEGY_STATE_DIGEST", "PLUGIN_STATE_DIGEST",
] as const
const FIELD_SEMANTICS = [
  "BAR_OPEN_PRICE", "BAR_HIGH_PRICE", "BAR_LOW_PRICE", "BAR_CLOSE_PRICE", "BAR_VOLUME_QUANTITY",
  "QUOTE_BID_PRICE", "QUOTE_ASK_PRICE", "QUOTE_BID_SIZE", "QUOTE_ASK_SIZE", "TRADE_LAST_PRICE",
  "TRADE_LAST_SIZE", "SCALAR_VALUE",
] as const

function validTypedConstant(value: unknown): value is Json {
  if (!object(value) || typeof value.kind !== "string") return false
  switch (value.kind) {
    case "I32":
      return exactKeys(value, ["kind", "value"]) && signed(value.value, -2_147_483_648, 2_147_483_647)
    case "I64":
    case "I128":
      return exactKeys(value, ["kind", "value"])
        && signed(value.value, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
    case "U64":
      return exactKeys(value, ["kind", "value"]) && unsigned(value.value, Number.MAX_SAFE_INTEGER)
    case "BYTES":
      return exactKeys(value, ["kind", "value"]) && byteArray(value.value)
    case "DIGEST32":
      return exactKeys(value, ["kind", "value"]) && byteArray(value.value, 32)
    case "STABLE_IDENTITY16":
      return exactKeys(value, ["kind", "value"]) && byteArray(value.value, 16)
    case "POSITION_INTENT_V1":
    case "TARGET_VARIANT_V1":
    case "PROTECTION_VARIANT_V1":
      return exactKeys(value, ["kind", "semantic_id"]) && typeof value.semantic_id === "string"
    default:
      return false
  }
}

function validInputScope(value: unknown): value is Json {
  return object(value) && exactKeys(value, ["kind"])
    && oneOf(value.kind, ["EXACT_INSTRUMENT", "UNIVERSE_MEMBERS"])
}

function validInputRole(value: unknown): value is Json {
  return object(value) && exactKeysWithOptional(value, [
    "semantic_id", "fact_class", "field_semantic_id", "channel", "timeframe", "unit", "scale",
    "value_type",
  ], ["instrument", "scope"])
    && [value.semantic_id, value.field_semantic_id, value.channel, value.timeframe, value.unit]
      .every((field) => typeof field === "string")
    && (value.instrument === undefined || typeof value.instrument === "string")
    && (value.scope === undefined || validInputScope(value.scope))
    && oneOf(value.fact_class, FACT_CLASSES) && unsigned(value.scale, 255)
    && oneOf(value.value_type, VALUE_TYPES)
}

function validInputJoin(value: unknown): value is Json {
  return object(value) && exactKeys(value, [
    "semantic_id", "inputs", "alignment_semantic_id", "trigger_input_id", "max_staleness_ns",
  ]) && [value.semantic_id, value.alignment_semantic_id, value.trigger_input_id]
    .every((field) => typeof field === "string")
    && Array.isArray(value.inputs) && value.inputs.every((input) => typeof input === "string")
    && unsigned(value.max_staleness_ns, Number.MAX_SAFE_INTEGER)
}

function validParameter(value: unknown): value is Json {
  return object(value) && exactKeys(value, ["semantic_id", "value_type", "value", "unit"])
    && typeof value.semantic_id === "string" && oneOf(value.value_type, VALUE_TYPES)
    && validTypedConstant(value.value) && typeof value.unit === "string"
}

function validStateCell(value: unknown): value is Json {
  return object(value) && exactKeys(value, ["semantic_id", "value_type", "initial", "max_bytes"])
    && typeof value.semantic_id === "string" && oneOf(value.value_type, VALUE_TYPES)
    && validTypedConstant(value.initial) && unsigned(value.max_bytes, 4_294_967_295)
}

function validPortContract(value: unknown): value is Json {
  return object(value) && exactKeys(value, ["semantic_id", "value_type", "max_bytes"])
    && typeof value.semantic_id === "string" && oneOf(value.value_type, VALUE_TYPES)
    && unsigned(value.max_bytes, 4_294_967_295)
}

function validPluginState(value: unknown): value is Json {
  return object(value) && exactKeys(value, ["pre_port_id", "post_port_id", "value_type", "max_bytes"])
    && typeof value.pre_port_id === "string" && typeof value.post_port_id === "string"
    && oneOf(value.value_type, VALUE_TYPES) && unsigned(value.max_bytes, 4_294_967_295)
}

function validPluginManifest(value: unknown): value is Json {
  return object(value) && exactKeys(value, [
    "semantic_id", "abi_version", "input_ports", "output_ports", "state", "capability_ids", "max_fuel",
    "max_linear_memory_bytes", "max_invocations_per_event", "failure_semantic_id",
  ]) && typeof value.semantic_id === "string" && unsigned(value.abi_version, 65_535)
    && Array.isArray(value.input_ports) && value.input_ports.every(validPortContract)
    && Array.isArray(value.output_ports) && value.output_ports.every(validPortContract)
    && validPluginState(value.state) && Array.isArray(value.capability_ids)
    && value.capability_ids.every((capability) => typeof capability === "string")
    && unsigned(value.max_fuel, Number.MAX_SAFE_INTEGER)
    && unsigned(value.max_linear_memory_bytes, 4_294_967_295)
    && unsigned(value.max_invocations_per_event, 65_535) && typeof value.failure_semantic_id === "string"
}

function validValueRef(value: unknown): value is Json {
  if (!object(value) || typeof value.kind !== "string") return false
  switch (value.kind) {
    case "INPUT":
      return exactKeys(value, ["kind", "input_id"]) && typeof value.input_id === "string"
    case "UNIVERSE_MEMBER_INPUT":
      return exactKeys(value, ["kind", "input_id", "member_ordinal"])
        && typeof value.input_id === "string" && unsigned(value.member_ordinal, 255)
    case "PARAMETER":
      return exactKeys(value, ["kind", "parameter_id"]) && typeof value.parameter_id === "string"
    case "PRIOR_STATE":
      return exactKeys(value, ["kind", "state_id"]) && typeof value.state_id === "string"
    case "LIFECYCLE_CONTEXT":
      return exactKeys(value, ["kind", "field"]) && oneOf(value.field, LIFECYCLE_CONTEXTS)
    case "NODE_OUTPUT":
      return exactKeys(value, ["kind", "node_id", "port_id"])
        && typeof value.node_id === "string" && typeof value.port_id === "string"
    default:
      return false
  }
}

function validPortBinding(value: unknown): value is Json {
  return object(value) && exactKeys(value, ["port_id", "source"])
    && typeof value.port_id === "string" && validValueRef(value.source)
}

function validComputeNode(value: unknown): value is Json {
  return object(value) && exactKeys(value, [
    "semantic_id", "plugin_semantic_id", "input_bindings", "pre_state", "output_port_ids",
    "post_state_port_id",
  ]) && typeof value.semantic_id === "string" && typeof value.plugin_semantic_id === "string"
    && Array.isArray(value.input_bindings) && value.input_bindings.every(validPortBinding)
    && validValueRef(value.pre_state) && Array.isArray(value.output_port_ids)
    && value.output_port_ids.every((port) => typeof port === "string")
    && typeof value.post_state_port_id === "string"
}

function validStateWrite(value: unknown): value is Json {
  return object(value) && exactKeys(value, ["state_id", "source"])
    && typeof value.state_id === "string" && validValueRef(value.source)
}

const PROPOSAL_FIELDS = [
  "position_intent", "target_variant", "target_position_units", "target_weight_micros",
  "rebalance_sequence", "reconciliation_target_units", "protection_variant", "stop_loss_ticks",
  "take_profit_ticks", "trailing_distance_ticks", "trailing_stop_ticks",
] as const

function validProposal(value: unknown): value is Json {
  return object(value) && exactKeysWithOptional(value, [...PROPOSAL_FIELDS], ["member_target_set"])
    && PROPOSAL_FIELDS.every((field) => validValueRef(value[field]))
    && (value.member_target_set === undefined || value.member_target_set === null
      || validValueRef(value.member_target_set))
}

function validReaction(value: unknown): value is Json {
  return object(value) && exactKeysWithOptional(value, ["kind", "nodes", "state_writes"], ["proposal"])
    && oneOf(value.kind, LIFECYCLE_KINDS) && Array.isArray(value.nodes)
    && value.nodes.every(validComputeNode) && Array.isArray(value.state_writes)
    && value.state_writes.every(validStateWrite)
    && (value.proposal === undefined || value.proposal === null || validProposal(value.proposal))
}

function validCapability(value: unknown): value is Json {
  return object(value) && exactKeys(value, ["semantic_id", "version", "dependencies"])
    && typeof value.semantic_id === "string" && unsigned(value.version, 65_535)
    && Array.isArray(value.dependencies) && value.dependencies.every((dependency) => typeof dependency === "string")
}

function validResources(value: unknown): value is Json {
  return object(value) && exactKeys(value, [
    "max_inputs", "max_nodes_per_reaction", "max_dependency_edges", "max_state_bytes",
    "max_plugin_calls_per_event",
  ]) && unsigned(value.max_inputs, 65_535) && unsigned(value.max_nodes_per_reaction, 65_535)
    && unsigned(value.max_dependency_edges, 65_535) && unsigned(value.max_state_bytes, 4_294_967_295)
    && unsigned(value.max_plugin_calls_per_event, 65_535)
}

function validDesign(value: unknown): value is Json {
  return object(value) && exactKeys(value, [
    "schema_version", "research_request_identity", "intent_identity", "intent_digest", "inputs",
    "joins", "parameters", "state", "reactions", "capabilities", "plugins", "resources", "falsifier",
  ]) && unsigned(value.schema_version, 65_535) && byteArray(value.research_request_identity, 32)
    && byteArray(value.intent_identity, 32) && byteArray(value.intent_digest, 32)
    && Array.isArray(value.inputs) && value.inputs.every(validInputRole)
    && Array.isArray(value.joins) && value.joins.every(validInputJoin)
    && Array.isArray(value.parameters) && value.parameters.every(validParameter)
    && Array.isArray(value.state) && value.state.every(validStateCell)
    && Array.isArray(value.reactions) && value.reactions.every(validReaction)
    && Array.isArray(value.capabilities) && value.capabilities.every(validCapability)
    && Array.isArray(value.plugins) && value.plugins.every(validPluginManifest)
    && validResources(value.resources) && typeof value.falsifier === "string"
}

function validBindingScope(value: unknown): value is Json {
  if (!object(value) || typeof value.kind !== "string") return false
  switch (value.kind) {
    case "EXACT_INSTRUMENT":
      return exactKeys(value, ["kind", "instrument"]) && typeof value.instrument === "string"
    case "UNIVERSE_SELECTION":
      return exactKeys(value, ["kind", "selection_identity"])
        && byteArray(value.selection_identity, 32)
    case "INSTRUMENT_SET":
      return exactKeys(value, ["kind", "instruments"]) && Array.isArray(value.instruments)
        && value.instruments.every((instrument) => typeof instrument === "string")
    default:
      return false
  }
}

function validBindingRequest(value: unknown): value is Json {
  return object(value) && exactKeys(value, [
    "research_request_identity", "strategy_design_identity", "input_role_identity", "scope",
    "field_semantic", "channel", "timeframe", "unit", "scale", "pit_request_identity",
    "pit_request_digest", "snapshot_identity", "snapshot_fact_digest", "observation_batch_digest",
    "source_binding_identity", "source_frontier_digest", "correction_frontier_digest",
    "instrument_master_digest", "universe_selection_digest", "market_semantics_identity", "decision_cut",
  ]) && byteArray(value.research_request_identity, 32)
    && byteArray(value.strategy_design_identity, 32) && byteArray(value.input_role_identity, 32)
    && validBindingScope(value.scope) && oneOf(value.field_semantic, FIELD_SEMANTICS)
    && oneOf(value.channel, ["MARKET", "REFERENCE", "ECONOMIC"])
    && typeof value.timeframe === "string" && oneOf(value.unit, ["PRICE", "QUANTITY", "SCALAR"])
    && unsigned(value.scale, 255) && byteArray(value.pit_request_identity, 32)
    && byteArray(value.pit_request_digest, 32) && byteArray(value.snapshot_identity, 32)
    && byteArray(value.snapshot_fact_digest, 32) && byteArray(value.observation_batch_digest, 32)
    && byteArray(value.source_binding_identity, 32) && byteArray(value.source_frontier_digest, 32)
    && byteArray(value.correction_frontier_digest, 32) && byteArray(value.instrument_master_digest, 32)
    && byteArray(value.universe_selection_digest, 32) && byteArray(value.market_semantics_identity, 32)
    && unsigned(value.decision_cut, Number.MAX_SAFE_INTEGER)
}

function validPluginCapsule(value: unknown): value is Json {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "manifest", "language", "rustc_release", "rustc_commit", "target",
    "build_command", "files",
  ]) || !unsigned(value.schema_version, 65_535) || !validPluginManifest(value.manifest)
    || ![value.language, value.rustc_release, value.rustc_commit, value.target].every(
      (field) => typeof field === "string",
    ) || !Array.isArray(value.build_command)
    || !value.build_command.every((part) => typeof part === "string") || !Array.isArray(value.files)) return false
  return value.files.every((file) => object(file)
    && exactKeysWithOptional(file, ["path", "bytes"], ["symlink_target"])
    && typeof file.path === "string" && byteArray(file.bytes)
    && (file.symlink_target === undefined || file.symlink_target === null
      || typeof file.symlink_target === "string"))
}

function validRunRequest(value: unknown): value is DevelopComposerRunRequestV2 {
  return object(value) && exactKeys(value, [
    "request_identity", "research_custody_reference", "design", "binding_requests",
    "plugin_source_capsules",
  ]) && identity(value.request_identity) && locator(value.research_custody_reference)
    && validDesign(value.design) && Array.isArray(value.binding_requests)
    && value.binding_requests.every(validBindingRequest) && Array.isArray(value.plugin_source_capsules)
    && value.plugin_source_capsules.length <= 64 && value.plugin_source_capsules.every(validPluginCapsule)
}

function unavailable(requestIdentity: string, coordinate: string, reason: string): DevelopComposerOperationResponseV2 {
  return {
    schema_version: 2,
    request_identity: requestIdentity,
    disposition: "UNAVAILABLE",
    receipt_identity: null,
    artifact: null,
    coordinate,
    reason,
  }
}

function validArtifact(value: unknown): value is Json {
  return object(value) && exactKeys(value, [
    "artifact_locator", "artifact_digest", "canonical_plan_digest", "design_digest",
  ]) && identity(value.artifact_locator) && byteArray(value.artifact_digest, 32)
    && byteArray(value.canonical_plan_digest, 32) && byteArray(value.design_digest, 32)
}

function validResponse(value: unknown, requestIdentity: string): value is DevelopComposerOperationResponseV2 {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "request_identity", "disposition", "receipt_identity", "artifact", "coordinate", "reason",
  ]) || value.schema_version !== 2 || value.request_identity !== requestIdentity
    || !["SUCCESS", "CONFLICT", "UNSUPPORTED", "NEEDS_RESEARCH_REFINEMENT", "UNAVAILABLE",
      "SUBMITTED_OR_UNKNOWN"].includes(String(value.disposition))
    || !(value.receipt_identity === null || byteArray(value.receipt_identity, 32))
    || !(value.artifact === null || validArtifact(value.artifact))
    || !(value.coordinate === null || typeof value.coordinate === "string")
    || !(value.reason === null || typeof value.reason === "string")) return false

  if (value.disposition === "SUCCESS") {
    return byteArray(value.receipt_identity, 32) && validArtifact(value.artifact)
      && value.coordinate === null && value.reason === null
  }
  return value.receipt_identity === null && value.artifact === null
}

async function boundedResponseText(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length")
  if (contentLength !== null && /^[0-9]+$/.test(contentLength)
    && BigInt(contentLength) > BigInt(MAX_OWNER_RESPONSE_BYTES)) {
    try {
      await response.body?.cancel("OWNER_RESPONSE_BOUND")
    } catch {
      // The size violation remains authoritative even if stream cancellation fails.
    }
    throw new Error("OWNER_RESPONSE_BOUND")
  }

  if (response.body === null) throw new Error("OWNER_RESPONSE_EMPTY")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let accumulated = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array)) throw new Error("OWNER_RESPONSE_CHUNK")
      const admitted = Math.min(value.byteLength, MAX_OWNER_RESPONSE_BYTES + 1 - accumulated)
      if (admitted > 0) {
        chunks.push(value.slice(0, admitted))
        accumulated += admitted
      }
      if (accumulated > MAX_OWNER_RESPONSE_BYTES || admitted < value.byteLength) {
        try {
          await reader.cancel("OWNER_RESPONSE_BOUND")
        } catch {
          // The size violation remains authoritative even if stream cancellation fails.
        }
        throw new Error("OWNER_RESPONSE_BOUND")
      }
    }
  } finally {
    reader.releaseLock()
  }

  if (accumulated === 0) throw new Error("OWNER_RESPONSE_EMPTY")
  const bytes = new Uint8Array(accumulated)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
}

async function ownerPost(
  path: string,
  token: string,
  requestIdentity: string,
  body?: string,
): Promise<DevelopComposerOperationResponseV2> {
  const response = await fetch(`${OWNER_URL}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body }),
    signal: AbortSignal.timeout(120_000),
  })
  const text = await boundedResponseText(response)
  const result: unknown = JSON.parse(text)
  if (!validResponse(result, requestIdentity)
    || !validStatusDisposition(response.status, result.disposition)) throw new Error("OWNER_RESPONSE_INVALID")
  return result
}

function validStatusDisposition(status: number, disposition: DevelopComposerOperationResponseV2["disposition"]): boolean {
  switch (status) {
    case 200: return disposition === "SUCCESS"
    case 202: return disposition === "SUBMITTED_OR_UNKNOWN"
    case 409: return disposition === "CONFLICT"
    case 422: return disposition === "UNSUPPORTED" || disposition === "NEEDS_RESEARCH_REFINEMENT"
    case 503: return disposition === "UNAVAILABLE"
    default: return false
  }
}

export async function main(
  action: Action,
  request_identity: string,
  request: DevelopComposerRunRequestV2 | null,
): Promise<DevelopComposerOperationResponseV2> {
  const boundIdentity = identity(request_identity) ? request_identity : "unbound"
  if (action !== "RUN" && action !== "RESOLVE") {
    return unavailable(boundIdentity, "transport.action", "RUN or RESOLVE is required")
  }
  if (!identity(request_identity)) {
    return unavailable("unbound", "transport.request_identity", "a bounded request identity is required")
  }
  if (action === "RUN" && (!validRunRequest(request) || request.request_identity !== request_identity)) {
    return unavailable(request_identity, "transport.request", "the typed RUN request is missing or mismatched")
  }
  if (action === "RESOLVE" && request !== null) {
    return unavailable(request_identity, "transport.resolve", "RESOLVE accepts only the same request identity")
  }

  const token = process.env.RD_OWNER_API_TOKEN
  if (!token) return unavailable(request_identity, "transport.authorization", "R&D Owner transport is unavailable")

  try {
    if (action === "RESOLVE") {
      return await ownerPost(
        `/v2/develop-composer/runs/${encodeURIComponent(request_identity)}/resolve`,
        token,
        request_identity,
      )
    }
    const body = JSON.stringify(request)
    if (new TextEncoder().encode(body).length > MAX_REQUEST_BYTES) {
      return unavailable(request_identity, "transport.request", "the typed RUN request exceeds the transport bound")
    }
    return await ownerPost("/v2/develop-composer/runs", token, request_identity, body)
  } catch {
    return unavailable(request_identity, "transport.owner", "R&D Owner response is unavailable")
  }
}
