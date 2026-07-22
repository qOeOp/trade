import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
  REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
  REPLAY_ATTEMPT_LEASE_OBSERVATION_POLICY_VERSION,
  REPLAY_ATTEMPT_LEASE_OBSERVATION_SCHEMA_VERSION,
  REPLAY_CHECKPOINT_RECEIPT_SCHEMA_VERSION,
  REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION,
  REPLAY_RESUME_AUTHORIZATION_SCHEMA_VERSION,
  REPLAY_SHARED_INITIAL_CAPITAL_RESERVATION_SCHEMA_VERSION,
  REPLAY_RUNTIME_SHARED_WALLET_RESERVATION_SCHEMA_VERSION,
  REPLAY_RUNTIME_SHARED_WALLET_LIFECYCLE_RESERVATION_SCHEMA_VERSION,
  REPLAY_RUNTIME_SHARED_WALLET_FUNDING_RESERVATION_SCHEMA_VERSION,
  REPLAY_RUNTIME_SHARED_WALLET_RISK_RESERVATION_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_ALLOCATION_RESERVATION_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_REALLOCATION_RESERVATION_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES,
  REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_RESERVATION_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION,
  REPLAY_RESERVATION_CANCELLATION_SCHEMA_VERSION,
  REPLAY_ATTEMPT_CANCELLATION_SCHEMA_VERSION,
  REPLAY_ATTEMPT_CANCELLATION_OBSERVATION_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_TERMINATION_SCHEMA_VERSION,
  REPLAY_AGGREGATE_TRADE_PROVIDER_CERTIFICATION_SCHEMA_VERSION,
  REPLAY_AGGREGATE_TRADE_PROVIDER_CERTIFICATION_TERMINATION_SCHEMA_VERSION,
  REPLAY_AGGREGATE_TRADE_EVIDENCE_ADMISSION_SCHEMA_VERSION,
  REPLAY_CROSS_SOURCE_ORDERING_ADMISSION_SCHEMA_VERSION,
  REPLAY_DECISION_OBSERVATION_BUNDLE_ADMISSION_SCHEMA_VERSION,
  REPLAY_DECISION_OBSERVATION_BUNDLE_DERIVATION_ADMISSION_SCHEMA_VERSION,
  DRAFT_AUTHORIZATION_SCHEMA_VERSION,
  TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION,
  assertDraftStrategyAuthorization,
  assertTrialReservationSnapshot,
  assertReplaySharedInitialCapitalReservationSnapshot,
  assertReplayRuntimeSharedWalletReservationSnapshot,
  assertReplayRuntimeSharedWalletLifecycleReservationSnapshot,
  assertReplayRuntimeSharedWalletFundingReservationSnapshot,
  assertReplayRuntimeSharedWalletRiskReservationSnapshot,
  assertReplayPortfolioAllocationReservationSnapshot,
  assertReplayPortfolioReallocationReservationSnapshot,
  assertReplayPortfolioCycleSequenceReservationSnapshot,
  assertReplayPortfolioTwoFixedPartialReservationSnapshot,
  assertReplayPortfolioTwoFixedPartialCycleSequenceReservationSnapshot,
  assertReplayPortfolioPostPartialStopReplacementCycleSequenceReservationSnapshot,
  createReplayCheckpointReceiptSnapshot,
  createReplayResumeAuthorizationSnapshot,
  createReplaySharedInitialCapitalReservationSnapshot,
  createReplayRuntimeSharedWalletReservationSnapshot,
  createReplayRuntimeSharedWalletLifecycleReservationSnapshot,
  createReplayRuntimeSharedWalletFundingReservationSnapshot,
  createReplayRuntimeSharedWalletRiskReservationSnapshot,
  createReplayPortfolioAllocationReservationSnapshot,
  createReplayPortfolioReallocationReservationSnapshot,
  createReplayPortfolioCycleSequenceReservationSnapshot,
  createReplayPortfolioTwoFixedPartialReservationSnapshot,
  createReplayPortfolioTwoFixedPartialCycleSequenceReservationSnapshot,
  createReplayPortfolioPostPartialStopReplacementCycleSequenceReservationSnapshot,
  createReplayInstrumentStatusProviderCertificationSnapshot,
  createReplayInstrumentStatusProviderCertificationTermination,
  createReplayAggregateTradeProviderCertificationSnapshot,
  createReplayAggregateTradeProviderCertificationTermination,
  createReplayAggregateTradeEvidenceAdmissionSnapshot,
  createReplayCrossSourceOrderingAdmissionSnapshot,
  createReplayDecisionObservationBundleAdmissionSnapshot,
  createReplayDecisionObservationBundleDerivationAdmissionSnapshot,
  createReplayReservationCancellationSnapshot,
  createReplayAttemptCancellationSnapshot,
  createReplayAttemptCancellationObservationSnapshot,
  createReplayAttemptLeaseObservationSnapshot,
  hashReplayResumeAuthorizationSnapshot,
  hashTrialReservationSnapshot,
  hashReplayAttemptLeaseSnapshot,
  hashReplayCheckpointReceiptSnapshot,
  type DraftStrategyAuthorization,
  type TrialReservationSnapshot,
} from "./control-plane-contracts"

const HASH = "a".repeat(64)

const PROVIDER_CERTIFICATION = createReplayInstrumentStatusProviderCertificationSnapshot({
  schema_version: REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION,
  certification_id: "status-provider-certification-1", certification_ref: "certification://status-provider/v1",
  status: "certified", certified_at: "2026-07-13T00:00:00Z", valid_until: "2026-08-01T00:00:00Z",
  certifier_id: "research-control-plane", certification_policy_version: "rd-status-provider-certification-v1",
  provider_capability_hash: HASH, producer_domain: "market-data-products", producer_id: "market-data.instrument-status-provider",
  producer_version: "v1", producer_build_hash: HASH, normalization_policy_version: "normalization-v1",
  normalization_policy_hash: HASH, allowed_source_kind: "venue_status_event_archive", allowed_completeness: "complete_history",
})

const AGGREGATE_TRADE_PROVIDER_CERTIFICATION = createReplayAggregateTradeProviderCertificationSnapshot({
  schema_version: REPLAY_AGGREGATE_TRADE_PROVIDER_CERTIFICATION_SCHEMA_VERSION,
  certification_id: "aggregate-trade-provider-certification-1",
  certification_ref: "certification://aggregate-trade-provider/v1",
  status: "certified",
  certified_at: "2026-07-13T00:00:00Z",
  valid_until: "2026-08-01T00:00:00Z",
  certifier_id: "research-control-plane",
  certification_policy_version: "rd-aggregate-trade-provider-certification-v1",
  provider_capability_hash: HASH,
  producer_domain: "market-data-products",
  producer_id: "market-data.aggregate-trade-provider",
  producer_version: "v1",
  producer_build_hash: HASH,
  provider_policy_hash: HASH,
  accepted_archive_schema: "trade.market-data-aggregate-trade-archive.v1",
  emitted_event_schema: "trade.rd-replay-aggregate-trade-event.v1",
  emitted_attestation_schema: "trade.rd-replay-aggregate-trade-coverage-attestation.v1",
  allowed_source_kind: "venue_aggregate_trade_archive",
  allowed_external_completeness: "not_verified",
})

function authorization(): DraftStrategyAuthorization {
  return {
    schema_version: DRAFT_AUTHORIZATION_SCHEMA_VERSION,
    decision: "accept_for_draft",
    decision_id: "decision-1",
    reviewer_run_id: "reviewer-1",
    primary_result_id: "result-1",
    primary_result_hash: HASH,
    selected_trial_id: "trial-1",
    selected_candidate_id: "candidate-1",
    candidate_frozen_at: "2026-07-14T08:00:00Z",
    identity: {
      schema_version: CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
      experiment_id: "experiment-1",
      trial_group_id: "group-1",
      trial_group_hash: HASH,
      trial_id: "trial-1",
      candidate_id: "candidate-1",
      candidate_hash: HASH,
      identity_hash_policy_version: "rd-identity-v1",
      experiment_contract_hash: HASH,
    },
  }
}

function reservation(): TrialReservationSnapshot {
  return {
    schema_version: TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION,
    reservation_id: "reservation-1", reservation_ref: "reservation://trial-1", issued_at: "2026-07-14T00:00:00Z", expires_at: "2026-07-15T00:00:00Z", status: "reserved",
    identity: authorization().identity, trial_ordinal: 1, run_id: "run-1", counts_against_budget: true,
    trial_accounting_policy_version: "count-all-v1", candidate_assignment_hash: HASH,
    bindings: {
      replay_idempotency_key: "replay-1", execution_spec_hash: HASH, dataset_manifest_ref: "dataset://fixture", dataset_hash: HASH,
      liquidity_capacity_attestation_hash: null,
      supplemental_facts_hash: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
      supplemental_requirement_set_hash: "f126b641e1c2e55c174e3505e15232b466e50c3fd764f30968a925821c31d144",
      venue_risk_policy_schedule_hash: HASH, instrument_spec_schedule_hash: HASH, instrument_status_schedule_hash: HASH, instrument_status_provenance_hash: HASH,
      instrument_status_provider_capability_hash: HASH, instrument_status_provider_certification_hash: PROVIDER_CERTIFICATION.certification_hash,
      harness_hash: HASH, assumptions_hash: HASH,
      cost_policy_hash: HASH, margin_policy_hash: HASH, simulator_policy_version: "rd-replay-simulator-v7", execution_mode: "step",
    },
    instrument_status_provider_certification: PROVIDER_CERTIFICATION,
    required_capabilities: ["closed-candle", "step"],
  }
}

test("draft authorization binds the selected Trial and Candidate", () => {
  expect(() => assertDraftStrategyAuthorization(authorization())).not.toThrow()
  expect(() => assertDraftStrategyAuthorization({ ...authorization(), selected_trial_id: "trial-2" })).toThrow()
})

test("draft authorization requires accept_for_draft and content hashes", () => {
  const value = authorization()
  expect(() => assertDraftStrategyAuthorization({ ...value, primary_result_hash: "weak" })).toThrow()
})

test("Trial Reservation snapshot is immutable-hashable and capability order is canonical", () => {
  const value = reservation()
  expect(() => assertTrialReservationSnapshot(value)).not.toThrow()
  expect(hashTrialReservationSnapshot(value)).toHaveLength(64)
  expect(hashTrialReservationSnapshot(structuredClone(value))).toBe(hashTrialReservationSnapshot(value))
  expect(() => assertTrialReservationSnapshot({ ...value, required_capabilities: ["step", "closed-candle"] })).toThrow("unique and sorted")
  expect(() => assertTrialReservationSnapshot({ ...value, expires_at: value.issued_at })).toThrow("issued_at < expires_at")
})

test("shared initial capital Reservation freezes one fully allocated pool and explicit priority", () => {
  const value = createReplaySharedInitialCapitalReservationSnapshot({
    schema_version: REPLAY_SHARED_INITIAL_CAPITAL_RESERVATION_SCHEMA_VERSION,
    reservation_id: "shared-capital-1",
    reservation_ref: "reservation://shared-capital/1",
    issued_at: "2026-07-14T00:01:00Z",
    expires_at: "2026-07-14T01:00:00Z",
    status: "reserved",
    authority_id: "research-control-plane",
    experiment_id: "experiment-1",
    trial_group_id: "group-1",
    trial_group_hash: HASH,
    batch_id: "batch-1",
    batch_plan_hash: HASH,
    settlement_asset: "USDT",
    capital_policy_version: "rd-shared-initial-capital-static-preallocation-v1",
    execution_priority_policy: "control_plane_explicit_rank_no_ties",
    shared_initial_cash: 3000.3,
    total_allocated_initial_cash: 3000.3,
    lanes: [
      { lane_id: "lane-b", priority_rank: 1, trial_id: "trial-2", run_id: "run-2", trial_reservation_ref: "reservation://trial-2", trial_reservation_hash: "b".repeat(64), allocated_initial_cash: 2000.2 },
      { lane_id: "lane-a", priority_rank: 2, trial_id: "trial-1", run_id: "run-1", trial_reservation_ref: "reservation://trial-1", trial_reservation_hash: "c".repeat(64), allocated_initial_cash: 1000.1 },
    ],
    limitations: [
      "no_runtime_cash_reuse_or_rebalancing",
      "no_cross_lane_margin_or_liquidation",
      "no_concurrent_matching_claim",
    ],
  })
  expect(() => assertReplaySharedInitialCapitalReservationSnapshot(value)).not.toThrow()
  expect(value.reservation_hash).toHaveLength(64)
  expect(() => createReplaySharedInitialCapitalReservationSnapshot({
    ...value,
    shared_initial_cash: 3000.2,
  })).toThrow("fully allocate")
  expect(() => createReplaySharedInitialCapitalReservationSnapshot({
    ...value,
    lanes: [value.lanes[1]!, value.lanes[0]!],
  })).toThrow("consecutive explicit priority")
  expect(() => assertReplaySharedInitialCapitalReservationSnapshot({
    ...value,
    injected: true,
  } as typeof value)).toThrow("field whitelist drift")
})

test("runtime shared wallet Reservation authorizes one pool without static lane allocations", () => {
  const value = createReplayRuntimeSharedWalletReservationSnapshot({
    schema_version: REPLAY_RUNTIME_SHARED_WALLET_RESERVATION_SCHEMA_VERSION,
    reservation_id: "runtime-wallet-1",
    reservation_ref: "reservation://runtime-wallet/1",
    issued_at: "2026-07-14T00:01:00Z",
    expires_at: "2026-07-14T01:00:00Z",
    status: "reserved",
    authority_id: "research-control-plane",
    experiment_id: "experiment-1",
    trial_group_id: "group-1",
    trial_group_hash: HASH,
    portfolio_id: "portfolio-1",
    portfolio_plan_hash: "b".repeat(64),
    settlement_asset: "USDT",
    shared_initial_cash: 100,
    capital_policy_version: "rd-runtime-shared-wallet-isolated-entry-v1",
    simultaneous_order_policy: "event_time_then_control_plane_priority",
    lanes: [
      { lane_id: "lane-b", priority_rank: 1, trial_id: "trial-2", run_id: "run-2", trial_reservation_ref: "reservation://trial-2", trial_reservation_hash: "c".repeat(64) },
      { lane_id: "lane-a", priority_rank: 2, trial_id: "trial-1", run_id: "run-1", trial_reservation_ref: "reservation://trial-1", trial_reservation_hash: "d".repeat(64) },
    ],
    limitations: [
      "market_next_open_entry_only",
      "isolated_margin_no_cross_margin",
      "no_exit_funding_liquidation_or_cash_release",
    ],
  })
  expect(() => assertReplayRuntimeSharedWalletReservationSnapshot(value)).not.toThrow()
  expect(value.reservation_hash).toHaveLength(64)
  expect(Object.hasOwn(value.lanes[0]!, "allocated_initial_cash")).toBe(false)

  const tied = structuredClone(value)
  tied.lanes[1]!.priority_rank = 1
  expect(() => assertReplayRuntimeSharedWalletReservationSnapshot(tied)).toThrow("consecutive explicit priority")
  expect(() => assertReplayRuntimeSharedWalletReservationSnapshot({
    ...value,
    limitations: [
      "market_next_open_entry_only",
      "isolated_margin_no_cross_margin",
    ],
  } as unknown as typeof value)).toThrow("limitations were weakened")
})

test("runtime shared wallet lifecycle Reservation freezes exit-release ordering without execution authority", () => {
  const value = createReplayRuntimeSharedWalletLifecycleReservationSnapshot({
    schema_version: REPLAY_RUNTIME_SHARED_WALLET_LIFECYCLE_RESERVATION_SCHEMA_VERSION,
    reservation_id: "runtime-wallet-lifecycle-1",
    reservation_ref: "reservation://runtime-wallet-lifecycle/1",
    issued_at: "2026-07-14T00:01:00Z",
    expires_at: "2026-07-14T01:00:00Z",
    status: "reserved",
    authority_id: "research-control-plane",
    experiment_id: "experiment-1",
    trial_group_id: "group-1",
    trial_group_hash: HASH,
    portfolio_id: "portfolio-1",
    portfolio_plan_hash: "b".repeat(64),
    settlement_asset: "USDT",
    shared_initial_cash: 100,
    capital_policy_version: "rd-runtime-shared-wallet-entry-exit-release-v1",
    same_time_cash_policy: "exit_release_before_entry_admission_then_control_plane_priority",
    lanes: [
      { lane_id: "lane-b", priority_rank: 1, trial_id: "trial-2", run_id: "run-2", trial_reservation_ref: "reservation://trial-2", trial_reservation_hash: "c".repeat(64) },
      { lane_id: "lane-a", priority_rank: 2, trial_id: "trial-1", run_id: "run-1", trial_reservation_ref: "reservation://trial-1", trial_reservation_hash: "d".repeat(64) },
    ],
    limitations: [
      "market_next_open_entry_and_full_exit_only",
      "isolated_margin_no_cross_margin",
      "no_funding_liquidation_or_partial_position",
    ],
  })
  expect(() => assertReplayRuntimeSharedWalletLifecycleReservationSnapshot(value)).not.toThrow()
  expect(value.reservation_hash).toHaveLength(64)
  expect(Object.hasOwn(value.lanes[0]!, "allocated_initial_cash")).toBe(false)

  const reordered = structuredClone(value)
  reordered.lanes.reverse()
  expect(() => assertReplayRuntimeSharedWalletLifecycleReservationSnapshot(reordered))
    .toThrow("consecutive priority and unique authority")
  expect(() => assertReplayRuntimeSharedWalletLifecycleReservationSnapshot({
    ...value,
    limitations: [
      "market_next_open_entry_and_full_exit_only",
      "isolated_margin_no_cross_margin",
    ],
  } as unknown as typeof value)).toThrow("limitations were weakened")
})

test("runtime shared wallet funding Reservation freezes phase-10 cash authority without risk authority", () => {
  const value = createReplayRuntimeSharedWalletFundingReservationSnapshot({
    schema_version: REPLAY_RUNTIME_SHARED_WALLET_FUNDING_RESERVATION_SCHEMA_VERSION,
    reservation_id: "runtime-wallet-funding-1",
    reservation_ref: "reservation://runtime-wallet-funding/1",
    issued_at: "2026-07-14T00:01:00Z",
    expires_at: "2026-07-14T01:00:00Z",
    status: "reserved",
    authority_id: "research-control-plane",
    experiment_id: "experiment-1",
    trial_group_id: "group-1",
    trial_group_hash: HASH,
    portfolio_id: "portfolio-1",
    portfolio_plan_hash: "b".repeat(64),
    settlement_asset: "USDT",
    shared_initial_cash: 100,
    capital_policy_version: "rd-runtime-shared-wallet-exact-funding-v1",
    funding_policy_version: "exact-event-time-t-minus-position-v1",
    same_time_cash_policy: "funding_before_exit_before_entry_then_control_plane_priority",
    lanes: [
      { lane_id: "lane-b", priority_rank: 1, trial_id: "trial-2", run_id: "run-2", trial_reservation_ref: "reservation://trial-2", trial_reservation_hash: "c".repeat(64) },
      { lane_id: "lane-a", priority_rank: 2, trial_id: "trial-1", run_id: "run-1", trial_reservation_ref: "reservation://trial-1", trial_reservation_hash: "d".repeat(64) },
    ],
    limitations: [
      "market_next_open_entry_full_exit_and_exact_funding_only",
      "isolated_margin_no_cross_margin",
      "no_liquidation_partial_position_or_borrow",
    ],
  })
  expect(() => assertReplayRuntimeSharedWalletFundingReservationSnapshot(value)).not.toThrow()
  expect(value.reservation_hash).toHaveLength(64)
  const weakened = structuredClone(value)
  weakened.limitations.pop()
  expect(() => assertReplayRuntimeSharedWalletFundingReservationSnapshot(weakened as typeof value))
    .toThrow("limitations were weakened")
  const tied = structuredClone(value)
  tied.lanes[1]!.priority_rank = 1
  expect(() => assertReplayRuntimeSharedWalletFundingReservationSnapshot(tied))
    .toThrow("consecutive priority and unique authority")
})

test("runtime shared wallet risk Reservation freezes exact-risk terminal priority without cross-margin authority", () => {
  const value = createReplayRuntimeSharedWalletRiskReservationSnapshot({
    schema_version: REPLAY_RUNTIME_SHARED_WALLET_RISK_RESERVATION_SCHEMA_VERSION,
    reservation_id: "runtime-wallet-risk-1",
    reservation_ref: "reservation://runtime-wallet-risk/1",
    issued_at: "2026-07-14T00:01:00Z",
    expires_at: "2026-07-14T01:00:00Z",
    status: "reserved",
    authority_id: "research-control-plane",
    experiment_id: "experiment-1",
    trial_group_id: "group-1",
    trial_group_hash: HASH,
    portfolio_id: "portfolio-1",
    portfolio_plan_hash: "b".repeat(64),
    settlement_asset: "USDT",
    shared_initial_cash: 100,
    capital_policy_version: "rd-runtime-shared-wallet-exact-risk-v1",
    funding_policy_version: "exact-event-time-t-minus-position-v1",
    risk_policy_version: "complete-exact-mark-isolated-maintenance-full-liquidation-v1",
    same_time_cash_policy: "funding_then_exact_risk_then_liquidation_then_exit_then_entry_then_control_plane_priority",
    lanes: [
      { lane_id: "lane-b", priority_rank: 1, trial_id: "trial-2", run_id: "run-2", trial_reservation_ref: "reservation://trial-2", trial_reservation_hash: "c".repeat(64) },
      { lane_id: "lane-a", priority_rank: 2, trial_id: "trial-1", run_id: "run-1", trial_reservation_ref: "reservation://trial-1", trial_reservation_hash: "d".repeat(64) },
    ],
    limitations: [
      "market_next_open_entry_full_exit_exact_funding_and_mark_risk_only",
      "isolated_margin_full_liquidation_no_cross_margin",
      "no_partial_liquidation_borrow_insurance_or_adl",
    ],
  })
  expect(() => assertReplayRuntimeSharedWalletRiskReservationSnapshot(value)).not.toThrow()
  expect(value.reservation_hash).toHaveLength(64)
  const weakened = structuredClone(value)
  weakened.limitations.pop()
  expect(() => assertReplayRuntimeSharedWalletRiskReservationSnapshot(weakened as typeof value))
    .toThrow("limitations were weakened")
  const tied = structuredClone(value)
  tied.lanes[1]!.priority_rank = 1
  expect(() => assertReplayRuntimeSharedWalletRiskReservationSnapshot(tied))
    .toThrow("consecutive priority and unique authority")
})

test("Portfolio Allocation Reservation freezes gross, absolute-net, and stop-loss risk caps", () => {
  const value = createReplayPortfolioAllocationReservationSnapshot({
    schema_version: REPLAY_PORTFOLIO_ALLOCATION_RESERVATION_SCHEMA_VERSION,
    reservation_id: "portfolio-allocation-1",
    reservation_ref: "reservation://portfolio-allocation/1",
    issued_at: "2026-07-14T00:01:00Z",
    expires_at: "2026-07-14T01:00:00Z",
    status: "reserved",
    authority_id: "research-control-plane",
    experiment_id: "experiment-1",
    trial_group_id: "group-1",
    trial_group_hash: HASH,
    portfolio_id: "portfolio-1",
    portfolio_plan_hash: "b".repeat(64),
    settlement_asset: "USDT",
    shared_initial_cash: 100,
    allocation_policy_version: "simultaneous-entry-greedy-priority-no-resize-v1",
    exposure_policy_version: "entry-execution-notional-gross-and-absolute-net-v1",
    risk_budget_policy_version: "entry-to-frozen-stop-adverse-execution-plus-round-trip-fees-v1",
    rejection_precedence: "lane_risk_then_cash_then_gross_then_absolute_net_then_portfolio_risk",
    max_gross_exposure_amount: 200,
    max_abs_net_exposure_amount: 100,
    max_portfolio_risk_amount: 25,
    lanes: [
      { lane_id: "lane-b", priority_rank: 1, trial_id: "trial-2", run_id: "run-2", trial_reservation_ref: "reservation://trial-2", trial_reservation_hash: "c".repeat(64), max_lane_risk_amount: 15 },
      { lane_id: "lane-a", priority_rank: 2, trial_id: "trial-1", run_id: "run-1", trial_reservation_ref: "reservation://trial-1", trial_reservation_hash: "d".repeat(64), max_lane_risk_amount: 15 },
    ],
    limitations: [
      "market_next_open_full_fill_or_reject_no_resize_entry_slice_only",
      "entry_notional_exposure_and_frozen_stop_loss_budget_not_dynamic_var",
      "no_exit_funding_liquidation_cross_margin_partial_fill_or_borrow",
    ],
  })
  expect(() => assertReplayPortfolioAllocationReservationSnapshot(value)).not.toThrow()
  const inconsistent = structuredClone(value)
  inconsistent.max_abs_net_exposure_amount = 201
  expect(() => assertReplayPortfolioAllocationReservationSnapshot(inconsistent))
    .toThrow("caps are inconsistent")
  const weakened = structuredClone(value)
  weakened.limitations.pop()
  expect(() => assertReplayPortfolioAllocationReservationSnapshot(weakened as typeof value))
    .toThrow("limitations were weakened")
})

test("Portfolio Reallocation Reservation binds cycle two to committed predecessor evidence", () => {
  const value = createReplayPortfolioReallocationReservationSnapshot({
    schema_version: REPLAY_PORTFOLIO_REALLOCATION_RESERVATION_SCHEMA_VERSION,
    reservation_id: "portfolio-reallocation-1",
    reservation_ref: "reservation://portfolio-reallocation/1",
    issued_at: "2026-07-14T00:03:10Z",
    expires_at: "2026-07-14T01:00:00Z",
    status: "reserved",
    authority_id: "research-control-plane",
    experiment_id: "experiment-1",
    trial_group_id: "group-1",
    trial_group_hash: HASH,
    portfolio_id: "portfolio-1",
    portfolio_plan_hash: "b".repeat(64),
    settlement_asset: "USDT",
    portfolio_initial_cash: 100,
    predecessor_integrated_result_hash: "c".repeat(64),
    predecessor_artifact_manifest_hash: "d".repeat(64),
    reallocation_cycle: 2,
    earliest_reallocation_time: "2026-07-14T00:04:00Z",
    opening_cash_policy: "predecessor_ending_available_cash_after_full_flat_release",
    eligibility_policy: "all_predecessor_positions_closed_and_exposure_risk_zero",
    allocation_policy_version: "simultaneous-entry-greedy-priority-no-resize-v1",
    max_gross_exposure_amount: 200,
    max_abs_net_exposure_amount: 100,
    max_portfolio_risk_amount: 25,
    lanes: [
      { lane_id: "lane-b", priority_rank: 1, trial_id: "trial-2", run_id: "run-2", trial_reservation_ref: "reservation://trial-2", trial_reservation_hash: "e".repeat(64), max_lane_risk_amount: 15 },
      { lane_id: "lane-a", priority_rank: 2, trial_id: "trial-1", run_id: "run-1", trial_reservation_ref: "reservation://trial-1", trial_reservation_hash: "f".repeat(64), max_lane_risk_amount: 15 },
    ],
    limitations: [
      "second_cycle_only_after_authoritative_full_flat_release",
      "opening_cash_derived_from_predecessor_result_not_control_plane_estimate",
      "no_third_cycle_partial_cross_margin_borrow_or_fast",
    ],
  })
  expect(() => assertReplayPortfolioReallocationReservationSnapshot(value)).not.toThrow()
  const predecessorDrift = structuredClone(value)
  predecessorDrift.predecessor_integrated_result_hash = "1".repeat(64)
  expect(() => assertReplayPortfolioReallocationReservationSnapshot(predecessorDrift))
    .toThrow("reallocation hash")
  const thirdCycle = structuredClone(value) as unknown as { reallocation_cycle: number }
  thirdCycle.reallocation_cycle = 3
  expect(() => assertReplayPortfolioReallocationReservationSnapshot(thirdCycle as unknown as typeof value))
    .toThrow("reallocation policy")
})

test("Portfolio Cycle Sequence Reservation freezes a bounded contiguous schedule without opening-cash estimates", () => {
  const value = createReplayPortfolioCycleSequenceReservationSnapshot({
    schema_version: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION,
    reservation_id: "cycle-sequence-1",
    reservation_ref: "reservation://cycle-sequence/1",
    issued_at: "2026-07-14T00:00:00Z",
    expires_at: "2026-07-14T01:00:00Z",
    status: "reserved",
    authority_id: "research-control-plane",
    experiment_id: "experiment-1",
    trial_group_id: "group-1",
    trial_group_hash: HASH,
    portfolio_id: "portfolio-1",
    settlement_asset: "USDT",
    initial_cash: 100,
    cycle_count: 3,
    max_cycle_count: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES,
    opening_cash_policy: "first_cycle_initial_then_predecessor_ending_available",
    successor_eligibility_policy: "predecessor_full_flat_exposure_and_risk_zero",
    expansion_policy: "exact_predeclared_cycles_no_runtime_append_or_search_expansion",
    cycles: [1, 2, 3].map((cycle) => ({
      cycle_index: cycle,
      allocation_plan_hash: `${cycle}`.repeat(64),
      risk_plan_hash: `${cycle + 3}`.repeat(64),
      earliest_cycle_time: `2026-07-14T00:0${cycle}:00Z`,
      max_gross_exposure_amount: 200,
      max_abs_net_exposure_amount: 100,
      max_portfolio_risk_amount: 25,
      lanes: [1, 2].map((lane) => ({
        lane_id: `cycle-${cycle}-lane-${lane}`,
        priority_rank: lane,
        trial_id: `trial-${cycle}-${lane}`,
        run_id: `run-${cycle}-${lane}`,
        trial_reservation_ref: `reservation://trial-${cycle}-${lane}`,
        trial_reservation_hash: createHash("sha256").update(`reservation-${cycle}-${lane}`).digest("hex"),
        max_lane_risk_amount: 15,
      })),
    })),
    limitations: [
      "one_to_eight_predeclared_full_flat_cycles_only",
      "cycle_opening_cash_is_runtime_predecessor_evidence_not_control_plane_estimate",
      "no_partial_cross_margin_borrow_real_liquidity_fast_or_runtime_cycle_expansion",
    ],
  })
  expect(() => assertReplayPortfolioCycleSequenceReservationSnapshot(value)).not.toThrow()
  const expanded = structuredClone(value)
  expanded.cycle_count = 4
  expect(() => assertReplayPortfolioCycleSequenceReservationSnapshot(expanded))
    .toThrow("cycle sequence policy")
  const reordered = structuredClone(value)
  reordered.cycles[1]!.earliest_cycle_time = reordered.cycles[0]!.earliest_cycle_time
  expect(() => assertReplayPortfolioCycleSequenceReservationSnapshot(reordered))
    .toThrow("cycle sequence order")
})

test("Portfolio two-fixed-partial Reservation freezes projection identity without execution authority", () => {
  const value = createReplayPortfolioTwoFixedPartialReservationSnapshot({
    schema_version: REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_RESERVATION_SCHEMA_VERSION,
    reservation_id: "portfolio-two-partial-1", reservation_ref: "reservation://portfolio-two-partial/1",
    issued_at: "2026-07-14T00:00:00Z", expires_at: "2026-07-14T01:00:00Z", status: "reserved",
    authority_id: "research-control-plane", experiment_id: "experiment-1", trial_group_id: "group-1",
    trial_group_hash: HASH, portfolio_id: "portfolio-1", settlement_asset: "USDT",
    source_terminal_evidence_hash: "b".repeat(64),
    source_terminal_artifact_manifest_hash: "c".repeat(64), risk_result_hash: "d".repeat(64),
    projection_policy_version: "two-predeclared-fixed-partials-terminal-risk-v1",
    lanes: [
      { lane_id: "lane-a", priority_rank: 1, trial_id: "trial-a", run_id: "run-a",
        trial_reservation_ref: "reservation://trial-a", trial_reservation_hash: "e".repeat(64),
        request_hash: "f".repeat(64), source_terminal_record_hash: "1".repeat(64), isolated_collateral: 20 },
      { lane_id: "lane-b", priority_rank: 2, trial_id: "trial-b", run_id: "run-b",
        trial_reservation_ref: "reservation://trial-b", trial_reservation_hash: "2".repeat(64),
        request_hash: "3".repeat(64), source_terminal_record_hash: "4".repeat(64), isolated_collateral: 25 },
    ],
    limitations: [
      "exactly_two_predeclared_fixed_quantity_partial_reduces_per_opened_lane",
      "projection_only_no_contract_search_review_or_lifecycle_authority",
      "no_dynamic_sizing_third_partial_post_partial_mutation_reentry_cross_margin_borrow_real_liquidity_or_fast",
    ],
  })
  expect(() => assertReplayPortfolioTwoFixedPartialReservationSnapshot(value)).not.toThrow()
  const reordered = structuredClone(value); reordered.lanes.reverse()
  expect(() => assertReplayPortfolioTwoFixedPartialReservationSnapshot(reordered))
    .toThrow("reservation lanes")
  const widened = structuredClone(value)
  widened.limitations[1] = "projection_and_review_authority" as typeof widened.limitations[1]
  expect(() => assertReplayPortfolioTwoFixedPartialReservationSnapshot(widened))
    .toThrow("limitations")
})

test("Portfolio two-fixed-partial cycle Reservation freezes exact child order and no runtime expansion", () => {
  const children = Array.from({ length: 4 }, (_, index) => createReplayPortfolioTwoFixedPartialReservationSnapshot({
    schema_version: REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_RESERVATION_SCHEMA_VERSION,
    reservation_id: `p27-child-${index + 1}`, reservation_ref: `reservation://p27-child/${index + 1}`,
    issued_at: "2026-07-14T00:00:00Z", expires_at: "2026-07-14T01:00:00Z", status: "reserved",
    authority_id: "research-control-plane", experiment_id: "experiment-1", trial_group_id: "group-1",
    trial_group_hash: HASH, portfolio_id: "portfolio-1", settlement_asset: "USDT",
    source_terminal_evidence_hash: String(index + 1).repeat(64),
    source_terminal_artifact_manifest_hash: String(index + 2).repeat(64),
    risk_result_hash: String(index + 3).repeat(64),
    projection_policy_version: "two-predeclared-fixed-partials-terminal-risk-v1",
    lanes: [{ lane_id: `lane-${index + 1}`, priority_rank: 1, trial_id: `trial-${index + 1}`,
      run_id: `run-${index + 1}`, trial_reservation_ref: `reservation://trial-${index + 1}`,
      trial_reservation_hash: String(index + 4).repeat(64), request_hash: String(index + 5).repeat(64),
      source_terminal_record_hash: String(index + 6).repeat(64), isolated_collateral: 20 }],
    limitations: ["exactly_two_predeclared_fixed_quantity_partial_reduces_per_opened_lane",
      "projection_only_no_contract_search_review_or_lifecycle_authority",
      "no_dynamic_sizing_third_partial_post_partial_mutation_reentry_cross_margin_borrow_real_liquidity_or_fast"],
  }))
  const value = createReplayPortfolioTwoFixedPartialCycleSequenceReservationSnapshot({
    schema_version: REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION,
    reservation_id: "p27-sequence-1", reservation_ref: "reservation://p27-sequence/1",
    issued_at: "2026-07-14T00:00:00Z", expires_at: "2026-07-14T01:00:00Z", status: "reserved",
    authority_id: "research-control-plane", experiment_id: "experiment-1", trial_group_id: "group-1",
    trial_group_hash: HASH, portfolio_id: "portfolio-1", settlement_asset: "USDT", initial_cash: 100,
    cycle_count: 4, max_cycle_count: 8,
    opening_cash_policy: "first_cycle_initial_then_predecessor_committed_trial_balance",
    successor_eligibility_policy: "predecessor_committed_full_flat_exposure_collateral_and_risk_zero",
    expansion_policy: "exact_predeclared_child_reservations_no_runtime_append_or_search_expansion",
    cycles: children.map((child, index) => ({ cycle_index: index + 1,
      two_fixed_partial_reservation_hash: child.reservation_hash,
      earliest_cycle_time: `2026-07-14T00:${String(index * 8).padStart(2, "0")}:00Z`,
      lanes: child.lanes.map((lane) => ({ lane_id: lane.lane_id, priority_rank: lane.priority_rank,
        trial_id: lane.trial_id, run_id: lane.run_id, trial_reservation_hash: lane.trial_reservation_hash,
        request_hash: lane.request_hash })) })),
    limitations: ["one_to_eight_predeclared_two_fixed_partial_full_flat_cycles_only",
      "cycle_opening_cash_must_equal_predecessor_committed_trial_balance",
      "no_dynamic_sizing_third_partial_post_partial_mutation_reentry_cross_margin_borrow_real_liquidity_fast_or_runtime_cycle_expansion"],
  })
  expect(() => assertReplayPortfolioTwoFixedPartialCycleSequenceReservationSnapshot(value)).not.toThrow()
  const expanded = structuredClone(value); expanded.cycle_count = 5
  expect(() => assertReplayPortfolioTwoFixedPartialCycleSequenceReservationSnapshot(expanded)).toThrow("policy")
  const reordered = structuredClone(value); reordered.cycles[1]!.earliest_cycle_time = value.cycles[0]!.earliest_cycle_time
  expect(() => assertReplayPortfolioTwoFixedPartialCycleSequenceReservationSnapshot(reordered)).toThrow("order")
})

test("Portfolio post-partial stop-replacement sequence freezes exact Lane Trial identities", () => {
  const value = createReplayPortfolioPostPartialStopReplacementCycleSequenceReservationSnapshot({
    schema_version: REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION,
    reservation_id: "p28-sequence-1", reservation_ref: "reservation://p28-sequence/1",
    issued_at: "2026-07-14T00:00:00Z", expires_at: "2026-07-14T01:00:00Z", status: "reserved",
    authority_id: "research-control-plane", experiment_id: "experiment-1", trial_group_id: "group-1",
    trial_group_hash: HASH, portfolio_id: "portfolio-p28", settlement_asset: "USDT", initial_cash: 100,
    cycle_count: 4, max_cycle_count: 8,
    opening_cash_policy: "first_cycle_initial_then_predecessor_committed_trial_balance",
    successor_eligibility_policy:
      "predecessor_committed_full_flat_collateral_exposure_unrealized_and_current_risk_zero",
    expansion_policy: "exact_predeclared_lane_trials_no_runtime_append_or_search_expansion",
    cycles: Array.from({ length: 4 }, (_, index) => ({
      cycle_index: index + 1,
      earliest_cycle_time: `2026-07-14T00:${String(index * 8).padStart(2, "0")}:00Z`,
      lanes: [{ lane_id: `lane-${index + 1}`, priority_rank: 1, trial_id: `trial-${index + 1}`,
        run_id: `run-${index + 1}`, trial_reservation_ref: `reservation://trial-${index + 1}`,
        trial_reservation_hash: String(index + 1).repeat(64),
        request_hash: String(index + 5).repeat(64) }],
    })),
    limitations: ["one_to_eight_predeclared_post_partial_stop_replacement_full_flat_cycles_only",
      "cycle_opening_cash_must_equal_predecessor_committed_trial_balance",
      "no_open_successor_dynamic_sizing_between_partial_or_repeated_mutation_third_partial_reentry_cross_margin_borrow_real_liquidity_fast_or_runtime_cycle_expansion"],
  })
  expect(() => assertReplayPortfolioPostPartialStopReplacementCycleSequenceReservationSnapshot(value))
    .not.toThrow()
  const duplicated = structuredClone(value)
  duplicated.cycles[1]!.lanes[0]!.trial_id = duplicated.cycles[0]!.lanes[0]!.trial_id
  expect(() => assertReplayPortfolioPostPartialStopReplacementCycleSequenceReservationSnapshot(duplicated))
    .toThrow("lanes")
  const expanded = structuredClone(value); expanded.cycle_count = 5
  expect(() => assertReplayPortfolioPostPartialStopReplacementCycleSequenceReservationSnapshot(expanded))
    .toThrow("policy")
})

test("provider certification termination is non-retroactive and type-safe", () => {
  const supersession = createReplayInstrumentStatusProviderCertificationTermination({
    schema_version: REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_TERMINATION_SCHEMA_VERSION,
    termination_id: "termination-1", termination_ref: "certification-termination://status-provider/v1",
    certification_hash: PROVIDER_CERTIFICATION.certification_hash, termination_type: "superseded",
    recorded_at: "2026-07-14T00:00:00Z", effective_at: "2026-07-15T00:00:00Z",
    authority_id: "research-control-plane", termination_policy_version: "rd-provider-termination-v1",
    reason_code: "provider_build_rotation", successor_certification_hash: "b".repeat(64),
  })
  expect(supersession.termination_hash).toHaveLength(64)
  const { termination_hash: _, ...body } = supersession
  expect(() => createReplayInstrumentStatusProviderCertificationTermination({
    ...body,
    recorded_at: "2026-07-16T00:00:00Z",
  })).toThrow("cannot be retroactive")
  expect(() => createReplayInstrumentStatusProviderCertificationTermination({
    ...body,
    termination_type: "revoked",
  })).toThrow("cannot name a successor")
})

test("aggregate trade provider admission stays pre-integration and completeness-bounded", () => {
  const admission = createReplayAggregateTradeEvidenceAdmissionSnapshot({
    schema_version: REPLAY_AGGREGATE_TRADE_EVIDENCE_ADMISSION_SCHEMA_VERSION,
    admission_id: "aggregate-trade-admission-1",
    admission_ref: "admission://aggregate-trade/trial-1",
    status: "admitted",
    issued_at: "2026-07-15T00:03:00Z",
    authority_id: "research-control-plane",
    admission_policy_version: "rd-aggregate-trade-evidence-admission-v1",
    trial_id: "trial-1",
    run_id: "run-1",
    reservation_ref: "reservation://trial-1",
    reservation_hash: HASH,
    provider_capability_hash: AGGREGATE_TRADE_PROVIDER_CERTIFICATION.provider_capability_hash,
    provider_certification_hash: AGGREGATE_TRADE_PROVIDER_CERTIFICATION.certification_hash,
    provider_certification: AGGREGATE_TRADE_PROVIDER_CERTIFICATION,
    archive_id: "aggregate-trade-archive-1",
    archive_hash: HASH,
    source_receipt_hash: HASH,
    completeness_audit_hash: HASH,
    evidence_ref: "evidence://aggregate-trade/trial-1",
    evidence_hash: HASH,
    coverage_attestation_hash: HASH,
    evidence_produced_at: "2026-07-15T00:02:00Z",
    coverage_start: "2026-07-15T00:00:00Z",
    coverage_end: "2026-07-15T00:01:00Z",
    external_completeness: "not_verified",
    scope: "pre_integration_exact_price_path_only",
  })
  expect(admission.admission_hash).toHaveLength(64)
  const { admission_hash: _admissionHash, ...body } = admission
  expect(() => createReplayAggregateTradeEvidenceAdmissionSnapshot({
    ...body,
    scope: "runner_execution" as typeof body.scope,
  })).toThrow("cannot authorize execution")
  expect(() => createReplayAggregateTradeEvidenceAdmissionSnapshot({
    ...body,
    issued_at: "2026-07-15T00:01:00Z",
  })).toThrow("chronology")
  expect(() => createReplayAggregateTradeEvidenceAdmissionSnapshot({
    ...body,
    provider_capability_hash: "b".repeat(64),
  })).toThrow("provider certification binding")

  const termination = createReplayAggregateTradeProviderCertificationTermination({
    schema_version: REPLAY_AGGREGATE_TRADE_PROVIDER_CERTIFICATION_TERMINATION_SCHEMA_VERSION,
    termination_id: "aggregate-trade-termination-1",
    termination_ref: "certification-termination://aggregate-trade-provider/v1",
    certification_hash: AGGREGATE_TRADE_PROVIDER_CERTIFICATION.certification_hash,
    termination_type: "revoked",
    recorded_at: "2026-07-15T00:04:00Z",
    effective_at: "2026-07-15T00:05:00Z",
    authority_id: "research-control-plane",
    termination_policy_version: "rd-aggregate-trade-provider-termination-v1",
    reason_code: "determinism_regression",
    successor_certification_hash: null,
  })
  expect(termination.termination_hash).toHaveLength(64)
})

test("cross-source ordering admission binds four source hashes without economic authority", () => {
  const limitations = [
    "cross-source-global-sequence-unavailable",
    "source-clock-resolution-does-not-prove-within-timestamp-order",
    "aggregate-trade-external-completeness-not-verified",
    "funding-external-completeness-not-asserted",
    "ohlcv-aggregate-trade-bar-link-not-attested",
  ] as const
  const admission = createReplayCrossSourceOrderingAdmissionSnapshot({
    schema_version: REPLAY_CROSS_SOURCE_ORDERING_ADMISSION_SCHEMA_VERSION,
    admission_id: "cross-source-admission-1",
    admission_ref: "admission://cross-source/trial-1",
    status: "admitted",
    issued_at: "2026-07-15T00:04:00Z",
    authority_id: "research-control-plane",
    admission_policy_version: "rd-cross-source-ordering-admission-v1",
    trial_id: "trial-1",
    run_id: "run-1",
    reservation_ref: "reservation://trial-1",
    reservation_hash: HASH,
    aggregate_trade_evidence_admission_ref: "admission://aggregate-trade/trial-1",
    aggregate_trade_evidence_admission_hash: HASH,
    aggregate_trade_coverage_attestation_hash: HASH,
    ordering_attestation_id: "cross-source-ordering-1",
    ordering_attestation_hash: HASH,
    ordering_attestation_schema_version: "trade.rd-replay-cross-source-ordering-attestation.v1",
    event_key_policy_version: "rd-replay-cross-source-event-key-v1",
    symbol: "BTCUSDT",
    timeframe: "4h",
    window_start_inclusive: "2026-07-15T00:00:00Z",
    window_end_exclusive: "2026-07-15T00:03:00Z",
    dataset_manifest_ref: "dataset://fixture",
    dataset_hash: HASH,
    instrument_status_schedule_hash: HASH,
    instrument_status_provenance_hash: HASH,
    source_kinds: ["instrument_status", "funding", "aggregate_trade", "ohlcv"],
    instrument_status_events_hash: HASH,
    funding_events_hash: HASH,
    aggregate_trade_events_hash: HASH,
    ohlcv_bars_hash: HASH,
    source_collections_hash: HASH,
    ordered_events_hash: HASH,
    ambiguity_groups_hash: HASH,
    ambiguity_group_count: 1,
    ordering_resolution: "resolution_limited",
    limitations: [...limitations],
    limitations_hash: createHash("sha256").update(JSON.stringify(limitations)).digest("hex"),
    external_completeness: "not_verified",
    scope: "pre_integration_cross_source_ordering_only",
    economic_authority: "none",
  })
  expect(admission.admission_hash).toHaveLength(64)
  const { admission_hash: _admissionHash, ...body } = admission
  expect(() => createReplayCrossSourceOrderingAdmissionSnapshot({
    ...body,
    economic_authority: "runner" as typeof body.economic_authority,
  })).toThrow("cannot authorize economic execution")
  expect(() => createReplayCrossSourceOrderingAdmissionSnapshot({
    ...body,
    ambiguity_group_count: 0,
    ordering_resolution: "exact_by_declared_timestamps",
  })).toThrow("overclaims")
  expect(() => createReplayCrossSourceOrderingAdmissionSnapshot({
    ...body,
    funding_events_hash: "b".repeat(64),
    source_kinds: ["instrument_status", "aggregate_trade", "funding", "ohlcv"] as unknown as typeof body.source_kinds,
  })).toThrow("four-source canonical set")
})

test("Replay cancellation receipts separate future claims from one active Attempt", () => {
  const reservationCancellation = createReplayReservationCancellationSnapshot({
    schema_version: REPLAY_RESERVATION_CANCELLATION_SCHEMA_VERSION,
    cancellation_id: "reservation-cancellation-1", cancellation_ref: "cancellation://reservation/1",
    status: "cancelled", recorded_at: "2026-07-14T00:01:00Z", effective_at: "2026-07-14T00:02:00Z",
    authority_id: "research-control-plane", cancellation_policy_version: "rd-replay-cancellation-v1",
    reason_code: "provider_certification_incident", trial_id: "trial-1", run_id: "run-1",
    reservation_ref: "reservation://trial-1", reservation_hash: HASH, scope: "future_attempt_claims",
  })
  expect(reservationCancellation.cancellation_hash).toHaveLength(64)
  const { cancellation_hash: _, ...reservationBody } = reservationCancellation
  expect(() => createReplayReservationCancellationSnapshot({
    ...reservationBody,
    recorded_at: "2026-07-14T00:03:00Z",
  })).toThrow("cannot be retroactive")

  const attemptCancellation = createReplayAttemptCancellationSnapshot({
    schema_version: REPLAY_ATTEMPT_CANCELLATION_SCHEMA_VERSION,
    cancellation_id: "attempt-cancellation-1", cancellation_ref: "cancellation://attempt/1",
    status: "cancelled", recorded_at: "2026-07-14T00:03:00Z",
    authority_id: "research-control-plane", cancellation_policy_version: "rd-replay-cancellation-v1",
    reason_code: "operator_emergency_stop", trial_id: "trial-1", run_id: "run-1",
    reservation_ref: "reservation://trial-1", reservation_hash: HASH, request_hash: "b".repeat(64),
    attempt_id: "attempt-1", attempt_ordinal: 1, worker_id: "worker-1", target_lease_generation: 2,
    scope: "active_attempt",
  })
  expect(attemptCancellation.cancellation_hash).toHaveLength(64)
  const { cancellation_hash: _attemptHash, ...attemptBody } = attemptCancellation
  expect(() => createReplayAttemptCancellationSnapshot({
    ...attemptBody,
    target_lease_generation: 0,
  })).toThrow("must be positive")

  const observation = createReplayAttemptCancellationObservationSnapshot({
    schema_version: REPLAY_ATTEMPT_CANCELLATION_OBSERVATION_SCHEMA_VERSION,
    observation_id: "attempt-cancellation-observation-1",
    observation_ref: "cancellation-observation://attempt/1",
    status: "observed",
    observed_at: "2026-07-14T00:04:00Z",
    cancellation_id: attemptCancellation.cancellation_id,
    cancellation_ref: attemptCancellation.cancellation_ref,
    cancellation_hash: attemptCancellation.cancellation_hash,
    trial_id: attemptCancellation.trial_id,
    run_id: attemptCancellation.run_id,
    reservation_ref: attemptCancellation.reservation_ref,
    reservation_hash: attemptCancellation.reservation_hash,
    request_hash: attemptCancellation.request_hash,
    attempt_id: attemptCancellation.attempt_id,
    attempt_ordinal: attemptCancellation.attempt_ordinal,
    worker_id: attemptCancellation.worker_id,
    target_lease_generation: attemptCancellation.target_lease_generation,
    outcome_schema_version: "trade.rd-replay-run-outcome.v35",
    outcome_status: "cancelled",
    outcome_failure_code: "execution-cancelled-at-checkpoint",
    partial_result_published: false,
  })
  expect(observation.observation_hash).toHaveLength(64)
  const { observation_hash: _observationHash, ...observationBody } = observation
  expect(() => createReplayAttemptCancellationObservationSnapshot({
    ...observationBody,
    target_lease_generation: 0,
  })).toThrow("must be positive")
})

test("Replay Attempt Lease snapshot carries a monotonic fencing generation", () => {
  const lease = {
    schema_version: REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
    attempt_id: "attempt-1", attempt_ordinal: 1, worker_id: "worker-1",
    trial_id: "trial-1", run_id: "run-1", reservation_ref: "reservation://trial-1",
    reservation_hash: HASH, request_hash: "b".repeat(64), status: "running" as const,
    lease_generation: 2, claimed_at: "2026-07-15T00:00:00Z",
    heartbeat_at: "2026-07-15T00:01:00Z", lease_expires_at: "2026-07-15T00:06:00Z",
  }
  expect(hashReplayAttemptLeaseSnapshot(lease)).toHaveLength(64)
  expect(() => hashReplayAttemptLeaseSnapshot({ ...lease, lease_expires_at: lease.heartbeat_at })).toThrow(/timestamps/)

  const observation = createReplayAttemptLeaseObservationSnapshot({
    schema_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_SCHEMA_VERSION,
    observation_id: "replay-attempt-lease-observation-1",
    observation_ref: "observation://replay-attempt-lease/1",
    observation_policy_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_POLICY_VERSION,
    status: "active_lease_observed",
    observed_at: lease.heartbeat_at,
    authority_owner: "research_control_plane",
    authority_source: "research_control_plane_state_store",
    read_consistency: "single_control_plane_transaction",
    clock_evidence: "caller_supplied_utc_not_external_time_attestation",
    trial_id: lease.trial_id,
    run_id: lease.run_id,
    attempt_id: lease.attempt_id,
    attempt_ordinal: lease.attempt_ordinal,
    worker_id: lease.worker_id,
    lease_generation: lease.lease_generation,
    attempt_lease_hash: hashReplayAttemptLeaseSnapshot(lease),
    attempt_lease: lease,
  })
  expect(observation.observation_hash).toHaveLength(64)
  const { observation_hash: _observationHash, ...observationBody } = observation
  expect(() => createReplayAttemptLeaseObservationSnapshot({
    ...observationBody,
    observed_at: lease.lease_expires_at,
  })).toThrow(/heartbeat_at <= observed_at < lease_expires_at/)
  expect(() => createReplayAttemptLeaseObservationSnapshot({
    ...observationBody,
    lease_generation: lease.lease_generation + 1,
  })).toThrow(/does not bind/)
})

test("Replay decision observation Bundle admission is immutable non-economic authority", () => {
  const value = createReplayDecisionObservationBundleAdmissionSnapshot({
    schema_version: REPLAY_DECISION_OBSERVATION_BUNDLE_ADMISSION_SCHEMA_VERSION,
    admission_id: "observation-bundle-admission-1",
    admission_ref: "admission://decision-observation-bundle/1",
    status: "admitted",
    issued_at: "2026-07-14T00:10:00Z",
    authority_id: "research-control-plane",
    admission_policy_version: "rd-decision-observation-bundle-admission-v1",
    trial_id: "trial-1",
    run_id: "run-1",
    reservation_ref: "reservation://trial-1",
    reservation_hash: HASH,
    request_schema_version: "trade.rd-replay-execution-request.v38",
    request_hash: "b".repeat(64),
    dataset_manifest_ref: "dataset://fixture",
    dataset_hash: "c".repeat(64),
    ordering_admission_ref: "admission://cross-source-ordering/1",
    ordering_admission_hash: "d".repeat(64),
    wire_manifest_id: "source-event-wire-1",
    wire_manifest_hash: "e".repeat(64),
    wire_policy_version: "rd-replay-source-event-wire-v2",
    decision_schedule_hash: "f".repeat(64),
    decision_schedule_entry_count: 2,
    bundle_id: "source-event-decision-observation-bundle-1",
    bundle_hash: "1".repeat(64),
    bundle_policy_version: "rd-replay-source-event-decision-observation-bundle-v1",
    binding_set_id: "source-event-decision-schedule-observation-set-1",
    binding_set_hash: "2".repeat(64),
    projection_count: 2,
    projections_hash: "3".repeat(64),
    observation_values_hashes_hash: "4".repeat(64),
    first_as_of_time: "2026-07-14T00:01:00Z",
    last_as_of_time: "2026-07-14T00:02:00Z",
    consumer_capability: "non_economic_decision_observation_audit",
    scope: "pre_integration_non_economic_observation_audit_only",
    parent_lineage_validation: "wire_identity_and_schedule_binding_only",
    projection_derivation_compatibility: "not_certified",
    decision_input_compatibility: "not_asserted",
    harness_compatibility: "not_bound",
    harness_invocation: "forbidden",
    runner_compatibility: "not_bound",
    decision_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
  })
  expect(value.admission_hash).toHaveLength(64)
  const { admission_hash: _, ...body } = value
  expect(() => createReplayDecisionObservationBundleAdmissionSnapshot({
    ...body,
    projection_count: 1,
  })).toThrow("cardinality")
  expect(() => createReplayDecisionObservationBundleAdmissionSnapshot({
    ...body,
    harness_invocation: "allowed" as "forbidden",
  })).toThrow("cannot authorize execution")
})

test("Replay decision observation derivation admission binds evidence without replay authority", () => {
  const value = createReplayDecisionObservationBundleDerivationAdmissionSnapshot({
    schema_version: REPLAY_DECISION_OBSERVATION_BUNDLE_DERIVATION_ADMISSION_SCHEMA_VERSION,
    admission_id: "observation-derivation-admission-1",
    admission_ref: "admission://decision-observation-derivation/1",
    status: "admitted",
    issued_at: "2026-07-14T00:11:00Z",
    authority_id: "research-control-plane",
    admission_policy_version: "rd-decision-observation-derivation-admission-v1",
    trial_id: "trial-1",
    run_id: "run-1",
    reservation_ref: "reservation://trial-1",
    reservation_hash: HASH,
    request_hash: "b".repeat(64),
    dataset_manifest_ref: "dataset://fixture",
    dataset_hash: "c".repeat(64),
    bundle_admission_ref: "admission://decision-observation-bundle/1",
    bundle_admission_hash: "d".repeat(64),
    ordering_admission_hash: "e".repeat(64),
    wire_manifest_id: "source-event-wire-1",
    wire_manifest_hash: "f".repeat(64),
    decision_schedule_hash: "1".repeat(64),
    bundle_id: "source-event-decision-observation-bundle-1",
    bundle_hash: "2".repeat(64),
    binding_set_id: "source-event-decision-schedule-observation-set-1",
    binding_set_hash: "3".repeat(64),
    derivation_attestation_id: "source-event-decision-observation-derivation-1",
    derivation_attestation_hash: "4".repeat(64),
    derivation_policy_version: "rd-replay-source-event-decision-observation-bundle-derivation-v1",
    certification_result: "certified_against_supplied_parent_chain",
    common_parent_rule: "one_wire_gate_trace_cursor_for_all_boundaries",
    boundary_count: 2,
    boundaries_hash: "5".repeat(64),
    first_decision_time: "2026-07-14T00:01:00Z",
    last_decision_time: "2026-07-14T00:02:00Z",
    consumer_capability: "non_economic_decision_observation_derivation_audit",
    scope: "pre_integration_non_economic_derivation_admission_only",
    control_plane_validation: "attestation_schema_hash_and_admitted_bundle_binding",
    control_plane_parent_replay: "not_performed",
    independent_verification: "external_parent_replay_required",
    decision_input_compatibility: "not_asserted",
    harness_compatibility: "not_bound",
    harness_invocation: "forbidden",
    runner_compatibility: "not_bound",
    decision_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
  })
  expect(value.admission_hash).toHaveLength(64)
  const { admission_hash: _, ...body } = value
  expect(() => createReplayDecisionObservationBundleDerivationAdmissionSnapshot({
    ...body,
    control_plane_parent_replay: "performed" as "not_performed",
  })).toThrow("cannot authorize execution")
  expect(() => createReplayDecisionObservationBundleDerivationAdmissionSnapshot({
    ...body,
    runner_compatibility: "bound" as "not_bound",
  })).toThrow("cannot authorize execution")
  expect(() => createReplayDecisionObservationBundleDerivationAdmissionSnapshot({
    ...body,
    unexpected_authority: "runner",
  } as typeof body)).toThrow("field whitelist")
})

test("Replay Resume Authorization binds a later target Attempt and detects mutation", () => {
  const value = createReplayResumeAuthorizationSnapshot({
    schema_version: REPLAY_RESUME_AUTHORIZATION_SCHEMA_VERSION,
    authorization_id: "resume-1", authorization_ref: "resume://attempt-2", issued_at: "2026-07-15T00:02:00Z", status: "authorized",
    trial_id: "trial-1", run_id: "run-1", request_hash: "b".repeat(64),
    reservation_ref: "reservation://trial-1", reservation_hash: HASH,
    source_attempt_id: "attempt-1", source_attempt_ordinal: 1, source_attempt_status: "cancelled",
    diagnostic_checkpoint_ref: "artifact://attempt-1/diagnostic-checkpoint-commit-2-2-ffffffffffffffff.json",
    diagnostic_checkpoint_hash: "c".repeat(64),
    target_attempt_id: "attempt-2", target_attempt_ordinal: 2, target_worker_id: "worker-2",
    target_claimed_at: "2026-07-15T00:01:00Z", target_lease_generation_floor: 1,
    target_attempt_lease_hash: "d".repeat(64),
  })
  expect(hashReplayResumeAuthorizationSnapshot(value)).toBe(value.authorization_hash)
  expect(() => hashReplayResumeAuthorizationSnapshot({ ...value, target_worker_id: "worker-3" })).toThrow("hash mismatch")
  const { authorization_hash: _, ...body } = value
  expect(() => createReplayResumeAuthorizationSnapshot({ ...body, target_attempt_ordinal: 1 })).toThrow("later Attempt")
})

test("Replay Checkpoint Receipt binds fenced producer authority and monotonic progress", () => {
  const receipt = createReplayCheckpointReceiptSnapshot({
    schema_version: REPLAY_CHECKPOINT_RECEIPT_SCHEMA_VERSION,
    receipt_id: "receipt-1", receipt_ref: "receipt://attempt-1/2", recorded_at: "2026-07-15T00:02:00Z", status: "recorded",
    trial_id: "trial-1", run_id: "run-1", request_hash: "b".repeat(64),
    reservation_ref: "reservation://trial-1", reservation_hash: HASH,
    attempt_id: "attempt-1", attempt_ordinal: 1, worker_id: "worker-1", lease_generation: 2,
    attempt_lease_hash: "c".repeat(64),
    diagnostic_checkpoint_ref: "artifact://attempt-1/diagnostic-checkpoint-commit-2-2-ffffffffffffffff.json",
    diagnostic_checkpoint_hash: "d".repeat(64),
    engine_checkpoint_ref: "artifact://attempt-1/diagnostic-checkpoint-2-2-ffffffffffffffff.json",
    engine_checkpoint_payload_hash: "e".repeat(64), engine_checkpoint_hash: "f".repeat(64),
    storage_policy_version: REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION,
    next_source_offset: 2,
  })
  expect(hashReplayCheckpointReceiptSnapshot(receipt)).toBe(receipt.receipt_hash)
  expect(() => hashReplayCheckpointReceiptSnapshot({ ...receipt, next_source_offset: 3 })).toThrow("hash mismatch")
  const { receipt_hash: _, ...body } = receipt
  expect(() => createReplayCheckpointReceiptSnapshot({
    ...body,
    storage_policy_version: "unsupported-storage-policy" as typeof REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION,
  })).toThrow("storage policy is not supported")
})
