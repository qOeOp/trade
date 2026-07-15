import { expect, test } from "bun:test"
import {
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS,
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
  REPLAY_NO_DECISION_MARKET_INPUT,
  REPLAY_NO_DECISION_MARKET_INPUT_HASH,
  REPLAY_REQUEST_SCHEMA_VERSION,
  REPLAY_SIMULATOR_POLICY_VERSION,
  canonicalHash,
  createReplaySingleDecisionSchedule,
  type ReplayExecutionRequest,
  type ReplayLimitation,
  type ReplayMarketBar,
} from "../../../contracts/src/lib/replay-contracts"
import { createReplayEventKey } from "./replay-event-key"
import { reduceReplaySourceEvents } from "./replay-source-reducer"

const HASH = "c".repeat(64)

function request(): ReplayExecutionRequest {
  const order: ReplayExecutionRequest["order"] = {
    side: "long", quantity: 1, signal_time: "2026-07-14T00:00:00Z",
    earliest_executable_time: "2026-07-14T04:00:00Z", stop_price: 95, target_price: 110,
  }
  const decisionSchedule = createReplaySingleDecisionSchedule(order)
  return {
    schema_version: REPLAY_REQUEST_SCHEMA_VERSION,
    run_id: "run-reducer", idempotency_key: "key-reducer", experiment_id: "experiment-1",
    trial_group_id: "group-1", trial_group_hash: HASH, trial_id: "trial-1",
    candidate_id: "candidate-1", candidate_hash: HASH, identity_hash_policy_version: "identity-v1",
    experiment_contract_hash: HASH, dataset_manifest_ref: "dataset://fixture", dataset_hash: HASH,
    supplemental_facts_hash: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    supplemental_requirement_set: structuredClone(REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS),
    supplemental_requirement_set_hash: REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
    decision_market_input_requirement: structuredClone(REPLAY_NO_DECISION_MARKET_INPUT),
    decision_market_input_requirement_hash: REPLAY_NO_DECISION_MARKET_INPUT_HASH,
    decision_schedule: decisionSchedule, decision_schedule_hash: canonicalHash(decisionSchedule),
    trial_reservation_ref: "reservation://trial-1", trial_reservation_hash: HASH,
    venue_risk_policy_schedule_hash: HASH, instrument_spec_schedule_hash: HASH,
    harness_hash: HASH, assumptions_hash: HASH, symbol: "BTCUSDT", timeframe: "4h", initial_cash: 10_000,
    order,
    cost_policy: { policy_id: "fixture", version: "1", fee_bps: 0, slippage_bps: 0, liquidation_fee_bps: 50 },
    simulator_policy: {
      version: REPLAY_SIMULATOR_POLICY_VERSION, signal_visibility: "closed_candle", earliest_execution: "next_open",
      same_bar_policy: "stop_first", gap_fill_policy: "worse_open", position_accounting: "average_cost", funding_timing: "exact_event", end_of_data: "mark_open", margin_evaluation: "before_strategy_orders",
    },
    margin_policy: { policy_id: "fixture", version: "rd-replay-isolated-margin-v7", mode: "isolated", collateral_asset: "USDT", isolated_collateral: 1000, initial_margin_rate: 0.1, maintenance_tier: { tier_id: "tier-1", snapshot_ref: "fixture:margin-tier-1", snapshot_hash: HASH, notional_floor: 0, notional_cap: 50_000, maintenance_margin_rate: 0.005, maintenance_amount: 0 }, cashflow_scope: "position_attributed", collateral_transfer: "reserve_at_entry_release_at_terminal_if_flat", settled_cashflow_account: "isolated_margin_collateral", observation_scope: "source_event_path", mark_source_policy: "complete_exact_mark_else_ohlcv_adverse", maintenance_trigger: "margin_balance_below_maintenance_requirement", breach_terminal_priority: "risk_before_strategy_exit", breach_evidence: "first_observed_source_event", maintenance_breach_action: "exact_observation_full_liquidation_else_terminal_failure", liquidation: "simulated_full_close", liquidation_trigger_sources: "mark_or_funding_mark", liquidation_execution_price: "trigger_mark_adverse_slippage", liquidation_quantity: "full_position", liquidation_order_priority: "cancel_strategy_exits_before_forced_fill", liquidation_deficit: "fail_without_result" },
    random_seed: 1,
  }
}

function bar(openTime: string, closeTime: string, open: number, high: number, low: number, close: number): ReplayMarketBar {
  return { open_time: openTime, close_time: closeTime, open, high, low, close, volume: 100, closed: true }
}

test("source reducer stops at the terminal market event and keeps only in-position funding", () => {
  const limitations: ReplayLimitation[] = []
  const result = reduceReplaySourceEvents({
    request: request(),
    bars: [
      bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 109, 98, 108),
      bar("2026-07-14T08:00:00Z", "2026-07-14T12:00:00Z", 108, 111, 106, 110),
      bar("2026-07-14T12:00:00Z", "2026-07-14T16:00:00Z", 110, 115, 108, 114),
    ],
    funding_events: [
      { timestamp: "2026-07-14T04:00:00Z", rate: 0.001, mark_price: 100 },
      { timestamp: "2026-07-14T12:00:00Z", rate: 0.001, mark_price: 110 },
      { timestamp: "2026-07-14T16:00:00Z", rate: 0.001, mark_price: 114 },
    ],
    mark_events: [],
    exact_mark_coverage: false,
    entry_index: 0,
    delisted_at: null,
    limitations,
    activate_entry: (source) => ({
      source_event_id: source.source_event_id,
      fill_key: createReplayEventKey({
        event_time: "2026-07-14T04:00:00Z", boundary_phase: 20, source_sequence: 1,
        event_subphase: 3, stable_event_id: "entry-fill",
      }),
    }),
    get_entry_fill_event_key: (entry) => entry.fill_key,
    observe_exact_risk: () => null,
    observe_strategy_exit: () => null,
    complete_exit: (exit) => `${exit.role}:${exit.timestamp}`,
  })

  expect(result.exit.role).toBe("target")
  expect(result.exit.timestamp).toBe("2026-07-14T12:00:00Z")
  expect(result.entry_transition.source_event_id).toContain("source:bar_open:1")
  expect(result.terminal_transition).toBe("target:2026-07-14T12:00:00Z")
  expect(result.source_events.at(-1)?.kind).toBe("bar_range")
  expect(result.applied_funding_sources.map((event) => event.event_key.event_time)).toEqual(["2026-07-14T12:00:00Z"])
  expect(result.source_events.some((event) => event.event_key.event_time === "2026-07-14T16:00:00Z")).toBe(false)
  expect(limitations).toEqual([])
})
