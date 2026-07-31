import assert from "node:assert/strict"
import test from "node:test"
import { validateExecutionCapability } from "./execution-capability-contract"

const now = "2026-07-23T00:00:00Z"

test("execution capability validation accepts an exact unexpired binding", () => {
  const issues = validateExecutionCapability(capability(), {
    target_action: "place_entry",
    idempotency_key: "flow-1:observe-1:entry-1",
    source_intent_ref: "action-intent://flow-1",
    now,
  })
  assert.deepEqual(issues, [])
})

test("execution capability validation rejects drift and expiry", () => {
  const issues = validateExecutionCapability(capability(), {
    target_action: "cancel_order",
    idempotency_key: "different",
    source_intent_ref: "action-intent://different",
    now: "2026-07-23T00:02:00Z",
  })
  assert.deepEqual(issues, ["target_action", "idempotency_key", "source_intent_ref", "expires_at"])
})

function capability(): Record<string, unknown> {
  return {
    schema_version: "trade.execution.capability.v1",
    capability_ref: "execution-capability://fixture",
    content_hash: `sha256:${"a".repeat(64)}`,
    target_action: "place_entry",
    idempotency_key: "flow-1:observe-1:entry-1",
    source_intent_ref: "action-intent://flow-1",
    account_ref: "exchange-account://binance/live/usdm/primary",
    account_scope: "capital-scope://retail-small-usdm",
    policy_authorization_ref: "policy-authorization://fixture",
    account_fact_ref: "exchange-account-facts://fixture",
    portfolio_projection_ref: "flow-read-models://portfolio-account/fixture",
    expires_at: "2026-07-23T00:01:00Z",
  }
}
