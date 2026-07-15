import { expect, test } from "bun:test"
import { CONTROL_PLANE_IDENTITY_SCHEMA_VERSION } from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { REPLAY_SIMULATOR_POLICY_VERSION } from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"
import { buildDeveloperReplayRequest } from "./developer-role"

const HASH = "f".repeat(64)

test("Developer request copies authority identity without inventing it", () => {
  const request = buildDeveloperReplayRequest({
    run_id: "run-1", idempotency_key: "key-1",
    identity: { schema_version: CONTROL_PLANE_IDENTITY_SCHEMA_VERSION, experiment_id: "experiment-1", trial_group_id: "group-1", trial_group_hash: HASH, trial_id: "trial-1", candidate_id: "candidate-1", candidate_hash: HASH, identity_hash_policy_version: "identity-v1", experiment_contract_hash: HASH },
    trial_reservation_ref: "reservation://trial-1", trial_reservation_hash: HASH,
    dataset_manifest_ref: "dataset://fixture", dataset_hash: HASH, supplemental_facts_hash: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", venue_risk_policy_schedule_hash: HASH, instrument_spec_schedule_hash: HASH, harness_hash: HASH, assumptions_hash: HASH,
    symbol: "BTCUSDT", timeframe: "4h", initial_cash: 1000,
    order: { side: "long", quantity: 1, signal_time: "2026-07-14T00:00:00Z", earliest_executable_time: "2026-07-14T04:00:00Z", stop_price: 95, target_price: 110 },
    cost_policy: { policy_id: "fixture", version: "1", fee_bps: 0, slippage_bps: 0, liquidation_fee_bps: 50 },
    simulator_policy: { version: REPLAY_SIMULATOR_POLICY_VERSION, signal_visibility: "closed_candle", earliest_execution: "next_open", same_bar_policy: "stop_first", gap_fill_policy: "worse_open", position_accounting: "average_cost", funding_timing: "exact_event", end_of_data: "mark_open", margin_evaluation: "before_strategy_orders" },
    margin_policy: { policy_id: "fixture", version: "rd-replay-isolated-margin-v7", mode: "isolated", collateral_asset: "USDT", isolated_collateral: 1000, initial_margin_rate: 0.1, maintenance_tier: { tier_id: "tier-1", snapshot_ref: "fixture:margin-tier-1", snapshot_hash: HASH, notional_floor: 0, notional_cap: 50_000, maintenance_margin_rate: 0.005, maintenance_amount: 0 }, cashflow_scope: "position_attributed", collateral_transfer: "reserve_at_entry_release_at_terminal_if_flat", settled_cashflow_account: "isolated_margin_collateral", observation_scope: "source_event_path", mark_source_policy: "complete_exact_mark_else_ohlcv_adverse", maintenance_trigger: "margin_balance_below_maintenance_requirement", breach_terminal_priority: "risk_before_strategy_exit", breach_evidence: "first_observed_source_event", maintenance_breach_action: "exact_observation_full_liquidation_else_terminal_failure", liquidation: "simulated_full_close", liquidation_trigger_sources: "mark_or_funding_mark", liquidation_execution_price: "trigger_mark_adverse_slippage", liquidation_quantity: "full_position", liquidation_order_priority: "cancel_strategy_exits_before_forced_fill", liquidation_deficit: "fail_without_result" }, random_seed: 1,
  })
  expect(request.trial_id).toBe("trial-1")
  expect(request.candidate_hash).toBe(HASH)
})
