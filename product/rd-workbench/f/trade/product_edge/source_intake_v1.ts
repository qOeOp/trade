type Action = "RUN" | "RESOLVE"

export type SourceInterpretationV1 = {
  bounded_explanation: string
  plausible_alternatives: string[]
  differentiating_prediction: string
  falsifier: string
}

const OWNER_URL = "http://rd-owner-api:8080"
const PRODUCT_EDGE_CHANNEL = "WINDMILL_PRODUCT_EDGE" as const
const LIVE_EXTERNAL_ENVIRONMENT_IDENTITY = "PRODUCTION_LIVE_EXTERNAL"
const LIVE_EXTERNAL_PROVIDER_PROFILE_DIGEST = "sha256:18e4411c991be0a92514bc8ff238ef0429f379d7aa0fd17c1169c7a4c0f45c6b"
const SEALED_ACCEPTANCE_ENVIRONMENT_IDENTITY = "source-intake-sealed-acceptance-environment-v1"
const SEALED_ACCEPTANCE_PROVIDER_PROFILE_DIGEST = "sha256:20e4901e7b97516edbaa744c0e866b0c509595386357c1b973e48beac1657f15"
const SEALED_ACCEPTANCE_FIXTURE_CORPUS_DIGEST = "sha256:b8cf806629fbb7baa2e38707b4d246a17e44d9841509701530cbd97558ddad18"
const MAX_OWNER_RESPONSE_BYTES = 2 * 1024 * 1024
const TERMINALS = [
  "RETRIEVED",
  "NOT_FOUND",
  "AUTH_REQUIRED",
  "ACCESS_DENIED",
  "RATE_LIMITED",
  "TERMS_OR_LICENSE_BLOCKED",
  "MALFORMED",
  "UNAVAILABLE",
] as const

const READBACK_KEYS = [
  "authority_class",
  "binding_identity",
  "content_digest",
  "content_locator",
  "environment_identity",
  "fixture_corpus_digest",
  "outbox_event_identity",
  "provenance_identity",
  "provider_profile_digest",
  "receipt",
  "request_identity",
  "source_candidate_identity",
  "state",
  "terminal",
]

const RECEIPT_KEYS = [
  "attempt_identity",
  "binding_identity",
  "committed_at_epoch_ms",
  "connected_address",
  "content_digest",
  "invocation_identity",
  "policy_decision_digest",
  "policy_decision_identity",
  "policy_decision_time",
  "receipt_identity",
  "request_identity",
  "response_header_digest",
  "response_media_type",
  "response_size_bytes",
  "response_status",
  "retrieval_time",
  "retrieval_time_evidence_digest",
  "retrieval_time_evidence_identity",
  "schema_version",
  "terminal",
  "terminal_evidence_digest",
  "terminal_evidence_identity",
]

const SHARED_TIME_KEYS = [
  "clock_epoch",
  "clock_identity",
  "comparison_rule",
  "decision_cut_epoch_ms",
  "epoch_successor_proof_identity",
  "head_digest",
  "head_identity",
  "monotonic_sequence",
  "predecessor_head_digest",
  "restart_continuity_digest",
  "skew_bound_ms",
  "successor_proof_commit_cut_epoch_ms",
  "uncertainty_bound_ms",
  "valid_through_epoch_ms",
  "wall_observed_epoch_ms",
]

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index])
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function validDigest(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value)
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function validIdentity(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 192
    && /^[A-Za-z0-9._:/-]+$/.test(value)
}

function validDoi(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && byteLength(value) <= 256
    && value === value.trim()
    && value.startsWith("10.")
    && value.includes("/")
    && /^[a-z0-9./\-_;():]+$/.test(value)
}

function validBoundedText(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && byteLength(value) <= 8_192
    && !/\p{Cc}/u.test(value)
}

function compareUtf8(left: string, right: string): number {
  const leftBytes = new TextEncoder().encode(left)
  const rightBytes = new TextEncoder().encode(right)
  const length = Math.min(leftBytes.length, rightBytes.length)
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index]
  }
  return leftBytes.length - rightBytes.length
}

function validInterpretation(value: unknown): value is SourceInterpretationV1 {
  if (!record(value) || !exactKeys(value, [
    "bounded_explanation",
    "differentiating_prediction",
    "falsifier",
    "plausible_alternatives",
  ])) return false
  if (!validBoundedText(value.bounded_explanation)
    || !validBoundedText(value.differentiating_prediction)
    || !validBoundedText(value.falsifier)
    || !Array.isArray(value.plausible_alternatives)
    || value.plausible_alternatives.length < 1
    || value.plausible_alternatives.length > 16
    || !value.plausible_alternatives.every(validBoundedText)) return false
  return value.plausible_alternatives
    .slice(1)
    .every((item, index) => compareUtf8(value.plausible_alternatives[index], item) < 0)
}

function unknown(requestIdentity: string) {
  return {
    request_identity: requestIdentity,
    resolution: "SUBMITTED_OR_UNKNOWN",
    next_legal_action: "RESOLVE_SAME_REQUEST",
  }
}

function terminal(value: unknown): value is typeof TERMINALS[number] {
  return typeof value === "string" && TERMINALS.includes(value as typeof TERMINALS[number])
}

function validAuthority(value: Record<string, unknown>): boolean {
  if (value.authority_class === "LIVE_EXTERNAL") {
    return value.environment_identity === LIVE_EXTERNAL_ENVIRONMENT_IDENTITY
      && value.provider_profile_digest === LIVE_EXTERNAL_PROVIDER_PROFILE_DIGEST
      && value.fixture_corpus_digest === null
  }
  if (value.authority_class === "SEALED_ACCEPTANCE") {
    return value.environment_identity === SEALED_ACCEPTANCE_ENVIRONMENT_IDENTITY
      && value.provider_profile_digest === SEALED_ACCEPTANCE_PROVIDER_PROFILE_DIGEST
      && value.fixture_corpus_digest === SEALED_ACCEPTANCE_FIXTURE_CORPUS_DIGEST
  }
  return false
}

function validSharedTime(value: unknown): value is Record<string, unknown> {
  if (!record(value) || !exactKeys(value, SHARED_TIME_KEYS)
    || !validDigest(value.head_identity)
    || !validDigest(value.head_digest)
    || !validIdentity(value.clock_identity)
    || !validIdentity(value.clock_epoch)
    || !nonNegativeSafeInteger(value.monotonic_sequence)
    || !nonNegativeSafeInteger(value.wall_observed_epoch_ms)
    || !nonNegativeSafeInteger(value.decision_cut_epoch_ms)
    || !nonNegativeSafeInteger(value.valid_through_epoch_ms)
    || Number(value.decision_cut_epoch_ms) >= Number(value.valid_through_epoch_ms)
    || !validDigest(value.restart_continuity_digest)
    || !nonNegativeSafeInteger(value.uncertainty_bound_ms)
    || !nonNegativeSafeInteger(value.skew_bound_ms)
    || value.comparison_rule !== "EXCLUSIVE_VALID_THROUGH") return false

  const noSuccessor = value.predecessor_head_digest === null
    && value.epoch_successor_proof_identity === null
    && value.successor_proof_commit_cut_epoch_ms === null
  const sealedSuccessor = validDigest(value.predecessor_head_digest)
    && validDigest(value.epoch_successor_proof_identity)
    && nonNegativeSafeInteger(value.successor_proof_commit_cut_epoch_ms)
  return noSuccessor || sealedSuccessor
}

function validReceipt(
  value: unknown,
  requestIdentity: string,
  bindingIdentity: string,
  acquisitionTerminal: typeof TERMINALS[number],
): value is Record<string, unknown> {
  if (!record(value) || !exactKeys(value, RECEIPT_KEYS)) return false
  if (value.schema_version !== 1 || !validIdentity(value.receipt_identity)) return false
  if (value.request_identity !== requestIdentity
    || value.binding_identity !== bindingIdentity
    || value.attempt_identity !== bindingIdentity
    || (value.invocation_identity !== null && !validIdentity(value.invocation_identity))
    || value.terminal !== acquisitionTerminal
    || !validDigest(value.terminal_evidence_identity)
    || !validDigest(value.terminal_evidence_digest)
    || !validIdentity(value.policy_decision_identity)
    || !validDigest(value.policy_decision_digest)
    || !validSharedTime(value.policy_decision_time)
    || (value.response_status !== null
      && !(Number.isSafeInteger(value.response_status) && Number(value.response_status) >= 100
        && Number(value.response_status) <= 599))
    || (value.response_header_digest !== null && !validDigest(value.response_header_digest))
    || (value.connected_address !== null || value.response_media_type !== null
      || value.response_size_bytes !== null) && !(nonEmpty(value.connected_address)
      && nonEmpty(value.response_media_type)
      && nonNegativeSafeInteger(value.response_size_bytes))
    || (value.content_digest !== null && !validDigest(value.content_digest))
    || !validIdentity(value.retrieval_time_evidence_identity)
    || !validDigest(value.retrieval_time_evidence_digest)
    || !validSharedTime(value.retrieval_time)
    || !nonNegativeSafeInteger(value.committed_at_epoch_ms)) return false

  const policyTime = value.policy_decision_time
  const retrievalTime = value.retrieval_time
  if (policyTime.clock_identity !== retrievalTime.clock_identity
    || policyTime.clock_epoch !== retrievalTime.clock_epoch
    || Number(policyTime.monotonic_sequence) >= Number(retrievalTime.monotonic_sequence)
    || policyTime.head_digest === retrievalTime.head_digest
    || Number(policyTime.decision_cut_epoch_ms) > Number(retrievalTime.decision_cut_epoch_ms)
    || Number(retrievalTime.decision_cut_epoch_ms)
      >= Number(retrievalTime.valid_through_epoch_ms)) return false

  const withoutPayload = value.connected_address === null
    && value.response_media_type === null
    && value.response_size_bytes === null
    && value.content_digest === null
  if (acquisitionTerminal === "RETRIEVED") {
    return validIdentity(value.invocation_identity)
      && value.response_status === 200
      && validDigest(value.response_header_digest)
      && nonEmpty(value.connected_address)
      && nonEmpty(value.response_media_type)
      && nonNegativeSafeInteger(value.response_size_bytes)
      && validDigest(value.content_digest)
  }
  if (!withoutPayload) return false
  const fixedStatus = acquisitionTerminal === "NOT_FOUND" ? 404
    : acquisitionTerminal === "AUTH_REQUIRED" ? 401
      : acquisitionTerminal === "ACCESS_DENIED" ? 403
        : acquisitionTerminal === "RATE_LIMITED" ? 429
          : undefined
  if (fixedStatus !== undefined) {
    return validIdentity(value.invocation_identity)
      && value.response_status === fixedStatus
      && validDigest(value.response_header_digest)
  }
  if (acquisitionTerminal === "TERMS_OR_LICENSE_BLOCKED") {
    return value.invocation_identity === null
      && value.response_status === null
      && value.response_header_digest === null
  }
  if (acquisitionTerminal === "UNAVAILABLE") {
    return validIdentity(value.invocation_identity)
      && ((value.response_status === null && value.response_header_digest === null)
        || (Number(value.response_status) >= 500 && Number(value.response_status) <= 599
          && validDigest(value.response_header_digest)))
  }
  return acquisitionTerminal === "MALFORMED"
    && validIdentity(value.invocation_identity)
    && nonNegativeSafeInteger(value.response_status)
    && Number(value.response_status) >= 100
    && Number(value.response_status) <= 599
    && (value.response_header_digest === null
      || (validDigest(value.response_header_digest)
        && (value.response_status === 200
          || (![401, 403, 404, 429].includes(Number(value.response_status))
            && !(Number(value.response_status) >= 500 && Number(value.response_status) <= 599)))))
}

export function projectOwnerReadbackV1(raw: unknown, requestIdentity: string) {
  if (!record(raw) || !exactKeys(raw, READBACK_KEYS)
    || raw.request_identity !== requestIdentity
    || !validIdentity(raw.binding_identity)
    || !validAuthority(raw)
    || raw.state !== "TERMINAL"
    || !terminal(raw.terminal)
    || !validReceipt(raw.receipt, requestIdentity, raw.binding_identity, raw.terminal)) {
    return unknown(requestIdentity)
  }

  const receipt = raw.receipt
  if (raw.terminal === "RETRIEVED") {
    if (receipt.invocation_identity === null
      || receipt.response_status !== 200
      || !nonEmpty(receipt.response_header_digest)
      || !nonEmpty(receipt.connected_address)
      || !nonEmpty(receipt.response_media_type)
      || !nonNegativeSafeInteger(receipt.response_size_bytes)
      || !nonEmpty(receipt.content_digest)
      || raw.content_digest !== receipt.content_digest
      || raw.content_locator !== `rd-owner://source-payload/sha256/${receipt.content_digest}`
      || !validIdentity(raw.provenance_identity)
      || !validIdentity(raw.source_candidate_identity)
      || !validIdentity(raw.outbox_event_identity)) return unknown(requestIdentity)
    return {
      request_identity: requestIdentity,
      binding_identity: raw.binding_identity,
      authority_class: raw.authority_class,
      environment_identity: raw.environment_identity,
      provider_profile_digest: raw.provider_profile_digest,
      fixture_corpus_digest: raw.fixture_corpus_digest,
      resolution: raw.terminal,
      receipt,
      content_locator: raw.content_locator,
      content_digest: raw.content_digest,
      provenance_identity: raw.provenance_identity,
      source_candidate_identity: raw.source_candidate_identity,
      outbox_event_identity: raw.outbox_event_identity,
    }
  }

  if (receipt.content_digest !== null
    || raw.content_locator !== null
    || raw.content_digest !== null
    || raw.provenance_identity !== null
    || raw.source_candidate_identity !== null
    || raw.outbox_event_identity === null
    || !validIdentity(raw.outbox_event_identity)) return unknown(requestIdentity)
  return {
    request_identity: requestIdentity,
    binding_identity: raw.binding_identity,
    authority_class: raw.authority_class,
    environment_identity: raw.environment_identity,
    provider_profile_digest: raw.provider_profile_digest,
    fixture_corpus_digest: raw.fixture_corpus_digest,
    resolution: raw.terminal,
    receipt,
    outbox_event_identity: raw.outbox_event_identity,
  }
}

async function ownerPost(path: string, token: string, body: unknown) {
  const response = await fetch(`${OWNER_URL}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  })
  const text = await response.text()
  if (!text || byteLength(text) > MAX_OWNER_RESPONSE_BYTES || response.status >= 500) {
    throw new Error("OWNER_RESPONSE_UNAVAILABLE")
  }
  return JSON.parse(text)
}

export async function main(
  action: Action,
  request_identity: string,
  normalized_doi?: string,
  interpretation?: SourceInterpretationV1,
) {
  if (!validIdentity(request_identity) || (action !== "RUN" && action !== "RESOLVE")) {
    return unknown(typeof request_identity === "string" ? request_identity : "INVALID_REQUEST_IDENTITY")
  }
  const token = process.env.RD_OWNER_API_TOKEN
  if (!nonEmpty(token)) return unknown(request_identity)

  const isResolve = action === "RESOLVE"
  if (!isResolve && (!validDoi(normalized_doi) || !validInterpretation(interpretation))) {
    return unknown(request_identity)
  }
  const path = isResolve
    ? `/v1/source-intakes/${encodeURIComponent(request_identity)}/resolve`
    : "/v1/source-intakes"
  const body = isResolve
    ? {}
    : {
        request_identity,
        channel: PRODUCT_EDGE_CHANNEL,
        normalized_doi,
        interpretation,
      }
  try {
    return projectOwnerReadbackV1(await ownerPost(path, token, body), request_identity)
  } catch {
    return unknown(request_identity)
  }
}
