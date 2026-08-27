import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { main, projectOwnerReadbackV1 } from "./source_intake_v1.ts"

const requestIdentity = "source-request-1"
const bindingIdentity = "source-binding-1"
const contentDigest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const sealedAuthority = {
  authority_class: "SEALED_ACCEPTANCE",
  environment_identity: "source-intake-sealed-acceptance-environment-v1",
  provider_profile_digest: "sha256:20e4901e7b97516edbaa744c0e866b0c509595386357c1b973e48beac1657f15",
  fixture_corpus_digest: "sha256:b8cf806629fbb7baa2e38707b4d246a17e44d9841509701530cbd97558ddad18",
}
const fixture = JSON.parse(readFileSync(new URL(
  "../../../tests/fixtures/source_intake_terminal_v1.json",
  import.meta.url,
), "utf8"))

const interpretation = {
  bounded_explanation: "The paper reports a bounded mechanism worth triage.",
  plausible_alternatives: ["Alternative A", "Alternative B"],
  differentiating_prediction: "The effect should weaken under the stated control.",
  falsifier: "The controlled observation is indistinguishable from zero.",
}

function receipt(terminal, overrides = {}) {
  const value = structuredClone(fixture.receipt)
  const fixedStatus = terminal === "NOT_FOUND" ? 404
    : terminal === "AUTH_REQUIRED" ? 401
      : terminal === "ACCESS_DENIED" ? 403
        : terminal === "RATE_LIMITED" ? 429
          : terminal === "MALFORMED" ? 200
            : null
  const invoked = terminal !== "TERMS_OR_LICENSE_BLOCKED"
  Object.assign(value, {
    invocation_identity: terminal === "RETRIEVED" || invoked ? value.invocation_identity : null,
    terminal,
    response_status: terminal === "RETRIEVED" ? value.response_status : fixedStatus,
    response_header_digest: terminal === "RETRIEVED" || fixedStatus !== null
      ? value.response_header_digest
      : null,
    connected_address: terminal === "RETRIEVED" ? value.connected_address : null,
    response_media_type: terminal === "RETRIEVED" ? value.response_media_type : null,
    response_size_bytes: terminal === "RETRIEVED" ? value.response_size_bytes : null,
    content_digest: terminal === "RETRIEVED" ? contentDigest : null,
    ...overrides,
  })
  return value
}

function readback(terminal = "RETRIEVED", overrides = {}) {
  const value = structuredClone(fixture)
  Object.assign(value, {
    terminal,
    receipt: receipt(terminal),
    content_locator: terminal === "RETRIEVED"
      ? `rd-owner://source-payload/sha256/${contentDigest}`
      : null,
    content_digest: terminal === "RETRIEVED" ? contentDigest : null,
    provenance_identity: terminal === "RETRIEVED" ? "source-provenance-1" : null,
    source_candidate_identity: terminal === "RETRIEVED" ? "source-candidate-1" : null,
    outbox_event_identity: "source-outbox-1",
    ...overrides,
  })
  return value
}

function assertUnknown(value) {
  assert.deepEqual(value, {
    request_identity: requestIdentity,
    resolution: "SUBMITTED_OR_UNKNOWN",
    next_legal_action: "RESOLVE_SAME_REQUEST",
  })
}

test("RETRIEVED is projected only from the complete terminal Owner atom", () => {
  assert.deepEqual(projectOwnerReadbackV1(fixture, requestIdentity), {
    request_identity: requestIdentity,
    binding_identity: bindingIdentity,
    authority_class: fixture.authority_class,
    environment_identity: fixture.environment_identity,
    provider_profile_digest: fixture.provider_profile_digest,
    fixture_corpus_digest: fixture.fixture_corpus_digest,
    resolution: "RETRIEVED",
    receipt: fixture.receipt,
    content_locator: `rd-owner://source-payload/sha256/${contentDigest}`,
    content_digest: contentDigest,
    provenance_identity: "source-provenance-1",
    source_candidate_identity: "source-candidate-1",
    outbox_event_identity: "source-outbox-1",
  })
})

test("SEALED_ACCEPTANCE is projected only from its exact authority tuple", () => {
  const result = projectOwnerReadbackV1(readback("RETRIEVED", sealedAuthority), requestIdentity)
  assert.equal(result.resolution, "RETRIEVED")
  assert.deepEqual({
    authority_class: result.authority_class,
    environment_identity: result.environment_identity,
    provider_profile_digest: result.provider_profile_digest,
    fixture_corpus_digest: result.fixture_corpus_digest,
  }, sealedAuthority)
})

for (const terminal of [
  "NOT_FOUND",
  "AUTH_REQUIRED",
  "ACCESS_DENIED",
  "RATE_LIMITED",
  "TERMS_OR_LICENSE_BLOCKED",
  "MALFORMED",
  "UNAVAILABLE",
]) {
  test(`${terminal} remains terminal and omits every positive field`, () => {
    const result = projectOwnerReadbackV1(readback(terminal), requestIdentity)
    assert.equal(result.resolution, terminal)
    assert.deepEqual(Object.keys(result).sort(), [
      "authority_class",
      "binding_identity",
      "environment_identity",
      "fixture_corpus_digest",
      "outbox_event_identity",
      "provider_profile_digest",
      "receipt",
      "request_identity",
      "resolution",
    ])
    for (const key of [
      "content_locator",
      "content_digest",
      "provenance_identity",
      "source_candidate_identity",
    ]) assert.equal(Object.hasOwn(result, key), false)
  })
}

for (const [name, mutate] of [
  ["missing response field", (value) => { delete value.outbox_event_identity }],
  ["extra response field", (value) => { value.status = true }],
  ["nonterminal state", (value) => { value.state = "PREPARED" }],
  ["wrong request identity", (value) => { value.request_identity = "other-request" }],
  ["missing authority class", (value) => { delete value.authority_class }],
  ["unknown authority class", (value) => { value.authority_class = "CALLER_SELECTED" }],
  ["live environment mismatch", (value) => { value.environment_identity = sealedAuthority.environment_identity }],
  ["live profile mismatch", (value) => { value.provider_profile_digest = sealedAuthority.provider_profile_digest }],
  ["live fixture injection", (value) => { value.fixture_corpus_digest = sealedAuthority.fixture_corpus_digest }],
  ["mixed sealed authority tuple", (value) => { value.authority_class = "SEALED_ACCEPTANCE" }],
  ["sealed authority without fixture", (value) => {
    Object.assign(value, sealedAuthority, { fixture_corpus_digest: null })
  }],
  ["sealed authority with live environment", (value) => {
    Object.assign(value, sealedAuthority, { environment_identity: "PRODUCTION_LIVE_EXTERNAL" })
  }],
  ["sealed authority with live profile", (value) => {
    Object.assign(value, sealedAuthority, { provider_profile_digest: fixture.provider_profile_digest })
  }],
  ["sealed authority with mutated fixture", (value) => {
    Object.assign(value, sealedAuthority, { fixture_corpus_digest: contentDigest })
  }],
  ["missing receipt", (value) => { value.receipt = null }],
  ["missing receipt field", (value) => { delete value.receipt.response_status }],
  ["extra receipt field", (value) => { value.receipt.admission_identity = "forbidden" }],
  ["cross-bound receipt", (value) => { value.receipt.request_identity = "other-request" }],
  ["mismatched terminal", (value) => { value.receipt.terminal = "NOT_FOUND" }],
  ["retrieved without invocation", (value) => { value.receipt.invocation_identity = null }],
  ["retrieved without 200 receipt", (value) => { value.receipt.response_status = 201 }],
  ["terminal status mismatch", (value) => {
    value.terminal = "NOT_FOUND"
    value.receipt = receipt("NOT_FOUND", { response_status: 401 })
    value.content_locator = null
    value.content_digest = null
    value.provenance_identity = null
    value.source_candidate_identity = null
  }],
  ["mismatched content digest", (value) => { value.content_digest = "sha256:other" }],
  ["mismatched content locator", (value) => { value.content_locator = "https://caller.invalid" }],
  ["missing provenance", (value) => { value.provenance_identity = null }],
  ["missing candidate", (value) => { value.source_candidate_identity = null }],
  ["missing outbox", (value) => { value.outbox_event_identity = null }],
  ["attempt not bound to binding", (value) => { value.receipt.attempt_identity = "other-attempt" }],
  ["invalid terminal evidence digest", (value) => { value.receipt.terminal_evidence_digest = "sha256:short" }],
  ["policy time after retrieval time", (value) => {
    value.receipt.policy_decision_time.decision_cut_epoch_ms = 2_001
  }],
  ["retrieval clock mismatch", (value) => {
    value.receipt.retrieval_time.clock_identity = "other-clock"
  }],
  ["retrieval epoch mismatch", (value) => {
    value.receipt.retrieval_time.clock_epoch = "other-epoch"
  }],
  ["retrieval sequence does not advance", (value) => {
    value.receipt.retrieval_time.monotonic_sequence = value.receipt.policy_decision_time.monotonic_sequence
  }],
  ["retrieval reuses the policy head", (value) => {
    value.receipt.retrieval_time.head_digest = value.receipt.policy_decision_time.head_digest
  }],
  ["expired retrieval evidence", (value) => {
    value.receipt.retrieval_time.valid_through_epoch_ms = 2_000
  }],
  ["partial successor evidence", (value) => {
    value.receipt.retrieval_time.predecessor_head_digest = contentDigest
  }],
]) {
  test(`malformed Owner readback fails closed: ${name}`, () => {
    const value = structuredClone(readback())
    mutate(value)
    assertUnknown(projectOwnerReadbackV1(value, requestIdentity))
  })
}

for (const key of Object.keys(fixture.receipt)) {
  test(`full Owner receipt fails closed when ${key} is missing`, () => {
    const value = structuredClone(fixture)
    delete value.receipt[key]
    assertUnknown(projectOwnerReadbackV1(value, requestIdentity))
  })
}

for (const timeField of ["policy_decision_time", "retrieval_time"]) {
  for (const key of Object.keys(fixture.receipt[timeField])) {
    test(`${timeField} fails closed when ${key} is missing`, () => {
      const value = structuredClone(fixture)
      delete value.receipt[timeField][key]
      assertUnknown(projectOwnerReadbackV1(value, requestIdentity))
    })
  }
  test(`${timeField} fails closed on an extra evidence field`, () => {
    const value = structuredClone(fixture)
    value.receipt[timeField].caller_clock = true
    assertUnknown(projectOwnerReadbackV1(value, requestIdentity))
  })
}

test("a negative terminal carrying positive fields fails closed", () => {
  assertUnknown(projectOwnerReadbackV1(readback("NOT_FOUND", {
    content_digest: contentDigest,
  }), requestIdentity))
})

async function withTransport(fetchImpl, callback) {
  const originalFetch = globalThis.fetch
  const originalToken = process.env.RD_OWNER_API_TOKEN
  globalThis.fetch = fetchImpl
  process.env.RD_OWNER_API_TOKEN = "owner-token-secret"
  try {
    return await callback()
  } finally {
    globalThis.fetch = originalFetch
    if (originalToken === undefined) delete process.env.RD_OWNER_API_TOKEN
    else process.env.RD_OWNER_API_TOKEN = originalToken
  }
}

test("RUN sends only the fixed Owner request and never calls a provider", async () => {
  const calls = []
  const result = await withTransport(async (url, options) => {
    calls.push({ url: String(url), options })
    return new Response(JSON.stringify(readback()))
  }, () => main("RUN", requestIdentity, "10.1234/source-intake", interpretation))
  assert.equal(result.resolution, "RETRIEVED")
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, "http://rd-owner-api:8080/v1/source-intakes")
  assert.equal(calls[0].options.method, "POST")
  assert.deepEqual(calls[0].options.headers, {
    authorization: "Bearer owner-token-secret",
    "content-type": "application/json",
  })
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    request_identity: requestIdentity,
    channel: "WINDMILL_PRODUCT_EDGE",
    normalized_doi: "10.1234/source-intake",
    interpretation,
  })
  assert.doesNotMatch(JSON.stringify(result), /owner-token-secret/)
})

test("RESOLVE posts no DOI or provider instruction and preserves the same encoded request", async () => {
  let call
  const result = await withTransport(async (url, options) => {
    call = { url: String(url), options }
    return new Response(JSON.stringify(readback("NOT_FOUND")))
  }, () => main("RESOLVE", requestIdentity, "10.9999/ignored", interpretation))
  assert.equal(result.resolution, "NOT_FOUND")
  assert.equal(call.url, `http://rd-owner-api:8080/v1/source-intakes/${requestIdentity}/resolve`)
  assert.deepEqual(JSON.parse(call.options.body), {})
})

for (const [name, response] of [
  ["response loss", () => { throw new Error("lost after commit") }],
  ["HTTP 200 malformed body", () => new Response("{}")],
  ["HTTP 500 valid-looking terminal", () => new Response(JSON.stringify(readback()), { status: 500 })],
  ["empty body", () => new Response("")],
  ["oversize body", () => new Response("x".repeat(2 * 1024 * 1024 + 1))],
]) {
  test(`${name} remains unknown with same-request resolution only`, async () => {
    const result = await withTransport(response, () => main(
      "RUN",
      requestIdentity,
      "10.1234/source-intake",
      interpretation,
    ))
    assertUnknown(result)
  })
}

for (const [name, doi, value] of [
  ["uppercase DOI", "10.1234/Upper", interpretation],
  ["caller URL smuggling", "https://caller.invalid/source", interpretation],
  ["missing alternative", "10.1234/source", { ...interpretation, plausible_alternatives: [] }],
  ["duplicate alternative", "10.1234/source", { ...interpretation, plausible_alternatives: ["same", "same"] }],
  ["unsorted alternatives", "10.1234/source", { ...interpretation, plausible_alternatives: ["z", "a"] }],
  ["extra interpretation authority", "10.1234/source", { ...interpretation, credentials: "secret" }],
  ["control character", "10.1234/source", { ...interpretation, falsifier: "bad\ntext" }],
]) {
  test(`invalid RUN input has no Owner or provider effect: ${name}`, async () => {
    let calls = 0
    const result = await withTransport(async () => {
      calls += 1
      throw new Error("must not fetch")
    }, () => main("RUN", requestIdentity, doi, value))
    assert.equal(calls, 0)
    assertUnknown(result)
  })
}

test("missing bearer capability has no network effect", async () => {
  const originalToken = process.env.RD_OWNER_API_TOKEN
  const originalFetch = globalThis.fetch
  let calls = 0
  delete process.env.RD_OWNER_API_TOKEN
  globalThis.fetch = async () => { calls += 1; throw new Error("must not fetch") }
  try {
    assertUnknown(await main("RESOLVE", requestIdentity))
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = originalFetch
    if (originalToken !== undefined) process.env.RD_OWNER_API_TOKEN = originalToken
  }
})
