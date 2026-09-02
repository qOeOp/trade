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

function identity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim() === value
}

function locator(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function byteArray(value: unknown, exactLength?: number): value is number[] {
  return Array.isArray(value) && (exactLength === undefined || value.length === exactLength)
    && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
}

function validDesign(value: unknown): value is Json {
  return object(value) && exactKeys(value, [
    "schema_version", "research_request_identity", "intent_identity", "intent_digest", "inputs",
    "joins", "parameters", "state", "reactions", "capabilities", "plugins", "resources", "falsifier",
  ]) && value.schema_version === 2
    && [value.inputs, value.joins, value.parameters, value.state, value.reactions,
      value.capabilities, value.plugins].every(Array.isArray)
    && object(value.resources) && typeof value.falsifier === "string"
}

function validBindingRequest(value: unknown): value is Json {
  return object(value) && exactKeys(value, [
    "research_request_identity", "strategy_design_identity", "input_role_identity", "scope",
    "field_semantic", "channel", "timeframe", "unit", "scale", "pit_request_identity",
    "pit_request_digest", "snapshot_identity", "snapshot_fact_digest", "observation_batch_digest",
    "source_binding_identity", "source_frontier_digest", "correction_frontier_digest",
    "instrument_master_digest", "universe_selection_digest", "market_semantics_identity", "decision_cut",
  ])
}

function validPluginCapsule(value: unknown): value is Json {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "manifest", "language", "rustc_release", "rustc_commit", "target",
    "build_command", "files",
  ]) || value.schema_version !== 2 || !object(value.manifest)
    || ![value.language, value.rustc_release, value.rustc_commit, value.target].every(
      (field) => typeof field === "string",
    ) || !Array.isArray(value.build_command)
    || !value.build_command.every((part) => typeof part === "string") || !Array.isArray(value.files)) return false
  return value.files.every((file) => object(file) && exactKeys(file, ["path", "bytes", "symlink_target"])
    && typeof file.path === "string" && byteArray(file.bytes)
    && (file.symlink_target === null || typeof file.symlink_target === "string"))
}

function validRunRequest(value: unknown): value is DevelopComposerRunRequestV2 {
  return object(value) && exactKeys(value, [
    "request_identity", "research_custody_reference", "design", "binding_requests",
    "plugin_source_capsules",
  ]) && identity(value.request_identity) && locator(value.research_custody_reference)
    && validDesign(value.design) && Array.isArray(value.binding_requests)
    && value.binding_requests.every(validBindingRequest) && Array.isArray(value.plugin_source_capsules)
    && value.plugin_source_capsules.every(validPluginCapsule)
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
  const text = await response.text()
  if (!text || new TextEncoder().encode(text).length > MAX_OWNER_RESPONSE_BYTES) {
    throw new Error("OWNER_RESPONSE_BOUND")
  }
  const result: unknown = JSON.parse(text)
  if (!validResponse(result, requestIdentity)) throw new Error("OWNER_RESPONSE_INVALID")
  return result
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
