import assert from "node:assert/strict"
import test from "node:test"
import { pathToFileURL } from "node:url"

const { main } = await import(pathToFileURL(new URL("./exploratory_replay_v2.ts", import.meta.url).pathname))
const { verifyReplayConsumerProjectionV2 } = await import(
  pathToFileURL(new URL("./consumer_projection_v1.ts", import.meta.url).pathname)
)

const d = (value) => `blake3:${value.repeat(64)}`
const content = (name, value) => ({ identity: name, digest: d(value) })
const versioned = (name) => ({ identity: name, version: "v1" })

function request() {
  return {
    schema_version: 2,
    request_identity: "replay-request-1",
    frozen_research_intent: content("intent-1", "1"),
    trial_family: content("family-1", "2"),
    trial_family_census_frontier: content("frontier-1", "3"),
    replay_authority: { namespace: "EXPLORATORY" },
    strategy_design: content("design-1", "4"),
    strategy_plan: content("plan-1", "5"),
    artifact: content("artifact-1", "6"),
    resolved_owner_inputs: content("owner-inputs-1", "7"),
    pit_scope: content("pit-scope-1", "8"),
    pit_snapshot: content("pit-snapshot-1", "9"),
    universe_selection: content("universe-1", "a"),
    correction_rule: versioned("correction-rule-1"),
    market_semantics: versioned("market-semantics-1"),
    replay_configuration: content("replay-configuration-1", "b"),
    models: {
      runtime_kernel: versioned("runtime-kernel-1"),
      simulator: versioned("simulator-1"),
      cost: versioned("cost-1"),
      slippage: versioned("slippage-1"),
      capacity: versioned("capacity-1"),
    },
    runner_operational_profile: versioned("runner-1"),
    diagnostic_policy: versioned("diagnostic-policy-1"),
    deterministic_seed: 17,
    window: { start_event_ns: 10, end_event_ns_exclusive: 20 },
    calendar: versioned("calendar-1"),
    session: versioned("session-1"),
    time_zone: versioned("UTC"),
    corporate_action_cut: content("corporate-action-cut-1", "c"),
    historical_membership_cut: content("membership-cut-1", "d"),
  }
}

function proposal() {
  return {
    build_request_identity: "build-1",
    attempt_identity: "attempt-1",
    build_receipt_identity: "build-receipt-1",
    artifact_family_binding_identity: "binding-1",
    request: request(),
  }
}

const meaningDigest = d("e")
const sealDigest = d("f")
const receiptIdentity = `rd-exploratory-replay-receipt-v2-${"1".repeat(64)}`
const bytes = (value) => [...new TextEncoder().encode(JSON.stringify(value))]

function identify(value = request()) {
  return {
    request_identity: value.request_identity,
    meaning_digest: meaningDigest,
    canonical_request_bytes: bytes(value),
  }
}

function unavailable() {
  return {
    projection: {
      schema_version: 1,
      request_identity: "replay-request-1",
      availability: "UNAVAILABLE",
      next_legal_action: "RESOLVE_OWNER_CUSTODY",
    },
    readback: null,
  }
}

function available(value = request()) {
  return {
    projection: {
      schema_version: 1,
      request_identity: value.request_identity,
      availability: "AVAILABLE",
      next_legal_action: "LOCK_BY_LOCATOR",
    },
    readback: {
      request: value,
      canonical_request_bytes: bytes(value),
      meaning_digest: meaningDigest,
      receipt: {
        schema_version: 2,
        receipt_identity: receiptIdentity,
        request_identity: value.request_identity,
        meaning_digest: meaningDigest,
        seal_digest: sealDigest,
        committed_at_epoch_ms: 100,
      },
      owner_cut_epoch_ms: 100,
    },
  }
}

function response(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })
}

async function withFetch(sequence, run) {
  const originalFetch = globalThis.fetch
  const originalToken = process.env.RD_OWNER_API_TOKEN
  const calls = []
  process.env.RD_OWNER_API_TOKEN = "test-token"
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) })
    const next = sequence.shift()
    if (next instanceof Error) throw next
    return response(next)
  }
  try {
    return await run(calls)
  } finally {
    globalThis.fetch = originalFetch
    if (originalToken === undefined) delete process.env.RD_OWNER_API_TOKEN
    else process.env.RD_OWNER_API_TOKEN = originalToken
  }
}

test("RUN identifies, resolves, commits once, and resolves the same selector", { concurrency: false }, async () => {
  await withFetch([identify(), unavailable(), { accepted: true }, available()], async (calls) => {
    const result = await main("RUN", "", "", proposal())
    assert.equal(result.resolution, "EXPLORATION_ACTIVE")
    assert.equal(result.request_identity, "replay-request-1")
    assert.equal(result.meaning_digest, meaningDigest)
    assert.equal(result.locator.receipt_identity, receiptIdentity)
    assert.equal(result.next_legal_action, "LOCK_BY_LOCATOR")
    assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
      "/v2/exploratory-replay-requests/identify",
      "/v2/exploratory-replay-requests/replay-request-1/resolve",
      "/v2/exploratory-replay-requests",
      "/v2/exploratory-replay-requests/replay-request-1/resolve",
    ])
    assert.deepEqual(calls[0].body, proposal().request)
    assert.deepEqual(calls[1].body, { meaning_digest: meaningDigest })
    assert.deepEqual(calls[2].body, proposal())
    assert.deepEqual(calls[3].body, { meaning_digest: meaningDigest })
  })
})

test("RUN returns existing custody without a second commit", { concurrency: false }, async () => {
  await withFetch([identify(), available()], async (calls) => {
    assert.equal((await main("RUN", "", "", proposal())).resolution, "EXPLORATION_ACTIVE")
    assert.equal(calls.length, 2)
  })
})

test("transport loss after commit resolves the same selector and never retries commit", { concurrency: false }, async () => {
  await withFetch([identify(), unavailable(), new Error("response lost"), available()], async (calls) => {
    assert.equal((await main("RUN", "", "", proposal())).resolution, "EXPLORATION_ACTIVE")
    assert.equal(calls.filter((call) => new URL(call.url).pathname === "/v2/exploratory-replay-requests").length, 1)
    assert.equal(calls.at(-1).body.meaning_digest, meaningDigest)
  })
})

test("RESOLVE calls only the same request route with meaning_digest", { concurrency: false }, async () => {
  await withFetch([available()], async (calls) => {
    const result = await main("RESOLVE", "replay-request-1", meaningDigest, proposal())
    assert.equal(result.resolution, "EXPLORATION_ACTIVE")
    assert.equal(calls.length, 1)
    assert.equal(new URL(calls[0].url).pathname, "/v2/exploratory-replay-requests/replay-request-1/resolve")
    assert.deepEqual(calls[0].body, { meaning_digest: meaningDigest })
  })
})

test("unknown, malformed, partial, and cross-spliced custody fails closed", { concurrency: false }, async () => {
  const cases = []
  const partial = available()
  delete partial.readback.receipt.seal_digest
  cases.push(partial)
  const wrongRequest = available()
  wrongRequest.readback.request.artifact.identity = "other-artifact"
  cases.push(wrongRequest)
  const wrongBytes = available()
  wrongBytes.readback.canonical_request_bytes = bytes({ ...request(), request_identity: "other-request" })
  cases.push(wrongBytes)
  const wrongMeaning = available()
  wrongMeaning.readback.receipt.meaning_digest = d("0")
  cases.push(wrongMeaning)
  const extraKey = available()
  extraKey.readback.fabricated = true
  cases.push(extraKey)

  for (const value of cases) {
    const projected = verifyReplayConsumerProjectionV2(
      value, request(), "replay-request-1", meaningDigest,
    )
    assert.equal(projected.resolution, "SUBMITTED_OR_UNKNOWN")
    assert.equal(projected.locator, null)
    assert.equal(projected.next_legal_action, "RESOLVE_SAME_REQUEST_IDENTITY")
  }

  await withFetch([identify(), { projection: available().projection, readback: null }], async (calls) => {
    const result = await main("RUN", "", "", proposal())
    assert.equal(result.resolution, "SUBMITTED_OR_UNKNOWN")
    assert.equal(calls.length, 2, "a malformed positive result must not authorize submit")
  })
})

test("identify must return canonical bytes for the exact requested meaning", { concurrency: false }, async () => {
  const spliced = identify()
  spliced.canonical_request_bytes = bytes({ ...request(), request_identity: "other-request" })
  await withFetch([spliced], async (calls) => {
    const result = await main("RUN", "", "", proposal())
    assert.equal(result.resolution, "SUBMITTED_OR_UNKNOWN")
    assert.equal(calls.length, 1)
  })
})
