import assert from "node:assert/strict"
import test from "node:test"

const { executeArtifactBuildV1, invocationStateDigestV1 } = await import("./artifact_build_v1.ts")
const { projectArtifactOwnerResultWithEvidenceV1 } = await import("./consumer_projection_v1.ts")
const {
  providerInvocationClaimDigestV1,
  providerInvocationClaimIdentityV1,
  providerInvocationStateDigestV1,
} = await import("./provider_invocation_custody_v1.ts")

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function sealExecutionCustody(value) {
  const custody = structuredClone(value)
  const admission = custody.request.admission
  custody.request_semantic_digest = `sha256:${await sha256(JSON.stringify({
    build_request_identity: custody.request.build_request_identity,
    attempt_identity: custody.request.attempt_identity,
    intent_identity: custody.request.intent_identity,
    admission: {
      request_identity: admission.request_identity,
      admission_identity: admission.admission_identity,
      admission_digest: admission.admission_digest,
    },
  }))}`
  custody.execution_custody_digest = `sha256:${await sha256(JSON.stringify({
    schema_version: custody.schema_version,
    request: custody.request,
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
  custody.reservation_digest = `sha256:${await sha256(JSON.stringify({
    schema_version: 1,
    request_identity: custody.request.build_request_identity,
    admission_identity: admission.admission_identity,
    attempt_identity: custody.request.attempt_identity,
    claim_identity: custody.claim_identity,
    claim_digest: custody.claim_digest,
    invocation_admission_receipt_identity: custody.invocation_admission_receipt_identity,
    invocation_admission_receipt_digest: custody.invocation_admission_receipt_digest,
    claimed_state_digest: custody.claimed_state_digest,
    execution_custody_digest: custody.execution_custody_digest,
    reserved_at_epoch_ms: custody.reserved_at_epoch_ms,
  }))}`
  custody.reservation_identity = `rd-artifact-invocation-reservation-v1-${custody.reservation_digest.slice(7)}`
  return custody
}

const request = {
  action: "RESOLVE",
  build_request_identity: "build-1",
  attempt_identity: "attempt-1",
  research_request_identity: "research-1",
  identity_mode: "EXACT",
}

const dashboardUnavailable = {
  schema_version: 1,
  resolution: "UNAVAILABLE",
  unavailable_reason: "DASHBOARD_EFFECT_DISPATCH_NOT_ADMITTED",
  effect_boundary_crossed: false,
  build_request_identity: null,
  attempt_identity: null,
  owner_receipt: null,
  research_view: null,
  artifact_review: null,
  artifact_review_actions: null,
  trial_family_resolution: null,
  artifact_trial_family: null,
  next_legal_action: null,
  provider_invocation: null,
}

const unknown = {
  schema_version: 1,
  resolution: "SUBMITTED_OR_UNKNOWN",
  build_request_identity: "build-1",
  attempt_identity: "attempt-1",
  owner_receipt: null,
  research_view: null,
  artifact_review: null,
  artifact_review_actions: null,
  trial_family_resolution: null,
  artifact_trial_family: null,
  next_legal_action: "RESOLVE_SAME_ATTEMPT_IDENTITY",
  provider_invocation: null,
}

const runtime = (dispatcher, fetcher) => ({
  owner_url: "https://owner.example.test",
  owner_token: "test-owner-token",
  provider_url: "https://provider.example.test",
  provider_api_key: "test-provider-token",
  provider_model: "test-provider-model",
  dispatcher,
  fetcher,
})

for (const dashboardRequest of [
  request,
  { ...request, action: "RUN", identity_mode: "GENERATE" },
]) {
  test(`Dashboard ${dashboardRequest.action} artifact execution fails closed without any fetch`, async () => {
    let fetchCalls = 0
    const result = await executeArtifactBuildV1(dashboardRequest, runtime("TRADE_DASHBOARD", async () => {
      fetchCalls += 1
      throw new Error("Dashboard must not call Owner or provider")
    }))

    assert.equal(fetchCalls, 0)
    assert.deepEqual(result, dashboardUnavailable)
  })
}

test("Windmill RUN accepts the canonical Owner claim wire set and reaches invocation start", async () => {
  const claim = {
    schema_version: 1,
    request_identity: "build-1",
    claim_identity: "claim-1",
    admission_identity: "admission-1",
    attempt_identity: "attempt-1",
    invocation_admission_receipt_identity: "invocation-admission-receipt-1",
    invocation_admission_receipt_digest: "sha256:invocation-admission-receipt",
    claim_digest: "sha256:claim",
    state_digest: "",
    committed_at_epoch_ms: 10,
    disposition: "CLAIMED_NEW",
    state: "CLAIMED",
    next_legal_action: "RUN_BOUNDED_EXECUTION_AGENT",
  }
  claim.state_digest = await invocationStateDigestV1({
    ...claim,
    updated_at_epoch_ms: claim.committed_at_epoch_ms,
  })
  const start = {
    schema_version: 1,
    request_identity: "build-1",
    claim_identity: "claim-1",
    admission_identity: "admission-1",
    attempt_identity: "attempt-1",
    claim_digest: "sha256:claim",
    state_digest: "",
    started_at_epoch_ms: 11,
    disposition: "STARTED_NEW",
  }
  start.state_digest = await invocationStateDigestV1({
    ...start,
    state: "INVOCATION_STARTED",
    updated_at_epoch_ms: start.started_at_epoch_ms,
  })
  const executionCustody = await sealExecutionCustody({
    schema_version: 1,
    request: {
      build_request_identity: "build-1",
      attempt_identity: "attempt-1",
      intent_identity: "intent-1",
      channel: "WINDMILL_PRODUCT_EDGE",
      admission: {
        request_identity: "build-1",
        admission_identity: "admission-1",
        admission_digest: "sha256:admission",
      },
    },
    request_semantic_digest: "",
    canonical_intent_bytes: `${JSON.stringify({
      schema_version: 1,
      intent_identity: "intent-1",
      request_identity: "research-1",
      semantic_digest: "sha256:intent",
    })}\n`,
    intent_semantic_digest: "sha256:intent",
    research_request_identity: "research-1",
    research_valid_through_epoch_ms: 1_000,
    trial_family_identity: "family-1",
    trial_family_root_digest: "sha256:family-root",
    census_frontier_identity: "frontier-1",
    census_frontier_digest: "sha256:frontier",
    claim_identity: "claim-1",
    claim_digest: "sha256:claim",
    invocation_admission_receipt_identity: "invocation-admission-receipt-1",
    invocation_admission_receipt_digest: "sha256:invocation-admission-receipt",
    claimed_state_digest: claim.state_digest,
    reservation_identity: "",
    reservation_digest: "",
    reserved_at_epoch_ms: 10,
  })
  const calls = []
  const phases = []
  const reachedInvocationStart = new Error("REACHED_INVOCATION_START")
  const runRequest = { ...request, action: "RUN" }

  await assert.rejects(
    executeArtifactBuildV1(runRequest, {
      ...runtime("WINDMILL", async (url) => {
        const value = String(url)
        calls.push(value)
        if (value.endsWith("/v2/research-goals/research-1/resolve")) {
          return new Response("{}")
        }
        if (value.endsWith("/v1/artifact-builds/build-1/attempts/attempt-1/resolve")) {
          return new Response(JSON.stringify({ ...unknown, provider_invocation: claim }))
        }
        if (value.endsWith("/v1/artifact-builds/start-provider-invocation")) {
          return new Response(JSON.stringify({
            execution_custody: executionCustody,
            invocation_start: start,
          }))
        }
        throw new Error(`unexpected fetch ${value}`)
      }),
      observe_phase: async (phase) => {
        phases.push(phase)
        if (phase === "INVOCATION_STARTED") throw reachedInvocationStart
      },
    }),
    reachedInvocationStart,
  )

  assert.deepEqual(phases, ["OWNER_CLAIMED", "INVOCATION_STARTED"])
  assert.equal(calls.length, 3)
  assert.equal(Object.hasOwn(claim, "state_updated_at_epoch_ms"), false)
  assert.equal(calls.some((url) => url === "https://provider.example.test"), false)
})

test("canonical Owner CLAIMED wire projects verified invocation custody", async () => {
  const admissionIdentity = `product-edge-request-admission-v1-${"a".repeat(64)}`
  const invocationAdmissionReceiptIdentity =
    `product-edge-provider-invocation-admission-receipt-v1-${"b".repeat(64)}`
  const claimIdentity = await providerInvocationClaimIdentityV1(
    admissionIdentity,
    request.attempt_identity,
    invocationAdmissionReceiptIdentity,
  )
  const claim = {
    schema_version: 1,
    request_identity: request.build_request_identity,
    claim_identity: claimIdentity,
    admission_identity: admissionIdentity,
    attempt_identity: request.attempt_identity,
    invocation_admission_receipt_identity: invocationAdmissionReceiptIdentity,
    invocation_admission_receipt_digest: `sha256:${"c".repeat(64)}`,
    claim_digest: "",
    state_digest: "",
    committed_at_epoch_ms: 10,
    disposition: "CLAIMED_NEW",
    state: "CLAIMED",
    next_legal_action: "RUN_BOUNDED_EXECUTION_AGENT",
  }
  claim.claim_digest = await providerInvocationClaimDigestV1(claim)
  claim.state_digest = await providerInvocationStateDigestV1({
    ...claim,
    updated_at_epoch_ms: claim.committed_at_epoch_ms,
  })

  const raw = {
    ...unknown,
    provider_invocation: claim,
    next_legal_action: "RUN_BOUNDED_EXECUTION_AGENT",
  }
  const result = await projectArtifactOwnerResultWithEvidenceV1(
    raw,
    request.build_request_identity,
    request.attempt_identity,
    null,
  )

  assert.equal(Object.hasOwn(claim, "state_updated_at_epoch_ms"), false)
  assert.equal(result.verified, true)
  assert.deepEqual(result.projection.provider_invocation, claim)
  assert.equal(result.projection.next_legal_action, "RUN_BOUNDED_EXECUTION_AGENT")
})

test("Windmill artifact resolution keeps the existing Owner flow", async () => {
  const calls = []
  const result = await executeArtifactBuildV1(request, runtime("WINDMILL", async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers) })
    return new Response(JSON.stringify(unknown))
  }))

  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, "https://owner.example.test/v2/research-goals/research-1/resolve")
  assert.equal(calls[1].url, "https://owner.example.test/v1/artifact-builds/build-1/attempts/attempt-1/resolve")
  assert.equal(calls[0].headers.has("x-trade-effect-dispatcher"), false)
  assert.equal(calls[1].headers.has("x-trade-effect-dispatcher"), false)
  assert.equal(result.resolution, "SUBMITTED_OR_UNKNOWN")
  assert.equal(result.build_request_identity, "build-1")
  assert.equal(result.attempt_identity, "attempt-1")
  assert.equal(result.next_legal_action, "RESOLVE_SAME_ATTEMPT_IDENTITY")
})
