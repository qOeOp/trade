import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { main } from "./source_intake_research_v1.ts"
import { unknownResearchProjectionV1 } from "./consumer_projection_v1.ts"

const fixture = JSON.parse(readFileSync(new URL(
  "../../../tests/fixtures/source_intake_research_terminal_v1.json",
  import.meta.url,
), "utf8"))

const operation = {
  proposal: {
    request_identity: "source-research-request-1",
    channel: "WINDMILL_PRODUCT_EDGE",
    goal: { hypothesis: "bounded" },
    trial_family_proposal: { trial_budget: 1 },
  },
  ancestry: {
    request_identity: "source-request-1",
    attempt_identity: "source-attempt-1",
    terminal_receipt_identity: "source-receipt-1",
  },
  policy_query: {
    request_identity: "source-request-1",
    gateway: "WINDMILL_PRODUCT_EDGE",
    admission: { request_identity: "source-request-1" },
    operation_manifest_identity: "manifest-1",
    operation_manifest_digest: `sha256:${"1".repeat(64)}`,
    connector_policy_locator: "sealed-source-intake-connector-policy-v1",
    network_policy_locator: "sealed-source-intake-network-policy-v1",
    rights_policy_locator: "sealed-source-intake-rights-policy-v1",
    retention_policy_locator: "sealed-source-intake-retention-policy-v1",
    dns_observation_locator: "sealed-source-intake-dns-observation-v1",
    shared_time_head: {},
    shared_time_successor: null,
  },
}

function withTransport(handler, run) {
  const originalFetch = globalThis.fetch
  const originalToken = process.env.RD_OWNER_API_TOKEN
  globalThis.fetch = handler
  process.env.RD_OWNER_API_TOKEN = "test-token"
  return Promise.resolve(run()).finally(() => {
    globalThis.fetch = originalFetch
    if (originalToken === undefined) delete process.env.RD_OWNER_API_TOKEN
    else process.env.RD_OWNER_API_TOKEN = originalToken
  })
}

test("RUN binds the path identity and sends the complete typed operation", async () => {
  await withTransport(async (url, request) => {
    assert.equal(url, "http://rd-owner-api:8080/v1/source-intake-research")
    assert.deepEqual(JSON.parse(request.body), operation)
    return new Response(JSON.stringify(fixture), { status: 200 })
  }, async () => {
    const result = await main("RUN", operation.proposal.request_identity, operation)
    assert.equal(result.resolution, "SUBMITTED_OR_UNKNOWN")
    assert.equal(result.request_identity, operation.proposal.request_identity)
  })
})

test("RESOLVE uses only the encoded same request identity and sends no body", async () => {
  const identity = "source-research/request 1"
  const response = { ...fixture, request_identity: identity }
  let calls = 0
  await withTransport(async (url, request) => {
    calls += 1
    assert.equal(
      url,
      "http://rd-owner-api:8080/v1/source-intake-research/source-research%2Frequest%201/resolve",
    )
    assert.equal(request.body, undefined)
    return new Response(JSON.stringify(response), { status: 200 })
  }, async () => {
    const result = await main("RESOLVE", identity, null)
    assert.equal(result.resolution, "SUBMITTED_OR_UNKNOWN")
    assert.equal(result.request_identity, identity)
    assert.deepEqual(result.consumer_projection, {
      schema_version: 1,
      operation: "research_goal.consumer_projection.v1",
      owner_operation: "research_goal.submit_or_resolve.v2",
      owner_schema: "sourced-research-goal-v2",
    })
    assert.equal((await main("RESOLVE", identity)).request_identity, identity)
  })
  assert.equal(calls, 2)
})

test("transport failure remains submitted-or-unknown with no positive custody", async () => {
  await withTransport(async () => { throw new Error("response lost") }, async () => {
    const result = await main("RUN", operation.proposal.request_identity, operation)
    assert.equal(result.resolution, "SUBMITTED_OR_UNKNOWN")
    assert.equal(result.owner_receipt, null)
    assert.equal(result.research_view, null)
  })
})

test("cross-bound identities and RESOLVE body injection fail before transport", async () => {
  let invoked = false
  const mismatched = structuredClone(operation)
  mismatched.policy_query.request_identity = "other-source-request"
  await withTransport(async () => { invoked = true }, async () => {
    const result = await main("RUN", operation.proposal.request_identity, mismatched)
    assert.equal(result.resolution, "SUBMITTED_OR_UNKNOWN")

    const pathMismatch = await main("RUN", "other-research-request", operation)
    assert.equal(pathMismatch.resolution, "SUBMITTED_OR_UNKNOWN")

    const resolveWithBody = await main("RESOLVE", operation.proposal.request_identity, operation)
    assert.equal(resolveWithBody.resolution, "SUBMITTED_OR_UNKNOWN")
  })
  assert.equal(invoked, false)
})

test("original RUN failures retain their projection and emit only bounded diagnostics", async () => {
  const cases = [
    ["OWNER_HTTP_ERROR", 500, async () => new Response("private-response-body", { status: 500 })],
    ["OWNER_TIMEOUT", null, async () => { throw new DOMException("private-timeout", "TimeoutError") }],
    ["OWNER_TRANSPORT_OR_JSON_ERROR", null, async () => { throw new Error("private-transport") }],
    ["OWNER_TRANSPORT_OR_JSON_ERROR", 200, async () => new Response("private-invalid-json", { status: 200 })],
    ["OWNER_JSON", 200, async () => new Response(JSON.stringify({ private: "private-json-body" }), { status: 200 })],
  ]
  const originalLog = console.log
  try {
    for (const [stage, status, handler] of cases) {
      const lines = []
      let calls = 0
      console.log = (line) => lines.push(line)
      await withTransport(async () => { calls += 1; return await handler() }, async () => {
        assert.deepEqual(await main("RUN", operation.proposal.request_identity, operation),
          unknownResearchProjectionV1(operation.proposal.request_identity))
      })
      assert.equal(calls, 1)
      const records = lines.map((line) => JSON.parse(line))
      assert.equal(records.length, 5)
      const transport = records.filter((record) => record.event === "source_intake_research_diagnostic_v1")
      const projection = records.filter((record) => record.event === "source_intake_research_projection_diagnostic_v1")
      assert.deepEqual(transport.map((record) => record.stage), [stage, "DERIVE_UNAVAILABLE", "VERIFY_UNAVAILABLE"])
      assert.deepEqual(projection.map((record) => record.first_failed_predicate), [
        stage === "OWNER_JSON" ? "ENVELOPE_SCHEMA_REQUEST" : "RESOLUTION", "RESOLUTION",
      ])
      assert.equal(records[0].http_status, status)
      for (const record of transport) {
        assert.deepEqual(Object.keys(record).sort(), ["elapsed_ms", "event", "http_status", "stage"])
        assert.equal(record.event, "source_intake_research_diagnostic_v1")
        assert.ok(record.http_status === null || Number.isInteger(record.http_status))
        assert.ok(Number.isSafeInteger(record.elapsed_ms) && record.elapsed_ms >= 0)
      }
      for (const record of projection) {
        assert.deepEqual(Object.keys(record).sort(), ["event", "first_failed_predicate"])
      }
      for (const secret of ["test-token", operation.proposal.request_identity, "private-", "bounded", "authorization"]) {
        assert.ok(!lines.join("\n").includes(secret))
      }
    }
    console.log = () => { throw new Error("private-logger-failure") }
    await withTransport(async () => new Response("private-invalid-json", { status: 200 }), async () => {
      assert.deepEqual(await main("RUN", operation.proposal.request_identity, operation),
        unknownResearchProjectionV1(operation.proposal.request_identity))
    })
  } finally {
    console.log = originalLog
  }
})
