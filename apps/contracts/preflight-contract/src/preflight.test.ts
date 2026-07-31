import { expect, test } from "bun:test"
import { evaluatePreflight } from "./preflight"

test("no-action decisions abstain without manufacturing blockers", () => {
  const result = evaluatePreflight({ plan: {}, observe: {}, target_action: "no_action" })
  expect(result.verdict).toBe("abstain")
  expect(result.blocked_by).toEqual([])
})

test("new risk rejects anonymous caller aggregates", () => {
  const result = evaluatePreflight({
    plan: completePlan(),
    observe: completeObserve(),
    strategy: { status: "live-small" },
    runtime_policy: { account_ref: ACCOUNT_REF, account_scope: ACCOUNT_SCOPE },
    target_action: "place_entry",
    aggregate_view: {
      active_plans_risk_sum: 0,
      current_account_open_risk_usdt: 0,
    },
    now: "2026-07-23T00:00:10.000Z",
  })
  expect(result.blocked_by.some((item) => item.check_id === "G-PORTFOLIO-PROJECTION-AUTHORITY")).toBe(true)
})

test("new risk accepts a fresh owner-backed portfolio projection", () => {
  const result = evaluatePreflight({
    plan: completePlan(),
    observe: completeObserve(),
    strategy: { status: "live-small" },
    runtime_policy: { account_ref: ACCOUNT_REF, account_scope: ACCOUNT_SCOPE },
    target_action: "place_entry",
    aggregate_view: ownerProjection(),
    now: "2026-07-23T00:00:10.000Z",
  })
  expect(result.blocked_by.some((item) => item.check_id === "G-PORTFOLIO-PROJECTION-AUTHORITY")).toBe(false)
})

const ACCOUNT_REF = "exchange-account://binance/live/usdm/primary"
const ACCOUNT_SCOPE = "capital-scope://retail-small-usdm"

function completePlan() {
  return {
    setup_id: "setup-1",
    thesis: "test thesis",
    entry_intent: "enter",
    exit_intent: "exit",
    invalidation: "invalid",
    direction_state: "偏多已确认",
    execution_verdict: "等条件",
    risk_budget_usdt: 10,
    live_permission: "live-small",
  }
}

function completeObserve() {
  return {
    created_at: "2026-07-23T00:00:00.000Z",
    setup_id: "setup-1",
    account: {
      account_ref: ACCOUNT_REF,
      account_scope: ACCOUNT_SCOPE,
      equity_usdt: 1000,
    },
  }
}

function ownerProjection() {
  return {
    schema_version: "trade.state.portfolio-account-projection.v1",
    account_ref: ACCOUNT_REF,
    account_scope: ACCOUNT_SCOPE,
    projection_ref: "flow-read-models://portfolio-account/scope/hash",
    content_hash: `sha256:${"a".repeat(64)}`,
    completeness: "complete",
    computed_at: "2026-07-23T00:00:05.000Z",
    risk_lock: { locked: false },
    reconcile_status: "consistent",
    active_plans_risk_sum: 0,
    current_account_open_risk_usdt: 0,
    realized_pnl_today_usdt: 0,
    active_plans_worst_loss_at_stop: 0,
    active_risk_flow_count: 0,
  }
}
