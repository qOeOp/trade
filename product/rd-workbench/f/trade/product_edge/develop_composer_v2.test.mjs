import assert from "node:assert/strict"
import test from "node:test"

import { main } from "./develop_composer_v2.ts"

const requestIdentity = "composer-request-1"
const maxOwnerResponseBytes = 2 * 1024 * 1024
const pluginManifest = {
  semantic_id: "plugin-1",
  abi_version: 2,
  input_ports: [],
  output_ports: [],
  state: {
    pre_port_id: "state-in",
    post_port_id: "state-out",
    value_type: "BYTES",
    max_bytes: 1024,
  },
  capability_ids: [],
  max_fuel: 10_000,
  max_linear_memory_bytes: 65_536,
  max_invocations_per_event: 1,
  failure_semantic_id: "FAIL_CLOSE",
}
const request = {
  request_identity: requestIdentity,
  research_custody_reference: "research-custody-1",
  design: {
    schema_version: 2,
    research_request_identity: Array(32).fill(1),
    intent_identity: Array(32).fill(2),
    intent_digest: Array(32).fill(3),
    inputs: [{
      semantic_id: "close-price",
      fact_class: "MARKET_DATA",
      instrument: "AAPL",
      field_semantic_id: "MARKET_DATA.BAR.CLOSE.PRICE.V1",
      channel: "MARKET",
      timeframe: "1d",
      unit: "PRICE",
      scale: 4,
      value_type: "I64",
    }],
    joins: [],
    parameters: [],
    state: [],
    reactions: [],
    capabilities: [],
    plugins: [pluginManifest],
    resources: {
      max_inputs: 1,
      max_nodes_per_reaction: 1,
      max_dependency_edges: 0,
      max_state_bytes: 1024,
      max_plugin_calls_per_event: 1,
    },
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
    manifest: pluginManifest,
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

const ownerSuccess = {
  schema_version: 2,
  request_identity: requestIdentity,
  disposition: "SUCCESS",
  receipt_identity: Array(32).fill(20),
  artifact: {
    artifact_locator: "rd-strategy-artifact-v2-1",
    artifact_digest: Array(32).fill(21),
    canonical_plan_digest: Array(32).fill(22),
    design_digest: Array(32).fill(23),
  },
  coordinate: null,
  reason: null,
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

function chunkedResponse(totalBytes, status, onCancel) {
  let emitted = 0
  return new Response(new ReadableStream({
    pull(controller) {
      const size = Math.min(64 * 1024, totalBytes - emitted)
      if (size === 0) {
        controller.close()
        return
      }
      emitted += size
      controller.enqueue(new Uint8Array(size).fill(32))
    },
    cancel(reason) {
      onCancel(reason)
    },
  }), { status })
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

test("Rust wire nulls, enum variants, shapes, digests, and numeric bounds fail before transport", {
  concurrency: false,
}, async () => {
  let calls = 0
  await withTransport(async () => { calls += 1 }, async () => {
    const cases = [
      ["null design", (candidate) => { candidate.design = null }],
      ["wrong Design enum", (candidate) => { candidate.design.inputs[0].fact_class = "MARKET" }],
      ["null binding scope", (candidate) => { candidate.binding_requests[0].scope = null }],
      ["wrong binding scope shape", (candidate) => {
        candidate.binding_requests[0].scope = { kind: "EXACT_INSTRUMENT" }
      }],
      ["wrong binding enum", (candidate) => { candidate.binding_requests[0].field_semantic = "CLOSE" }],
      ["short digest", (candidate) => { candidate.binding_requests[0].pit_request_digest = [1] }],
      ["u8 overflow", (candidate) => { candidate.binding_requests[0].scale = 256 }],
      ["u16 overflow", (candidate) => { candidate.design.resources.max_inputs = 65_536 }],
      ["unsafe u64", (candidate) => {
        candidate.binding_requests[0].decision_cut = Number.MAX_SAFE_INTEGER + 1
      }],
      ["capsule count overflow", (candidate) => {
        candidate.plugin_source_capsules = Array.from(
          { length: 65 }, () => structuredClone(candidate.plugin_source_capsules[0]),
        )
      }],
      ["null capsule manifest", (candidate) => { candidate.plugin_source_capsules[0].manifest = null }],
    ]
    for (const [label, mutate] of cases) {
      const candidate = structuredClone(request)
      mutate(candidate)
      const result = await main("RUN", requestIdentity, candidate)
      assert.equal(result.disposition, "UNAVAILABLE", label)
      assert.equal(result.coordinate, "transport.request", label)
    }

    const oversizedIdentity = "x".repeat(257)
    const oversizedRequest = structuredClone(request)
    oversizedRequest.request_identity = oversizedIdentity
    const oversizedResult = await main("RUN", oversizedIdentity, oversizedRequest)
    assert.equal(oversizedResult.disposition, "UNAVAILABLE")
    assert.equal(oversizedResult.coordinate, "transport.request_identity")
  })
  assert.equal(calls, 0)
})

test("only exact HTTP status and Owner disposition pairs pass through", { concurrency: false }, async () => {
  const exactPairs = [
    [200, ownerSuccess],
    [202, { ...ownerUnavailable, disposition: "SUBMITTED_OR_UNKNOWN" }],
    [409, { ...ownerUnavailable, disposition: "CONFLICT" }],
    [422, { ...ownerUnavailable, disposition: "UNSUPPORTED" }],
    [422, { ...ownerUnavailable, disposition: "NEEDS_RESEARCH_REFINEMENT" }],
    [503, ownerUnavailable],
  ]
  for (const [status, response] of exactPairs) {
    await withTransport(
      async () => new Response(JSON.stringify(response), { status }),
      async () => assert.deepEqual(await main("RUN", requestIdentity, request), response),
    )
  }
})

test("HTTP status and disposition mismatches fail closed, including 503 SUCCESS", {
  concurrency: false,
}, async () => {
  const mismatches = [
    [503, ownerSuccess],
    [200, ownerUnavailable],
    [202, { ...ownerUnavailable, disposition: "CONFLICT" }],
    [409, { ...ownerUnavailable, disposition: "SUBMITTED_OR_UNKNOWN" }],
    [422, ownerUnavailable],
    [500, ownerUnavailable],
  ]
  for (const [status, response] of mismatches) {
    await withTransport(async () => new Response(JSON.stringify(response), { status }), async () => {
      const result = await main("RUN", requestIdentity, request)
      assert.equal(result.disposition, "UNAVAILABLE")
      assert.equal(result.coordinate, "transport.owner")
      assert.equal(result.receipt_identity, null)
      assert.equal(result.artifact, null)
    })
  }
})

test("chunked response without Content-Length cancels immediately beyond the byte bound", {
  concurrency: false,
}, async () => {
  let cancelReason = null
  await withTransport(
    async () => chunkedResponse(
      Number.POSITIVE_INFINITY,
      503,
      (reason) => { cancelReason = reason },
    ),
    async () => {
      const result = await main("RUN", requestIdentity, request)
      assert.equal(result.disposition, "UNAVAILABLE")
      assert.equal(result.coordinate, "transport.owner")
      assert.equal(result.receipt_identity, null)
      assert.equal(result.artifact, null)
    },
  )
  assert.equal(cancelReason, "OWNER_RESPONSE_BOUND")
})

test("an exact-bound chunked response remains readable", { concurrency: false }, async () => {
  const prefix = new TextEncoder().encode(JSON.stringify(ownerUnavailable))
  const exactBody = new Uint8Array(maxOwnerResponseBytes).fill(32)
  exactBody.set(prefix)
  let offset = 0
  await withTransport(async () => new Response(new ReadableStream({
    pull(controller) {
      if (offset === exactBody.byteLength) {
        controller.close()
        return
      }
      const end = Math.min(offset + 64 * 1024, exactBody.byteLength)
      controller.enqueue(exactBody.slice(offset, end))
      offset = end
    },
  }), { status: 503 }), async () => {
    assert.deepEqual(await main("RUN", requestIdentity, request), ownerUnavailable)
  })
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
