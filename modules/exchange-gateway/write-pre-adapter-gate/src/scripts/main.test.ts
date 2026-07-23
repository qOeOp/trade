import assert from "node:assert/strict"
import test from "node:test"
import { run } from "./main"

test("write pre-adapter gate passes authorized writes", () => {
  const result = run(["--json", JSON.stringify({
    action: "place_entry",
    mode: "live_small",
    idempotency_key: "idem-1",
    source_intent_ref: "artifact_catalog:artifact/action-intent-1",
    authorized: true,
    now: "2026-07-23T00:00:00.000Z",
    capability: capabilityFixture(),
  })]) as { ok: boolean; data: { status: string } }

  assert.equal(result.ok, true)
  assert.equal(result.data.status, "passed")
})

function capabilityFixture() {
  return {
    schema_version: "trade.execution.capability.v1",
    capability_ref: "execution-capability://scope/hash",
    content_hash: `sha256:${"a".repeat(64)}`,
    target_action: "place_entry",
    account_ref: "exchange-account://binance/live/usdm/primary",
    account_scope: "capital-scope://retail-small-usdm",
    policy_authorization_ref: "policy-authorization://profile/scope/hash",
    account_fact_ref: "exchange-account-facts://snapshot",
    portfolio_projection_ref: "flow-read-models://portfolio-account/scope/hash",
    idempotency_key: "idem-1",
    source_intent_ref: "artifact_catalog:artifact/action-intent-1",
    expires_at: "2026-07-23T00:00:30.000Z",
  }
}

test("write pre-adapter gate blocks unauthorised writes", () => {
  const result = run(["--json", JSON.stringify({
    action: "place_entry",
    mode: "live_small",
    idempotency_key: "idem-1",
  })]) as { ok: boolean; data: { status: string; issues: unknown[] } }

  assert.equal(result.ok, false)
  assert.equal(result.data.status, "blocked")
  assert.ok(result.data.issues.length > 0)
})
