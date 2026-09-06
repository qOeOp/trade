const OWNER_URL = "http://rd-owner-api:8080"
const MAX_OWNER_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_LOCATOR_BYTES = 256

type Action = "RUN" | "RESOLVE"
type Json = Record<string, unknown>

export type DevelopComposerRequestProjectionV2 = {
  schema_version: 2
  research_request_locator: string
  request_identity: string
  request_digest: number[]
  research_custody_digest: number[]
  research_request_identity: number[]
  intent_identity: number[]
  intent_digest: number[]
  design_identity: number[]
  design_digest: number[]
  provider_identity: string
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

function boundedIdentity(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
    && new TextEncoder().encode(value).length <= MAX_LOCATOR_BYTES
}

function digest(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 32
    && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
}

function unavailable(
  requestIdentity: string,
  coordinate: string,
  reason: string,
  disposition: DevelopComposerOperationResponseV2["disposition"] = "UNAVAILABLE",
): DevelopComposerOperationResponseV2 {
  return {
    schema_version: 2,
    request_identity: requestIdentity,
    disposition,
    receipt_identity: null,
    artifact: null,
    coordinate,
    reason,
  }
}

function validProjection(
  value: unknown,
  researchRequestLocator: string,
): value is DevelopComposerRequestProjectionV2 {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "research_request_locator", "request_identity", "request_digest",
    "research_custody_digest", "research_request_identity", "intent_identity", "intent_digest",
    "design_identity", "design_digest", "provider_identity",
  ]) || value.schema_version !== 2 || value.research_request_locator !== researchRequestLocator
    || !boundedIdentity(value.request_identity) || !boundedIdentity(value.provider_identity)) return false
  return [
    value.request_digest,
    value.research_custody_digest,
    value.research_request_identity,
    value.intent_identity,
    value.intent_digest,
    value.design_identity,
    value.design_digest,
  ].every(digest)
}

function validArtifact(value: unknown): value is Json {
  return object(value) && exactKeys(value, [
    "artifact_locator", "artifact_digest", "canonical_plan_digest", "design_digest",
  ]) && boundedIdentity(value.artifact_locator) && digest(value.artifact_digest)
    && digest(value.canonical_plan_digest) && digest(value.design_digest)
}

function validResponse(value: unknown, requestIdentity: string): value is DevelopComposerOperationResponseV2 {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "request_identity", "disposition", "receipt_identity", "artifact", "coordinate", "reason",
  ]) || value.schema_version !== 2 || value.request_identity !== requestIdentity
    || !["SUCCESS", "CONFLICT", "UNSUPPORTED", "NEEDS_RESEARCH_REFINEMENT", "UNAVAILABLE",
      "SUBMITTED_OR_UNKNOWN"].includes(String(value.disposition))
    || !(value.receipt_identity === null || digest(value.receipt_identity))
    || !(value.artifact === null || validArtifact(value.artifact))
    || !(value.coordinate === null || typeof value.coordinate === "string")
    || !(value.reason === null || typeof value.reason === "string")) return false
  if (value.disposition === "SUCCESS") {
    return digest(value.receipt_identity) && validArtifact(value.artifact)
      && value.coordinate === null && value.reason === null
  }
  return value.receipt_identity === null && value.artifact === null
}

async function boundedResponseText(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length")
  if (contentLength !== null && /^[0-9]+$/.test(contentLength)
    && BigInt(contentLength) > BigInt(MAX_OWNER_RESPONSE_BYTES)) {
    try { await response.body?.cancel("OWNER_RESPONSE_BOUND") } catch {}
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
      accumulated += value.byteLength
      if (accumulated > MAX_OWNER_RESPONSE_BYTES) {
        try { await reader.cancel("OWNER_RESPONSE_BOUND") } catch {}
        throw new Error("OWNER_RESPONSE_BOUND")
      }
      chunks.push(value)
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

async function requestProjection(
  token: string,
  researchRequestLocator: string,
): Promise<DevelopComposerRequestProjectionV2> {
  const response = await fetch(
    `${OWNER_URL}/v2/develop-composer/request-projections?research_request_locator=${encodeURIComponent(researchRequestLocator)}`,
    {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(120_000),
    },
  )
  if (response.status !== 200) throw new Error("OWNER_PROJECTION_UNAVAILABLE")
  const result: unknown = JSON.parse(await boundedResponseText(response))
  if (!validProjection(result, researchRequestLocator)) throw new Error("OWNER_PROJECTION_INVALID")
  return result
}

function validStatusDisposition(
  status: number,
  disposition: DevelopComposerOperationResponseV2["disposition"],
): boolean {
  switch (status) {
    case 200: return disposition === "SUCCESS"
    case 202: return disposition === "SUBMITTED_OR_UNKNOWN"
    case 409: return disposition === "CONFLICT"
    case 422: return disposition === "UNSUPPORTED" || disposition === "NEEDS_RESEARCH_REFINEMENT"
    case 503: return disposition === "UNAVAILABLE"
    default: return false
  }
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
  const result: unknown = JSON.parse(await boundedResponseText(response))
  if (!validResponse(result, requestIdentity)
    || !validStatusDisposition(response.status, result.disposition)) throw new Error("OWNER_RESPONSE_INVALID")
  return result
}

export async function main(
  action: Action,
  research_request_locator: string,
): Promise<DevelopComposerOperationResponseV2> {
  if (action !== "RUN" && action !== "RESOLVE") {
    return unavailable("unbound", "transport.action", "RUN or RESOLVE is required")
  }
  if (!boundedIdentity(research_request_locator)) {
    return unavailable("unbound", "transport.research_request_locator", "a bounded Research request locator is required")
  }
  const token = process.env.RD_OWNER_API_TOKEN
  if (!token) return unavailable("unbound", "transport.authorization", "R&D Owner transport is unavailable")

  let projection: DevelopComposerRequestProjectionV2
  try {
    projection = await requestProjection(token, research_request_locator)
  } catch {
    return unavailable("unbound", "transport.request_projection", "R&D Owner request projection is unavailable")
  }

  try {
    if (action === "RESOLVE") {
      return await ownerPost(
        `/v2/develop-composer/runs/${encodeURIComponent(projection.request_identity)}/resolve`,
        token,
        projection.request_identity,
      )
    }
    return await ownerPost(
      "/v2/develop-composer/runs",
      token,
      projection.request_identity,
      JSON.stringify({ research_request_locator }),
    )
  } catch {
    return unavailable(
      projection.request_identity,
      "transport.owner",
      "R&D Owner response is unavailable; resolve the prefetched identity",
      "SUBMITTED_OR_UNKNOWN",
    )
  }
}
