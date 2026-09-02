import assert from "node:assert/strict"
import test from "node:test"

import { main } from "./develop_composer_v2.ts"

const requestIdentity = "composer-request-1"
const request = {
  request_identity: requestIdentity,
  research_custody_reference: "research-custody-1",
  design: {
    schema_version: 2,
    research_request_identity: Array(32).fill(1),
    intent_identity: Array(32).fill(2),
    intent_digest: Array(32).fill(3),
    inputs: [],
    joins: [],
    parameters: [],
    state: [],
    reactions: [],
    capabilities: [],
    plugins: [],
    resources: {},
    falsifier: "bounded falsifier",
  },
  binding_requests: [{
    research_request_identity: Array(32).fill(1),
    strategy_design_identity: Array(32).fill(2),
    input_role_identity: Array(32).fill(3),
    scope: { kind: "EXACT_INSTRUMENT", instrument: "AAPL" },
    field_semantic: "BAR_CLOSE_PRICE",
    channel: "MARKET",
    timeframe: "1d",
    unit: "PRICE",
    scale: 4,
    pit_request_identity: Array(32).fill(4),
    pit_request_digest: Array(32).fill(5),
    snapshot_identity: Array(32).fill(6),
    snapshot_fact_digest: Array(32).fill(7),
    observation_batch_digest: Array(32).fill(8),
    source_binding_identity: Array(32).fill(9),
    source_frontier_digest: Array(32).fill(10),
    correction_frontier_digest: Array(32).fill(11),
    instrument_master_digest: Array(32).fill(12),
    universe_selection_digest: Array(32).fill(13),
    market_semantics_identity: Array(32).fill(14),
    decision_cut: 1,
  }],
  plugin_source_capsules: [{
    schema_version: 2,
    manifest: {},
    language: "rust.no_std.fixed-abi-source.v2",
    rustc_release: "1.97.1",
    rustc_commit: "rustc-commit",
    target: "wasm32v1-none",
    build_command: ["cargo", "build", "--offline"],
    files: [{ path: "src/lib.rs", bytes: [1, 2, 3], symlink_target: null }],
  }],
}

const ownerUnavailable = {
  schema_version: 2,
  request_identity: requestIdentity,
  disposition: "UNAVAILABLE",
  receipt_identity: null,
  artifact: null,
  coordinate: "composer.acceptance",
  reason: "Durable Composer is unavailable outside the compile-time sealed acceptance build",
}

function withTransport(handler, run) {
  const originalFetch = globalThis.fetch
  const originalToken = process.env.RD_OWNER_API_TOKEN
  globalThis.fetch = handler
  process.env.RD_OWNER_API_TOKEN = "agent-entry-secret"
  return Promise.resolve(run()).finally(() => {
    globalThis.fetch = originalFetch
    if (originalToken === undefined) delete process.env.RD_OWNER_API_TOKEN
    else process.env.RD_OWNER_API_TOKEN = originalToken
  })
}

test("RUN posts the unchanged typed request and passes default UNAVAILABLE through", { concurrency: false }, async () => {
  await withTransport(async (url, init) => {
    assert.equal(url, "http://rd-owner-api:8080/v2/develop-composer/runs")
    assert.equal(init.method, "POST")
    assert.equal(init.headers.authorization, "Bearer agent-entry-secret")
    assert.deepEqual(JSON.parse(init.body), request)
    return new Response(JSON.stringify(ownerUnavailable), { status: 503 })
  }, async () => {
    assert.deepEqual(await main("RUN", requestIdentity, request), ownerUnavailable)
  })
})

test("RESOLVE uses only the encoded same request identity and sends no body", { concurrency: false }, async () => {
  const identity = "composer/request 1"
  const response = { ...ownerUnavailable, request_identity: identity }
  await withTransport(async (url, init) => {
    assert.equal(
      url,
      "http://rd-owner-api:8080/v2/develop-composer/runs/composer%2Frequest%201/resolve",
    )
    assert.equal(init.method, "POST")
    assert.equal(init.body, undefined)
    return new Response(JSON.stringify(response), { status: 503 })
  }, async () => {
    assert.deepEqual(await main("RESOLVE", identity, null), response)
  })
})

test("malformed and mismatched requests fail closed before transport", { concurrency: false }, async () => {
  let calls = 0
  await withTransport(async () => { calls += 1 }, async () => {
    const malformed = structuredClone(request)
    delete malformed.plugin_source_capsules
    const malformedResult = await main("RUN", requestIdentity, malformed)
    assert.equal(malformedResult.disposition, "UNAVAILABLE")
    assert.equal(malformedResult.coordinate, "transport.request")

    const mismatched = structuredClone(request)
    mismatched.request_identity = "other-request"
    const mismatchResult = await main("RUN", requestIdentity, mismatched)
    assert.equal(mismatchResult.disposition, "UNAVAILABLE")
    assert.equal(mismatchResult.request_identity, requestIdentity)

    const resolveWithBody = await main("RESOLVE", requestIdentity, request)
    assert.equal(resolveWithBody.disposition, "UNAVAILABLE")
    assert.equal(resolveWithBody.coordinate, "transport.resolve")
  })
  assert.equal(calls, 0)
})

test("mismatched or positive-looking malformed Owner responses fail closed", { concurrency: false }, async () => {
  await withTransport(async () => new Response(JSON.stringify({
    ...ownerUnavailable,
    request_identity: "other-request",
    disposition: "SUCCESS",
  }), { status: 200 }), async () => {
    const result = await main("RUN", requestIdentity, request)
    assert.equal(result.disposition, "UNAVAILABLE")
    assert.equal(result.request_identity, requestIdentity)
    assert.equal(result.receipt_identity, null)
    assert.equal(result.artifact, null)
    assert.equal(result.coordinate, "transport.owner")
  })
})

test("transport failure does not log the token or synthesize success", { concurrency: false }, async () => {
  const originalLog = console.log
  const originalError = console.error
  const observed = []
  console.log = (...values) => observed.push(values.join(" "))
  console.error = (...values) => observed.push(values.join(" "))
  try {
    await withTransport(async () => { throw new Error("agent-entry-secret") }, async () => {
      const result = await main("RUN", requestIdentity, request)
      assert.equal(result.disposition, "UNAVAILABLE")
      assert.equal(result.receipt_identity, null)
      assert.equal(result.artifact, null)
    })
  } finally {
    console.log = originalLog
    console.error = originalError
  }
  assert.deepEqual(observed, [])
})

test("missing transport authority returns structured UNAVAILABLE without a call", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch
  const originalToken = process.env.RD_OWNER_API_TOKEN
  let called = false
  globalThis.fetch = async () => { called = true }
  delete process.env.RD_OWNER_API_TOKEN
  try {
    const result = await main("RUN", requestIdentity, request)
    assert.equal(result.disposition, "UNAVAILABLE")
    assert.equal(result.coordinate, "transport.authorization")
  } finally {
    globalThis.fetch = originalFetch
    if (originalToken !== undefined) process.env.RD_OWNER_API_TOKEN = originalToken
  }
  assert.equal(called, false)
})
