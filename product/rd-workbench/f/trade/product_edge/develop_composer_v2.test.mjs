import assert from "node:assert/strict"
import test from "node:test"

import { main } from "./develop_composer_v2.ts"

const locator = "research/request v2"
const requestIdentity = "composer-request-1"
const digest = (byte) => Array(32).fill(byte)
const projection = {
  schema_version: 2,
  research_request_locator: locator,
  request_identity: requestIdentity,
  request_digest: digest(1),
  research_custody_digest: digest(2),
  research_request_identity: digest(3),
  intent_identity: digest(4),
  intent_digest: digest(5),
  design_identity: digest(6),
  design_digest: digest(7),
  provider_identity: "sealed-a0-provider-v1",
}
const unavailable = {
  schema_version: 2,
  request_identity: requestIdentity,
  disposition: "UNAVAILABLE",
  receipt_identity: null,
  artifact: null,
  coordinate: "composer.acceptance",
  reason: "unavailable",
}
const success = {
  schema_version: 2,
  request_identity: requestIdentity,
  disposition: "SUCCESS",
  receipt_identity: digest(8),
  artifact: {
    artifact_locator: "rd-strategy-artifact-v2-1",
    artifact_digest: digest(9),
    canonical_plan_digest: digest(10),
    design_digest: digest(7),
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

test("RUN prefetches Owner identity then posts only the Research locator", { concurrency: false }, async () => {
  let call = 0
  await withTransport(async (url, init) => {
    call += 1
    if (call === 1) {
      assert.equal(url, "http://rd-owner-api:8080/v2/develop-composer/request-projections?research_request_locator=research%2Frequest%20v2")
      assert.equal(init.method, "GET")
      assert.equal(init.body, undefined)
      assert.deepEqual(init.headers, { authorization: "Bearer agent-entry-secret" })
      return new Response(JSON.stringify(projection), { status: 200 })
    }
    assert.equal(url, "http://rd-owner-api:8080/v2/develop-composer/runs")
    assert.equal(init.method, "POST")
    assert.deepEqual(JSON.parse(init.body), { research_request_locator: locator })
    assert.deepEqual(Object.keys(JSON.parse(init.body)), ["research_request_locator"])
    return new Response(JSON.stringify(success), { status: 200 })
  }, async () => assert.deepEqual(await main("RUN", locator), success))
  assert.equal(call, 2)
})

test("RESOLVE derives the same request identity from read-only projection and sends no body", { concurrency: false }, async () => {
  let call = 0
  await withTransport(async (url, init) => {
    call += 1
    if (call === 1) return new Response(JSON.stringify(projection), { status: 200 })
    assert.equal(url, "http://rd-owner-api:8080/v2/develop-composer/runs/composer-request-1/resolve")
    assert.equal(init.method, "POST")
    assert.equal(init.body, undefined)
    return new Response(JSON.stringify(success), { status: 200 })
  }, async () => assert.deepEqual(await main("RESOLVE", locator), success))
  assert.equal(call, 2)
})

test("lost RUN response preserves the prefetched identity for same-attempt RESOLVE", { concurrency: false }, async () => {
  let call = 0
  await withTransport(async () => {
    call += 1
    if (call === 1) return new Response(JSON.stringify(projection), { status: 200 })
    throw new Error("response lost")
  }, async () => {
    const result = await main("RUN", locator)
    assert.equal(result.request_identity, requestIdentity)
    assert.equal(result.disposition, "SUBMITTED_OR_UNKNOWN")
    assert.equal(result.coordinate, "transport.owner")
  })
})

test("projection is advisory for recovery only and never copied into POST", { concurrency: false }, async () => {
  const changed = { ...projection, design_digest: digest(99), provider_identity: "changed-provider" }
  let post
  await withTransport(async (_url, init) => {
    if (init.method === "GET") return new Response(JSON.stringify(changed), { status: 200 })
    post = JSON.parse(init.body)
    return new Response(JSON.stringify(unavailable), { status: 503 })
  }, async () => assert.deepEqual(await main("RUN", locator), unavailable))
  assert.deepEqual(post, { research_request_locator: locator })
})

test("unknown, empty and oversized locator input fails before transport", { concurrency: false }, async () => {
  let calls = 0
  await withTransport(async () => { calls += 1 }, async () => {
    for (const value of ["", " ", "x".repeat(257)]) {
      const result = await main("RUN", value)
      assert.equal(result.disposition, "UNAVAILABLE")
      assert.equal(result.coordinate, "transport.research_request_locator")
    }
    const result = await main("OTHER", locator)
    assert.equal(result.coordinate, "transport.action")
  })
  assert.equal(calls, 0)
})

test("malformed or mismatched full projection DTO fails closed before POST", { concurrency: false }, async () => {
  const cases = [
    { ...projection, research_request_locator: "other" },
    { ...projection, request_identity: "" },
    { ...projection, request_digest: [1] },
    { ...projection, design: { injected: true } },
  ]
  for (const candidate of cases) {
    let calls = 0
    await withTransport(async () => {
      calls += 1
      return new Response(JSON.stringify(candidate), { status: 200 })
    }, async () => {
      const result = await main("RUN", locator)
      assert.equal(result.disposition, "UNAVAILABLE")
      assert.equal(result.coordinate, "transport.request_projection")
    })
    assert.equal(calls, 1)
  }
})

test("only exact HTTP status and Owner disposition pairs pass through", { concurrency: false }, async () => {
  const pairs = [
    [200, success],
    [202, { ...unavailable, disposition: "SUBMITTED_OR_UNKNOWN" }],
    [409, { ...unavailable, disposition: "CONFLICT" }],
    [422, { ...unavailable, disposition: "UNSUPPORTED" }],
    [422, { ...unavailable, disposition: "NEEDS_RESEARCH_REFINEMENT" }],
    [503, unavailable],
  ]
  for (const [status, response] of pairs) {
    let call = 0
    await withTransport(async () => {
      call += 1
      return call === 1
        ? new Response(JSON.stringify(projection), { status: 200 })
        : new Response(JSON.stringify(response), { status })
    }, async () => assert.deepEqual(await main("RUN", locator), response))
  }
})

test("projection outage and status-disposition mismatch fail closed", { concurrency: false }, async () => {
  await withTransport(
    async () => new Response(JSON.stringify(unavailable), { status: 503 }),
    async () => {
      const result = await main("RUN", locator)
      assert.equal(result.coordinate, "transport.request_projection")
      assert.equal(result.request_identity, "unbound")
    },
  )
  let call = 0
  await withTransport(async () => {
    call += 1
    return call === 1
      ? new Response(JSON.stringify(projection), { status: 200 })
      : new Response(JSON.stringify(success), { status: 503 })
  }, async () => {
    const result = await main("RUN", locator)
    assert.equal(result.disposition, "SUBMITTED_OR_UNKNOWN")
    assert.equal(result.request_identity, requestIdentity)
  })
})
