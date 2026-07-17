import { expect, test } from "bun:test"
import {
  REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_DECISION_MARKET_INPUT_REQUIREMENT_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
  REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS,
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
  REPLAY_REQUEST_SCHEMA_VERSION,
  REPLAY_SIMULATOR_POLICY_VERSION,
  REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION,
  canonicalHash,
  createReplayDecisionHarnessContext,
  createReplayDecisionStateSnapshot,
  createReplayInstrumentStatusProvenance,
  type ReplayDecisionScheduleEntry,
  type ReplayExecutionRequest,
  type ReplaySourceEvent,
} from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_ENTRY_SCHEMA_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_POLICY_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_SCHEMA_VERSION,
  createReplaySourceEventDecisionObservationHarnessContextBinding,
  createReplaySourceEventDecisionObservationHarnessContextBindingEntry,
  type ReplaySourceEventDecisionObservationHarnessContextBindingBody,
} from "../../../contracts/src/lib/replay-source-event-decision-observation-harness-context-binding"
import {
  assertReplayPositionOpenStateInputMaterialization,
} from "../../../contracts/src/lib/replay-position-open-state-input-materialization"
import {
  assertReplayPositionOpenStateInputMaterializationLineage,
  buildReplayPositionOpenStateInputMaterialization,
} from "./replay-position-open-state-input-materialization"

const HASH = "a".repeat(64)
const ACCOUNTING = {
  spec_version: REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
  product_type: "linear_derivative" as const,
  base_asset: "BTC", quote_asset: "USDT", settlement_asset: "USDT", contract_multiplier: "1",
  price_increment: "0.01", quantity_increment: "0.001", settlement_increment: "0.00000001",
}
const MAINTENANCE_TIER = {
  tier_id: "tier-1", snapshot_ref: "fixture:margin-tier-1", snapshot_hash: HASH,
  notional_floor: 0, notional_cap: 50_000, maintenance_margin_rate: 0.005, maintenance_amount: 0,
}
const RISK_SNAPSHOT = {
  schema_version: REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION,
  snapshot_id: "risk-1", venue_id: "binance-usdm", symbol: "BTCUSDT",
  effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z",
  source_ref: "fixture:risk-1", source_hash: HASH, initial_margin_rate: 0.1,
  maintenance_tier: MAINTENANCE_TIER, liquidation_fee_bps: 50,
}
const SPEC_SNAPSHOT = {
  schema_version: REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION,
  snapshot_id: "spec-1", venue_id: "binance-usdm", symbol: "BTCUSDT",
  effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z",
  source_ref: "fixture:spec-1", source_hash: HASH,
}
const STATUS_SNAPSHOT = {
  schema_version: REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
  snapshot_id: "status-1", venue_id: "binance-usdm", symbol: "BTCUSDT", status: "trading" as const,
  effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z",
  source_ref: "fixture:status-1", source_hash: HASH,
}
const STATUS_PROVENANCE = createReplayInstrumentStatusProvenance({
  producer_domain: "market-data-products", producer_id: "fixture-status-producer", producer_version: "v1",
  producer_build_hash: HASH, source_owner: "binance-usdm", provider_capability_hash: HASH,
  provider_certification_ref: "certification://fixture-status-provider/v1", provider_certification_hash: HASH,
  source_kind: "venue_status_event_archive", normalization_policy_version: "fixture-status-normalization-v1",
  normalization_policy_hash: HASH, completeness: "complete_history", coverage_start: "2020-01-01T00:00:00Z",
  coverage_end: "2030-01-01T00:00:00Z", source_observed_through: "2026-07-13T00:00:00Z",
  produced_at: "2026-07-13T00:00:00Z", source_ref: "fixture:status-source", source_hash: HASH,
  source_record_count: 1, status_epochs: [STATUS_SNAPSHOT],
})

function request(candidateHash = HASH): ReplayExecutionRequest {
  const order: ReplayExecutionRequest["order"] = {
    side: "long", quantity: 1, signal_time: "2026-07-14T04:00:00Z",
    earliest_executable_time: "2026-07-14T08:00:00Z", stop_price: 95, target_price: 110,
    entry_execution: { order_type: "market" },
  }
  const schedule = {
    schema_version: "trade.rd-replay-decision-schedule.v7" as const,
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
    dataset_manifest_ref: "dataset://fixture", dataset_hash: HASH,
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
    instrument_status_provider_certification_hash: HASH,
    harness_hash: HASH, assumptions_hash: HASH, symbol: "BTCUSDT", timeframe: "4h", initial_cash: 1000,
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

function contextBinding(requestValue: ReplayExecutionRequest) {
  const entries = requestValue.decision_schedule.entries.map((scheduleEntry: ReplayDecisionScheduleEntry) => {
    const context = createReplayDecisionHarnessContext(requestValue, scheduleEntry)
    return createReplaySourceEventDecisionObservationHarnessContextBindingEntry({
      schema_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_ENTRY_SCHEMA_VERSION,
      decision_sequence: scheduleEntry.decision_sequence, decision_time: scheduleEntry.decision_time,
      selected_expected_effect: scheduleEntry.expected_effect,
      selected_schedule_entry_hash: canonicalHash(scheduleEntry),
      schedule_binding_id: `fixture-schedule-binding-${scheduleEntry.decision_sequence}`,
      schedule_binding_hash: HASH,
      observation_projection_id: `fixture-observation-projection-${scheduleEntry.decision_sequence}`,
      observation_projection_hash: HASH, observation_as_of_time: scheduleEntry.decision_time,
      observation_count: 1, observations_hash: HASH, observation_values_hash: HASH,
      visibility_cut_hash: HASH, pit_payload_view_hash: HASH, harness_hash: requestValue.harness_hash,
      harness_context: context, harness_context_hash: canonicalHash(context),
    })
  })
  const bodyWithoutId: Omit<ReplaySourceEventDecisionObservationHarnessContextBindingBody, "binding_id"> = {
    schema_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_SCHEMA_VERSION,
    binding_policy_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_POLICY_VERSION,
    scope: "pre_integration_non_economic_observation_harness_context_binding",
    binding_purpose: "bind_admitted_observation_boundaries_to_frozen_harness_context_identity",
    authority_source: "control_plane_derivation_admission", context_derivation: "canonical_request_and_schedule_entry",
    observation_binding: "admitted_bundle_member_identity_only", decision_input_materialization: "not_certified",
    supplemental_input_compatibility: "not_bound", market_input_compatibility: "not_bound",
    state_input_compatibility: "not_bound", worker_request_compatibility: "not_bound",
    harness_invocation: "forbidden", decision_output_authority: "none", signal_authority: "none",
    order_authority: "none", economic_authority: "none", runner_compatibility: "not_bound",
    request_schema_version: requestValue.schema_version, request_hash: canonicalHash(requestValue),
    run_id: requestValue.run_id, experiment_id: requestValue.experiment_id,
    trial_group_id: requestValue.trial_group_id, trial_id: requestValue.trial_id,
    candidate_id: requestValue.candidate_id, candidate_hash: requestValue.candidate_hash,
    reservation_ref: requestValue.trial_reservation_ref, reservation_hash: requestValue.trial_reservation_hash,
    dataset_manifest_ref: requestValue.dataset_manifest_ref, dataset_hash: requestValue.dataset_hash,
    derivation_admission_id: "fixture-derivation-admission-1",
    derivation_admission_ref: "admission://fixture/derivation-1", derivation_admission_hash: HASH,
    bundle_id: "fixture-observation-bundle-1", bundle_hash: HASH,
    decision_schedule_hash: requestValue.decision_schedule_hash, harness_hash: requestValue.harness_hash,
    harness_context_schema_version: entries[0]!.harness_context.schema_version,
    entry_count: entries.length, entries, entries_hash: canonicalHash(entries),
    entry_hashes_hash: canonicalHash(entries.map((entry) => entry.entry_hash)),
    harness_context_hashes_hash: canonicalHash(entries.map((entry) => entry.harness_context_hash)),
    observation_projection_hashes_hash: canonicalHash(entries.map((entry) => entry.observation_projection_hash)),
    first_decision_time: entries[0]!.decision_time, last_decision_time: entries.at(-1)!.decision_time,
  }
  return createReplaySourceEventDecisionObservationHarnessContextBinding({
    ...bodyWithoutId,
    binding_id: `source-event-observation-harness-context-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
}

test("Engine materializes one position-open State input without creating Worker authority", () => {
  const requestValue = request()
  const binding = contextBinding(requestValue)
  const sourceEvents: ReplaySourceEvent[] = [{
    source_event_id: "source:bar_range:1", kind: "bar_range", source_index: 0,
    event_key: {
      event_time: "2026-07-14T08:00:00Z", boundary_phase: 20,
      source_sequence: 1, event_subphase: 0, stable_event_id: "source:bar_range:1",
    },
  }, {
    source_event_id: "source:bar_range:2", kind: "bar_range", source_index: 1,
    event_key: {
      event_time: "2026-07-14T12:00:00Z", boundary_phase: 20,
      source_sequence: 2, event_subphase: 0, stable_event_id: "source:bar_range:2",
    },
  }]
  const snapshot = createReplayDecisionStateSnapshot({
    schema_version: REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION,
    run_id: requestValue.run_id, decision_sequence: 2, decision_time: "2026-07-14T12:00:00Z",
    observation_event_key: structuredClone(sourceEvents[1]!.event_key),
    source_prefix_hash: canonicalHash(sourceEvents),
    position: { state: "open", side: "long", signed_quantity: 1, average_entry_price: 100 },
    active_protection: {
      stop: { order_id: "stop-1", status: "active", trigger_price: 95, remaining_quantity: 1 },
      target: { order_id: "target-1", status: "active", trigger_price: 110, remaining_quantity: 1 },
    },
    mark_price: 102, cash_balance: 999.9, total_fees: 0.1, total_funding: 0,
    unrealized_pnl: 2, equity: 1001.9,
  })
  const input = {
    request: requestValue,
    harness_context_binding: binding,
    decision_state_snapshot: snapshot,
    source_events: sourceEvents,
  }
  const materialization = buildReplayPositionOpenStateInputMaterialization(input)
  expect(materialization.owner).toBe("replay_engine_runtime")
  expect(materialization.economic_recomputation).toBe("not_performed")
  expect(materialization.source_event_count).toBe(2)
  expect(materialization.decision_state_snapshot_hash).toBe(snapshot.snapshot_hash)
  expect(materialization.worker_request_materialization).toBe("forbidden")
  expect(materialization.harness_invocation).toBe("forbidden")
  expect(() => assertReplayPositionOpenStateInputMaterialization(materialization)).not.toThrow()
  expect(() => assertReplayPositionOpenStateInputMaterializationLineage(materialization, input)).not.toThrow()
  expect(buildReplayPositionOpenStateInputMaterialization(structuredClone(input))).toEqual(materialization)

  expect(() => buildReplayPositionOpenStateInputMaterialization({
    ...input,
    source_events: sourceEvents.slice(1),
  })).toThrow("source prefix")
  expect(() => buildReplayPositionOpenStateInputMaterialization({
    ...input,
    source_events: [...sourceEvents, {
      source_event_id: "source:bar_open:3", kind: "bar_open", source_index: 2,
      event_key: {
        event_time: "2026-07-14T12:00:00Z", boundary_phase: 20,
        source_sequence: 3, event_subphase: 0, stable_event_id: "source:bar_open:3",
      },
    }],
  })).toThrow("exact complete source prefix")
  expect(() => buildReplayPositionOpenStateInputMaterialization({
    ...input,
    harness_context_binding: contextBinding(request("b".repeat(64))),
  })).toThrow("Request/Context binding drift")
  expect(() => assertReplayPositionOpenStateInputMaterialization({
    ...materialization,
    worker_request_materialization: "allowed" as never,
  })).toThrow("unsupported position-open State input materialization authority")
  const { snapshot_hash: _snapshotHash, ...snapshotBody } = snapshot
  expect(() => assertReplayPositionOpenStateInputMaterializationLineage(materialization, {
    ...input,
    decision_state_snapshot: createReplayDecisionStateSnapshot({
      ...snapshotBody,
      cash_balance: 999.8,
    }),
  })).toThrow("parent lineage drift")
})
