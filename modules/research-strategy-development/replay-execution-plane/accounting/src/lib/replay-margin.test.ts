import { expect, test } from "bun:test"
import {
  REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
  REPLAY_MARGIN_POLICY_VERSION,
  type ReplayEventKey,
  type ReplayInstrumentAccountingSpec,
  type ReplayIsolatedMarginPolicy,
  type ReplayLedgerEntry,
  type ReplayPositionProjection,
} from "../../../contracts/src/lib/replay-contracts"
import { buildReplayMarginSnapshot } from "./replay-margin"

const spec: ReplayInstrumentAccountingSpec = {
  spec_version: REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
  product_type: "linear_derivative",
  base_asset: "BTC",
  quote_asset: "USDT",
  settlement_asset: "USDT",
  contract_multiplier: "1",
  price_increment: "0.01",
  quantity_increment: "0.001",
  settlement_increment: "0.01",
}

const policy: ReplayIsolatedMarginPolicy = {
  policy_id: "margin-policy",
  version: REPLAY_MARGIN_POLICY_VERSION,
  mode: "isolated",
  collateral_asset: "USDT",
  isolated_collateral: 20,
  initial_margin_rate: 0.1,
  maintenance_tier: {
    tier_id: "tier-1",
    snapshot_ref: "fixture:margin-tier-1",
    snapshot_hash: "a".repeat(64),
    notional_floor: 0,
    notional_cap: 1000,
    maintenance_margin_rate: 0.05,
    maintenance_amount: 0,
  },
  cashflow_scope: "position_attributed",
  collateral_transfer: "reserve_at_entry_release_at_terminal_if_flat",
  settled_cashflow_account: "isolated_margin_collateral",
  observation_scope: "source_event_path",
  mark_source_policy: "complete_exact_mark_else_ohlcv_adverse",
  maintenance_trigger: "margin_balance_below_maintenance_requirement",
  breach_terminal_priority: "risk_before_strategy_exit",
  breach_evidence: "first_observed_source_event",
  maintenance_breach_action: "exact_observation_full_liquidation_else_terminal_failure",
  liquidation: "simulated_full_close",
  liquidation_trigger_sources: "mark_or_funding_mark",
  liquidation_execution_price: "trigger_mark_adverse_slippage",
  liquidation_quantity: "full_position",
  liquidation_order_priority: "cancel_strategy_exits_before_forced_fill",
  liquidation_deficit: "fail_without_result",
}

function key(time: string, phase: 20 | 100, id: string): ReplayEventKey {
  return { event_time: time, boundary_phase: phase, source_sequence: 1, event_subphase: 0, stable_event_id: id }
}

function position(state: "open" | "flat", eventKey: ReplayEventKey): ReplayPositionProjection {
  return {
    position_event_id: `position-${state}`,
    position_id: "position",
    sequence: state === "open" ? 1 : 2,
    event_key: eventKey,
    timestamp: eventKey.event_time,
    cause_fill_id: `fill-${state}`,
    symbol: "BTCUSDT",
    accounting_method: "average_cost",
    numeric_policy_version: "rd-replay-number-v3",
    state,
    side: state === "open" ? "long" : null,
    signed_quantity: state === "open" ? 1 : 0,
    average_entry_price: state === "open" ? 100 : null,
    valuation_price: state === "open" ? 100 : 110,
    valuation_source: "fill_price",
    realized_pnl_delta: state === "open" ? 0 : 10,
    realized_pnl_cumulative: state === "open" ? 0 : 10,
    unrealized_pnl: 0,
  }
}

function ledger(entry: ReplayEventKey, ending: ReplayEventKey): ReplayLedgerEntry[] {
  return [
    { entry_id: "initial", event_key: key("2026-07-14T00:00:00Z", 20, "initial"), timestamp: "2026-07-14T00:00:00Z", kind: "initial_cash", amount: 1000, balance_after: 1000, ref: "run" },
    { entry_id: "fee", event_key: entry, timestamp: entry.event_time, kind: "fee", amount: -1, balance_after: 999, ref: "fill-open" },
    { entry_id: "funding", event_key: key("2026-07-14T06:00:00Z", 20, "funding"), timestamp: "2026-07-14T06:00:00Z", kind: "funding", amount: -2, balance_after: 997, ref: "funding" },
    { entry_id: "ending", event_key: ending, timestamp: ending.event_time, kind: "ending_cash", amount: 0, balance_after: 997, ref: "run" },
  ]
}

test("isolated margin snapshots include attributed cashflows and deterministic requirements", () => {
  const entry = key("2026-07-14T04:00:00Z", 20, "entry")
  const ending = key("2026-07-14T08:00:00Z", 100, "ending")
  const facts = ledger(entry, ending)
  const postEntry = buildReplayMarginSnapshot({
    run_id: "run", snapshot_sequence: 1, stage: "post_entry", accounting_spec: spec, margin_policy: policy,
    position: position("open", entry), event_key: entry, mark_source_ref: "fill-open", mark_source: "fill_price",
    mark_price: 100, unrealized_pnl: 0, resolution: "exact", ledger: facts,
  })
  expect(postEntry).toMatchObject({ notional: 100, attributed_settled_cashflow: -1, margin_balance: 19, initial_margin_requirement: 10, maintenance_margin_requirement: 5, margin_ratio: 0.263157894737, maintenance_trigger: "margin_balance_below_maintenance_requirement", maintenance_breach_observed: false, breach_terminal_priority: "risk_before_strategy_exit", state: "healthy" })

  const terminal = buildReplayMarginSnapshot({
    run_id: "run", snapshot_sequence: 2, stage: "terminal", accounting_spec: spec, margin_policy: policy,
    position: position("open", entry), event_key: ending, mark_source_ref: "bar", mark_source: "bar_close",
    mark_price: 90, unrealized_pnl: -10, resolution: "exact", ledger: facts,
  })
  expect(terminal).toMatchObject({ attributed_settled_cashflow: -3, margin_balance: 7, initial_margin_requirement: 9, maintenance_margin_requirement: 4.5, initial_margin_sufficient: false, maintenance_margin_sufficient: true, state: "healthy" })
})

test("flat terminal margin releases the observational allocation without inventing liquidation", () => {
  const entry = key("2026-07-14T04:00:00Z", 20, "entry")
  const exit = key("2026-07-14T08:00:00Z", 20, "exit")
  const ending = key("2026-07-14T08:00:00Z", 100, "ending")
  const snapshot = buildReplayMarginSnapshot({
    run_id: "run", snapshot_sequence: 2, stage: "terminal", accounting_spec: spec, margin_policy: policy,
    position: position("flat", exit), event_key: ending, mark_source_ref: "fill-flat", mark_source: "fill_price",
    mark_price: 110, unrealized_pnl: 0, resolution: "not_applicable_flat", ledger: ledger(entry, ending),
  })
  expect(snapshot).toMatchObject({ state: "flat", isolated_collateral: 0, margin_balance: 0, margin_ratio: null, liquidation_evaluated: false })
})

test("margin observation exposes a maintenance breach but does not synthesize liquidation", () => {
  const entry = key("2026-07-14T04:00:00Z", 20, "entry")
  const ending = key("2026-07-14T08:00:00Z", 100, "ending")
  const snapshot = buildReplayMarginSnapshot({
    run_id: "run", snapshot_sequence: 2, stage: "terminal", accounting_spec: spec, margin_policy: policy,
    position: position("open", entry), event_key: ending, mark_source_ref: "bar", mark_source: "bar_close",
    mark_price: 84, unrealized_pnl: -16, resolution: "exact", ledger: ledger(entry, ending),
  })
  expect(snapshot).toMatchObject({ margin_balance: 1, maintenance_margin_requirement: 4.2, maintenance_margin_sufficient: false, maintenance_breach_observed: true, state: "maintenance_breached", liquidation_evaluated: false })
})
