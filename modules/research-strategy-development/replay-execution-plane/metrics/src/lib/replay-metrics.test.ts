import { expect, test } from "bun:test"
import {
  REPLAY_EQUITY_POLICY_VERSION,
  REPLAY_MARGIN_POLICY_VERSION,
  type ReplayBoundaryPhase,
  type ReplayEquityBridge,
  type ReplayEventKey,
  type ReplayFill,
  type ReplayLedgerEntry,
  type ReplayMarginSnapshot,
} from "../../../contracts/src/lib/replay-contracts"
import { deriveReplayMetrics } from "./replay-metrics"

function eventKey(eventTime: string, phase: ReplayBoundaryPhase, id: string): ReplayEventKey {
  return { event_time: eventTime, boundary_phase: phase, source_sequence: 1, event_subphase: 0, stable_event_id: id }
}

test("metrics are derived from immutable fills and ledger", () => {
  const fills: ReplayFill[] = [
    { fill_id: "f1", order_id: "o1", order_role: "entry", event_key: eventKey("2026-07-14T00:00:00Z", 20, "entry-fill"), timestamp: "2026-07-14T00:00:00Z", side: "buy", quantity: 1, price: 100, fee: 1, reduce_only: false },
    { fill_id: "f2", order_id: "o2", order_role: "target", event_key: eventKey("2026-07-14T08:00:00Z", 20, "exit-fill"), timestamp: "2026-07-14T08:00:00Z", side: "sell", quantity: 1, price: 110, fee: 1, reduce_only: true },
  ]
  const ledger: ReplayLedgerEntry[] = [
    { entry_id: "l1", event_key: eventKey(fills[0].timestamp, 70, "initial"), timestamp: fills[0].timestamp, kind: "initial_cash", amount: 1000, balance_after: 1000, ref: "run" },
    { entry_id: "l2", event_key: fills[0].event_key, timestamp: fills[0].timestamp, kind: "fee", amount: -1, balance_after: 999, ref: "f1" },
    { entry_id: "l3", event_key: fills[1].event_key, timestamp: fills[1].timestamp, kind: "realized_pnl", amount: 10, balance_after: 1009, ref: "f2" },
    { entry_id: "l4", event_key: fills[1].event_key, timestamp: fills[1].timestamp, kind: "fee", amount: -1, balance_after: 1008, ref: "f2" },
    { entry_id: "l5", event_key: eventKey(fills[1].timestamp, 100, "ending"), timestamp: fills[1].timestamp, kind: "ending_cash", amount: 0, balance_after: 1008, ref: "run" },
  ]
  const equityBridge: ReplayEquityBridge = {
    policy_version: REPLAY_EQUITY_POLICY_VERSION,
    valuation_id: "valuation-1",
    settlement_asset: "USDT",
    terminal_position_state: "flat",
    cash_balance: 1008,
    position_valuation: 0,
    ending_equity: 1008,
    reconciled: true,
  }
  const marginSnapshots: ReplayMarginSnapshot[] = [
    { policy_version: REPLAY_MARGIN_POLICY_VERSION, venue_risk_policy_snapshot_id: "risk-1", venue_risk_policy_snapshot_hash: "1".repeat(64), snapshot_id: "margin-entry", snapshot_sequence: 1, stage: "post_entry", event_key: fills[0].event_key, timestamp: fills[0].timestamp, position_event_id: "position-1", mark_source_ref: "f1", mark_source: "fill_price", resolution: "exact", symbol: "BTCUSDT", collateral_asset: "USDT", signed_quantity: 1, mark_price: 100, notional: 100, isolated_collateral: 20, attributed_settled_cashflow: -1, unrealized_pnl: 0, margin_balance: 19, initial_margin_requirement: 10, maintenance_margin_requirement: 5, initial_margin_headroom: 9, maintenance_margin_headroom: 14, margin_ratio: 0.263157894737, initial_margin_sufficient: true, maintenance_margin_sufficient: true, maintenance_trigger: "margin_balance_below_maintenance_requirement", maintenance_breach_observed: false, breach_terminal_priority: "risk_before_strategy_exit", state: "healthy", liquidation_evaluated: false },
    { policy_version: REPLAY_MARGIN_POLICY_VERSION, venue_risk_policy_snapshot_id: "risk-1", venue_risk_policy_snapshot_hash: "1".repeat(64), snapshot_id: "margin-terminal", snapshot_sequence: 2, stage: "terminal", event_key: ledger.at(-1)!.event_key, timestamp: fills[1].timestamp, position_event_id: "position-2", mark_source_ref: "f2", mark_source: "fill_price", resolution: "not_applicable_flat", symbol: "BTCUSDT", collateral_asset: "USDT", signed_quantity: 0, mark_price: 110, notional: 0, isolated_collateral: 0, attributed_settled_cashflow: 0, unrealized_pnl: 0, margin_balance: 0, initial_margin_requirement: 0, maintenance_margin_requirement: 0, initial_margin_headroom: 0, maintenance_margin_headroom: 0, margin_ratio: null, initial_margin_sufficient: true, maintenance_margin_sufficient: true, maintenance_trigger: "margin_balance_below_maintenance_requirement", maintenance_breach_observed: false, breach_terminal_priority: "risk_before_strategy_exit", state: "flat", liquidation_evaluated: false },
  ]
  expect(deriveReplayMetrics({
    initial_cash: 1000, fills, ledger, equity_bridge: equityBridge,
    margin_snapshots: marginSnapshots, ohlcv_resolution_evidence: [], pending_order_resolutions: [],
  })).toEqual({
    initial_cash: 1000,
    ending_equity: 1008,
    net_pnl: 8,
    return_fraction: 0.008,
    realized_pnl: 10,
    unrealized_pnl: 0,
    total_fees: 2,
    total_liquidation_fees: 0,
    total_funding: 0,
    trade_count: 1,
    margin_observation_count: 2,
    peak_observed_margin_ratio: 0.263157894737,
    terminal_margin_ratio: null,
    observed_maintenance_breach_count: 0,
    ohlcv_resolution_limited_count: 0,
    pending_order_resolution_limited_count: 0,
    ohlcv_net_terminal_contribution_span: 0,
    ohlcv_canonical_shortfall_to_best: 0,
  })
})
