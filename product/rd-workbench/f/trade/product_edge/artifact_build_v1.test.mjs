import assert from "node:assert/strict"
import test from "node:test"
import { pathToFileURL } from "node:url"

const intentDigest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const intentIdentity = "rd-research-intent-v2-d06b72fe795a6f42e0bb7c65b807679be2d8d3cacf4a19938560bfb6624625b8"
const basisDigest = "sha256:5fbd1b3619c4fff5bdbbab0b5fb82c94f27d5edf4883e14a3e2c9e9aa58db6b1"
const basisIdentity = "rd-independence-basis-v1-5fbd1b3619c4fff5bdbbab0b5fb82c94f27d5edf4883e14a3e2c9e9aa58db6b1"
const feedbackDigest = "sha256:cb2538ef46693c5923d6ec443cc439398d39f59deedc1ad8b75fabf5594d6bc5"
const feedbackIdentity = "qualification-protected-feedback-frontier-v1-cb2538ef46693c5923d6ec443cc439398d39f59deedc1ad8b75fabf5594d6bc5"
const familyIdentity = "rd-trial-family-v1-cc6af1a3a29d5d6b5a57cf192cfbff7b8f772fcfc1c036650c180b0c5c850bc2"
const policyDigest = "sha256:67747818438bf4dd765190db1e4f4cc7af82b19793bb0d43cf31ee161a54a5ee"
const rootDigest = "sha256:246564eb3fcd0aaa64e455f2b76bd138c7501471de154c39fdb07f9df6cfc331"
const memberDigest = "sha256:e243e54e142194e109fae89a0cac8e8af58e8724f6f86886544d9265539fdafd"
const frontierDigest = "sha256:73ec89ca5d972ffc1e5eee2612365254950ca4d7677ee2f0b7a776d420498dbd"
const frontierIdentity = "rd-trial-family-frontier-v1-73ec89ca5d972ffc1e5eee2612365254950ca4d7677ee2f0b7a776d420498dbd"

const { deriveGeneratedArtifactIdentitiesV1, invocationStateDigestV1, main } = await import(
  pathToFileURL(new URL("./artifact_build_v1.ts", import.meta.url).pathname)
)

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

const preparation = {
  schema_version: 1,
  resolution: "PREPARED",
  build_request_identity: "build-1",
  attempt_identity: "attempt-1",
  semantic_digest: "sha256:request",
  canonical_intent_bytes: "{\"intent\":1}",
  intent_identity: intentIdentity,
  intent_semantic_digest: intentDigest,
  owner_receipt: null,
  next_legal_action: "RUN_BOUNDED_EXECUTION_AGENT",
}
const claim = {
  schema_version: 1,
  request_identity: "build-1",
  claim_identity: "claim-1",
  admission_identity: "admission-1",
  attempt_identity: "attempt-1",
  invocation_admission_receipt_identity: "invocation-admission-receipt-1",
  invocation_admission_receipt_digest: "sha256:invocation-admission-receipt",
  claim_digest: "sha256:claim",
  state_digest: "sha256:claimed",
  committed_at_epoch_ms: 10,
  disposition: "CLAIMED_NEW",
  state: "CLAIMED",
  next_legal_action: "RUN_BOUNDED_EXECUTION_AGENT",
}
const start = {
  schema_version: 1,
  request_identity: "build-1",
  claim_identity: "claim-1",
  admission_identity: "admission-1",
  attempt_identity: "attempt-1",
  claim_digest: "sha256:claim",
  state_digest: "sha256:started",
  started_at_epoch_ms: 11,
  disposition: "STARTED_NEW",
}
claim.state_digest = await invocationStateDigestV1({
  schema_version: claim.schema_version,
  claim_identity: claim.claim_identity,
  admission_identity: claim.admission_identity,
  attempt_identity: claim.attempt_identity,
  claim_digest: claim.claim_digest,
  state: "CLAIMED",
  state_digest: "",
  updated_at_epoch_ms: claim.committed_at_epoch_ms,
})
start.state_digest = await invocationStateDigestV1({
  schema_version: start.schema_version,
  claim_identity: start.claim_identity,
  admission_identity: start.admission_identity,
  attempt_identity: start.attempt_identity,
  claim_digest: start.claim_digest,
  state: "INVOCATION_STARTED",
  state_digest: "",
  updated_at_epoch_ms: start.started_at_epoch_ms,
})
const executionCustody = await sealExecutionCustody({
  schema_version: 1,
  request: {
    build_request_identity: "build-1",
    attempt_identity: "attempt-1",
    intent_identity: intentIdentity,
    channel: "WINDMILL_PRODUCT_EDGE",
    admission: {
      request_identity: "build-1",
      admission_identity: "admission-1",
      admission_digest: "sha256:admission",
    },
  },
  request_semantic_digest: "sha256:request",
  canonical_intent_bytes: `${JSON.stringify({
    schema_version: 2,
    intent_identity: intentIdentity,
    request_identity: "request-1",
    semantic_digest: intentDigest,
    trial_family_identity: familyIdentity,
  })}\n`,
  intent_semantic_digest: intentDigest,
  research_request_identity: "request-1",
  research_valid_through_epoch_ms: 600095,
  trial_family_identity: familyIdentity,
  trial_family_root_digest: rootDigest,
  census_frontier_identity: frontierIdentity,
  census_frontier_digest: frontierDigest,
  claim_identity: "claim-1",
  claim_digest: "sha256:claim",
  invocation_admission_receipt_identity: "invocation-admission-receipt-1",
  invocation_admission_receipt_digest: "sha256:invocation-admission-receipt",
  claimed_state_digest: claim.state_digest,
  reservation_identity: "reservation-1",
  reservation_digest: "sha256:reservation",
  reserved_at_epoch_ms: 10,
})
const unclaimed = {
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

const s1Response = {
  schema_version: 2,
  resolution: "ACCEPTED",
  request_identity: "request-1",
  owner_receipt: {
    schema_version: 1, receipt_identity: "rd-research-request-receipt-v2-d06b72fe795a6f42e0bb7c65b807679be2d8d3cacf4a19938560bfb6624625b8", request_identity: "request-1",
    semantic_digest: intentDigest, disposition: "ACCEPTED",
    resulting_research_intent_identity: intentIdentity, committed_at_epoch_ms: 100, rejection_code: null,
  },
  research_view: {
    schema_version: 1,
    projection_identity: "rd-research-view-v2-225c635a02b5f8c203c355ef1a08e6f9bd6eb58c5c63d0819f9aac1725d4708d",
    request_identity: "request-1",
    trusted_principal: "principal-1", authorized_scope: ["research:submit"],
    authorization_policy_cut: "authorization-cut-1", source_owner: "R_AND_D",
    source_cut: "rd-source-cut-v2-d06b72fe795a6f42e0bb7c65b807679be2d8d3cacf4a19938560bfb6624625b8",
    observed_at_epoch_ms: 100, projection_at_epoch_ms: 100, valid_through_epoch_ms: 600095,
    availability: "AVAILABLE", phase: "INTENT_FROZEN", intent_identity: intentIdentity,
    source_frontier: [{ locator: "https://example.test/source", content_digest: "sha256:source",
      observed_at: "2026-08-22T00:00:00Z", source_cut: "source-cut-1", license_basis: "test",
      interpretation: "test interpretation" }], next_legal_action: "WAIT_FOR_R_AND_D_EXECUTION",
  },
  independence_basis: {
    schema_version: 1, basis_identity: basisIdentity, request_identity: "request-1", principal: "principal-1",
    request_scope: ["research:submit"], rationale_digest: "sha256:b6d9ce3ef56cd70624a2d3a89e1bb57a644751224a42560fd1bd781db979dd1b",
    independence_disposition: "INDEPENDENT", lineage_resolution: "GENESIS_EMPTY",
    semantic_predecessor_frontier: [], lineage_digest: "sha256:5511c7f9277fe1cccc26d418c56a88f45d24aedaad67d9f4ffade1b851927892", basis_digest: basisDigest,
    receipt: { schema_version: 1, receipt_identity: "rd-independence-basis-receipt-v1-d2c7580a5d232709b9857710d8eec94e5aada76ff3262da5fbfc5b91c1c39783", basis_identity: basisIdentity,
      basis_digest: basisDigest, committed_at_epoch_ms: 90 },
  },
  protected_feedback: {
    schema_version: 1, projection_identity: feedbackIdentity, projection_digest: feedbackDigest,
    resolution: "GENESIS_EMPTY", principal: "principal-1", request_scope: ["research:submit"],
    basis_identity: basisIdentity, basis_digest: basisDigest, source_sequence: 0,
    source_cut: "qualification-protected-feedback-cut-v1-0", source_frontier_identity: null, source_frontier_digest: null,
    clock_epoch: "unix-epoch-ms-v1", projection_at_epoch_ms: 95, valid_through_epoch_ms: 600095,
    receipt: { schema_version: 1,
      receipt_identity: "qualification-protected-feedback-frontier-receipt-v1-6600f9fb628ced7b2e6148956881c2798ed2cab26f2300c8853c3be06ecf3972",
      projection_identity: feedbackIdentity, projection_digest: feedbackDigest, committed_at_epoch_ms: 95 },
  },
  trial_family_resolution: "AVAILABLE",
  trial_family: {
    root: { schema_version: 1, trial_family_identity: familyIdentity, policy: {
      trial_budget: 8, stop_rule: "stop", pit_rule_identity: "pit-1", cost_model_identity: "cost-1",
      slippage_model_identity: "slippage-1", capacity_model_identity: "capacity-1",
      semantic_predecessor_frontier: [], protected_feedback_frontier: feedbackIdentity,
      independence_disposition: "INDEPENDENT", independence_basis_identity: basisIdentity,
      frozen_falsifier_binding: "falsifier-1",
    }, policy_digest: policyDigest, root_digest: rootDigest, created_at_epoch_ms: 100 },
    root_receipt: { schema_version: 1, receipt_identity: `rd-trial-family-root-receipt-v1-${rootDigest.slice(7)}`,
      trial_family_identity: familyIdentity, intent_identity: intentIdentity, root_digest: rootDigest,
      committed_at_epoch_ms: 100 },
    initial_intent_member: { schema_version: 1,
      member_identity: `rd-trial-family-member-v1-${memberDigest.slice(7)}`, trial_family_identity: familyIdentity,
      member_kind: "INTENT", fact_identity: intentIdentity, fact_digest: intentDigest, ordinal: 0,
      member_digest: memberDigest },
    membership_receipt: { schema_version: 1,
      receipt_identity: `rd-trial-family-membership-receipt-v1-${memberDigest.slice(7)}`,
      trial_family_identity: familyIdentity, member_identity: `rd-trial-family-member-v1-${memberDigest.slice(7)}`,
      member_digest: memberDigest,
      committed_at_epoch_ms: 100 },
    census_frontier: { schema_version: 1, frontier_identity: frontierIdentity,
      trial_family_identity: familyIdentity, root_digest: rootDigest, member_digests: [memberDigest],
      consumed_trial_budget: 1, frontier_digest: frontierDigest },
  },
  next_legal_action: "WAIT_FOR_R_AND_D_EXECUTION",
}

const researchResolve = (value) => value.includes("/v2/research-goals/request-1/resolve")

async function runWith(
  startMutation,
  claimMutation = (value) => value,
  custodyMutation = (value) => value,
) {
  const originalFetch = globalThis.fetch
  const originalToken = process.env.RD_OWNER_API_TOKEN
  const originalKey = process.env.DEEPSEEK_API_KEY
  let providerCalls = 0
  globalThis.fetch = async (url) => {
    const value = String(url)
    if (researchResolve(value)) return new Response(JSON.stringify(s1Response))
    if (value.includes("/resolve")) return new Response(JSON.stringify({
      ...unclaimed,
      provider_invocation: claimMutation({ ...claim, disposition: "ALREADY_CLAIMED" }),
    }))
    if (value.includes("/prepare")) return new Response(JSON.stringify(preparation))
    if (value.includes("/claim-provider-invocation")) {
      return new Response(JSON.stringify(claimMutation({ ...claim })))
    }
    if (value.includes("/start-provider-invocation")) {
      return new Response(JSON.stringify({
        invocation_start: startMutation({ ...start }),
        execution_custody: custodyMutation(structuredClone(executionCustody)),
      }))
    }
    if (value.includes("api.deepseek.com")) {
      providerCalls += 1
      throw new Error("provider must not be called")
    }
    throw new Error(`unexpected request ${value}`)
  }
  process.env.RD_OWNER_API_TOKEN = "test-token"
  process.env.DEEPSEEK_API_KEY = "test-provider-key"
  try {
    const result = await main("RUN", "build-1", "attempt-1", "request-1", "EXACT")
    return { result, providerCalls }
  } finally {
    globalThis.fetch = originalFetch
    if (originalToken === undefined) delete process.env.RD_OWNER_API_TOKEN
    else process.env.RD_OWNER_API_TOKEN = originalToken
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = originalKey
  }
}

for (const [name, mutate] of [
  ["empty invocation admission receipt identity", (value) => ({ ...value, invocation_admission_receipt_identity: "" })],
  ["empty invocation admission receipt digest", (value) => ({ ...value, invocation_admission_receipt_digest: "" })],
  ["non-string invocation admission receipt identity", (value) => ({ ...value, invocation_admission_receipt_identity: 1 })],
  ["non-string invocation admission receipt digest", (value) => ({ ...value, invocation_admission_receipt_digest: 1 })],
  ["missing invocation admission receipt identity", ({ invocation_admission_receipt_identity: _, ...value }) => value],
  ["missing invocation admission receipt digest", ({ invocation_admission_receipt_digest: _, ...value }) => value],
  ["extra claim field", (value) => ({ ...value, extra: true })],
  ["started-new existing claim", (value) => ({
    ...value, disposition: "CLAIMED_NEW", state: "INVOCATION_STARTED",
    next_legal_action: "MANUALLY_RECONCILE_PROVIDER_INVOCATION",
  })],
]) {
  test(`${name} claim readback returns same-attempt unknown with zero provider call`, async () => {
    const { result, providerCalls } = await runWith((value) => value, mutate)
    assert.equal(providerCalls, 0)
    assert.equal(result.resolution, "SUBMITTED_OR_UNKNOWN")
    assert.equal(result.next_legal_action, "RESOLVE_SAME_ATTEMPT_IDENTITY")
    assert.equal(result.provider_invocation, null)
  })
}

for (const [name, mutate] of [
  ["foreign admission", (value) => ({
    ...value,
    request: { ...value.request, admission: { ...value.request.admission, request_identity: "build-2" } },
  })],
  ["foreign intent", (value) => ({ ...value, request: { ...value.request, intent_identity: "intent-2" } })],
  ["foreign research request", (value) => ({ ...value, research_request_identity: "request-2" })],
  ["foreign TrialFamily", (value) => ({ ...value, trial_family_identity: "family-2" })],
  ["foreign Census frontier", (value) => ({ ...value, census_frontier_identity: "frontier-2" })],
  ["expired before reservation", (value) => ({ ...value, research_valid_through_epoch_ms: 10 })],
]) {
  test(`${name} execution custody returns same-attempt unknown with zero provider call`, async () => {
    const { result, providerCalls } = await runWith((value) => value, (value) => value, mutate)
    assert.equal(providerCalls, 0)
    assert.equal(result.resolution, "SUBMITTED_OR_UNKNOWN")
    assert.equal(result.build_request_identity, "build-1")
    assert.equal(result.attempt_identity, "attempt-1")
    assert.equal(result.next_legal_action, "RESOLVE_SAME_ATTEMPT_IDENTITY")
  })
}

for (const [name, mutate] of [
  ["wrong request", (value) => ({ ...value, request_identity: "build-2" })],
  ["wrong attempt", (value) => ({ ...value, attempt_identity: "attempt-2" })],
  ["wrong claim", (value) => ({ ...value, claim_identity: "claim-2" })],
  ["wrong digest", (value) => ({ ...value, claim_digest: "sha256:wrong" })],
  ["non-canonical state digest", (value) => ({ ...value, state_digest: "sha256:arbitrary-cross-spliced-start" })],
  ["wrong version", (value) => ({ ...value, schema_version: 2 })],
  ["missing admission", ({ admission_identity: _, ...value }) => value],
]) {
  test(`${name} start readback returns same-attempt unknown with zero provider call`, async () => {
    const { result, providerCalls } = await runWith(mutate)
    assert.equal(providerCalls, 0)
    assert.equal(result.resolution, "SUBMITTED_OR_UNKNOWN")
    assert.equal(result.build_request_identity, "build-1")
    assert.equal(result.attempt_identity, "attempt-1")
    assert.equal(result.next_legal_action, "RESOLVE_SAME_ATTEMPT_IDENTITY")
    assert.equal(result.provider_invocation, null)
  })
}

test("GENERATE derives canonical identities and performs one fresh admission", async () => {
  const originalFetch = globalThis.fetch
  const originalToken = process.env.RD_OWNER_API_TOKEN
  const originalKey = process.env.DEEPSEEK_API_KEY
  const generated = await deriveGeneratedArtifactIdentitiesV1("build-seed-1", "attempt-seed-1", "request-1")
  assert.ok(generated)
  let prepareCalls = 0
  let claimCalls = 0
  let failCalls = 0
  globalThis.fetch = async (url) => {
    const value = String(url)
    if (researchResolve(value)) return new Response(JSON.stringify(s1Response))
    if (value.includes("/resolve")) return new Response(JSON.stringify({
      ...unclaimed,
      build_request_identity: generated.build_request_identity,
      attempt_identity: generated.attempt_identity,
    }))
    if (value.includes("/prepare")) {
      prepareCalls += 1
      return new Response(JSON.stringify({
        ...preparation,
        build_request_identity: generated.build_request_identity,
        attempt_identity: generated.attempt_identity,
      }))
    }
    if (value.includes("/claim-provider-invocation")) {
      claimCalls += 1
      return new Response(JSON.stringify({
        ...claim,
        request_identity: generated.build_request_identity,
        attempt_identity: generated.attempt_identity,
      }))
    }
    if (value.includes("/fail")) {
      failCalls += 1
      return new Response(JSON.stringify({
        ...unclaimed,
        build_request_identity: generated.build_request_identity,
        attempt_identity: generated.attempt_identity,
      }))
    }
    throw new Error(`unexpected request ${value}`)
  }
  process.env.RD_OWNER_API_TOKEN = "test-token"
  delete process.env.DEEPSEEK_API_KEY
  try {
    const result = await main("RUN", "build-seed-1", "attempt-seed-1", "request-1", "GENERATE")
    assert.equal(result.build_request_identity, generated.build_request_identity)
    assert.equal(result.attempt_identity, generated.attempt_identity)
    assert.notEqual(result.build_request_identity, "build-seed-1")
    assert.notEqual(result.attempt_identity, "attempt-seed-1")
    assert.equal(prepareCalls, 1)
    assert.equal(claimCalls, 1)
    assert.equal(failCalls, 1)
  } finally {
    globalThis.fetch = originalFetch
    if (originalToken === undefined) delete process.env.RD_OWNER_API_TOKEN
    else process.env.RD_OWNER_API_TOKEN = originalToken
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = originalKey
  }
})

test("cross-spliced Research family cannot authorize a fresh admission or provider", async () => {
  const originalFetch = globalThis.fetch
  const originalToken = process.env.RD_OWNER_API_TOKEN
  const originalKey = process.env.DEEPSEEK_API_KEY
  const spliced = structuredClone(s1Response)
  spliced.trial_family.census_frontier.frontier_identity = "frontier-spliced"
  let artifactResolveCalls = 0
  let ownerMutationCalls = 0
  let providerCalls = 0
  globalThis.fetch = async (url) => {
    const value = String(url)
    if (researchResolve(value)) return new Response(JSON.stringify(spliced))
    if (value.includes("/resolve")) {
      artifactResolveCalls += 1
      return new Response(JSON.stringify(unclaimed))
    }
    if (value.includes("api.deepseek.com")) providerCalls += 1
    else ownerMutationCalls += 1
    throw new Error(`unexpected request ${value}`)
  }
  process.env.RD_OWNER_API_TOKEN = "test-token"
  process.env.DEEPSEEK_API_KEY = "test-key"
  try {
    const result = await main("RUN", "build-seed-1", "attempt-seed-1", "request-1", "GENERATE")
    assert.equal(result.resolution, "SUBMITTED_OR_UNKNOWN")
    assert.equal(artifactResolveCalls, 1)
    assert.equal(ownerMutationCalls, 0)
    assert.equal(providerCalls, 0)
  } finally {
    globalThis.fetch = originalFetch
    if (originalToken === undefined) delete process.env.RD_OWNER_API_TOKEN
    else process.env.RD_OWNER_API_TOKEN = originalToken
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = originalKey
  }
})

test("EXACT vacant imported identities can only resolve and never borrow live S1", async () => {
  const originalFetch = globalThis.fetch
  const originalToken = process.env.RD_OWNER_API_TOKEN
  const originalKey = process.env.DEEPSEEK_API_KEY
  let resolveCalls = 0
  let researchResolveCalls = 0
  let mutatingCalls = 0
  globalThis.fetch = async (url) => {
    const value = String(url)
    if (researchResolve(value)) {
      researchResolveCalls += 1
      return new Response(JSON.stringify(s1Response))
    }
    if (value.includes("/artifact-builds/") && value.includes("/resolve")) {
      resolveCalls += 1
      return new Response(JSON.stringify(unclaimed))
    }
    mutatingCalls += 1
    throw new Error(`unexpected request ${value}`)
  }
  process.env.RD_OWNER_API_TOKEN = "test-token"
  process.env.DEEPSEEK_API_KEY = "test-provider-key"
  try {
    const result = await main("RUN", "build-1", "attempt-1", "request-1", "EXACT")
    assert.equal(result.resolution, "SUBMITTED_OR_UNKNOWN")
    assert.equal(researchResolveCalls, 1)
    assert.equal(resolveCalls, 1)
    assert.equal(mutatingCalls, 0)
  } finally {
    globalThis.fetch = originalFetch
    if (originalToken === undefined) delete process.env.RD_OWNER_API_TOKEN
    else process.env.RD_OWNER_API_TOKEN = originalToken
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = originalKey
  }
})

test("lost start response resolves exact started custody and exposes manual reconciliation only", async () => {
  const originalFetch = globalThis.fetch
  const originalToken = process.env.RD_OWNER_API_TOKEN
  const originalKey = process.env.DEEPSEEK_API_KEY
  let providerCalls = 0
  let resolveCalls = 0
  const started = {
    ...claim,
    disposition: "ALREADY_CLAIMED",
    state: "INVOCATION_STARTED",
    state_digest: "sha256:started",
    next_legal_action: "MANUALLY_RECONCILE_PROVIDER_INVOCATION",
  }
  const resolved = {
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
    provider_invocation: started,
  }
  globalThis.fetch = async (url) => {
    const value = String(url)
    if (researchResolve(value)) return new Response(JSON.stringify(s1Response))
    if (value.includes("/resolve")) {
      resolveCalls += 1
      return new Response(JSON.stringify(resolveCalls === 1 ? {
        ...unclaimed,
        provider_invocation: { ...claim, disposition: "ALREADY_CLAIMED" },
      } : resolved))
    }
    if (value.includes("/prepare")) return new Response(JSON.stringify(preparation))
    if (value.includes("/claim-provider-invocation")) return new Response(JSON.stringify(claim))
    if (value.includes("/start-provider-invocation")) throw new Error("response lost after commit")
    if (value.includes("api.deepseek.com")) {
      providerCalls += 1
      throw new Error("provider must not be called")
    }
    throw new Error(`unexpected request ${value}`)
  }
  process.env.RD_OWNER_API_TOKEN = "test-token"
  process.env.DEEPSEEK_API_KEY = "test-provider-key"
  try {
    const result = await main("RUN", "build-1", "attempt-1", "request-1", "EXACT")
    assert.equal(providerCalls, 0)
    assert.equal(result.resolution, "SUBMITTED_OR_UNKNOWN")
    assert.equal(result.next_legal_action, "MANUALLY_RECONCILE_PROVIDER_INVOCATION")
    assert.equal(result.provider_invocation.request_identity, "build-1")
    assert.equal(result.provider_invocation.admission_identity, "admission-1")
    assert.equal(result.provider_invocation.attempt_identity, "attempt-1")
    assert.equal(result.provider_invocation.claim_identity, "claim-1")
    assert.equal(result.provider_invocation.invocation_admission_receipt_identity, "invocation-admission-receipt-1")
    assert.equal(result.provider_invocation.invocation_admission_receipt_digest, "sha256:invocation-admission-receipt")
    assert.equal(result.provider_invocation.state_digest, "sha256:started")
  } finally {
    globalThis.fetch = originalFetch
    if (originalToken === undefined) delete process.env.RD_OWNER_API_TOKEN
    else process.env.RD_OWNER_API_TOKEN = originalToken
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = originalKey
  }
})

test("an existing sealed claim starts once after preparation authority becomes stale", async () => {
  const originalFetch = globalThis.fetch
  const originalToken = process.env.RD_OWNER_API_TOKEN
  const originalKey = process.env.DEEPSEEK_API_KEY
  let startCalls = 0
  let startResearchRequestIdentity = null
  let providerCalls = 0
  let failCalls = 0
  let resolveCalls = 0
  const stalePreparation = {
    ...preparation,
    resolution: "SUBMITTED_OR_UNKNOWN",
    next_legal_action: "RESOLVE_SAME_ATTEMPT_IDENTITY",
  }
  const recoveredClaim = { ...claim, disposition: "ALREADY_CLAIMED" }
  globalThis.fetch = async (url, options) => {
    const value = String(url)
    if (researchResolve(value)) return new Response(JSON.stringify(s1Response))
    if (value.includes("/resolve")) {
      resolveCalls += 1
      if (resolveCalls === 1) return new Response(JSON.stringify({
        ...unclaimed,
        provider_invocation: recoveredClaim,
      }))
      return new Response(JSON.stringify({
        ...unclaimed,
        provider_invocation: {
          ...recoveredClaim,
          state: "INVOCATION_STARTED",
          state_digest: "sha256:started",
          next_legal_action: "MANUALLY_RECONCILE_PROVIDER_INVOCATION",
        },
      }))
    }
    if (value.includes("/prepare")) return new Response(JSON.stringify(stalePreparation))
    if (value.includes("/claim-provider-invocation")) return new Response(JSON.stringify(recoveredClaim))
    if (value.includes("/start-provider-invocation")) {
      startCalls += 1
      startResearchRequestIdentity = JSON.parse(options.body).research_request_identity
      return new Response(JSON.stringify({
        invocation_start: start,
        execution_custody: executionCustody,
      }))
    }
    if (value.includes("api.deepseek.com")) {
      providerCalls += 1
      throw new Error("provider failure after sealed start")
    }
    if (value.includes("/fail")) {
      failCalls += 1
      return new Response(JSON.stringify({
        schema_version: 1,
        resolution: "SUBMITTED_OR_UNKNOWN",
        build_request_identity: "build-1",
        attempt_identity: "attempt-1",
        owner_receipt: null,
        research_view: null,
        artifact_review: null,
        artifact_review_actions: null,
        next_legal_action: "RESOLVE_SAME_ATTEMPT_IDENTITY",
      }))
    }
    throw new Error(`unexpected request ${value}`)
  }
  process.env.RD_OWNER_API_TOKEN = "test-token"
  process.env.DEEPSEEK_API_KEY = "test-provider-key"
  try {
    const result = await main("RUN", "build-1", "attempt-1", "request-1", "EXACT")
    assert.equal(startCalls, 1)
    assert.equal(startResearchRequestIdentity, "request-1")
    assert.equal(providerCalls, 1)
    assert.equal(resolveCalls, 2)
    assert.equal(failCalls, 0)
    assert.equal(result.resolution, "SUBMITTED_OR_UNKNOWN")
    assert.equal(result.next_legal_action, "MANUALLY_RECONCILE_PROVIDER_INVOCATION")
  } finally {
    globalThis.fetch = originalFetch
    if (originalToken === undefined) delete process.env.RD_OWNER_API_TOKEN
    else process.env.RD_OWNER_API_TOKEN = originalToken
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = originalKey
  }
})

test("recovered claimed custody starts directly when current S1 is unavailable", async () => {
  const originalFetch = globalThis.fetch
  const originalToken = process.env.RD_OWNER_API_TOKEN
  const originalKey = process.env.DEEPSEEK_API_KEY
  let prepareCalls = 0
  let claimCalls = 0
  let startCalls = 0
  let providerCalls = 0
  let candidateCalls = 0
  const recoveredClaim = { ...claim, disposition: "ALREADY_CLAIMED" }
  globalThis.fetch = async (url) => {
    const value = String(url)
    if (researchResolve(value)) throw new Error("current S1 unavailable")
    if (value.includes("/resolve")) return new Response(JSON.stringify({
      ...unclaimed,
      provider_invocation: recoveredClaim,
    }))
    if (value.includes("/prepare")) {
      prepareCalls += 1
      throw new Error("recovered claim must not prepare")
    }
    if (value.includes("/claim-provider-invocation")) {
      claimCalls += 1
      throw new Error("recovered claim must not be replaced")
    }
    if (value.includes("/start-provider-invocation")) {
      startCalls += 1
      return new Response(JSON.stringify({
        invocation_start: start,
        execution_custody: executionCustody,
      }))
    }
    if (value.includes("api.deepseek.com")) {
      providerCalls += 1
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        logic: { signal: "MOMENTUM", direction: "LONG_ONLY", lookback_bars: 20,
          entry_threshold_bps: 10, exit_threshold_bps: 5 },
        structured_logic_summary: "bounded recovered strategy candidate",
        agent_change_explanation: "generated from sealed historical intent custody",
      }) } }] }))
    }
    if (value.includes("/candidate")) {
      candidateCalls += 1
      return new Response(JSON.stringify(resolveCalls === 1 ? {
        ...unclaimed,
        provider_invocation: { ...claim, disposition: "ALREADY_CLAIMED" },
      } : unclaimed))
    }
    throw new Error(`unexpected request ${value}`)
  }
  process.env.RD_OWNER_API_TOKEN = "test-token"
  process.env.DEEPSEEK_API_KEY = "test-provider-key"
  try {
    const result = await main("RUN", "build-1", "attempt-1", "request-1", "EXACT")
    assert.equal(prepareCalls, 0)
    assert.equal(claimCalls, 0)
    assert.equal(startCalls, 1)
    assert.equal(providerCalls, 1)
    assert.equal(candidateCalls, 1)
    assert.equal(result.resolution, "SUBMITTED_OR_UNKNOWN")
  } finally {
    globalThis.fetch = originalFetch
    if (originalToken === undefined) delete process.env.RD_OWNER_API_TOKEN
    else process.env.RD_OWNER_API_TOKEN = originalToken
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = originalKey
  }
})

test("terminal Owner receipt wins before prepare claim or invocation state", async () => {
  const originalFetch = globalThis.fetch
  const originalToken = process.env.RD_OWNER_API_TOKEN
  const originalKey = process.env.DEEPSEEK_API_KEY
  let prepareCalls = 0
  let claimCalls = 0
  let startCalls = 0
  let providerCalls = 0
  const terminal = {
    ...unclaimed,
    resolution: "FAILED_NO_ARTIFACT",
    owner_receipt: {
      schema_version: 1,
      receipt_identity: "rd-artifact-build-receipt-v1-36422525a71b86c6876cf03b3247ece9a4887c9e93b4401c86cc72166e1b7ebd",
      build_request_identity: "build-1",
      attempt_identity: "attempt-1",
      request_semantic_digest: "sha256:request",
      intent_identity: intentIdentity,
      intent_semantic_digest: intentDigest,
      disposition: "FAILED_NO_ARTIFACT",
      artifact_identity: null,
      build_receipt_identity: null,
      failure_code: "PROVIDER_ERROR",
      committed_at_epoch_ms: 110,
    },
    research_view: s1Response.research_view,
    next_legal_action: "CREATE_SUCCESSOR_BUILD_REQUEST",
    provider_invocation: {
      ...claim,
      disposition: "ALREADY_CLAIMED",
      state: "INVOCATION_STARTED",
      state_digest: "sha256:started",
      next_legal_action: "MANUALLY_RECONCILE_PROVIDER_INVOCATION",
    },
  }
  globalThis.fetch = async (url) => {
    const value = String(url)
    if (researchResolve(value)) return new Response(JSON.stringify(s1Response))
    if (value.includes("/resolve")) return new Response(JSON.stringify(terminal))
    if (value.includes("/prepare")) prepareCalls += 1
    if (value.includes("/claim-provider-invocation")) claimCalls += 1
    if (value.includes("/start-provider-invocation")) startCalls += 1
    if (value.includes("api.deepseek.com")) providerCalls += 1
    throw new Error(`unexpected request ${value}`)
  }
  process.env.RD_OWNER_API_TOKEN = "test-token"
  process.env.DEEPSEEK_API_KEY = "test-provider-key"
  try {
    const result = await main("RUN", "build-1", "attempt-1", "request-1", "EXACT")
    assert.equal(result.resolution, "FAILED_NO_ARTIFACT")
    assert.equal(result.owner_receipt.receipt_identity,
      "rd-artifact-build-receipt-v1-36422525a71b86c6876cf03b3247ece9a4887c9e93b4401c86cc72166e1b7ebd")
    assert.equal(result.provider_invocation, null)
    assert.equal(prepareCalls, 0)
    assert.equal(claimCalls, 0)
    assert.equal(startCalls, 0)
    assert.equal(providerCalls, 0)
  } finally {
    globalThis.fetch = originalFetch
    if (originalToken === undefined) delete process.env.RD_OWNER_API_TOKEN
    else process.env.RD_OWNER_API_TOKEN = originalToken
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = originalKey
  }
})

async function runAfterSealedStart(providerResponse) {
  const originalFetch = globalThis.fetch
  const originalToken = process.env.RD_OWNER_API_TOKEN
  const originalKey = process.env.DEEPSEEK_API_KEY
  let providerCalls = 0
  let resolveCalls = 0
  let failCalls = 0
  const failureCodes = []
  globalThis.fetch = async (url, options) => {
    const value = String(url)
    if (researchResolve(value)) return new Response(JSON.stringify(s1Response))
    if (value.includes("/resolve")) {
      resolveCalls += 1
      return new Response(JSON.stringify(resolveCalls === 1 ? {
        ...unclaimed,
        provider_invocation: { ...claim, disposition: "ALREADY_CLAIMED" },
      } : unclaimed))
    }
    if (value.includes("/prepare")) return new Response(JSON.stringify(preparation))
    if (value.includes("/claim-provider-invocation")) return new Response(JSON.stringify(claim))
    if (value.includes("/start-provider-invocation")) {
      return new Response(JSON.stringify({
        invocation_start: start,
        execution_custody: executionCustody,
      }))
    }
    if (value.includes("api.deepseek.com")) {
      providerCalls += 1
      return providerResponse()
    }
    if (value.includes("/fail")) {
      failCalls += 1
      failureCodes.push(JSON.parse(options.body).failure_code)
      return new Response(JSON.stringify(unclaimed))
    }
    throw new Error(`unexpected request ${value}`)
  }
  process.env.RD_OWNER_API_TOKEN = "test-token"
  process.env.DEEPSEEK_API_KEY = "test-provider-key"
  try {
    const result = await main("RUN", "build-1", "attempt-1", "request-1", "EXACT")
    return { result, providerCalls, resolveCalls, failCalls, failureCodes }
  } finally {
    globalThis.fetch = originalFetch
    if (originalToken === undefined) delete process.env.RD_OWNER_API_TOKEN
    else process.env.RD_OWNER_API_TOKEN = originalToken
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = originalKey
  }
}

for (const [name, providerResponse] of [
  ["provider fetch rejection", () => { throw new Error("provider transport rejected") }],
  ["provider response body-read rejection", () => ({ ok: true, text: async () => { throw new Error("body read rejected") } })],
]) {
  test(`${name} after sealed start resolves the same attempt without failing`, async () => {
    const { result, providerCalls, resolveCalls, failCalls } = await runAfterSealedStart(providerResponse)
    assert.equal(providerCalls, 1)
    assert.equal(resolveCalls, 2)
    assert.equal(failCalls, 0)
    assert.equal(result.resolution, "SUBMITTED_OR_UNKNOWN")
    assert.equal(result.build_request_identity, "build-1")
    assert.equal(result.attempt_identity, "attempt-1")
    assert.equal(result.next_legal_action, "RESOLVE_SAME_ATTEMPT_IDENTITY")
  })
}

for (const [name, providerResponse, failureCode] of [
  ["definitive non-OK provider response", () => new Response("provider rejected", { status: 503 }), "PROVIDER_ERROR"],
  ["empty provider response body", () => new Response(""), "PROVIDER_ERROR"],
  ["oversize provider response body", () => new Response("x".repeat(64 * 1024 + 1)), "PROVIDER_ERROR"],
  ["malformed provider envelope", () => new Response("{"), "PROVIDER_ERROR"],
  ["malformed provider candidate", () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ logic: {} }) } }] })), "CANDIDATE_MALFORMED"],
]) {
  test(`${name} after sealed start fails once without a provider retry`, async () => {
    const { providerCalls, resolveCalls, failCalls, failureCodes } = await runAfterSealedStart(providerResponse)
    assert.equal(providerCalls, 1)
    assert.equal(resolveCalls, 1)
    assert.equal(failCalls, 1)
    assert.deepEqual(failureCodes, [failureCode])
  })
}
