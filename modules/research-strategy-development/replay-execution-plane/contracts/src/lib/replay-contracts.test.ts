import { expect, test } from "bun:test"
import {
  REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_BUILD_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_CAPABILITY_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_LOADER_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_RECEIPT_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_REGISTRY_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_REQUEST_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_RESPONSE_SCHEMA_VERSION,
  REPLAY_DECISION_BOUNDARY_SCHEMA_VERSION,
  REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_CONTEXT_SCHEMA_VERSION,
  REPLAY_DECISION_MARKET_INPUT_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_DECISION_MARKET_INPUT_REQUIREMENT_SCHEMA_VERSION,
  REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
  REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_REDUCE_ONLY_EXIT_INTENT_SCHEMA_VERSION,
  REPLAY_PROTECTIVE_STOP_REPLACE_INTENT_SCHEMA_VERSION,
  REPLAY_PARTIAL_REDUCE_INTENT_SCHEMA_VERSION,
  REPLAY_PARTIAL_REDUCE_PROTECTION_POLICY_VERSION,
  REPLAY_PARTIAL_REDUCE_CAPABILITY,
  REPLAY_CERTIFIED_CAPABILITIES,
  REPLAY_LOCAL_ARTIFACT_STORE_CAPABILITY,
  REPLAY_OBJECT_ARTIFACT_STORE_REQUIRED_CAPABILITY,
  REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
  REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS,
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
  REPLAY_NO_DECISION_MARKET_INPUT,
  REPLAY_NO_DECISION_MARKET_INPUT_HASH,
  REPLAY_REQUEST_SCHEMA_VERSION,
  REPLAY_SIMULATOR_POLICY_VERSION,
  REPLAY_SUPPLEMENTAL_FACT_SCHEMA_VERSION,
  REPLAY_SUPPLEMENTAL_REQUIREMENT_SET_SCHEMA_VERSION,
  REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION,
  assertReplayExecutionRequest,
  assertReplayDatasetManifest,
  assertReplayArtifactStoreCapability,
  assertReplayDecisionHarnessCapability,
  assertReplayDecisionHarnessBuildAttestation,
  assertReplayDecisionHarnessReceipt,
  assertReplayDecisionHarnessSourceBundle,
  assertReplayDecisionBoundary,
  assertReplayDecisionEvidenceTimeline,
  assertReplayDecisionInputSnapshot,
  assertReplayDecisionMarketInputSnapshot,
  assertReplayDecisionStateSnapshot,
  assertReplayDecisionStateSnapshotSourcePrefix,
  assertReplayDataGapFailureEvidence,
  assertReplayPartialReduceIntent,
  assertReplaySupplementalFact,
  assertReplaySupplementalRequirementSet,
  canonicalHash,
  createReplayDecisionHarnessBuildAttestation,
  createReplayDecisionHarnessContext,
  createReplayDecisionHarnessReceipt,
  createReplayDecisionHarnessSourceBundle,
  createReplayDecisionBoundary,
  createReplayDecisionEvidenceTimeline,
  createReplayDecisionInputSnapshot,
  createReplayEntryCancelIntent,
  createReplayDecisionMarketInputSnapshot,
  createReplayDecisionStateSnapshot,
  createReplayInstrumentStatusProvenance,
  createReplayLiquidityCapacityAttestation,
  createReplaySingleDecisionSchedule,
  replayAuthorizedInitialDecisionEvidenceEntry,
  replayAuthorizedInitialDecisionScheduleEntry,
  type ReplayExecutionRequest,
  type ReplayInstrumentStatusSnapshot,
} from "./replay-contracts"

const HASH = "a".repeat(64)
const MAINTENANCE_TIER = { tier_id: "tier-1", snapshot_ref: "fixture:margin-tier-1", snapshot_hash: HASH, notional_floor: 0, notional_cap: 50_000, maintenance_margin_rate: 0.005, maintenance_amount: 0 }
const RISK_SNAPSHOT = { schema_version: REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION, snapshot_id: "risk-1", venue_id: "binance-usdm", symbol: "BTCUSDT", effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z", source_ref: "fixture:risk-1", source_hash: HASH, initial_margin_rate: 0.1, maintenance_tier: MAINTENANCE_TIER, liquidation_fee_bps: 50 }
const SPEC_SNAPSHOT = { schema_version: REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION, snapshot_id: "spec-1", venue_id: "binance-usdm", symbol: "BTCUSDT", effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z", source_ref: "fixture:spec-1", source_hash: HASH }
const STATUS_SNAPSHOT = { schema_version: REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION, snapshot_id: "status-1", venue_id: "binance-usdm", symbol: "BTCUSDT", status: "trading" as const, effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z", source_ref: "fixture:status-1", source_hash: HASH }
const statusProvenance = (statusEpochs: ReplayInstrumentStatusSnapshot[] = [STATUS_SNAPSHOT], completeness: "complete_history" | "current_snapshot_only" = "complete_history") => createReplayInstrumentStatusProvenance({
  producer_domain: "market-data-products", producer_id: "fixture-status-producer", producer_version: "v1", producer_build_hash: HASH, source_owner: "binance-usdm",
  provider_capability_hash: HASH, provider_certification_ref: "certification://fixture-status-provider/v1", provider_certification_hash: HASH,
  source_kind: completeness === "complete_history" ? "venue_status_event_archive" : "venue_current_snapshot",
  normalization_policy_version: "fixture-status-normalization-v1", normalization_policy_hash: HASH, completeness,
  coverage_start: "2020-01-01T00:00:00Z", coverage_end: "2030-01-01T00:00:00Z",
  source_observed_through: "2026-07-13T00:00:00Z", produced_at: "2026-07-13T00:00:00Z",
  source_ref: "fixture:status-source", source_hash: HASH, source_record_count: statusEpochs.length, status_epochs: statusEpochs,
})

export function fixtureRequest(): ReplayExecutionRequest {
  const order: ReplayExecutionRequest["order"] = {
    side: "long", quantity: 1, signal_time: "2026-07-14T00:00:00Z",
    earliest_executable_time: "2026-07-14T04:00:00Z", stop_price: 95, target_price: 110,
    entry_execution: { order_type: "market" },
  }
  const decisionSchedule = createReplaySingleDecisionSchedule(order)
  return {
    schema_version: REPLAY_REQUEST_SCHEMA_VERSION,
    run_id: "run-1",
    idempotency_key: "replay-1",
    experiment_id: "experiment-1",
    trial_group_id: "group-1",
    trial_group_hash: HASH,
    trial_id: "trial-1",
    candidate_id: "candidate-1",
    candidate_hash: HASH,
    identity_hash_policy_version: "rd-identity-v1",
    experiment_contract_hash: HASH,
    trial_reservation_ref: "reservation://trial-1",
    trial_reservation_hash: HASH,
    dataset_manifest_ref: "dataset://btc-4h",
    dataset_hash: HASH,
    supplemental_facts_hash: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    supplemental_requirement_set: structuredClone(REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS),
    supplemental_requirement_set_hash: REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
    decision_market_input_requirement: structuredClone(REPLAY_NO_DECISION_MARKET_INPUT),
    decision_market_input_requirement_hash: REPLAY_NO_DECISION_MARKET_INPUT_HASH,
    decision_schedule: decisionSchedule,
    decision_schedule_hash: canonicalHash(decisionSchedule),
    venue_risk_policy_schedule_hash: canonicalHash([RISK_SNAPSHOT]),
    instrument_spec_schedule_hash: HASH,
    instrument_status_schedule_hash: canonicalHash([STATUS_SNAPSHOT]),
    instrument_status_provenance_hash: canonicalHash(statusProvenance()),
    instrument_status_provider_capability_hash: HASH,
    instrument_status_provider_certification_hash: HASH,
    harness_hash: HASH,
    assumptions_hash: HASH,
    symbol: "BTCUSDT",
    timeframe: "4h",
    initial_cash: 10_000,
    order,
    cost_policy: { policy_id: "standard", version: "1", fee_bps: 2, slippage_bps: 1, liquidation_fee_bps: 50 },
    simulator_policy: {
      version: REPLAY_SIMULATOR_POLICY_VERSION,
      signal_visibility: "closed_candle",
      earliest_execution: "next_open",
      same_bar_policy: "stop_first",
      gap_fill_policy: "worse_open",
      position_accounting: "average_cost",
      funding_timing: "exact_event",
      end_of_data: "mark_open",
      margin_evaluation: "before_strategy_orders",
    },
    margin_policy: { policy_id: "fixture", version: "rd-replay-isolated-margin-v7", mode: "isolated", collateral_asset: "USDT", isolated_collateral: 1000, initial_margin_rate: 0.1, maintenance_tier: { ...MAINTENANCE_TIER }, cashflow_scope: "position_attributed", collateral_transfer: "reserve_at_entry_release_at_terminal_if_flat", settled_cashflow_account: "isolated_margin_collateral", observation_scope: "source_event_path", mark_source_policy: "complete_exact_mark_else_ohlcv_adverse", maintenance_trigger: "margin_balance_below_maintenance_requirement", breach_terminal_priority: "risk_before_strategy_exit", breach_evidence: "first_observed_source_event", maintenance_breach_action: "exact_observation_full_liquidation_else_terminal_failure", liquidation: "simulated_full_close", liquidation_trigger_sources: "mark_or_funding_mark", liquidation_execution_price: "trigger_mark_adverse_slippage", liquidation_quantity: "full_position", liquidation_order_priority: "cancel_strategy_exits_before_forced_fill", liquidation_deficit: "fail_without_result" },
    random_seed: 7,
  }
}

test("Replay request requires complete Trial and evidence identity", () => {
  expect(() => assertReplayExecutionRequest(fixtureRequest())).not.toThrow()
  expect(() => assertReplayExecutionRequest({ ...fixtureRequest(), dataset_hash: "weak" })).toThrow()
  expect(() => assertReplayExecutionRequest({ ...fixtureRequest(), instrument_status_schedule_hash: "weak" })).toThrow()
  expect(() => assertReplayExecutionRequest({ ...fixtureRequest(), instrument_status_provenance_hash: "weak" })).toThrow()
  expect(() => assertReplayExecutionRequest({ ...fixtureRequest(), instrument_status_provider_capability_hash: "weak" })).toThrow()
  expect(() => assertReplayExecutionRequest({ ...fixtureRequest(), instrument_status_provider_certification_hash: "weak" })).toThrow()
  expect(() => assertReplayExecutionRequest({ ...fixtureRequest(), decision_schedule_hash: HASH })).toThrow("decision schedule hash mismatch")
  const unauthorizedSchedule = fixtureRequest()
  unauthorizedSchedule.decision_schedule = {
    ...unauthorizedSchedule.decision_schedule,
    entries: [
      { decision_sequence: 1, decision_time: "2026-07-13T20:00:00Z", expected_effect: "no_action", authorized_reduce_only_exit: null, authorized_protective_stop_replace: null, authorized_partial_reduce: null, authorized_order_hash: null },
      { ...unauthorizedSchedule.decision_schedule.entries[0]!, decision_sequence: 2 },
    ],
  }
  unauthorizedSchedule.decision_schedule_hash = canonicalHash(unauthorizedSchedule.decision_schedule)
  expect(() => assertReplayExecutionRequest(unauthorizedSchedule)).toThrow("market-only closed-bar lookback")
})

test("Request v28 freezes GTC, IOC, and one contract-owned GTC cancel boundary", () => {
  const requestValue = fixtureRequest()
  requestValue.order = {
    ...requestValue.order,
    entry_execution: {
      order_type: "limit", limit_price: 99.5, time_in_force: "gtc",
      liquidity_model: "ohlcv-cross-through-full-fill-bounded-v1", full_fill_capacity: 1,
      liquidity_capacity_attestation_hash: HASH,
    },
  }
  requestValue.decision_schedule = createReplaySingleDecisionSchedule(requestValue.order)
  requestValue.decision_schedule_hash = canonicalHash(requestValue.decision_schedule)
  expect(() => assertReplayExecutionRequest(requestValue)).not.toThrow()
  const ioc = structuredClone(requestValue)
  if (ioc.order.entry_execution.order_type !== "limit") throw new Error("fixture must be Limit")
  ioc.order.entry_execution.time_in_force = "ioc"
  ioc.decision_schedule = createReplaySingleDecisionSchedule(ioc.order)
  ioc.decision_schedule_hash = canonicalHash(ioc.decision_schedule)
  expect(() => assertReplayExecutionRequest(ioc)).not.toThrow()
  const cancelled = structuredClone(requestValue)
  cancelled.order.entry_cancel_intent = createReplayEntryCancelIntent({
    intent_id: "cancel-entry-1",
    requested_at: cancelled.order.signal_time,
    effective_at: "2026-07-14T08:00:00Z",
  })
  cancelled.decision_schedule = createReplaySingleDecisionSchedule(cancelled.order)
  cancelled.decision_schedule_hash = canonicalHash(cancelled.decision_schedule)
  expect(() => assertReplayExecutionRequest(cancelled)).not.toThrow()
  const cancelHashTampered = structuredClone(cancelled)
  cancelHashTampered.order.entry_cancel_intent!.effective_at = "2026-07-14T12:00:00Z"
  cancelHashTampered.decision_schedule = createReplaySingleDecisionSchedule(cancelHashTampered.order)
  cancelHashTampered.decision_schedule_hash = canonicalHash(cancelHashTampered.decision_schedule)
  expect(() => assertReplayExecutionRequest(cancelHashTampered)).toThrow("intent hash mismatch")
  const iocCancelled = structuredClone(ioc)
  iocCancelled.order.entry_cancel_intent = cancelled.order.entry_cancel_intent
  iocCancelled.decision_schedule = createReplaySingleDecisionSchedule(iocCancelled.order)
  iocCancelled.decision_schedule_hash = canonicalHash(iocCancelled.decision_schedule)
  expect(() => assertReplayExecutionRequest(iocCancelled)).toThrow("requires one GTC Limit")
  const overCapacity = structuredClone(requestValue)
  if (overCapacity.order.entry_execution.order_type !== "limit") throw new Error("fixture must be Limit")
  overCapacity.order.entry_execution.full_fill_capacity = 0.5
  overCapacity.decision_schedule = createReplaySingleDecisionSchedule(overCapacity.order)
  overCapacity.decision_schedule_hash = canonicalHash(overCapacity.decision_schedule)
  expect(() => assertReplayExecutionRequest(overCapacity)).toThrow("exceeds frozen full-fill capacity")
})

test("authorized initial decision lookup is semantic rather than positional", () => {
  const requestValue = fixtureRequest()
  const authorizedScheduleEntry = requestValue.decision_schedule.entries[0]!
  const noActionScheduleEntry = {
    decision_sequence: 2,
    decision_time: "2026-07-14T08:00:00Z",
    expected_effect: "no_action" as const,
    authorized_reduce_only_exit: null,
    authorized_protective_stop_replace: null,
    authorized_partial_reduce: null,
    authorized_order_hash: null,
  }
  const nonPositionalRequest = {
    ...requestValue,
    decision_schedule: {
      ...requestValue.decision_schedule,
      entries: [authorizedScheduleEntry, noActionScheduleEntry],
    },
  }
  expect(replayAuthorizedInitialDecisionScheduleEntry(nonPositionalRequest)).toEqual(authorizedScheduleEntry)

  const inputSnapshot = createReplayDecisionInputSnapshot(requestValue, [])
  const marketSnapshot = createReplayDecisionMarketInputSnapshot({ request: requestValue, interval_ms: 14_400_000, bars: [] })
  const timeline = createReplayDecisionEvidenceTimeline({
    request: requestValue,
    decisions: [{
      schedule_entry: authorizedScheduleEntry,
      decision_input_snapshot: inputSnapshot,
      decision_market_input_snapshot: marketSnapshot,
    }],
  })
  const authorizedEvidenceEntry = timeline.entries[0]!
  const nonPositionalTimeline = {
    ...timeline,
    entries: [{ ...authorizedEvidenceEntry, execution_effect: "no_action" as const }, authorizedEvidenceEntry],
  }
  expect(replayAuthorizedInitialDecisionEvidenceEntry(nonPositionalTimeline)).toEqual(authorizedEvidenceEntry)
})

test("decision schedule freezes one final full-position reduce-only market exit", () => {
  const requestValue = fixtureRequest()
  const requirement = {
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
  const exitIntent = {
    schema_version: REPLAY_REDUCE_ONLY_EXIT_INTENT_SCHEMA_VERSION,
    side: "sell" as const,
    order_type: "market" as const,
    reduce_only: true as const,
    quantity_policy: "full_open_position" as const,
    signal_time: "2026-07-14T08:00:00Z",
    earliest_executable_time: "2026-07-14T12:00:00Z",
  }
  requestValue.decision_market_input_requirement = requirement
  requestValue.decision_market_input_requirement_hash = canonicalHash(requirement)
  requestValue.decision_schedule = {
    schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
    schedule_policy: "frozen_closed_bar_schedule",
    entries: [
      requestValue.decision_schedule.entries[0]!,
      {
        decision_sequence: 2,
        decision_time: exitIntent.signal_time,
        expected_effect: "authorized_reduce_only_exit",
        authorized_reduce_only_exit: exitIntent,
        authorized_protective_stop_replace: null,
        authorized_partial_reduce: null,
        authorized_order_hash: canonicalHash(exitIntent),
      },
    ],
  }
  requestValue.decision_schedule_hash = canonicalHash(requestValue.decision_schedule)
  expect(() => assertReplayExecutionRequest(requestValue)).not.toThrow()

  const wrongSide = structuredClone(requestValue)
  wrongSide.decision_schedule.entries[1]!.authorized_reduce_only_exit!.side = "buy"
  wrongSide.decision_schedule.entries[1]!.authorized_order_hash = canonicalHash(
    wrongSide.decision_schedule.entries[1]!.authorized_reduce_only_exit,
  )
  wrongSide.decision_schedule_hash = canonicalHash(wrongSide.decision_schedule)
  expect(() => assertReplayExecutionRequest(wrongSide)).toThrow("opposite-side")

  const notFinal = structuredClone(requestValue)
  notFinal.decision_schedule.entries.push({
    decision_sequence: 3,
    decision_time: "2026-07-14T16:00:00Z",
    expected_effect: "no_action",
    authorized_reduce_only_exit: null,
    authorized_protective_stop_replace: null,
    authorized_partial_reduce: null,
    authorized_order_hash: null,
  })
  notFinal.decision_schedule_hash = canonicalHash(notFinal.decision_schedule)
  expect(() => assertReplayExecutionRequest(notFinal)).toThrow("final full-position")
})

test("decision schedule permits one full-position tighten-only protective stop replacement", () => {
  const requestValue = fixtureRequest()
  const requirement = {
    schema_version: REPLAY_DECISION_MARKET_INPUT_REQUIREMENT_SCHEMA_VERSION,
    mode: "closed_bar_lookback" as const, source_kind: "ohlcv" as const,
    fields: ["open", "high", "low", "close", "volume"] as const, lookback_bars: 1,
    visibility_policy: "close_time_at_or_before_decision_time" as const,
    terminal_bar_policy: "close_time_equals_decision_time" as const,
    continuity_policy: "strict_interval_grid" as const, undeclared_input_policy: "reject" as const,
  }
  const replaceIntent = {
    schema_version: REPLAY_PROTECTIVE_STOP_REPLACE_INTENT_SCHEMA_VERSION,
    side: "sell" as const, order_type: "stop_market" as const, reduce_only: true as const,
    quantity_policy: "full_open_position" as const,
    replace_policy: "tighten_only_cancel_then_submit" as const,
    signal_time: "2026-07-14T08:00:00Z", previous_stop_price: 95, new_stop_price: 101,
  }
  requestValue.decision_market_input_requirement = requirement
  requestValue.decision_market_input_requirement_hash = canonicalHash(requirement)
  requestValue.decision_schedule = {
    schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
    schedule_policy: "frozen_closed_bar_schedule",
    entries: [
      requestValue.decision_schedule.entries[0]!,
      {
        decision_sequence: 2, decision_time: replaceIntent.signal_time,
        expected_effect: "authorized_protective_stop_replace",
        authorized_reduce_only_exit: null,
        authorized_protective_stop_replace: replaceIntent,
        authorized_partial_reduce: null,
        authorized_order_hash: canonicalHash(replaceIntent),
      },
    ],
  }
  requestValue.decision_schedule_hash = canonicalHash(requestValue.decision_schedule)
  expect(() => assertReplayExecutionRequest(requestValue)).not.toThrow()

  const loosened = structuredClone(requestValue)
  loosened.decision_schedule.entries[1]!.authorized_protective_stop_replace!.new_stop_price = 94
  loosened.decision_schedule.entries[1]!.authorized_order_hash = canonicalHash(
    loosened.decision_schedule.entries[1]!.authorized_protective_stop_replace,
  )
  loosened.decision_schedule_hash = canonicalHash(loosened.decision_schedule)
  expect(() => assertReplayExecutionRequest(loosened)).toThrow("must tighten")
})

test("decision schedule certifies one non-terminal fixed-quantity partial reduce", () => {
  const initialOrder = fixtureRequest().order
  const partial = {
    schema_version: REPLAY_PARTIAL_REDUCE_INTENT_SCHEMA_VERSION,
    side: "sell" as const,
    order_type: "market" as const,
    reduce_only: true as const,
    quantity_policy: "fixed_quantity" as const,
    quantity: 0.4,
    signal_time: "2026-07-14T08:00:00Z",
    earliest_executable_time: "2026-07-14T12:00:00Z",
    post_fill_position_policy: "must_remain_open" as const,
    protection_resize_policy: "after_fill_cancel_both_then_replace_remaining_at_same_source_boundary" as const,
    protection_policy_version: REPLAY_PARTIAL_REDUCE_PROTECTION_POLICY_VERSION,
    replacement_trigger_policy: "preserve_current_stop_and_target_prices" as const,
    remaining_quantity_authority: "absolute_post_fill_position" as const,
    schedule_combination_policy: "one_partial_reduce_then_optional_final_full_exit_no_stop_replace" as const,
  }
  expect(() => assertReplayPartialReduceIntent(partial, initialOrder)).not.toThrow()
  expect(REPLAY_CERTIFIED_CAPABILITIES).toContain(REPLAY_PARTIAL_REDUCE_CAPABILITY)

  const requestValue = fixtureRequest()
  requestValue.decision_market_input_requirement = {
    schema_version: REPLAY_DECISION_MARKET_INPUT_REQUIREMENT_SCHEMA_VERSION,
    mode: "closed_bar_lookback", source_kind: "ohlcv",
    fields: ["open", "high", "low", "close", "volume"], lookback_bars: 1,
    visibility_policy: "close_time_at_or_before_decision_time",
    terminal_bar_policy: "close_time_equals_decision_time",
    continuity_policy: "strict_interval_grid", undeclared_input_policy: "reject",
  }
  requestValue.decision_market_input_requirement_hash = canonicalHash(requestValue.decision_market_input_requirement)
  requestValue.decision_schedule = {
    schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
    schedule_policy: "frozen_closed_bar_schedule",
    entries: [requestValue.decision_schedule.entries[0]!, {
      decision_sequence: 2, decision_time: partial.signal_time,
      expected_effect: "authorized_partial_reduce", authorized_reduce_only_exit: null,
      authorized_protective_stop_replace: null, authorized_partial_reduce: partial,
      authorized_order_hash: canonicalHash(partial),
    }],
  }
  requestValue.decision_schedule_hash = canonicalHash(requestValue.decision_schedule)
  expect(() => assertReplayExecutionRequest(requestValue)).not.toThrow()

  const combinedWithStopReplace = structuredClone(requestValue)
  const replace = {
    schema_version: REPLAY_PROTECTIVE_STOP_REPLACE_INTENT_SCHEMA_VERSION,
    side: "sell" as const, order_type: "stop_market" as const, reduce_only: true as const,
    quantity_policy: "full_open_position" as const,
    replace_policy: "tighten_only_cancel_then_submit" as const,
    signal_time: "2026-07-14T12:00:00Z", previous_stop_price: 95, new_stop_price: 101,
  }
  combinedWithStopReplace.decision_schedule.entries.push({
    decision_sequence: 3, decision_time: replace.signal_time,
    expected_effect: "authorized_protective_stop_replace", authorized_reduce_only_exit: null,
    authorized_protective_stop_replace: replace, authorized_partial_reduce: null,
    authorized_order_hash: canonicalHash(replace),
  })
  combinedWithStopReplace.decision_schedule_hash = canonicalHash(combinedWithStopReplace.decision_schedule)
  expect(() => assertReplayExecutionRequest(combinedWithStopReplace)).toThrow("cannot be combined")

  const duplicate = structuredClone(requestValue)
  const secondPartial = {
    ...partial, signal_time: "2026-07-14T16:00:00Z", earliest_executable_time: "2026-07-14T20:00:00Z",
  }
  duplicate.decision_schedule.entries.push({
    decision_sequence: 3, decision_time: secondPartial.signal_time,
    expected_effect: "authorized_partial_reduce", authorized_reduce_only_exit: null,
    authorized_protective_stop_replace: null, authorized_partial_reduce: secondPartial,
    authorized_order_hash: canonicalHash(secondPartial),
  })
  duplicate.decision_schedule_hash = canonicalHash(duplicate.decision_schedule)
  expect(() => assertReplayExecutionRequest(duplicate)).toThrow("at most one partial reduce")

  expect(() => assertReplayPartialReduceIntent({ ...partial, quantity: initialOrder.quantity }, initialOrder))
    .toThrow("must leave an open position")
  expect(() => assertReplayPartialReduceIntent({ ...partial, side: "buy" }, initialOrder))
    .toThrow("unsupported Replay partial-reduce")
  expect(() => assertReplayPartialReduceIntent({
    ...partial, protection_resize_policy: "cancel_then_amend" as never,
  }, initialOrder)).toThrow("unsupported Replay partial-reduce")
  expect(() => assertReplayPartialReduceIntent({
    ...partial, earliest_executable_time: partial.signal_time,
  }, initialOrder)).toThrow("must follow signal time")

  const shortOrder = { ...initialOrder, side: "short" as const, stop_price: 105, target_price: 90 }
  expect(() => assertReplayPartialReduceIntent({ ...partial, side: "buy" }, shortOrder)).not.toThrow()
})

test("position-open decision state snapshot is self-hashed monetary evidence", () => {
  const sourceEvents = [{
    source_event_id: "source:bar_range:2",
    kind: "bar_range" as const,
    source_index: 1,
    event_key: {
      event_time: "2026-07-14T08:00:00Z", boundary_phase: 20 as const,
      source_sequence: 2, event_subphase: 0, stable_event_id: "source:bar_range:2",
    },
  }]
  const snapshot = createReplayDecisionStateSnapshot({
    schema_version: REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION,
    run_id: "run-state-1",
    decision_sequence: 2,
    decision_time: "2026-07-14T08:00:00Z",
    observation_event_key: {
      event_time: "2026-07-14T08:00:00Z", boundary_phase: 20,
      source_sequence: 2, event_subphase: 0, stable_event_id: "source:bar_range:2",
    },
    source_prefix_hash: canonicalHash(sourceEvents),
    position: { state: "open", side: "long", signed_quantity: 1, average_entry_price: 100 },
    active_protection: {
      stop: { order_id: "run-state-1:order:stop", status: "active", trigger_price: 95, remaining_quantity: 1 },
      target: { order_id: "run-state-1:order:target", status: "active", trigger_price: 110, remaining_quantity: 1 },
    },
    mark_price: 102,
    cash_balance: 999.9,
    total_fees: 0.1,
    total_funding: 0,
    unrealized_pnl: 2,
    equity: 1001.9,
  })
  expect(() => assertReplayDecisionStateSnapshot(snapshot)).not.toThrow()
  expect(() => assertReplayDecisionStateSnapshotSourcePrefix(snapshot, sourceEvents)).not.toThrow()
  expect(() => assertReplayDecisionStateSnapshotSourcePrefix(snapshot, [])).toThrow("source prefix")
  expect(() => assertReplayDecisionStateSnapshot({ ...snapshot, cash_balance: 1000 })).toThrow("hash mismatch")
})

test("Replay request freezes one bounded isolated maintenance tier", () => {
  const excessiveCollateral = fixtureRequest()
  excessiveCollateral.margin_policy.isolated_collateral = excessiveCollateral.initial_cash + 1
  expect(() => assertReplayExecutionRequest(excessiveCollateral)).toThrow("cannot exceed initial cash")
  const invertedRates = fixtureRequest()
  invertedRates.margin_policy.maintenance_tier.maintenance_margin_rate = invertedRates.margin_policy.initial_margin_rate
  expect(() => assertReplayExecutionRequest(invertedRates)).toThrow("must be below initial margin rate")
  const unfrozenTransfer = fixtureRequest()
  ;(unfrozenTransfer.margin_policy as unknown as { collateral_transfer?: string }).collateral_transfer = undefined
  expect(() => assertReplayExecutionRequest(unfrozenTransfer)).toThrow("unsupported isolated margin policy")
  const unfrozenBreachPriority = fixtureRequest()
  ;(unfrozenBreachPriority.margin_policy as unknown as { breach_terminal_priority?: string }).breach_terminal_priority = undefined
  expect(() => assertReplayExecutionRequest(unfrozenBreachPriority)).toThrow("unsupported isolated margin policy")
  const negativeLiquidationFee = fixtureRequest()
  negativeLiquidationFee.cost_policy.liquidation_fee_bps = -1
  expect(() => assertReplayExecutionRequest(negativeLiquidationFee)).toThrow("liquidation_fee_bps")
  const unfrozenLiquidationPrice = fixtureRequest()
  ;(unfrozenLiquidationPrice.margin_policy as unknown as { liquidation_execution_price?: string }).liquidation_execution_price = undefined
  expect(() => assertReplayExecutionRequest(unfrozenLiquidationPrice)).toThrow("unsupported isolated margin policy")
})

test("canonical hash is independent of object key order", () => {
  expect(canonicalHash({ b: 2, a: 1 })).toBe(canonicalHash({ a: 1, b: 2 }))
})

test("supplemental fact freezes causal timestamps and canonical payload identity", () => {
  const payload = { open_interest: "100" }
  const fact = {
    schema_version: REPLAY_SUPPLEMENTAL_FACT_SCHEMA_VERSION,
    record_id: "oi-1", source_id: "binance-open-interest", entity_key: "BTCUSDT", fact_key: "open_interest",
    event_time: "2026-07-13T20:00:00Z", availability_at: "2026-07-13T20:01:00Z", received_at: "2026-07-13T20:01:01Z",
    revision_id: "v1", source_sequence: 1, payload, content_hash: canonicalHash(payload),
  }
  expect(() => assertReplaySupplementalFact(fact)).not.toThrow()
  expect(() => assertReplaySupplementalFact({ ...fact, availability_at: "2026-07-13T19:59:59Z" })).toThrow("before its event time")
  expect(() => assertReplaySupplementalFact({ ...fact, payload: { open_interest: "101" } })).toThrow("payload hash mismatch")
})

test("Decision Input Snapshot and Harness Receipt are self-hashed immutable evidence", () => {
  const requestValue = fixtureRequest()
  const sourceBundle = createReplayDecisionHarnessSourceBundle({
    bundle_ref: "harness://fixture/decision-v1",
    entrypoint: { file_path: "src/decision.ts", export_name: "execute" },
    files: [
      { path: "src/decision.ts", content_utf8: "export function execute(input) { return input.request.order }\n" },
      { path: "src/constants.ts", content_utf8: "export const version = 1\n" },
    ],
  })
  requestValue.harness_hash = sourceBundle.bundle_hash
  expect(sourceBundle.files.map((file) => file.path)).toEqual(["src/constants.ts", "src/decision.ts"])
  expect(() => assertReplayDecisionHarnessSourceBundle(sourceBundle, requestValue)).not.toThrow()
  expect(() => assertReplayDecisionHarnessSourceBundle({
    ...sourceBundle,
    files: [{ ...sourceBundle.files[0], content_utf8: `${sourceBundle.files[0].content_utf8}// tampered\n` }, sourceBundle.files[1]],
  }, requestValue)).toThrow("source file hash mismatch")
  requestValue.supplemental_requirement_set = {
    schema_version: REPLAY_SUPPLEMENTAL_REQUIREMENT_SET_SCHEMA_VERSION,
    mode: "signal_time_complete",
    undeclared_input_policy: "reject",
    requirements: [],
  }
  requestValue.supplemental_requirement_set_hash = canonicalHash(requestValue.supplemental_requirement_set)
  const snapshot = createReplayDecisionInputSnapshot(requestValue, [])
  const marketSnapshot = createReplayDecisionMarketInputSnapshot({ request: requestValue, interval_ms: 14_400_000, bars: [] })
  expect(snapshot).toMatchObject({
    schema_version: REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION,
    selected_records_hash: canonicalHash([]),
  })
  expect(() => assertReplayDecisionInputSnapshot(snapshot, requestValue)).not.toThrow()
  expect(() => assertReplayDecisionInputSnapshot({ ...snapshot, decision_time: "2026-07-13T23:59:59Z" }, requestValue)).toThrow()

  const buildAttestation = createReplayDecisionHarnessBuildAttestation({
    source_bundle: sourceBundle,
    runtime_version: "fixture-bun",
    runtime_executable_sha256: HASH,
    artifact_content_utf8: "export default 1\n",
  })
  expect(() => assertReplayDecisionHarnessBuildAttestation({
    ...buildAttestation,
    artifact: { ...buildAttestation.artifact, content_utf8: `${buildAttestation.artifact.content_utf8}// tampered\n` },
  }, sourceBundle)).toThrow("artifact hash mismatch")
  const workerRequest = {
    schema_version: REPLAY_DECISION_HARNESS_WORKER_REQUEST_SCHEMA_VERSION,
    invocation_id: HASH,
    source_bundle_hash: sourceBundle.bundle_hash,
    artifact_hash: buildAttestation.artifact.sha256,
    request_context: createReplayDecisionHarnessContext(requestValue),
    decision_input_snapshot: snapshot,
    decision_market_input_snapshot: marketSnapshot,
    decision_state_snapshot: null,
  }
  const workerResponse = {
    schema_version: REPLAY_DECISION_HARNESS_WORKER_RESPONSE_SCHEMA_VERSION,
    invocation_id: HASH,
    source_bundle_hash: sourceBundle.bundle_hash,
    artifact_hash: buildAttestation.artifact.sha256,
    decision_output: { action: "submit_initial_order" as const, order: requestValue.order },
    trace: { selected_records_hash: snapshot.selected_records_hash },
  }

  const capability = {
    schema_version: REPLAY_DECISION_HARNESS_CAPABILITY_SCHEMA_VERSION,
    harness_hash: requestValue.harness_hash,
    source_bundle_ref: sourceBundle.bundle_ref,
    source_bundle_hash: sourceBundle.bundle_hash,
    build_attestation_hash: buildAttestation.attestation_hash,
    build_artifact_hash: buildAttestation.artifact.sha256,
    runtime_executable_hash: buildAttestation.runtime.executable_sha256,
    registry_policy_version: REPLAY_DECISION_HARNESS_REGISTRY_POLICY_VERSION,
    build_policy_version: REPLAY_DECISION_HARNESS_BUILD_POLICY_VERSION,
    loader_policy_version: REPLAY_DECISION_HARNESS_LOADER_POLICY_VERSION,
    worker_protocol_version: REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION,
    execution_policy: "fresh_subprocess_stdio_reproducibility_pair" as const,
    context_schema_version: REPLAY_DECISION_HARNESS_CONTEXT_SCHEMA_VERSION,
    supplemental_input_schema_version: REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION,
    market_input_schema_version: REPLAY_DECISION_MARKET_INPUT_SNAPSHOT_SCHEMA_VERSION,
    state_input_schema_version: REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION,
    output_schema_version: REPLAY_DECISION_HARNESS_RECEIPT_SCHEMA_VERSION,
  }
  expect(() => assertReplayDecisionHarnessCapability(capability, requestValue)).not.toThrow()
  expect(() => assertReplayDecisionHarnessCapability({ ...capability, harness_hash: "b".repeat(64) }, requestValue)).toThrow("source/build/runtime binding")
  const receipt = createReplayDecisionHarnessReceipt({
    request: requestValue,
    decision_input_snapshot: snapshot,
    decision_market_input_snapshot: marketSnapshot,
    decision_state_snapshot: null,
    source_bundle: sourceBundle,
    build_attestation: buildAttestation,
    capability,
    worker_request: workerRequest,
    worker_response: workerResponse,
    worker_verification_response: workerResponse,
    decision_output: { action: "submit_initial_order", order: requestValue.order },
    trace: { selected_records_hash: snapshot.selected_records_hash },
  })
  expect(() => assertReplayDecisionHarnessReceipt(receipt, requestValue, snapshot, marketSnapshot, sourceBundle, buildAttestation)).not.toThrow()
  expect(() => assertReplayDecisionHarnessReceipt({ ...receipt, trace: { tampered: true } }, requestValue, snapshot)).toThrow("trace hash")

  const timeline = createReplayDecisionEvidenceTimeline({
    request: requestValue,
    decisions: [{
      schedule_entry: requestValue.decision_schedule.entries[0]!,
      decision_input_snapshot: snapshot,
    decision_market_input_snapshot: marketSnapshot,
    decision_state_snapshot: null,
      decision_harness_bundle: sourceBundle,
      decision_harness_build: buildAttestation,
      decision_harness_receipt: receipt,
    }],
  })
  expect(timeline).toMatchObject({
    cardinality_policy: "frozen_decision_schedule",
    ordering_policy: "decision_time_then_sequence",
    entries: [{
      decision_sequence: 1,
      evidence_mode: "attested_harness",
      decision_boundary: {
        schema_version: REPLAY_DECISION_BOUNDARY_SCHEMA_VERSION,
        decision_origin: "attested_harness_verified_schedule_effect",
        market_input_evidence: "not_required_compatibility",
        market_input_snapshot_hash: marketSnapshot.snapshot_hash,
      },
    }],
  })
  const boundary = createReplayDecisionBoundary(requestValue, marketSnapshot)
  expect(() => assertReplayDecisionBoundary(boundary, requestValue, marketSnapshot)).not.toThrow()
  expect(() => assertReplayDecisionBoundary({
    ...boundary,
    earliest_executable_time: requestValue.order.signal_time,
  }, requestValue)).toThrow("decision-input protocol")
  expect(() => assertReplayDecisionBoundary({
    ...boundary,
    market_input_evidence: "recomputed" as never,
  }, requestValue)).toThrow("decision-input protocol")
  expect(() => assertReplayDecisionEvidenceTimeline(timeline, requestValue)).not.toThrow()
  expect(() => assertReplayDecisionEvidenceTimeline({ ...timeline, entries: [] }, requestValue)).toThrow("cardinality")
  expect(() => assertReplayDecisionEvidenceTimeline({
    ...timeline,
    entries: [{ ...timeline.entries[0]!, decision_sequence: 2 }],
  }, requestValue)).toThrow("frozen schedule authority")
})

test("Decision Market Input Snapshot admits only the frozen contiguous closed-bar lookback", () => {
  const requestValue = fixtureRequest()
  requestValue.order = { ...requestValue.order, signal_time: "2026-07-14T08:00:00Z", earliest_executable_time: "2026-07-14T12:00:00Z" }
  requestValue.decision_market_input_requirement = {
    schema_version: REPLAY_DECISION_MARKET_INPUT_REQUIREMENT_SCHEMA_VERSION,
    mode: "closed_bar_lookback",
    source_kind: "ohlcv",
    fields: ["open", "high", "low", "close", "volume"],
    lookback_bars: 2,
    visibility_policy: "close_time_at_or_before_decision_time",
    terminal_bar_policy: "close_time_equals_decision_time",
    continuity_policy: "strict_interval_grid",
    undeclared_input_policy: "reject",
  }
  requestValue.decision_market_input_requirement_hash = canonicalHash(requestValue.decision_market_input_requirement)
  const bars = [
    { open_time: "2026-07-14T00:00:00Z", close_time: "2026-07-14T04:00:00Z", open: 100, high: 102, low: 99, close: 101, volume: 1, closed: true as const },
    { open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 101, high: 103, low: 100, close: 102, volume: 2, closed: true as const },
  ]
  const snapshot = createReplayDecisionMarketInputSnapshot({ request: requestValue, interval_ms: 14_400_000, bars })
  expect(() => assertReplayDecisionMarketInputSnapshot(snapshot, requestValue)).not.toThrow()
  expect(() => createReplayDecisionMarketInputSnapshot({ request: requestValue, interval_ms: 14_400_000, bars: [bars[1]] })).toThrow("lookback is incomplete")
  const oneBarRequest = structuredClone(requestValue)
  if (oneBarRequest.decision_market_input_requirement.mode !== "closed_bar_lookback") {
    throw new Error("fixture requires closed-bar lookback")
  }
  oneBarRequest.decision_market_input_requirement = {
    ...oneBarRequest.decision_market_input_requirement,
    lookback_bars: 1,
  }
  oneBarRequest.decision_market_input_requirement_hash = canonicalHash(oneBarRequest.decision_market_input_requirement)
  expect(() => createReplayDecisionMarketInputSnapshot({
    request: oneBarRequest,
    interval_ms: 14_400_000,
    bars: [bars[0]],
  })).toThrow("terminal bar must close at decision time")
  expect(() => createReplayDecisionMarketInputSnapshot({
    request: requestValue,
    interval_ms: 14_400_000,
    bars: [{ ...bars[0], open_time: "2026-07-13T20:00:00Z", close_time: "2026-07-14T00:00:00Z" }, bars[1]],
  })).toThrow("grid gap")
  expect(() => createReplayDecisionMarketInputSnapshot({
    request: requestValue,
    interval_ms: 14_400_000,
    bars: [bars[1], { ...bars[1], open_time: "2026-07-14T08:00:00Z", close_time: "2026-07-14T12:00:00Z" }],
  })).toThrow("future-visible")
})

test("data-gap failure evidence binds exact missing grid bounds", () => {
  const evidence = {
    gap_kind: "open_position_grid_gap" as const,
    gap_start: "2026-07-14T08:00:00Z",
    next_observed_open: "2026-07-14T16:00:00Z",
    missing_bar_count: 2,
    interval_ms: 14_400_000,
    policy: "fail_before_unobserved_interval_effects" as const,
  }
  expect(() => assertReplayDataGapFailureEvidence(evidence)).not.toThrow()
  expect(() => assertReplayDataGapFailureEvidence({
    ...evidence,
    missing_bar_count: 1,
  })).toThrow("bounds do not match")
})

test("supplemental requirement set freezes a non-overlapping closed input scope", () => {
  const requirementSet = {
    schema_version: REPLAY_SUPPLEMENTAL_REQUIREMENT_SET_SCHEMA_VERSION,
    mode: "signal_time_complete" as const,
    undeclared_input_policy: "reject" as const,
    requirements: [{
      requirement_id: "open-interest-btc",
      source_id: "binance-open-interest", entity_key: "BTCUSDT", fact_key: "open_interest",
      event_time_start_inclusive: "2026-07-13T20:00:00Z", event_time_end_inclusive: "2026-07-13T20:00:00Z",
      minimum_visible_event_count: 1, maximum_latest_event_age_ms: 14_400_000,
    }],
  }
  expect(() => assertReplaySupplementalRequirementSet(requirementSet, "2026-07-14T00:00:00Z")).not.toThrow()
  expect(() => assertReplaySupplementalRequirementSet({
    ...requirementSet,
    requirements: [...requirementSet.requirements, { ...requirementSet.requirements[0], requirement_id: "open-interest-btc-copy" }].sort((left, right) => left.requirement_id.localeCompare(right.requirement_id)),
  }, "2026-07-14T00:00:00Z")).toThrow("must not overlap")
  expect(() => assertReplaySupplementalRequirementSet({
    ...requirementSet,
    requirements: [{ ...requirementSet.requirements[0], event_time_end_inclusive: "2026-07-14T00:00:01Z" }],
  }, "2026-07-14T00:00:00Z")).toThrow("beyond decision time")
  expect(() => assertReplayExecutionRequest({ ...fixtureRequest(), supplemental_requirement_set_hash: HASH })).toThrow("requirement set hash mismatch")
})

test("Artifact Store capability freezes local and remote immutable-create semantics", () => {
  expect(() => assertReplayArtifactStoreCapability(REPLAY_LOCAL_ARTIFACT_STORE_CAPABILITY)).not.toThrow()
  expect(() => assertReplayArtifactStoreCapability(REPLAY_OBJECT_ARTIFACT_STORE_REQUIRED_CAPABILITY)).not.toThrow()
  expect(() => assertReplayArtifactStoreCapability({
    ...REPLAY_OBJECT_ARTIFACT_STORE_REQUIRED_CAPABILITY,
    immutable_create: "hard_link_create_if_absent",
  })).toThrow("does not match its backend contract")
})

test("Replay dataset manifest requires explicit UTC lifecycle and availability policy", () => {
  const manifest = {
    schema_version: REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
    manifest_id: "manifest-1", manifest_ref: "dataset://btc-4h", data_hash: HASH,
    dataset_kind: "ohlcv" as const, symbol: "BTCUSDT", timeframe: "4h", interval_ms: 14_400_000,
    row_count: 1, first_open_time: "2026-07-14T04:00:00Z", last_close_time: "2026-07-14T08:00:00Z",
    observed_through: "2026-07-14T08:00:00Z", closed_candles_only: true as const,
    bar_final_availability: "close_time" as const, funding_availability: "event_time" as const, mark_availability: "event_time" as const,
    mark_coverage: "none" as const, mark_interval_ms: null, mark_event_count: 0, supplemental_facts: { coverage: "none" as const, record_count: 0, source_ids: [], content_hash: canonicalHash([]), requirement_set_hash: "f126b641e1c2e55c174e3505e15232b466e50c3fd764f30968a925821c31d144" },
    venue_risk_policy_epochs: [RISK_SNAPSHOT],
    instrument: {
      listed_at: "2020-01-01T00:00:00Z", trading_enabled_at: "2020-01-01T00:00:00Z", delisted_at: null, status_history: "complete" as const,
      status_epochs: [STATUS_SNAPSHOT],
      status_provenance: statusProvenance(),
      spec_epochs: [SPEC_SNAPSHOT],
      accounting: { spec_version: REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION, product_type: "linear_derivative" as const, base_asset: "BTC", quote_asset: "USDT", settlement_asset: "USDT", contract_multiplier: "1", price_increment: "0.01", quantity_increment: "0.001", settlement_increment: "0.00000001" },
    },
    universe: { selected_at: "2026-07-14T00:00:00Z", survivorship: "point_in_time" as const },
  }
  expect(() => assertReplayDatasetManifest(manifest)).not.toThrow()
  expect(() => assertReplayDatasetManifest({ ...manifest, observed_through: "2026-07-14T07:59:59+00:00" })).toThrow("RFC 3339 UTC")
  expect(() => assertReplayDatasetManifest({
    ...manifest,
    instrument: { ...manifest.instrument, accounting: { ...manifest.instrument.accounting, settlement_asset: "BTC" } },
  })).toThrow("quote-asset settlement")
  expect(() => assertReplayDatasetManifest({
    ...manifest,
    venue_risk_policy_epochs: [
      { ...RISK_SNAPSHOT, valid_until: "2026-07-14T06:00:00Z" },
      { ...RISK_SNAPSHOT, snapshot_id: "risk-2", effective_at: "2026-07-14T07:00:00Z" },
    ],
  })).toThrow("ordered, non-overlapping, and contiguous")

  const statusSchedule = [
    { ...STATUS_SNAPSHOT, valid_until: "2026-07-14T06:00:00Z" },
    { ...STATUS_SNAPSHOT, snapshot_id: "status-halted", status: "halted" as const, effective_at: "2026-07-14T06:00:00Z", valid_until: "2026-07-14T07:00:00Z", source_ref: "fixture:status-halted", source_hash: "b".repeat(64) },
    { ...STATUS_SNAPSHOT, snapshot_id: "status-resumed", effective_at: "2026-07-14T07:00:00Z", source_ref: "fixture:status-resumed", source_hash: "c".repeat(64) },
  ]
  expect(() => assertReplayDatasetManifest({
    ...manifest,
    instrument: { ...manifest.instrument, status_epochs: statusSchedule, status_provenance: statusProvenance(statusSchedule) },
  })).not.toThrow()
  expect(() => assertReplayDatasetManifest({
    ...manifest,
    instrument: { ...manifest.instrument, status_history: "current_snapshot_only", status_epochs: statusSchedule, status_provenance: statusProvenance(statusSchedule, "current_snapshot_only") },
  })).toThrow("cannot certify historical halt epochs")
  const gappedStatusSchedule = structuredClone(statusSchedule)
  gappedStatusSchedule[0].valid_until = "2026-07-14T05:00:00Z"
  expect(() => assertReplayDatasetManifest({
    ...manifest,
    instrument: { ...manifest.instrument, status_epochs: gappedStatusSchedule, status_provenance: statusProvenance(gappedStatusSchedule) },
  })).toThrow("ordered, non-overlapping, and contiguous")
  expect(() => assertReplayDatasetManifest({
    ...manifest,
    instrument: { ...manifest.instrument, status_provenance: { ...statusProvenance(), source_kind: "venue_current_snapshot" } },
  })).toThrow("requires a venue status event archive")
  expect(() => assertReplayDatasetManifest({
    ...manifest,
    instrument: { ...manifest.instrument, status_provenance: { ...statusProvenance(), coverage_end: "2026-07-14T07:00:00Z" } },
  })).toThrow("must cover the Replay window")
  expect(() => assertReplayDatasetManifest({
    ...manifest,
    instrument: { ...manifest.instrument, status_provenance: { ...statusProvenance(), status_schedule_hash: HASH } },
  })).toThrow("schedule hash mismatch")
})

test("liquidity capacity attestation is self-hashed and chronologically causal", () => {
  const value = createReplayLiquidityCapacityAttestation({
    schema_version: "trade.rd-replay-liquidity-capacity-attestation.v1",
    attestation_id: "capacity-1", attestation_ref: "capacity://btc/1", symbol: "BTCUSDT",
    quantity_unit: "base_asset", capacity_scope: "static_order_quantity_ceiling", full_fill_capacity: 1,
    calibration_window_start: "2026-07-01T00:00:00Z", calibration_window_end: "2026-07-12T00:00:00Z",
    observed_through: "2026-07-12T00:00:00Z", available_at: "2026-07-13T00:00:00Z",
    source_ref: "dataset://capacity-source/1", source_hash: HASH,
    derivation_policy_id: "conservative-capacity", derivation_policy_version: "v1", derivation_policy_hash: HASH,
    evidence_limitation: "not_event_depth_or_queue_position_proof",
  })
  const tampered = { ...value, full_fill_capacity: 2 }
  expect(() => assertReplayDatasetManifest({
    schema_version: REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
    manifest_id: "manifest-1", manifest_ref: "dataset://capacity", data_hash: HASH,
    dataset_kind: "ohlcv", symbol: "BTCUSDT", timeframe: "4h", interval_ms: 14_400_000,
    row_count: 1, first_open_time: "2026-07-14T04:00:00Z", last_close_time: "2026-07-14T08:00:00Z",
    observed_through: "2026-07-14T08:00:00Z", closed_candles_only: true,
    bar_final_availability: "close_time", funding_availability: "event_time", mark_availability: "event_time",
    mark_coverage: "none", mark_interval_ms: null, mark_event_count: 0,
    supplemental_facts: { coverage: "none", record_count: 0, source_ids: [], content_hash: canonicalHash([]), requirement_set_hash: "f126b641e1c2e55c174e3505e15232b466e50c3fd764f30968a925821c31d144" },
    liquidity_capacity_attestation: tampered,
    venue_risk_policy_epochs: [RISK_SNAPSHOT],
    instrument: { listed_at: "2020-01-01T00:00:00Z", trading_enabled_at: "2020-01-01T00:00:00Z", delisted_at: null, status_history: "complete", status_epochs: [STATUS_SNAPSHOT], status_provenance: statusProvenance(), spec_epochs: [SPEC_SNAPSHOT], accounting: { spec_version: REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION, product_type: "linear_derivative", base_asset: "BTC", quote_asset: "USDT", settlement_asset: "USDT", contract_multiplier: "1", price_increment: "0.01", quantity_increment: "0.001", settlement_increment: "0.00000001" } },
    universe: { selected_at: "2026-07-14T00:00:00Z", survivorship: "point_in_time" },
  })).toThrow("attestation hash mismatch")
})
