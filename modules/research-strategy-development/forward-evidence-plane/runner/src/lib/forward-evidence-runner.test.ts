import { expect, test } from "bun:test"
import { CONTROL_PLANE_IDENTITY_SCHEMA_VERSION, DRAFT_AUTHORIZATION_SCHEMA_VERSION, REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION, STRATEGY_DRAFT_BINDING_SCHEMA_VERSION, TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION, hashTrialReservationSnapshot, type ReplayAttemptLeaseSnapshot, type TrialReservationSnapshot } from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { REPLAY_CERTIFIED_CAPABILITIES, REPLAY_DATASET_MANIFEST_SCHEMA_VERSION, REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION, REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION, REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION, REPLAY_NO_DECISION_MARKET_INPUT, REPLAY_NO_DECISION_MARKET_INPUT_HASH, REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS, REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH, REPLAY_REQUEST_SCHEMA_VERSION, REPLAY_SIMULATOR_POLICY_VERSION, REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION, canonicalHash, createReplaySingleDecisionSchedule, replayDatasetHash, replayExecutionSpecHash, type ReplayDatasetManifest, type ReplayExecutionRequest, type ReplayMarketBar } from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"
import { FORWARD_ADMISSION_SCHEMA_VERSION, type ForwardAdmissionRequest } from "../../../contracts/src/lib/forward-evidence-contracts"
import { runForwardEvidenceSession } from "./forward-evidence-runner"

const HASH = "e".repeat(64)
const MAINTENANCE_TIER = { tier_id: "tier-1", snapshot_ref: "fixture:margin-tier-1", snapshot_hash: HASH, notional_floor: 0, notional_cap: 50_000, maintenance_margin_rate: 0.005, maintenance_amount: 0 }
const RISK_SNAPSHOT = { schema_version: REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION, snapshot_id: "risk-1", venue_id: "binance-usdm", symbol: "BTCUSDT", effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-14T08:00:00Z", source_ref: "fixture:risk-1", source_hash: HASH, initial_margin_rate: 0.1, maintenance_tier: MAINTENANCE_TIER, liquidation_fee_bps: 50 }
const SPEC_SNAPSHOT = { schema_version: REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION, snapshot_id: "spec-1", venue_id: "binance-usdm", symbol: "BTCUSDT", effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-14T08:00:00Z", source_ref: "fixture:spec-1", source_hash: HASH }
const STATUS_SNAPSHOT = { schema_version: REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION, snapshot_id: "status-1", venue_id: "binance-usdm", symbol: "BTCUSDT", status: "trading" as const, effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-14T08:00:00Z", source_ref: "fixture:status-1", source_hash: HASH }
const ACCOUNTING = { spec_version: REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION, product_type: "linear_derivative" as const, base_asset: "BTC", quote_asset: "USDT", settlement_asset: "USDT", contract_multiplier: "1", price_increment: "0.01", quantity_increment: "0.001", settlement_increment: "0.00000001" }

function admission(dataHash: string): ForwardAdmissionRequest {
  const order: ReplayExecutionRequest["order"] = { side: "long", quantity: 1, signal_time: "2026-07-14T12:00:00Z", earliest_executable_time: "2026-07-14T16:00:00Z", stop_price: 95, target_price: 110 }
  const decisionSchedule = createReplaySingleDecisionSchedule(order)
  const authorization = {
    schema_version: DRAFT_AUTHORIZATION_SCHEMA_VERSION, decision: "accept_for_draft" as const,
    decision_id: "decision-1", reviewer_run_id: "review-1", primary_result_id: "result-1", primary_result_hash: HASH,
    selected_trial_id: "trial-1", selected_candidate_id: "candidate-1", candidate_frozen_at: "2026-07-14T08:00:00Z",
    identity: { schema_version: CONTROL_PLANE_IDENTITY_SCHEMA_VERSION, experiment_id: "experiment-1", trial_group_id: "group-1", trial_group_hash: HASH, trial_id: "trial-1", candidate_id: "candidate-1", candidate_hash: HASH, identity_hash_policy_version: "identity-v1", experiment_contract_hash: HASH },
  }
  const replayRequest: ReplayExecutionRequest = {
    schema_version: REPLAY_REQUEST_SCHEMA_VERSION, run_id: "forward-run-1", idempotency_key: "forward-replay-1",
    experiment_id: "experiment-1", trial_group_id: "group-1", trial_group_hash: HASH, trial_id: "trial-1", candidate_id: "candidate-1", candidate_hash: HASH,
    identity_hash_policy_version: "identity-v1", experiment_contract_hash: HASH, dataset_manifest_ref: "dataset://forward", dataset_hash: dataHash,
    supplemental_facts_hash: canonicalHash([]),
    supplemental_requirement_set: structuredClone(REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS),
    supplemental_requirement_set_hash: REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
    decision_market_input_requirement: structuredClone(REPLAY_NO_DECISION_MARKET_INPUT),
    decision_market_input_requirement_hash: REPLAY_NO_DECISION_MARKET_INPUT_HASH,
    decision_schedule: decisionSchedule, decision_schedule_hash: canonicalHash(decisionSchedule),
    trial_reservation_ref: "reservation://trial-1", trial_reservation_hash: HASH,
    venue_risk_policy_schedule_hash: canonicalHash([RISK_SNAPSHOT]), instrument_spec_schedule_hash: canonicalHash({ epochs: [SPEC_SNAPSHOT], accounting: ACCOUNTING }),
    instrument_status_schedule_hash: canonicalHash([STATUS_SNAPSHOT]),
    harness_hash: HASH, assumptions_hash: HASH, strategy_policy_hash: HASH, symbol: "BTCUSDT", timeframe: "4h", initial_cash: 1000,
    order,
    cost_policy: { policy_id: "fixture", version: "1", fee_bps: 0, slippage_bps: 0, liquidation_fee_bps: 50 },
    simulator_policy: { version: REPLAY_SIMULATOR_POLICY_VERSION, signal_visibility: "closed_candle", earliest_execution: "next_open", same_bar_policy: "stop_first", gap_fill_policy: "worse_open", position_accounting: "average_cost", funding_timing: "exact_event", end_of_data: "mark_open", margin_evaluation: "before_strategy_orders" },
    margin_policy: marginPolicy(), random_seed: 1,
  }
  const replayTrialReservation = authorize(replayRequest)
  return {
    schema_version: FORWARD_ADMISSION_SCHEMA_VERSION, session_id: "session-1", idempotency_key: "forward-1", forward_reservation_id: "reservation-1",
    frozen_at: "2026-07-14T08:00:00Z", data_watermark: "2026-07-14T20:00:00Z", forward_dataset_hash: dataHash,
    draft: { schema_version: STRATEGY_DRAFT_BINDING_SCHEMA_VERSION, draft_id: "draft-1", strategy_id: "S-CANDIDATE-1", strategy_version: "1", strategy_ref: "strategies/candidate-1.md", strategy_policy_hash: HASH, materialization_status: "ready", created_at: "2026-07-14T08:00:00Z", authorization },
    replay_request: replayRequest,
    replay_trial_reservation: replayTrialReservation,
  }
}

function authorize(request: ReplayExecutionRequest): TrialReservationSnapshot {
  const reservation: TrialReservationSnapshot = {
    schema_version: TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION, reservation_id: "reservation-1", reservation_ref: request.trial_reservation_ref,
    issued_at: "2026-07-14T08:00:00Z", expires_at: "2026-07-15T08:00:00Z", status: "reserved",
    identity: { schema_version: CONTROL_PLANE_IDENTITY_SCHEMA_VERSION, experiment_id: request.experiment_id, trial_group_id: request.trial_group_id, trial_group_hash: request.trial_group_hash, trial_id: request.trial_id, candidate_id: request.candidate_id, candidate_hash: request.candidate_hash, identity_hash_policy_version: request.identity_hash_policy_version, experiment_contract_hash: request.experiment_contract_hash },
    trial_ordinal: 1, run_id: request.run_id, counts_against_budget: true, trial_accounting_policy_version: "count-all-v1", candidate_assignment_hash: HASH,
    bindings: { replay_idempotency_key: request.idempotency_key, execution_spec_hash: replayExecutionSpecHash(request), dataset_manifest_ref: request.dataset_manifest_ref, dataset_hash: request.dataset_hash, supplemental_facts_hash: request.supplemental_facts_hash, supplemental_requirement_set_hash: request.supplemental_requirement_set_hash, venue_risk_policy_schedule_hash: request.venue_risk_policy_schedule_hash, instrument_spec_schedule_hash: request.instrument_spec_schedule_hash, instrument_status_schedule_hash: request.instrument_status_schedule_hash, harness_hash: request.harness_hash, assumptions_hash: request.assumptions_hash, cost_policy_hash: canonicalHash(request.cost_policy), margin_policy_hash: canonicalHash(request.margin_policy), simulator_policy_version: request.simulator_policy.version, execution_mode: "step" },
    required_capabilities: [...REPLAY_CERTIFIED_CAPABILITIES],
  }
  request.trial_reservation_hash = hashTrialReservationSnapshot(reservation)
  return reservation
}

function attemptLease(request: ReplayExecutionRequest, reservation: TrialReservationSnapshot): ReplayAttemptLeaseSnapshot {
  return {
    schema_version: REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
    attempt_id: "forward-attempt-1", attempt_ordinal: 1, worker_id: "forward-worker-1",
    trial_id: request.trial_id, run_id: request.run_id, reservation_ref: reservation.reservation_ref,
    reservation_hash: hashTrialReservationSnapshot(reservation), request_hash: canonicalHash(request),
    status: "running", lease_generation: 2, claimed_at: "2026-07-14T12:00:00Z",
    heartbeat_at: "2026-07-14T12:00:30Z", lease_expires_at: "2026-07-14T12:05:00Z",
  }
}

function marginPolicy() { return { policy_id: "fixture", version: "rd-replay-isolated-margin-v7" as const, mode: "isolated" as const, collateral_asset: "USDT", isolated_collateral: 1000, initial_margin_rate: 0.1, maintenance_tier: { ...MAINTENANCE_TIER }, cashflow_scope: "position_attributed" as const, collateral_transfer: "reserve_at_entry_release_at_terminal_if_flat" as const, settled_cashflow_account: "isolated_margin_collateral" as const, observation_scope: "source_event_path" as const, mark_source_policy: "complete_exact_mark_else_ohlcv_adverse" as const, maintenance_trigger: "margin_balance_below_maintenance_requirement" as const, breach_terminal_priority: "risk_before_strategy_exit" as const, breach_evidence: "first_observed_source_event" as const, maintenance_breach_action: "exact_observation_full_liquidation_else_terminal_failure" as const, liquidation: "simulated_full_close" as const, liquidation_trigger_sources: "mark_or_funding_mark" as const, liquidation_execution_price: "trigger_mark_adverse_slippage" as const, liquidation_quantity: "full_position" as const, liquidation_order_priority: "cancel_strategy_exits_before_forced_fill" as const, liquidation_deficit: "fail_without_result" as const } }

function datasetManifest(bars: ReplayMarketBar[], dataHash: string): ReplayDatasetManifest {
  return {
    schema_version: REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
    manifest_id: "forward-manifest-1", manifest_ref: "dataset://forward", data_hash: dataHash,
    dataset_kind: "ohlcv", symbol: "BTCUSDT", timeframe: "4h", interval_ms: 14_400_000,
    row_count: bars.length, first_open_time: bars[0].open_time, last_close_time: bars.at(-1)!.close_time,
    observed_through: bars.at(-1)!.close_time, closed_candles_only: true,
    bar_final_availability: "close_time", funding_availability: "event_time", mark_availability: "event_time",
    mark_coverage: "none", mark_interval_ms: null, mark_event_count: 0, supplemental_facts: { coverage: "none" as const, record_count: 0, source_ids: [], content_hash: canonicalHash([]), requirement_set_hash: "f126b641e1c2e55c174e3505e15232b466e50c3fd764f30968a925821c31d144" },
    venue_risk_policy_epochs: [RISK_SNAPSHOT],
    instrument: {
      listed_at: "2020-01-01T00:00:00Z", trading_enabled_at: "2020-01-01T00:00:00Z", delisted_at: null, status_history: "complete",
      status_epochs: [STATUS_SNAPSHOT],
      spec_epochs: [SPEC_SNAPSHOT],
      accounting: ACCOUNTING,
    },
    universe: { selected_at: "2026-07-14T08:00:00Z", survivorship: "point_in_time" },
  }
}

test("Forward executes only post-freeze closed bars through Replay semantics", () => {
  const bars: ReplayMarketBar[] = [{ open_time: "2026-07-14T16:00:00Z", close_time: "2026-07-14T20:00:00Z", open: 100, high: 111, low: 99, close: 110, volume: 10, closed: true }]
  const dataHash = replayDatasetHash(bars)
  const admitted = admission(dataHash)
  const result = runForwardEvidenceSession({
    admission: admitted, replay_attempt_lease: attemptLease(admitted.replay_request, admitted.replay_trial_reservation),
    replay_observed_at: "2026-07-14T12:01:00Z", dataset_manifest: datasetManifest(bars, dataHash), bars,
  })
  expect(result.status).toBe("completed")
  expect(result.replay_result?.fills[1].order_role).toBe("target")
  expect(result.limitations[0]?.code).toBe("rd-forward-evidence-only")
})

test("Forward rejects pre-freeze data instead of silently backfilling", () => {
  const bars: ReplayMarketBar[] = [{ open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 101, low: 99, close: 100, volume: 10, closed: true }]
  const dataHash = replayDatasetHash(bars)
  const admitted = admission(dataHash)
  const result = runForwardEvidenceSession({
    admission: admitted, replay_attempt_lease: attemptLease(admitted.replay_request, admitted.replay_trial_reservation),
    replay_observed_at: "2026-07-14T12:01:00Z", dataset_manifest: datasetManifest(bars, dataHash), bars,
  })
  expect(result.status).toBe("failed")
  expect(result.limitations[0]?.detail).toContain("pre-freeze")
})
