import {
  CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
  TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION,
  hashTrialReservationSnapshot,
  type TrialReservationSnapshot,
} from "../../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_CERTIFIED_CAPABILITIES,
  REPLAY_DECISION_MARKET_INPUT_REQUIREMENT_SCHEMA_VERSION,
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS,
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
  REPLAY_REQUEST_SCHEMA_VERSION,
  REPLAY_SIMULATOR_POLICY_VERSION,
  canonicalHash,
  replayExecutionSpecHash,
  type ReplayExecutionRequest,
} from "../../../../contracts/src/lib/replay-contracts"
import {
  ACCOUNTING,
  HASH,
  MAINTENANCE_TIER,
  PROVIDER_CERTIFICATION,
  RISK_SNAPSHOT,
  SPEC_SNAPSHOT,
  STATUS_PROVENANCE,
  STATUS_SNAPSHOT,
} from "./replay-worker-v10-market-fixture"

export function request(
  candidateHash = HASH,
  harnessHash = HASH,
  datasetHash = HASH,
): ReplayExecutionRequest {
  const order: ReplayExecutionRequest["order"] = {
    side: "long", quantity: 1, signal_time: "2026-07-14T04:00:00Z",
    earliest_executable_time: "2026-07-14T08:00:00Z", stop_price: 95, target_price: 110,
    entry_execution: { order_type: "market" },
  }
  const schedule = {
    schema_version: "trade.rd-replay-decision-schedule.v13" as const,
    schedule_policy: "frozen_closed_bar_schedule" as const,
    entries: [{
      decision_sequence: 1, decision_time: order.signal_time,
      expected_effect: "authorized_initial_order" as const,
      authorized_order_hash: canonicalHash(order), authorized_reduce_only_exit: null,
      authorized_protective_stop_replace: null, authorized_partial_reduce: null,
    }, {
      decision_sequence: 2, decision_time: "2026-07-14T12:00:00Z", expected_effect: "no_action" as const,
      authorized_order_hash: null, authorized_reduce_only_exit: null,
      authorized_protective_stop_replace: null, authorized_partial_reduce: null,
    }],
  }
  const marketRequirement = {
    schema_version: REPLAY_DECISION_MARKET_INPUT_REQUIREMENT_SCHEMA_VERSION,
    mode: "closed_bar_lookback" as const,
    source_kind: "ohlcv" as const,
    fields: ["open", "high", "low", "close", "volume"] as const,
    lookback_bars: 1,
    visibility_policy: "close_time_at_or_before_decision_time" as const,
    terminal_bar_policy: "close_time_equals_decision_time" as const,
    continuity_policy: "strict_interval_grid" as const,
    undeclared_input_policy: "reject" as const,
  }
  return {
    schema_version: REPLAY_REQUEST_SCHEMA_VERSION,
    run_id: "state-materialization-run", idempotency_key: "state-materialization-idem",
    experiment_id: "experiment-1", trial_group_id: "group-1", trial_group_hash: HASH,
    trial_id: "trial-1", candidate_id: "candidate-1", candidate_hash: candidateHash,
    identity_hash_policy_version: "rd-identity-v1", experiment_contract_hash: HASH,
    trial_reservation_ref: "reservation://trial-1", trial_reservation_hash: HASH,
    dataset_manifest_ref: "dataset://fixture", dataset_hash: datasetHash,
    supplemental_facts_hash: canonicalHash([]),
    supplemental_requirement_set: structuredClone(REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS),
    supplemental_requirement_set_hash: REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
    decision_market_input_requirement: marketRequirement,
    decision_market_input_requirement_hash: canonicalHash(marketRequirement),
    decision_schedule: schedule, decision_schedule_hash: canonicalHash(schedule),
    venue_risk_policy_schedule_hash: canonicalHash([RISK_SNAPSHOT]),
    instrument_spec_schedule_hash: canonicalHash({ epochs: [SPEC_SNAPSHOT], accounting: ACCOUNTING }),
    instrument_status_schedule_hash: canonicalHash([STATUS_SNAPSHOT]),
    instrument_status_provenance_hash: canonicalHash(STATUS_PROVENANCE),
    instrument_status_provider_capability_hash: HASH,
    instrument_status_provider_certification_hash: PROVIDER_CERTIFICATION.certification_hash,
    harness_hash: harnessHash, assumptions_hash: HASH, symbol: "BTCUSDT", timeframe: "4h", initial_cash: 1000,
    order, cost_policy: { policy_id: "fixture", version: "1", fee_bps: 0, slippage_bps: 0, liquidation_fee_bps: 50 },
    simulator_policy: {
      version: REPLAY_SIMULATOR_POLICY_VERSION, signal_visibility: "closed_candle",
      earliest_execution: "next_open", same_bar_policy: "stop_first", gap_fill_policy: "worse_open",
      position_accounting: "average_cost", funding_timing: "exact_event", end_of_data: "mark_open",
      margin_evaluation: "before_strategy_orders",
    },
    margin_policy: {
      policy_id: "fixture", version: "rd-replay-isolated-margin-v7", mode: "isolated",
      collateral_asset: "USDT", isolated_collateral: 1000, initial_margin_rate: 0.1,
      maintenance_tier: structuredClone(MAINTENANCE_TIER), cashflow_scope: "position_attributed",
      collateral_transfer: "reserve_at_entry_release_at_terminal_if_flat",
      settled_cashflow_account: "isolated_margin_collateral", observation_scope: "source_event_path",
      mark_source_policy: "complete_exact_mark_else_ohlcv_adverse",
      maintenance_trigger: "margin_balance_below_maintenance_requirement",
      breach_terminal_priority: "risk_before_strategy_exit", breach_evidence: "first_observed_source_event",
      maintenance_breach_action: "exact_observation_full_liquidation_else_terminal_failure",
      liquidation: "simulated_full_close", liquidation_trigger_sources: "mark_or_funding_mark",
      liquidation_execution_price: "trigger_mark_adverse_slippage", liquidation_quantity: "full_position",
      liquidation_order_priority: "cancel_strategy_exits_before_forced_fill",
      liquidation_deficit: "fail_without_result",
    },
    random_seed: 1,
  }
}

export function authorizeReplayTrialRequest(
  requestValue: ReplayExecutionRequest,
  options: {
    providerCertification?: TrialReservationSnapshot["instrument_status_provider_certification"]
  } = {},
): TrialReservationSnapshot {
  const reservation: TrialReservationSnapshot = {
    schema_version: TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION,
    reservation_id: `reservation:${requestValue.run_id}`,
    reservation_ref: requestValue.trial_reservation_ref,
    issued_at: "2026-07-14T00:00:00Z",
    expires_at: "2026-07-15T00:00:00Z",
    status: "reserved",
    identity: {
      schema_version: CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
      experiment_id: requestValue.experiment_id,
      trial_group_id: requestValue.trial_group_id,
      trial_group_hash: requestValue.trial_group_hash,
      trial_id: requestValue.trial_id,
      candidate_id: requestValue.candidate_id,
      candidate_hash: requestValue.candidate_hash,
      identity_hash_policy_version: requestValue.identity_hash_policy_version,
      experiment_contract_hash: requestValue.experiment_contract_hash,
    },
    trial_ordinal: 1,
    run_id: requestValue.run_id,
    counts_against_budget: true,
    trial_accounting_policy_version: "count-all-v1",
    candidate_assignment_hash: HASH,
    bindings: {
      replay_idempotency_key: requestValue.idempotency_key,
      execution_spec_hash: replayExecutionSpecHash(requestValue),
      dataset_manifest_ref: requestValue.dataset_manifest_ref,
      dataset_hash: requestValue.dataset_hash,
      liquidity_capacity_attestation_hash: requestValue.order.entry_execution.order_type === "market"
        ? null
        : requestValue.order.entry_execution.liquidity_capacity_attestation_hash,
      supplemental_facts_hash: requestValue.supplemental_facts_hash,
      supplemental_requirement_set_hash: requestValue.supplemental_requirement_set_hash,
      venue_risk_policy_schedule_hash: requestValue.venue_risk_policy_schedule_hash,
      instrument_spec_schedule_hash: requestValue.instrument_spec_schedule_hash,
      instrument_status_schedule_hash: requestValue.instrument_status_schedule_hash,
      instrument_status_provenance_hash: requestValue.instrument_status_provenance_hash,
      instrument_status_provider_capability_hash: requestValue.instrument_status_provider_capability_hash,
      instrument_status_provider_certification_hash: requestValue.instrument_status_provider_certification_hash,
      harness_hash: requestValue.harness_hash,
      assumptions_hash: requestValue.assumptions_hash,
      cost_policy_hash: canonicalHash(requestValue.cost_policy),
      margin_policy_hash: canonicalHash(requestValue.margin_policy),
      simulator_policy_version: requestValue.simulator_policy.version,
      execution_mode: "step",
    },
    instrument_status_provider_certification: options.providerCertification ?? PROVIDER_CERTIFICATION,
    required_capabilities: [...REPLAY_CERTIFIED_CAPABILITIES],
  }
  requestValue.trial_reservation_hash = hashTrialReservationSnapshot(reservation)
  return reservation
}

