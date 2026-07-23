import { expect, test } from "bun:test"
import { buildExecutionCapability, validateExecutionCapability } from "./execution-capability"

test("execution capability binds policy, account fact, projection, intent, effect, and expiry", () => {
  const capability = buildExecutionCapability({
    target_action: "place_entry",
    preflight_result: { verdict: "armable" },
    runtime_authorization: {
      account_ref: ACCOUNT_REF,
      account_scope: ACCOUNT_SCOPE,
      authorization_ref: "policy-authorization://profile/scope/hash",
      policy_hash: `sha256:${"a".repeat(64)}`,
      expires_at: "2026-07-23T00:05:00.000Z",
    },
    account_fact: {
      account_ref: ACCOUNT_REF,
      account_scope: ACCOUNT_SCOPE,
      snapshot_ref: "exchange-account-facts://snapshot",
      as_of: "2026-07-23T00:00:00.000Z",
      freshness: { max_age_seconds: 30 },
    },
    portfolio_projection: {
      account_ref: ACCOUNT_REF,
      account_scope: ACCOUNT_SCOPE,
      projection_ref: "flow-read-models://portfolio-account/scope/hash",
    },
    source_intent_ref: "action-intent://intent-1",
    idempotency_key: "intent-1:place-entry",
    risk_budget_usdt: 10,
    max_notional_usdt: 500,
    now: "2026-07-23T00:00:05.000Z",
  })

  expect(capability.expires_at).toBe("2026-07-23T00:00:30.000Z")
  expect(capability.capability_ref).toMatch(/^execution-capability:\/\//)
  expect(validateExecutionCapability(capability, {
    target_action: "place_entry",
    idempotency_key: "intent-1:place-entry",
    source_intent_ref: "action-intent://intent-1",
    now: "2026-07-23T00:00:06.000Z",
  })).toEqual([])
})

test("execution capability rejects account scope drift", () => {
  expect(() => buildExecutionCapability({
    target_action: "place_entry",
    preflight_result: { verdict: "armable" },
    runtime_authorization: {
      account_ref: ACCOUNT_REF,
      account_scope: ACCOUNT_SCOPE,
      authorization_ref: "policy-authorization://profile/scope/hash",
      policy_hash: `sha256:${"a".repeat(64)}`,
      expires_at: "2026-07-23T00:05:00.000Z",
    },
    account_fact: {
      account_ref: ACCOUNT_REF,
      account_scope: "capital-scope://other",
      snapshot_ref: "exchange-account-facts://snapshot",
      as_of: "2026-07-23T00:00:00.000Z",
    },
    portfolio_projection: {
      account_ref: ACCOUNT_REF,
      account_scope: ACCOUNT_SCOPE,
      projection_ref: "flow-read-models://portfolio-account/scope/hash",
    },
    source_intent_ref: "action-intent://intent-1",
    idempotency_key: "intent-1:place-entry",
    now: "2026-07-23T00:00:05.000Z",
  })).toThrow(/account_scope mismatch/)
})

const ACCOUNT_REF = "exchange-account://binance/live/usdm/primary"
const ACCOUNT_SCOPE = "capital-scope://retail-small-usdm"
