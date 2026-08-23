const PRODUCT_EDGE_GATEWAY = "WINDMILL_PRODUCT_EDGE" as const
type Channel = typeof PRODUCT_EDGE_GATEWAY
type Action = "RUN" | "RESOLVE"
type IdentityMode = "GENERATE" | "EXACT"

import {
  deriveArtifactConsumerProjectionV1,
  deriveResearchConsumerProjectionV1,
  deriveVerifiedArtifactS1ContextV1,
  deriveVerifiedS1ConsumerContextV1,
  verifyArtifactConsumerProjectionV1,
  type VerifiedS1ConsumerContextV1,
} from "./consumer_projection_v1.ts"

type AgentCandidate = {
  logic: {
    signal: "MOMENTUM" | "MEAN_REVERSION" | "BREAKOUT"
    direction: "LONG_ONLY" | "SHORT_ONLY" | "LONG_SHORT"
    lookback_bars: number
    entry_threshold_bps: number
    exit_threshold_bps: number
  }
  structured_logic_summary: string
  agent_change_explanation: string
}

const OWNER_URL = "http://rd-owner-api:8080"
const PROVIDER_URL = "https://api.deepseek.com/chat/completions"
const MAX_OWNER_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024

class ProviderOutcomeUnknown extends Error {
  constructor() {
    super("PROVIDER_OUTCOME_UNKNOWN")
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort()
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index])
}

function validProviderInvocationClaimEnvelopeV1(
  claim: Record<string, unknown>,
  buildRequestIdentity: string,
  attemptIdentity: string,
): boolean {
  return exactKeys(claim, [
    "admission_identity", "attempt_identity", "claim_digest", "claim_identity",
    "committed_at_epoch_ms", "disposition", "invocation_admission_receipt_digest",
    "invocation_admission_receipt_identity", "next_legal_action", "request_identity",
    "schema_version", "state", "state_digest",
  ])
    && claim.schema_version === 1
    && claim.request_identity === buildRequestIdentity
    && claim.attempt_identity === attemptIdentity
    && nonEmpty(claim.admission_identity)
    && nonEmpty(claim.claim_identity)
    && nonEmpty(claim.claim_digest)
    && nonEmpty(claim.invocation_admission_receipt_identity)
    && nonEmpty(claim.invocation_admission_receipt_digest)
    && nonEmpty(claim.state_digest)
    && Number.isSafeInteger(claim.committed_at_epoch_ms)
    && Number(claim.committed_at_epoch_ms) >= 0
    && ["CLAIMED_NEW", "ALREADY_CLAIMED"].includes(String(claim.disposition))
    && (claim.state !== "INVOCATION_STARTED" || claim.disposition === "ALREADY_CLAIMED")
}

export function validProviderInvocationClaimV1(
  claim: Record<string, unknown>,
  buildRequestIdentity: string,
  attemptIdentity: string,
): boolean {
  return validProviderInvocationClaimEnvelopeV1(claim, buildRequestIdentity, attemptIdentity)
    && claim.state === "CLAIMED"
    && claim.next_legal_action === "RUN_BOUNDED_EXECUTION_AGENT"
}

export async function validProviderInvocationStartV1(
  envelope: Record<string, unknown>,
  claim: Record<string, unknown>,
  buildRequestIdentity: string,
  attemptIdentity: string,
  researchRequestIdentity?: string,
  expectedContext?: VerifiedS1ConsumerContextV1 | null,
): Promise<boolean> {
  if (!exactKeys(envelope, ["execution_custody", "invocation_start"])) return false
  const start = envelope.invocation_start as Record<string, unknown>
  const custody = envelope.execution_custody as Record<string, unknown>
  if (!start || typeof start !== "object" || Array.isArray(start)
    || !custody || typeof custody !== "object" || Array.isArray(custody)) return false
  const request = custody.request as Record<string, unknown>
  const admission = request?.admission as Record<string, unknown>
  let intent: Record<string, unknown>
  try {
    const bytes = custody.canonical_intent_bytes
    if (typeof bytes !== "string" || !bytes.endsWith("\n")) return false
    intent = JSON.parse(bytes.slice(0, -1)) as Record<string, unknown>
  } catch {
    return false
  }
  const structurallyValid = validProviderInvocationClaimV1(claim, buildRequestIdentity, attemptIdentity)
    && exactKeys(start, [
      "admission_identity", "attempt_identity", "claim_digest", "claim_identity",
      "disposition", "request_identity", "schema_version", "started_at_epoch_ms", "state_digest",
    ])
    && start.schema_version === 1
    && start.disposition === "STARTED_NEW"
    && start.request_identity === buildRequestIdentity
    && start.attempt_identity === attemptIdentity
    && start.admission_identity === claim.admission_identity
    && start.claim_identity === claim.claim_identity
    && start.claim_digest === claim.claim_digest
    && nonEmpty(start.state_digest)
    && start.state_digest !== claim.state_digest
    && Number.isSafeInteger(start.started_at_epoch_ms)
    && Number(start.started_at_epoch_ms) >= Number(claim.committed_at_epoch_ms)
    && exactKeys(custody, [
      "canonical_intent_bytes", "census_frontier_digest", "census_frontier_identity",
      "claim_digest", "claim_identity", "claimed_state_digest", "intent_semantic_digest",
      "execution_custody_digest", "invocation_admission_receipt_digest", "invocation_admission_receipt_identity",
      "request", "request_semantic_digest", "research_request_identity", "reservation_digest",
      "reservation_identity", "reserved_at_epoch_ms", "research_valid_through_epoch_ms",
      "schema_version", "trial_family_identity", "trial_family_root_digest",
    ])
    && custody.schema_version === 1
    && request && typeof request === "object" && !Array.isArray(request)
    && exactKeys(request, [
      "admission", "attempt_identity", "build_request_identity", "channel", "intent_identity",
    ])
    && request.build_request_identity === buildRequestIdentity
    && request.attempt_identity === attemptIdentity
    && request.channel === PRODUCT_EDGE_GATEWAY
    && nonEmpty(request.intent_identity)
    && admission && typeof admission === "object" && !Array.isArray(admission)
    && exactKeys(admission, ["admission_digest", "admission_identity", "request_identity"])
    && admission.request_identity === buildRequestIdentity
    && admission.admission_identity === claim.admission_identity
    && nonEmpty(admission.admission_digest)
    && custody.claim_identity === claim.claim_identity
    && custody.claim_digest === claim.claim_digest
    && custody.invocation_admission_receipt_identity === claim.invocation_admission_receipt_identity
    && custody.invocation_admission_receipt_digest === claim.invocation_admission_receipt_digest
    && custody.claimed_state_digest === claim.state_digest
    && [custody.canonical_intent_bytes, custody.intent_semantic_digest,
      custody.request_semantic_digest, custody.research_request_identity,
      custody.trial_family_identity, custody.trial_family_root_digest,
      custody.census_frontier_identity, custody.census_frontier_digest,
      custody.reservation_identity, custody.reservation_digest].every(nonEmpty)
    && Number.isSafeInteger(custody.reserved_at_epoch_ms)
    && Number(custody.reserved_at_epoch_ms) >= Number(claim.committed_at_epoch_ms)
    && Number(start.started_at_epoch_ms) >= Number(custody.reserved_at_epoch_ms)
    && Number.isSafeInteger(custody.research_valid_through_epoch_ms)
    && Number(custody.research_valid_through_epoch_ms) > Number(custody.reserved_at_epoch_ms)
    && (researchRequestIdentity === undefined
      || custody.research_request_identity === researchRequestIdentity)
    && intent && typeof intent === "object" && !Array.isArray(intent)
    && [1, 2].includes(Number(intent.schema_version))
    && intent.intent_identity === request.intent_identity
    && intent.request_identity === custody.research_request_identity
    && intent.semantic_digest === custody.intent_semantic_digest
    && (intent.schema_version !== 2
      || intent.trial_family_identity === custody.trial_family_identity)
    && (expectedContext == null || (
      custody.research_request_identity === expectedContext.request_identity
      && request.intent_identity === expectedContext.intent_identity
      && custody.intent_semantic_digest === expectedContext.intent_semantic_digest
      && custody.trial_family_identity === expectedContext.trial_family_identity
      && custody.trial_family_root_digest === expectedContext.trial_family_root_digest
      && custody.census_frontier_identity === expectedContext.census_frontier_identity
      && custody.census_frontier_digest === expectedContext.census_frontier_digest
      && custody.research_valid_through_epoch_ms === expectedContext.valid_through_epoch_ms
    ))
  if (!structurallyValid) return false

  const claimedStateDigest = await invocationStateDigestV1({
    schema_version: claim.schema_version,
    claim_identity: claim.claim_identity,
    admission_identity: claim.admission_identity,
    attempt_identity: claim.attempt_identity,
    claim_digest: claim.claim_digest,
    state: "CLAIMED",
    state_digest: "",
    updated_at_epoch_ms: claim.committed_at_epoch_ms,
  })
  const startedStateDigest = await invocationStateDigestV1({
    schema_version: start.schema_version,
    claim_identity: start.claim_identity,
    admission_identity: start.admission_identity,
    attempt_identity: start.attempt_identity,
    claim_digest: start.claim_digest,
    state: "INVOCATION_STARTED",
    state_digest: "",
    updated_at_epoch_ms: start.started_at_epoch_ms,
  })
  if (claim.state_digest !== claimedStateDigest || start.state_digest !== startedStateDigest) return false

  const canonicalAdmission = {
    request_identity: admission.request_identity,
    admission_identity: admission.admission_identity,
    admission_digest: admission.admission_digest,
  }
  const canonicalRequest = {
    build_request_identity: request.build_request_identity,
    attempt_identity: request.attempt_identity,
    intent_identity: request.intent_identity,
    channel: request.channel,
    admission: canonicalAdmission,
  }
  const requestSemanticDigest = `sha256:${await sha256(JSON.stringify({
    build_request_identity: request.build_request_identity,
    attempt_identity: request.attempt_identity,
    intent_identity: request.intent_identity,
    admission: canonicalAdmission,
  }))}`
  if (custody.request_semantic_digest !== requestSemanticDigest) return false

  const executionCustodyDigest = `sha256:${await sha256(JSON.stringify({
    schema_version: custody.schema_version,
    request: canonicalRequest,
    request_semantic_digest: custody.request_semantic_digest,
    canonical_intent_bytes: custody.canonical_intent_bytes,
    intent_semantic_digest: custody.intent_semantic_digest,
    research_request_identity: custody.research_request_identity,
    research_valid_through_epoch_ms: custody.research_valid_through_epoch_ms,
    trial_family_identity: custody.trial_family_identity,
    trial_family_root_digest: custody.trial_family_root_digest,
    census_frontier_identity: custody.census_frontier_identity,
    census_frontier_digest: custody.census_frontier_digest,
    claim_identity: custody.claim_identity,
    claim_digest: custody.claim_digest,
    invocation_admission_receipt_identity: custody.invocation_admission_receipt_identity,
    invocation_admission_receipt_digest: custody.invocation_admission_receipt_digest,
    claimed_state_digest: custody.claimed_state_digest,
    reserved_at_epoch_ms: custody.reserved_at_epoch_ms,
  }))}`
  if (custody.execution_custody_digest !== executionCustodyDigest) return false

  const reservationDigest = `sha256:${await sha256(JSON.stringify({
    schema_version: 1,
    request_identity: buildRequestIdentity,
    admission_identity: claim.admission_identity,
    attempt_identity: attemptIdentity,
    claim_identity: custody.claim_identity,
    claim_digest: custody.claim_digest,
    invocation_admission_receipt_identity: custody.invocation_admission_receipt_identity,
    invocation_admission_receipt_digest: custody.invocation_admission_receipt_digest,
    claimed_state_digest: custody.claimed_state_digest,
    execution_custody_digest: custody.execution_custody_digest,
    reserved_at_epoch_ms: custody.reserved_at_epoch_ms,
  }))}`
  return custody.reservation_digest === reservationDigest
    && custody.reservation_identity === `rd-artifact-invocation-reservation-v1-${reservationDigest.slice(7)}`
}

export async function deriveGeneratedArtifactIdentitiesV1(
  buildGenerationIdentity: string,
  attemptGenerationIdentity: string,
  researchRequestIdentity: string,
) {
  if (![buildGenerationIdentity, attemptGenerationIdentity, researchRequestIdentity].every(nonEmpty)) {
    return null
  }
  const meaning = JSON.stringify({
    schema_version: 1,
    operation: "artifact_build.submit_or_resolve.v1",
    build_generation_identity: buildGenerationIdentity,
    attempt_generation_identity: attemptGenerationIdentity,
    research_request_identity: researchRequestIdentity,
    gateway: PRODUCT_EDGE_GATEWAY,
  })
  const buildDigest = await sha256(`artifact-build-request-generation-v1\n${meaning}`)
  const attemptDigest = await sha256(`artifact-build-attempt-generation-v1\n${meaning}`)
  return {
    build_request_identity: `artifact-build-request-v1-${buildDigest}`,
    attempt_identity: `artifact-build-attempt-v1-${attemptDigest}`,
  }
}

function contextFromExecutionCustodyV1(
  custody: Record<string, any>,
  researchRequestIdentity: string,
): VerifiedS1ConsumerContextV1 | null {
  if (custody.research_request_identity !== researchRequestIdentity
    || custody.request?.intent_identity == null) return null
  return {
    schema_version: 1,
    request_identity: custody.research_request_identity,
    intent_identity: custody.request.intent_identity,
    intent_semantic_digest: custody.intent_semantic_digest,
    trial_family_identity: custody.trial_family_identity,
    trial_family_root_digest: custody.trial_family_root_digest,
    census_frontier_identity: custody.census_frontier_identity,
    census_frontier_digest: custody.census_frontier_digest,
    valid_through_epoch_ms: custody.research_valid_through_epoch_ms,
  }
}

export function validArtifactPreparationV1(
  preparation: Record<string, unknown>,
  buildRequestIdentity: string,
  attemptIdentity: string,
  intentIdentity: string,
): boolean {
  return exactKeys(preparation, [
    "attempt_identity", "build_request_identity", "canonical_intent_bytes", "intent_identity",
    "intent_semantic_digest", "next_legal_action", "owner_receipt", "resolution",
    "schema_version", "semantic_digest",
  ])
    && preparation.schema_version === 1
    && preparation.resolution === "PREPARED"
    && preparation.build_request_identity === buildRequestIdentity
    && preparation.attempt_identity === attemptIdentity
    && preparation.intent_identity === intentIdentity
    && nonEmpty(preparation.semantic_digest)
    && nonEmpty(preparation.canonical_intent_bytes)
    && nonEmpty(preparation.intent_semantic_digest)
    && preparation.owner_receipt === null
    && preparation.next_legal_action === "RUN_BOUNDED_EXECUTION_AGENT"
}

function unknown(
  buildRequestIdentity: string,
  attemptIdentity: string,
  invocation?: Record<string, unknown>,
) {
  const next = invocation?.state === "CLAIMED"
    ? "RUN_BOUNDED_EXECUTION_AGENT"
    : invocation?.state === "INVOCATION_STARTED"
      ? "MANUALLY_RECONCILE_PROVIDER_INVOCATION"
      : "RESOLVE_SAME_ATTEMPT_IDENTITY"
  return {
    schema_version: 1,
    resolution: "SUBMITTED_OR_UNKNOWN",
    build_request_identity: buildRequestIdentity,
    attempt_identity: attemptIdentity,
    owner_receipt: null,
    research_view: null,
    artifact_review: null,
    artifact_review_actions: null,
    trial_family_resolution: null,
    artifact_trial_family: null,
    next_legal_action: next,
    provider_invocation: invocation ?? null,
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
    signal: AbortSignal.timeout(120_000),
  })
  const text = await response.text()
  if (!text || text.length > MAX_OWNER_RESPONSE_BYTES) throw new Error("OWNER_RESPONSE_BOUND")
  const result = JSON.parse(text)
  if (response.status >= 500) throw new Error("OWNER_UNAVAILABLE")
  return result
}

async function resolveS1Context(token: string, requestIdentity: string) {
  const raw = await ownerPost(
    `/v2/research-goals/${encodeURIComponent(requestIdentity)}/resolve`,
    token,
    {},
  )
  const projection = await deriveResearchConsumerProjectionV1(raw, requestIdentity)
  return await deriveVerifiedS1ConsumerContextV1(projection, requestIdentity)
}

async function resolve(
  token: string,
  buildRequestIdentity: string,
  attemptIdentity: string,
) {
  const result = await ownerPost(
    `/v1/artifact-builds/${encodeURIComponent(buildRequestIdentity)}/attempts/${encodeURIComponent(attemptIdentity)}/resolve`,
    token,
    {},
  )
  return projectOwnerResolution(result, buildRequestIdentity, attemptIdentity)
}

export function projectOwnerResolution(
  result: Record<string, any>,
  buildRequestIdentity: string,
  attemptIdentity: string,
) {
  void buildRequestIdentity
  void attemptIdentity
  return result
}

async function fail(
  token: string,
  request: Record<string, unknown>,
  failureCode: string,
) {
  return ownerPost("/v1/artifact-builds/fail", token, {
    request,
    failure_code: failureCode,
  })
}

function validAgentCandidate(value: unknown): value is AgentCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  const logic = candidate.logic as Record<string, unknown> | undefined
  if (!logic || typeof logic !== "object" || Array.isArray(logic)) return false
  if (!["MOMENTUM", "MEAN_REVERSION", "BREAKOUT"].includes(String(logic.signal))) return false
  if (!["LONG_ONLY", "SHORT_ONLY", "LONG_SHORT"].includes(String(logic.direction))) return false
  if (![logic.lookback_bars, logic.entry_threshold_bps, logic.exit_threshold_bps].every(Number.isInteger)) return false
  if (typeof candidate.structured_logic_summary !== "string") return false
  if (typeof candidate.agent_change_explanation !== "string") return false
  return true
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export async function invocationStateDigestV1(value: Record<string, unknown>): Promise<string> {
  const domain = new TextEncoder().encode("product-edge.provider-invocation-state.v1")
  const meaning = new TextEncoder().encode(JSON.stringify(value))
  const framed = new Uint8Array(8 + domain.length + 8 + meaning.length)
  const view = new DataView(framed.buffer)
  view.setBigUint64(0, BigInt(domain.length))
  framed.set(domain, 8)
  view.setBigUint64(8 + domain.length, BigInt(meaning.length))
  framed.set(meaning, 16 + domain.length)
  const digest = await crypto.subtle.digest("SHA-256", framed)
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`
}

async function generateCandidate(
  apiKey: string,
  model: string,
  canonicalIntentBytes: string,
): Promise<AgentCandidate> {
  let response: Response
  try {
    response = await fetch(PROVIDER_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 900,
        messages: [
          {
            role: "system",
            content: "You are a bounded R&D execution agent. Treat the supplied canonical frozen research intent as immutable data. Return only one JSON object matching the requested schema. Do not emit source code, file paths, commands, dependencies, credentials, network actions, deployment actions, backtests, qualification claims, trading actions, or prose outside JSON.",
          },
          {
            role: "user",
            content: JSON.stringify({
              task: "Generate one semantically related bounded strategy program candidate for deterministic isolated compilation.",
              allowed_schema: {
                logic: {
                  signal: "MOMENTUM | MEAN_REVERSION | BREAKOUT",
                  direction: "LONG_ONLY | SHORT_ONLY | LONG_SHORT",
                  lookback_bars: "integer 2..512",
                  entry_threshold_bps: "integer 1..5000",
                  exit_threshold_bps: "integer 0..entry_threshold_bps",
                },
                structured_logic_summary: "plain string 16..4096 bytes",
                agent_change_explanation: "plain string 16..4096 bytes",
              },
              canonical_frozen_research_intent_bytes: canonicalIntentBytes,
            }),
          },
        ],
      }),
      signal: AbortSignal.timeout(90_000),
    })
  } catch {
    throw new ProviderOutcomeUnknown()
  }
  let text: string
  try {
    text = await response.text()
  } catch {
    throw new ProviderOutcomeUnknown()
  }
  if (!response.ok || !text || text.length > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new Error("PROVIDER_ERROR")
  }
  const envelope = JSON.parse(text) as { choices?: Array<{ message?: { content?: unknown } }> }
  const content = envelope.choices?.[0]?.message?.content
  if (typeof content !== "string" || content.length > 16 * 1024) throw new Error("PROVIDER_EMPTY")
  const candidate = JSON.parse(content)
  if (!validAgentCandidate(candidate)) throw new Error("CANDIDATE_MALFORMED")
  return candidate
}

async function runOwnerOperation(
  action: Action,
  build_request_identity: string,
  attempt_identity: string,
  research_request_identity: string,
  initialContext: VerifiedS1ConsumerContextV1 | null,
  freshAdmissionAllowed: boolean,
) {
  let context = initialContext
  const finish = (raw: Record<string, any>) => ({ raw, context })
  const token = process.env.RD_OWNER_API_TOKEN
  if (!token) return finish(unknown(build_request_identity, attempt_identity))
  if (action === "RESOLVE") {
    try {
      return finish(await resolve(token, build_request_identity, attempt_identity))
    } catch {
      return finish(unknown(build_request_identity, attempt_identity))
    }
  }

  let existing: Record<string, any>
  try {
    existing = await resolve(token, build_request_identity, attempt_identity)
    if (existing?.owner_receipt != null || existing?.provider_invocation?.state === "INVOCATION_STARTED") {
      return finish(existing)
    }
  } catch {
    return finish(unknown(build_request_identity, attempt_identity))
  }

  let invocationClaim: Record<string, unknown>
  let request: Record<string, any>
  if (existing?.provider_invocation?.state === "CLAIMED") {
    invocationClaim = existing.provider_invocation
    if (!validProviderInvocationClaimV1(invocationClaim, build_request_identity, attempt_identity)) {
      return finish(unknown(build_request_identity, attempt_identity))
    }
    request = {}
  } else {
    if (!freshAdmissionAllowed) return finish(existing)
    if (!context) return finish(existing)
    request = {
      build_request_identity,
      attempt_identity,
      intent_identity: context.intent_identity,
      channel: PRODUCT_EDGE_GATEWAY,
    }
    let preparation: Record<string, unknown>
    try {
      preparation = await ownerPost("/v1/artifact-builds/prepare", token, request)
    } catch {
      return finish(unknown(build_request_identity, attempt_identity))
    }
    try {
      invocationClaim = await ownerPost(
        "/v1/artifact-builds/claim-provider-invocation",
        token,
        request,
      )
    } catch {
      return finish(unknown(build_request_identity, attempt_identity))
    }
    if (invocationClaim.disposition !== "CLAIMED_NEW"
      && invocationClaim.disposition !== "ALREADY_CLAIMED") {
      return finish(unknown(build_request_identity, attempt_identity))
    }
    if (!validProviderInvocationClaimEnvelopeV1(invocationClaim, build_request_identity, attempt_identity)) {
      return finish(unknown(build_request_identity, attempt_identity))
    }
    if (invocationClaim.state === "INVOCATION_STARTED") {
      if (invocationClaim.next_legal_action !== "MANUALLY_RECONCILE_PROVIDER_INVOCATION") {
        return finish(unknown(build_request_identity, attempt_identity))
      }
      return finish(unknown(build_request_identity, attempt_identity, invocationClaim))
    }
    if (!validProviderInvocationClaimV1(invocationClaim, build_request_identity, attempt_identity)) {
      return finish(unknown(build_request_identity, attempt_identity))
    }
    if (invocationClaim.disposition === "CLAIMED_NEW" && !validArtifactPreparationV1(
      preparation, build_request_identity, attempt_identity, context.intent_identity,
    )) {
      try {
        return finish(await resolve(token, build_request_identity, attempt_identity))
      } catch {
        return finish(unknown(build_request_identity, attempt_identity))
      }
    }
  }

  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    if (Object.keys(request).length === 0) return finish(existing)
    return finish(await fail(token, request, "NOT_CONFIGURED"))
  }
  const model = process.env.RD_EXECUTION_AGENT_MODEL || "deepseek-chat"
  let invocationStartEnvelope: Record<string, unknown>
  try {
    invocationStartEnvelope = await ownerPost(
      "/v1/artifact-builds/start-provider-invocation",
      token,
      {
        build_request_identity,
        attempt_identity,
        research_request_identity,
      },
    )
  } catch {
    try {
      return finish(await resolve(token, build_request_identity, attempt_identity))
    } catch {
      return finish(unknown(build_request_identity, attempt_identity))
    }
  }
  if (!await validProviderInvocationStartV1(
    invocationStartEnvelope,
    invocationClaim,
    build_request_identity,
    attempt_identity,
    research_request_identity,
    context,
  )) {
    return finish(unknown(build_request_identity, attempt_identity))
  }
  const executionCustody = invocationStartEnvelope.execution_custody as Record<string, any>
  context = contextFromExecutionCustodyV1(executionCustody, research_request_identity)
  if (!context) {
    try {
      return finish(await resolve(token, build_request_identity, attempt_identity))
    } catch {
      return finish(unknown(build_request_identity, attempt_identity))
    }
  }
  request = executionCustody.request
  const canonicalIntentBytes = executionCustody.canonical_intent_bytes as string
  const intentSemanticDigest = executionCustody.intent_semantic_digest as string
  const intentIdentity = request.intent_identity as string

  let generated: AgentCandidate
  try {
    generated = await generateCandidate(apiKey, model, canonicalIntentBytes)
  } catch (error) {
    if (error instanceof ProviderOutcomeUnknown) {
      try {
        return finish(await resolve(token, build_request_identity, attempt_identity))
      } catch {
        return finish(unknown(build_request_identity, attempt_identity))
      }
    }
    const code = error instanceof Error && ["PROVIDER_EMPTY", "CANDIDATE_MALFORMED"].includes(error.message)
      ? error.message
      : "PROVIDER_ERROR"
    return finish(await fail(token, request, code))
  }
  const candidateHash = await sha256(JSON.stringify(generated))
  const candidate = {
    schema_version: 1,
    candidate_identity: `agent-program-candidate-v1-${candidateHash.slice(0, 32)}`,
    intent_identity: intentIdentity,
    intent_semantic_digest: intentSemanticDigest,
    logic: generated.logic,
    structured_logic_summary: generated.structured_logic_summary,
    agent_change_explanation: generated.agent_change_explanation,
  }
  try {
    return finish(await ownerPost("/v1/artifact-builds/candidate", token, { request, candidate }))
  } catch {
    return finish(unknown(build_request_identity, attempt_identity))
  }
}

export async function main(
  action: Action,
  build_request_identity: string,
  attempt_identity: string,
  research_request_identity: string,
  identity_mode: IdentityMode,
) {
  let effectiveBuildRequestIdentity = build_request_identity
  let effectiveAttemptIdentity = attempt_identity
  if (action === "RUN" && identity_mode === "GENERATE") {
    const generated = await deriveGeneratedArtifactIdentitiesV1(
      build_request_identity,
      attempt_identity,
      research_request_identity,
    )
    if (!generated) return unknown(build_request_identity, attempt_identity)
    effectiveBuildRequestIdentity = generated.build_request_identity
    effectiveAttemptIdentity = generated.attempt_identity
  } else if (identity_mode !== "EXACT") {
    return unknown(build_request_identity, attempt_identity)
  }
  const token = process.env.RD_OWNER_API_TOKEN
  if (!token) return unknown(effectiveBuildRequestIdentity, effectiveAttemptIdentity)
  let s1Context: VerifiedS1ConsumerContextV1 | null = null
  try {
    s1Context = await resolveS1Context(token, research_request_identity)
  } catch {}
  const operation = await runOwnerOperation(
    action,
    effectiveBuildRequestIdentity,
    effectiveAttemptIdentity,
    research_request_identity,
    s1Context,
    action === "RUN" && identity_mode === "GENERATE",
  )
  const verificationContext = operation.context ?? await deriveVerifiedArtifactS1ContextV1(
    operation.raw,
    effectiveBuildRequestIdentity,
    effectiveAttemptIdentity,
    research_request_identity,
  )
  return await verifyArtifactConsumerProjectionV1(
    await deriveArtifactConsumerProjectionV1(
      operation.raw,
      effectiveBuildRequestIdentity,
      effectiveAttemptIdentity,
      verificationContext,
    ),
    effectiveBuildRequestIdentity,
    effectiveAttemptIdentity,
    verificationContext,
  )
}
