import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"

interface DryRunFixtureIdentity {
  eventKey: string
  sourceObserveEventKey: string
  chainId: string
}

export function executionContractInputFixture(
  sourceObserveEventKey: string,
  chainId: string,
): JSONRecord {
  return {
    source_observe_event_key: sourceObserveEventKey,
    chain_id: chainId,
    setup_id: "trend-breakout",
    market: "usdm",
    symbol: "BTCUSDT",
    side: "long",
    position_side: "BOTH",
    margin_mode: "isolated",
    target_leverage: 2,
    account_snapshot: {
      equity_usdt: 1000,
      available_balance_usdt: 900,
      snapshot_at: "2026-07-08T12:00:00Z",
    },
    risk: {
      risk_budget_usdt: 10,
      stop_price: 64000,
      invalidation: "below range",
      expected_rr_net: 2,
    },
    entries: [{ type: "STOP_MARKET", stop_price: 66000, margin_usdt: 100 }],
    exchange_rules: { quantity_step_size: "0.001", min_qty: "0.001" },
  }
}

export function dryRunInputFixture(identity: DryRunFixtureIdentity): JSONRecord {
  return {
    now: "2026-07-08T12:00:20Z",
    event_key: identity.eventKey,
    created_at: "2026-07-08T12:00:21Z",
    target_action: "place_entry",
    plan: {
      symbol: "BTCUSDT",
      side: "long",
      setup_id: "trend-breakout",
      direction_state: "偏多已确认",
      execution_verdict: "等条件",
      thesis: "4H trend is intact",
      entry_intent: "buy breakout",
      exit_intent: "exit below invalidation",
      invalidation: "4H close below range",
      stop_price: 64000,
      risk_budget_usdt: 10,
      expected_rr_net: 2,
      live_permission: "live-small",
    },
    observe: {
      created_at: "2026-07-08T12:00:00Z",
      symbol: "BTCUSDT",
      side: "long",
      setup_id: "trend-breakout",
      account: {
        account_ref: "exchange-account://binance/live/usdm/primary",
        account_scope: "capital-scope://retail-small-usdm",
        equity_usdt: 1000,
      },
    },
    strategy: { status: "live-small" },
    account_config: { max_open_risk_pct: 0.1, max_day_loss_pct: 0.05 },
    runtime_policy: {
      source_hash: `sha256:${"a".repeat(64)}`,
      account_ref: "exchange-account://binance/live/usdm/primary",
      account_scope: "capital-scope://retail-small-usdm",
      effective_limits: {},
    },
    runtime_authorization: {
      schema_version: "trade.policy.runtime-authorization.v1",
      authorization_ref: "policy-authorization://fixture",
      content_hash: `sha256:${"b".repeat(64)}`,
      policy_hash: `sha256:${"a".repeat(64)}`,
      account_ref: "exchange-account://binance/live/usdm/primary",
      account_scope: "capital-scope://retail-small-usdm",
      issued_at: "2026-07-08T11:59:00Z",
      expires_at: "2026-07-08T12:05:00Z",
    },
    request: { type: "STOP_MARKET" },
    aggregate_view: {
      schema_version: "trade.state.portfolio-account-projection.v1",
      projection_ref: "flow-read-models://portfolio-account/fixture",
      content_hash: `sha256:${"c".repeat(64)}`,
      account_ref: "exchange-account://binance/live/usdm/primary",
      account_scope: "capital-scope://retail-small-usdm",
      completeness: "complete",
      computed_at: "2026-07-08T12:00:10Z",
      risk_lock: { locked: false },
      reconcile_status: "consistent",
      active_plans_risk_sum: 0,
      current_account_open_risk_usdt: 0,
      realized_pnl_today_usdt: 0,
      active_plans_worst_loss_at_stop: 0,
    },
    execution_contract_input: executionContractInputFixture(
      identity.sourceObserveEventKey,
      identity.chainId,
    ),
  }
}
