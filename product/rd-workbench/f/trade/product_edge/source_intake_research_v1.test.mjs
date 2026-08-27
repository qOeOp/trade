import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { main } from "./source_intake_research_v1.ts"

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

test("RUN sends only the typed untrusted proposal and locator operation", async () => {
  await withTransport(async (url, request) => {
    assert.equal(url, "http://rd-owner-api:8080/v1/source-intake-research")
    assert.deepEqual(JSON.parse(request.body), operation)
    return new Response(JSON.stringify(fixture), { status: 200 })
  }, async () => {
    const result = await main("RUN", operation)
    assert.equal(result.resolution, "SUBMITTED_OR_UNKNOWN")
    assert.equal(result.request_identity, operation.proposal.request_identity)
  })
})

test("RESOLVE replays the exact same meaning at the same request identity", async () => {
  await withTransport(async (url, request) => {
    assert.equal(
      url,
      "http://rd-owner-api:8080/v1/source-intake-research/source-research-request-1/resolve",
    )
    assert.deepEqual(JSON.parse(request.body), operation)
    return new Response(JSON.stringify(fixture), { status: 200 })
  }, async () => {
    const result = await main("RESOLVE", operation)
    assert.equal(result.resolution, "SUBMITTED_OR_UNKNOWN")
    assert.deepEqual(result.consumer_projection, {
      schema_version: 1,
      operation: "research_goal.consumer_projection.v1",
      owner_operation: "research_goal.submit_or_resolve.v2",
      owner_schema: "sourced-research-goal-v2",
    })
  })
})

test("transport failure remains submitted-or-unknown with no positive custody", async () => {
  await withTransport(async () => { throw new Error("response lost") }, async () => {
    const result = await main("RUN", operation)
    assert.equal(result.resolution, "SUBMITTED_OR_UNKNOWN")
    assert.equal(result.owner_receipt, null)
    assert.equal(result.research_view, null)
  })
})

test("cross-bound ancestry and policy locators fail before transport", async () => {
  let invoked = false
  const mismatched = structuredClone(operation)
  mismatched.policy_query.request_identity = "other-source-request"
  await withTransport(async () => { invoked = true }, async () => {
    const result = await main("RUN", mismatched)
    assert.equal(result.resolution, "SUBMITTED_OR_UNKNOWN")
  })
  assert.equal(invoked, false)
})
