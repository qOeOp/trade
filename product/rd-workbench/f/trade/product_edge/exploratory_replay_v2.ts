const OWNER_URL = "http://rd-owner-api:8080"
const MAX_OWNER_RESPONSE_BYTES = 2 * 1024 * 1024

type Action = "RUN" | "RESOLVE"
type Json = Record<string, any>

import {
  unavailableReplayOwnerReadV2,
  unknownReplayProjectionV2,
  validExploratoryReplayRequestV2,
  verifyReplayConsumerProjectionV2,
} from "./consumer_projection_v1.ts"

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

function digest(value: unknown): value is string {
  return typeof value === "string" && /^(sha256|blake3):[0-9a-f]{64}$/.test(value)
}

function bytes(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.length <= MAX_OWNER_RESPONSE_BYTES
    && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
}

function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((item, index) => equalJson(item, right[index]))
  }
  if (!object(left) || !object(right)) return false
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && equalJson(left[key], right[key]))
}

function canonicalBytesMatch(value: unknown, request: Json): boolean {
  if (!bytes(value)) return false
  try {
    const decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(value)))
    return validExploratoryReplayRequestV2(decoded) && equalJson(decoded, request)
  } catch {
    return false
  }
}

function validProposal(value: unknown): value is Json {
  return object(value) && exactKeys(value, [
    "build_request_identity", "attempt_identity", "build_receipt_identity",
    "artifact_family_binding_identity", "request",
  ]) && [value.build_request_identity, value.attempt_identity, value.build_receipt_identity,
    value.artifact_family_binding_identity].every(identity)
    && validExploratoryReplayRequestV2(value.request)
}

function validSelector(value: unknown, request: Json): value is Json {
  return object(value) && exactKeys(value, [
    "request_identity", "meaning_digest", "canonical_request_bytes",
  ]) && value.request_identity === request.request_identity && digest(value.meaning_digest)
    && canonicalBytesMatch(value.canonical_request_bytes, request)
}

async function ownerPost(path: string, token: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${OWNER_URL}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
  const text = await response.text()
  if (!text || text.length > MAX_OWNER_RESPONSE_BYTES) throw new Error("OWNER_RESPONSE_BOUND")
  const result = JSON.parse(text)
  if (!response.ok) throw new Error("OWNER_REQUEST_FAILED")
  return result
}

function resolveOwner(token: string, requestIdentity: string, meaningDigest: string) {
  return ownerPost(
    `/v2/exploratory-replay-requests/${encodeURIComponent(requestIdentity)}/resolve`,
    token,
    { meaning_digest: meaningDigest },
  )
}

async function projectedResolve(
  token: string, request: Json, requestIdentity: string, meaningDigest: string,
) {
  const raw = await resolveOwner(token, requestIdentity, meaningDigest)
  return verifyReplayConsumerProjectionV2(raw, request, requestIdentity, meaningDigest)
}

export async function main(
  action: Action,
  request_identity: string,
  meaning_digest: string,
  proposal: unknown,
) {
  const proposalRequestIdentity = validProposal(proposal) ? proposal.request.request_identity : request_identity
  const initialUnknown = unknownReplayProjectionV2(
    identity(proposalRequestIdentity) ? proposalRequestIdentity : request_identity,
    digest(meaning_digest) ? meaning_digest : null,
  )
  if ((action !== "RUN" && action !== "RESOLVE") || !validProposal(proposal)) return initialUnknown
  const request = proposal.request
  const token = process.env.RD_OWNER_API_TOKEN
  if (!token) return initialUnknown

  if (action === "RESOLVE") {
    if (request_identity !== request.request_identity || !digest(meaning_digest)) return initialUnknown
    try {
      return await projectedResolve(token, request, request_identity, meaning_digest)
    } catch {
      return unknownReplayProjectionV2(request_identity, meaning_digest)
    }
  }

  let selector: Json
  try {
    const identified = await ownerPost(
      "/v2/exploratory-replay-requests/identify",
      token,
      request,
    )
    if (!validSelector(identified, request)) return initialUnknown
    selector = identified
  } catch {
    return initialUnknown
  }

  const unknown = unknownReplayProjectionV2(selector.request_identity, selector.meaning_digest)
  let existing: unknown
  try {
    existing = await resolveOwner(token, selector.request_identity, selector.meaning_digest)
  } catch {
    return unknown
  }
  const projected = verifyReplayConsumerProjectionV2(
    existing, request, selector.request_identity, selector.meaning_digest,
  )
  if (projected.resolution === "EXPLORATION_ACTIVE") return projected
  if (!unavailableReplayOwnerReadV2(existing, selector.request_identity)) return unknown

  try {
    await ownerPost("/v2/exploratory-replay-requests", token, proposal)
  } catch {
    try {
      return await projectedResolve(token, request, selector.request_identity, selector.meaning_digest)
    } catch {
      return unknown
    }
  }
  try {
    return await projectedResolve(token, request, selector.request_identity, selector.meaning_digest)
  } catch {
    return unknown
  }
}
