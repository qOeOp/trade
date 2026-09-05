import assert from "node:assert/strict"
import test from "node:test"

const { executeArtifactBuildV1 } = await import("./artifact_build_v1.ts")

const request = {
  action: "RESOLVE",
  build_request_identity: "build-1",
  attempt_identity: "attempt-1",
  research_request_identity: "research-1",
  identity_mode: "EXACT",
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
    assert.deepEqual(result, unknown)
  })
}

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
