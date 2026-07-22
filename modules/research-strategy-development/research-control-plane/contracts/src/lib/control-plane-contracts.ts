import { createHash } from "node:crypto"
import { REPLAY_LOCAL_ARTIFACT_STORAGE_POLICY_VERSION } from "../../../../../contracts/replay-contract/src/replay-storage-policy"

export const CONTROL_PLANE_IDENTITY_SCHEMA_VERSION = "trade.rd-identity-binding.v1" as const
export const DRAFT_AUTHORIZATION_SCHEMA_VERSION = "trade.rd-draft-authorization.v1" as const
export const STRATEGY_DRAFT_BINDING_SCHEMA_VERSION = "trade.rd-strategy-draft-binding.v1" as const
export const TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION = "trade.rd-trial-reservation-snapshot.v9" as const
export const REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION = "trade.rd-replay-instrument-status-provider-certification.v1" as const
export const REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_TERMINATION_SCHEMA_VERSION = "trade.rd-replay-instrument-status-provider-certification-termination.v1" as const
export const REPLAY_AGGREGATE_TRADE_PROVIDER_CERTIFICATION_SCHEMA_VERSION = "trade.rd-replay-aggregate-trade-provider-certification.v1" as const
export const REPLAY_AGGREGATE_TRADE_PROVIDER_CERTIFICATION_TERMINATION_SCHEMA_VERSION = "trade.rd-replay-aggregate-trade-provider-certification-termination.v1" as const
export const REPLAY_AGGREGATE_TRADE_EVIDENCE_ADMISSION_SCHEMA_VERSION = "trade.rd-replay-aggregate-trade-evidence-admission.v1" as const
export const REPLAY_CROSS_SOURCE_ORDERING_ADMISSION_SCHEMA_VERSION = "trade.rd-replay-cross-source-ordering-admission.v1" as const
export const REPLAY_BAR_LINKED_AGGREGATE_TRADE_PATH_AUTHORITY_SCHEMA_VERSION =
  "trade.rd-replay-bar-linked-aggregate-trade-path-authority.v1" as const
export const REPLAY_DECISION_OBSERVATION_BUNDLE_ADMISSION_SCHEMA_VERSION = "trade.rd-replay-decision-observation-bundle-admission.v1" as const
export const REPLAY_DECISION_OBSERVATION_BUNDLE_DERIVATION_ADMISSION_SCHEMA_VERSION = "trade.rd-replay-decision-observation-bundle-derivation-admission.v1" as const
export const REPLAY_RESERVATION_CANCELLATION_SCHEMA_VERSION = "trade.rd-replay-reservation-cancellation.v1" as const
export const REPLAY_ATTEMPT_CANCELLATION_SCHEMA_VERSION = "trade.rd-replay-attempt-cancellation.v1" as const
export const REPLAY_ATTEMPT_CANCELLATION_OBSERVATION_SCHEMA_VERSION = "trade.rd-replay-attempt-cancellation-observation.v1" as const
export const REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION = "trade.rd-replay-attempt-lease.v1" as const
export const REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_REQUEST_SCHEMA_VERSION =
  "trade.rd-replay-successor-verification-lease-renewal-request.v1" as const
export const REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_REQUEST_POLICY_VERSION =
  "rd-replay-successor-verification-lease-renewal-request-v1" as const
export const REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_RECEIPT_SCHEMA_VERSION =
  "trade.rd-replay-successor-verification-lease-renewal-receipt.v1" as const
export const REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_RECEIPT_POLICY_VERSION =
  "rd-replay-successor-verification-lease-renewal-receipt-v1" as const
export const REPLAY_ATTEMPT_LEASE_OBSERVATION_SCHEMA_VERSION = "trade.rd-replay-attempt-lease-observation.v1" as const
export const REPLAY_ATTEMPT_LEASE_OBSERVATION_POLICY_VERSION = "rd-replay-attempt-lease-observation-v1" as const
export const REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_SCHEMA_VERSION =
  "trade.rd-replay-attempt-lease-observation-registry-read-receipt.v1" as const
export const REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_POLICY_VERSION =
  "rd-replay-attempt-lease-observation-registry-read-receipt-v1" as const
export const REPLAY_DISPATCH_CLOCK_ATTESTATION_SCHEMA_VERSION =
  "trade.rd-replay-dispatch-clock-attestation.v1" as const
export const REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION =
  "rd-replay-dispatch-clock-attestation-v1" as const
export const REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_SCHEMA_VERSION =
  "trade.rd-replay-spawn-boundary-revalidation-request.v1" as const
export const REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_POLICY_VERSION =
  "rd-replay-spawn-boundary-revalidation-request-v1" as const
export const REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_SCHEMA_VERSION =
  "trade.rd-replay-spawn-boundary-revalidation-receipt.v1" as const
export const REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_POLICY_VERSION =
  "rd-replay-spawn-boundary-revalidation-receipt-v1" as const
export const REPLAY_CHECKPOINT_RECEIPT_SCHEMA_VERSION = "trade.rd-replay-checkpoint-receipt.v2" as const
export const REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION = REPLAY_LOCAL_ARTIFACT_STORAGE_POLICY_VERSION
export const REPLAY_RESUME_AUTHORIZATION_SCHEMA_VERSION = "trade.rd-replay-resume-authorization-snapshot.v1" as const
export const REPLAY_SHARED_INITIAL_CAPITAL_RESERVATION_SCHEMA_VERSION =
  "trade.rd-replay-shared-initial-capital-reservation.v1" as const
export const REPLAY_RUNTIME_SHARED_WALLET_RESERVATION_SCHEMA_VERSION =
  "trade.rd-replay-runtime-shared-wallet-reservation.v1" as const
export const REPLAY_RUNTIME_SHARED_WALLET_LIFECYCLE_RESERVATION_SCHEMA_VERSION =
  "trade.rd-replay-runtime-shared-wallet-lifecycle-reservation.v1" as const
export const REPLAY_RUNTIME_SHARED_WALLET_FUNDING_RESERVATION_SCHEMA_VERSION =
  "trade.rd-replay-runtime-shared-wallet-funding-reservation.v1" as const
export const REPLAY_RUNTIME_SHARED_WALLET_RISK_RESERVATION_SCHEMA_VERSION =
  "trade.rd-replay-runtime-shared-wallet-risk-reservation.v1" as const
export const REPLAY_PORTFOLIO_ALLOCATION_RESERVATION_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-allocation-reservation.v1" as const
export const REPLAY_PORTFOLIO_REALLOCATION_RESERVATION_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-reallocation-reservation.v1" as const
export const REPLAY_PORTFOLIO_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-cycle-sequence-reservation.v1" as const
export const REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES = 8 as const
export const REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_RESERVATION_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-two-fixed-partial-reservation.v1" as const
export const REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-two-fixed-partial-cycle-sequence-reservation.v1" as const
export const REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION =
  "trade.rd-replay-portfolio-post-partial-stop-replacement-cycle-sequence-reservation.v1" as const

export interface ResearchIdentityBinding {
  schema_version: typeof CONTROL_PLANE_IDENTITY_SCHEMA_VERSION
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  trial_id: string
  candidate_id: string
  candidate_hash: string
  identity_hash_policy_version: string
  experiment_contract_hash: string
}

export interface ReplayReservationBindings {
  replay_idempotency_key: string
  execution_spec_hash: string
  dataset_manifest_ref: string
  dataset_hash: string
  liquidity_capacity_attestation_hash: string | null
  supplemental_facts_hash: string
  supplemental_requirement_set_hash: string
  venue_risk_policy_schedule_hash: string
  instrument_spec_schedule_hash: string
  instrument_status_schedule_hash: string
  instrument_status_provenance_hash: string
  instrument_status_provider_capability_hash: string
  instrument_status_provider_certification_hash: string
  harness_hash: string
  assumptions_hash: string
  cost_policy_hash: string
  margin_policy_hash: string
  simulator_policy_version: string
  execution_mode: "step"
}

export interface ReplayInstrumentStatusProviderCertificationSnapshot {
  schema_version: typeof REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION
  certification_id: string
  certification_ref: string
  certification_hash: string
  status: "certified"
  certified_at: string
  valid_until: string
  certifier_id: string
  certification_policy_version: string
  provider_capability_hash: string
  producer_domain: "market-data-products"
  producer_id: string
  producer_version: string
  producer_build_hash: string
  normalization_policy_version: string
  normalization_policy_hash: string
  allowed_source_kind: "venue_status_event_archive"
  allowed_completeness: "complete_history"
}

export type ReplayInstrumentStatusProviderCertificationBody = Omit<
  ReplayInstrumentStatusProviderCertificationSnapshot,
  "certification_hash"
>

export type ReplayInstrumentStatusProviderCertificationTerminationReason =
  | "provider_build_rotation"
  | "normalization_policy_rotation"
  | "capability_rotation"
  | "certification_error"
  | "determinism_regression"
  | "security_incident"
  | "provider_retired"

export interface ReplayInstrumentStatusProviderCertificationTermination {
  schema_version: typeof REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_TERMINATION_SCHEMA_VERSION
  termination_id: string
  termination_ref: string
  termination_hash: string
  certification_hash: string
  termination_type: "revoked" | "superseded"
  recorded_at: string
  effective_at: string
  authority_id: string
  termination_policy_version: string
  reason_code: ReplayInstrumentStatusProviderCertificationTerminationReason
  successor_certification_hash: string | null
}

export type ReplayInstrumentStatusProviderCertificationTerminationBody = Omit<
  ReplayInstrumentStatusProviderCertificationTermination,
  "termination_hash"
>

export interface ReplayAggregateTradeProviderCertificationSnapshot {
  schema_version: typeof REPLAY_AGGREGATE_TRADE_PROVIDER_CERTIFICATION_SCHEMA_VERSION
  certification_id: string
  certification_ref: string
  certification_hash: string
  status: "certified"
  certified_at: string
  valid_until: string
  certifier_id: string
  certification_policy_version: string
  provider_capability_hash: string
  producer_domain: "market-data-products"
  producer_id: "market-data.aggregate-trade-provider"
  producer_version: string
  producer_build_hash: string
  provider_policy_hash: string
  accepted_archive_schema: "trade.market-data-aggregate-trade-archive.v1"
  emitted_event_schema: "trade.rd-replay-aggregate-trade-event.v1"
  emitted_attestation_schema: "trade.rd-replay-aggregate-trade-coverage-attestation.v1"
  allowed_source_kind: "venue_aggregate_trade_archive"
  allowed_external_completeness: "not_verified"
}

export type ReplayAggregateTradeProviderCertificationBody = Omit<
  ReplayAggregateTradeProviderCertificationSnapshot,
  "certification_hash"
>

export type ReplayAggregateTradeProviderCertificationTerminationReason =
  ReplayInstrumentStatusProviderCertificationTerminationReason

export interface ReplayAggregateTradeProviderCertificationTermination {
  schema_version: typeof REPLAY_AGGREGATE_TRADE_PROVIDER_CERTIFICATION_TERMINATION_SCHEMA_VERSION
  termination_id: string
  termination_ref: string
  termination_hash: string
  certification_hash: string
  termination_type: "revoked" | "superseded"
  recorded_at: string
  effective_at: string
  authority_id: string
  termination_policy_version: string
  reason_code: ReplayAggregateTradeProviderCertificationTerminationReason
  successor_certification_hash: string | null
}

export type ReplayAggregateTradeProviderCertificationTerminationBody = Omit<
  ReplayAggregateTradeProviderCertificationTermination,
  "termination_hash"
>

export interface ReplayAggregateTradeEvidenceAdmissionSnapshot {
  schema_version: typeof REPLAY_AGGREGATE_TRADE_EVIDENCE_ADMISSION_SCHEMA_VERSION
  admission_id: string
  admission_ref: string
  admission_hash: string
  status: "admitted"
  issued_at: string
  authority_id: string
  admission_policy_version: string
  trial_id: string
  run_id: string
  reservation_ref: string
  reservation_hash: string
  provider_capability_hash: string
  provider_certification_hash: string
  provider_certification: ReplayAggregateTradeProviderCertificationSnapshot
  archive_id: string
  archive_hash: string
  source_receipt_hash: string
  completeness_audit_hash: string
  evidence_ref: string
  evidence_hash: string
  coverage_attestation_hash: string
  evidence_produced_at: string
  coverage_start: string
  coverage_end: string
  external_completeness: "not_verified"
  scope: "pre_integration_exact_price_path_only"
}

export type ReplayAggregateTradeEvidenceAdmissionBody = Omit<
  ReplayAggregateTradeEvidenceAdmissionSnapshot,
  "admission_hash"
>

export type ReplayCrossSourceOrderingAdmissionLimitation =
  | "cross-source-global-sequence-unavailable"
  | "source-clock-resolution-does-not-prove-within-timestamp-order"
  | "aggregate-trade-external-completeness-not-verified"
  | "funding-external-completeness-not-asserted"
  | "ohlcv-aggregate-trade-bar-link-not-attested"
  | "instrument-status-effective-vs-availability-separated"

export interface ReplayCrossSourceOrderingAdmissionSnapshot {
  schema_version: typeof REPLAY_CROSS_SOURCE_ORDERING_ADMISSION_SCHEMA_VERSION
  admission_id: string
  admission_ref: string
  admission_hash: string
  status: "admitted"
  issued_at: string
  authority_id: string
  admission_policy_version: string
  trial_id: string
  run_id: string
  reservation_ref: string
  reservation_hash: string
  aggregate_trade_evidence_admission_ref: string
  aggregate_trade_evidence_admission_hash: string
  aggregate_trade_coverage_attestation_hash: string
  ordering_attestation_id: string
  ordering_attestation_hash: string
  ordering_attestation_schema_version: "trade.rd-replay-cross-source-ordering-attestation.v1"
  event_key_policy_version: "rd-replay-cross-source-event-key-v1"
  symbol: string
  timeframe: string
  window_start_inclusive: string
  window_end_exclusive: string
  dataset_manifest_ref: string
  dataset_hash: string
  instrument_status_schedule_hash: string
  instrument_status_provenance_hash: string
  source_kinds: ["instrument_status", "funding", "aggregate_trade", "ohlcv"]
  instrument_status_events_hash: string
  funding_events_hash: string
  aggregate_trade_events_hash: string
  ohlcv_bars_hash: string
  source_collections_hash: string
  ordered_events_hash: string
  ambiguity_groups_hash: string
  ambiguity_group_count: number
  ordering_resolution: "exact_by_declared_timestamps" | "resolution_limited"
  limitations: ReplayCrossSourceOrderingAdmissionLimitation[]
  limitations_hash: string
  external_completeness: "not_verified"
  scope: "pre_integration_cross_source_ordering_only"
  economic_authority: "none"
}

export type ReplayCrossSourceOrderingAdmissionBody = Omit<
  ReplayCrossSourceOrderingAdmissionSnapshot,
  "admission_hash"
>

export const REPLAY_BAR_LINKED_AGGREGATE_TRADE_PATH_AUTHORITY_LIMITATIONS = Object.freeze([
  "aggregate-trade-external-completeness-not-verified",
  "bar-relative-public-trade-price-order-only",
  "cross-source-global-sequence-not-authorized",
  "entry-trigger-trade-excluded-from-post-entry-protection-observation",
  "no-queue-fill-quantity-maker-probability-slippage-impact-insurance-or-adl",
  "no-runner-result-artifact-or-default-path-cutover",
] as const)

export interface ReplayBarLinkedAggregateTradePathAuthoritySnapshot {
  schema_version: typeof REPLAY_BAR_LINKED_AGGREGATE_TRADE_PATH_AUTHORITY_SCHEMA_VERSION
  authority_snapshot_id: string
  authority_snapshot_ref: string
  authority_snapshot_hash: string
  status: "authorized"
  issued_at: string
  authority_id: string
  authority_policy_version: string
  trial_id: string
  run_id: string
  reservation_ref: string
  reservation_hash: string
  request_schema_version: "trade.rd-replay-execution-request.v38"
  request_hash: string
  entry_order_hash: string
  dataset_manifest_ref: string
  dataset_hash: string
  aggregate_trade_evidence_admission_ref: string
  aggregate_trade_evidence_admission_hash: string
  cross_source_ordering_admission_ref: string
  cross_source_ordering_admission_hash: string
  bar_link_attestation_id: string
  bar_link_attestation_hash: string
  bar_link_schema_version: "trade.rd-replay-kline-aggregate-trade-bar-link-attestation.v1"
  bar_link_policy_version: "rd-replay-kline-aggregate-trade-bar-link-v1"
  venue_id: "binance-usdm"
  symbol: string
  timeframe: string
  window_start_inclusive: string
  window_end_exclusive: string
  latest_component_available_at: string
  kline_record_hash: string
  replay_market_bar_hash: string
  aggregate_trade_coverage_attestation_hash: string
  aggregate_trade_events_hash: string
  entry_side: "long" | "short"
  entry_trigger_price: number
  protective_stop_price: number
  protective_target_price: number
  consumer_capability: "bounded_initial_stop_market_same_bar_post_entry_protection_ordering"
  entry_scope: "initial_stop_market_entry_only"
  path_resolution_authority: "authorized_for_bound_request_and_bar"
  path_observation_rule: "strictly_after_entry_trigger_trade"
  path_source_authority: "ordered_aggregate_trade_prices_within_linked_bar_only"
  cross_source_ordering_authority: "lineage_only_not_global_sequence"
  fill_quantity_authority: "none"
  cost_authority: "none"
  external_completeness: "not_verified"
  runner_compatibility: "not_bound"
  activation: "forbidden_until_exact_request_runner_consumer"
  limitations: Array<typeof REPLAY_BAR_LINKED_AGGREGATE_TRADE_PATH_AUTHORITY_LIMITATIONS[number]>
  limitations_hash: string
}

export type ReplayBarLinkedAggregateTradePathAuthorityBody = Omit<
  ReplayBarLinkedAggregateTradePathAuthoritySnapshot,
  "authority_snapshot_hash"
>

export interface ReplayDecisionObservationBundleAdmissionSnapshot {
  schema_version: typeof REPLAY_DECISION_OBSERVATION_BUNDLE_ADMISSION_SCHEMA_VERSION
  admission_id: string
  admission_ref: string
  admission_hash: string
  status: "admitted"
  issued_at: string
  authority_id: string
  admission_policy_version: string
  trial_id: string
  run_id: string
  reservation_ref: string
  reservation_hash: string
  request_schema_version: "trade.rd-replay-execution-request.v38"
  request_hash: string
  dataset_manifest_ref: string
  dataset_hash: string
  ordering_admission_ref: string
  ordering_admission_hash: string
  wire_manifest_id: string
  wire_manifest_hash: string
  wire_policy_version: "rd-replay-source-event-wire-v2"
  decision_schedule_hash: string
  decision_schedule_entry_count: number
  bundle_id: string
  bundle_hash: string
  bundle_policy_version: "rd-replay-source-event-decision-observation-bundle-v1"
  binding_set_id: string
  binding_set_hash: string
  projection_count: number
  projections_hash: string
  observation_values_hashes_hash: string
  first_as_of_time: string
  last_as_of_time: string
  consumer_capability: "non_economic_decision_observation_audit"
  scope: "pre_integration_non_economic_observation_audit_only"
  parent_lineage_validation: "wire_identity_and_schedule_binding_only"
  projection_derivation_compatibility: "not_certified"
  decision_input_compatibility: "not_asserted"
  harness_compatibility: "not_bound"
  harness_invocation: "forbidden"
  runner_compatibility: "not_bound"
  decision_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
}

export type ReplayDecisionObservationBundleAdmissionBody = Omit<
  ReplayDecisionObservationBundleAdmissionSnapshot,
  "admission_hash"
>

export interface ReplayDecisionObservationBundleDerivationAdmissionSnapshot {
  schema_version: typeof REPLAY_DECISION_OBSERVATION_BUNDLE_DERIVATION_ADMISSION_SCHEMA_VERSION
  admission_id: string
  admission_ref: string
  admission_hash: string
  status: "admitted"
  issued_at: string
  authority_id: string
  admission_policy_version: string
  trial_id: string
  run_id: string
  reservation_ref: string
  reservation_hash: string
  request_hash: string
  dataset_manifest_ref: string
  dataset_hash: string
  bundle_admission_ref: string
  bundle_admission_hash: string
  ordering_admission_hash: string
  wire_manifest_id: string
  wire_manifest_hash: string
  decision_schedule_hash: string
  bundle_id: string
  bundle_hash: string
  binding_set_id: string
  binding_set_hash: string
  derivation_attestation_id: string
  derivation_attestation_hash: string
  derivation_policy_version: "rd-replay-source-event-decision-observation-bundle-derivation-v1"
  certification_result: "certified_against_supplied_parent_chain"
  common_parent_rule: "one_wire_gate_trace_cursor_for_all_boundaries"
  boundary_count: number
  boundaries_hash: string
  first_decision_time: string
  last_decision_time: string
  consumer_capability: "non_economic_decision_observation_derivation_audit"
  scope: "pre_integration_non_economic_derivation_admission_only"
  control_plane_validation: "attestation_schema_hash_and_admitted_bundle_binding"
  control_plane_parent_replay: "not_performed"
  independent_verification: "external_parent_replay_required"
  decision_input_compatibility: "not_asserted"
  harness_compatibility: "not_bound"
  harness_invocation: "forbidden"
  runner_compatibility: "not_bound"
  decision_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
}

export type ReplayDecisionObservationBundleDerivationAdmissionBody = Omit<
  ReplayDecisionObservationBundleDerivationAdmissionSnapshot,
  "admission_hash"
>

export type ReplayExecutionCancellationReason =
  | "provider_certification_incident"
  | "data_integrity_incident"
  | "harness_security_incident"
  | "policy_withdrawal"
  | "operator_emergency_stop"

export interface ReplayReservationCancellationSnapshot {
  schema_version: typeof REPLAY_RESERVATION_CANCELLATION_SCHEMA_VERSION
  cancellation_id: string
  cancellation_ref: string
  cancellation_hash: string
  status: "cancelled"
  recorded_at: string
  effective_at: string
  authority_id: string
  cancellation_policy_version: string
  reason_code: ReplayExecutionCancellationReason
  trial_id: string
  run_id: string
  reservation_ref: string
  reservation_hash: string
  scope: "future_attempt_claims"
}

export interface ReplayAttemptCancellationSnapshot {
  schema_version: typeof REPLAY_ATTEMPT_CANCELLATION_SCHEMA_VERSION
  cancellation_id: string
  cancellation_ref: string
  cancellation_hash: string
  status: "cancelled"
  recorded_at: string
  authority_id: string
  cancellation_policy_version: string
  reason_code: ReplayExecutionCancellationReason
  trial_id: string
  run_id: string
  reservation_ref: string
  reservation_hash: string
  request_hash: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  target_lease_generation: number
  scope: "active_attempt"
}

export type ReplayReservationCancellationBody = Omit<ReplayReservationCancellationSnapshot, "cancellation_hash">
export type ReplayAttemptCancellationBody = Omit<ReplayAttemptCancellationSnapshot, "cancellation_hash">

export interface ReplayAttemptCancellationObservationSnapshot {
  schema_version: typeof REPLAY_ATTEMPT_CANCELLATION_OBSERVATION_SCHEMA_VERSION
  observation_id: string
  observation_ref: string
  observation_hash: string
  status: "observed"
  observed_at: string
  cancellation_id: string
  cancellation_ref: string
  cancellation_hash: string
  trial_id: string
  run_id: string
  reservation_ref: string
  reservation_hash: string
  request_hash: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  target_lease_generation: number
  outcome_schema_version: "trade.rd-replay-run-outcome.v35"
  outcome_status: "cancelled"
  outcome_failure_code: "execution-cancelled-at-checkpoint"
  partial_result_published: false
}

export type ReplayAttemptCancellationObservationBody = Omit<
  ReplayAttemptCancellationObservationSnapshot,
  "observation_hash"
>

export interface TrialReservationSnapshot {
  schema_version: typeof TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION
  reservation_id: string
  reservation_ref: string
  issued_at: string
  expires_at: string
  status: "reserved"
  identity: ResearchIdentityBinding
  trial_ordinal: number
  run_id: string
  counts_against_budget: boolean
  trial_accounting_policy_version: string
  candidate_assignment_hash: string
  bindings: ReplayReservationBindings
  instrument_status_provider_certification: ReplayInstrumentStatusProviderCertificationSnapshot
  required_capabilities: string[]
}

export interface ReplaySharedInitialCapitalReservationSnapshot {
  schema_version: typeof REPLAY_SHARED_INITIAL_CAPITAL_RESERVATION_SCHEMA_VERSION
  reservation_id: string
  reservation_ref: string
  reservation_hash: string
  issued_at: string
  expires_at: string
  status: "reserved"
  authority_id: "research-control-plane"
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  batch_id: string
  batch_plan_hash: string
  settlement_asset: string
  capital_policy_version: "rd-shared-initial-capital-static-preallocation-v1"
  execution_priority_policy: "control_plane_explicit_rank_no_ties"
  shared_initial_cash: number
  total_allocated_initial_cash: number
  lanes: Array<{
    lane_id: string
    priority_rank: number
    trial_id: string
    run_id: string
    trial_reservation_ref: string
    trial_reservation_hash: string
    allocated_initial_cash: number
  }>
  limitations: [
    "no_runtime_cash_reuse_or_rebalancing",
    "no_cross_lane_margin_or_liquidation",
    "no_concurrent_matching_claim",
  ]
}

export type ReplaySharedInitialCapitalReservationBody = Omit<
  ReplaySharedInitialCapitalReservationSnapshot,
  "reservation_hash"
>

export interface ReplayRuntimeSharedWalletReservationSnapshot {
  schema_version: typeof REPLAY_RUNTIME_SHARED_WALLET_RESERVATION_SCHEMA_VERSION
  reservation_id: string
  reservation_ref: string
  reservation_hash: string
  issued_at: string
  expires_at: string
  status: "reserved"
  authority_id: "research-control-plane"
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  portfolio_plan_hash: string
  settlement_asset: string
  shared_initial_cash: number
  capital_policy_version: "rd-runtime-shared-wallet-isolated-entry-v1"
  simultaneous_order_policy: "event_time_then_control_plane_priority"
  lanes: Array<{
    lane_id: string
    priority_rank: number
    trial_id: string
    run_id: string
    trial_reservation_ref: string
    trial_reservation_hash: string
  }>
  limitations: [
    "market_next_open_entry_only",
    "isolated_margin_no_cross_margin",
    "no_exit_funding_liquidation_or_cash_release",
  ]
}

export type ReplayRuntimeSharedWalletReservationBody = Omit<
  ReplayRuntimeSharedWalletReservationSnapshot,
  "reservation_hash"
>

export interface ReplayRuntimeSharedWalletLifecycleReservationSnapshot {
  schema_version: typeof REPLAY_RUNTIME_SHARED_WALLET_LIFECYCLE_RESERVATION_SCHEMA_VERSION
  reservation_id: string
  reservation_ref: string
  reservation_hash: string
  issued_at: string
  expires_at: string
  status: "reserved"
  authority_id: "research-control-plane"
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  portfolio_plan_hash: string
  settlement_asset: string
  shared_initial_cash: number
  capital_policy_version: "rd-runtime-shared-wallet-entry-exit-release-v1"
  same_time_cash_policy: "exit_release_before_entry_admission_then_control_plane_priority"
  lanes: Array<{
    lane_id: string
    priority_rank: number
    trial_id: string
    run_id: string
    trial_reservation_ref: string
    trial_reservation_hash: string
  }>
  limitations: [
    "market_next_open_entry_and_full_exit_only",
    "isolated_margin_no_cross_margin",
    "no_funding_liquidation_or_partial_position",
  ]
}

export type ReplayRuntimeSharedWalletLifecycleReservationBody = Omit<
  ReplayRuntimeSharedWalletLifecycleReservationSnapshot,
  "reservation_hash"
>

export interface ReplayRuntimeSharedWalletFundingReservationSnapshot {
  schema_version: typeof REPLAY_RUNTIME_SHARED_WALLET_FUNDING_RESERVATION_SCHEMA_VERSION
  reservation_id: string
  reservation_ref: string
  reservation_hash: string
  issued_at: string
  expires_at: string
  status: "reserved"
  authority_id: "research-control-plane"
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  portfolio_plan_hash: string
  settlement_asset: string
  shared_initial_cash: number
  capital_policy_version: "rd-runtime-shared-wallet-exact-funding-v1"
  funding_policy_version: "exact-event-time-t-minus-position-v1"
  same_time_cash_policy: "funding_before_exit_before_entry_then_control_plane_priority"
  lanes: Array<{
    lane_id: string
    priority_rank: number
    trial_id: string
    run_id: string
    trial_reservation_ref: string
    trial_reservation_hash: string
  }>
  limitations: [
    "market_next_open_entry_full_exit_and_exact_funding_only",
    "isolated_margin_no_cross_margin",
    "no_liquidation_partial_position_or_borrow",
  ]
}

export type ReplayRuntimeSharedWalletFundingReservationBody = Omit<
  ReplayRuntimeSharedWalletFundingReservationSnapshot,
  "reservation_hash"
>

export interface ReplayRuntimeSharedWalletRiskReservationSnapshot {
  schema_version: typeof REPLAY_RUNTIME_SHARED_WALLET_RISK_RESERVATION_SCHEMA_VERSION
  reservation_id: string
  reservation_ref: string
  reservation_hash: string
  issued_at: string
  expires_at: string
  status: "reserved"
  authority_id: "research-control-plane"
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  portfolio_plan_hash: string
  settlement_asset: string
  shared_initial_cash: number
  capital_policy_version: "rd-runtime-shared-wallet-exact-risk-v1"
  funding_policy_version: "exact-event-time-t-minus-position-v1"
  risk_policy_version: "complete-exact-mark-isolated-maintenance-full-liquidation-v1"
  same_time_cash_policy: "funding_then_exact_risk_then_liquidation_then_exit_then_entry_then_control_plane_priority"
  lanes: Array<{
    lane_id: string
    priority_rank: number
    trial_id: string
    run_id: string
    trial_reservation_ref: string
    trial_reservation_hash: string
  }>
  limitations: [
    "market_next_open_entry_full_exit_exact_funding_and_mark_risk_only",
    "isolated_margin_full_liquidation_no_cross_margin",
    "no_partial_liquidation_borrow_insurance_or_adl",
  ]
}

export type ReplayRuntimeSharedWalletRiskReservationBody = Omit<
  ReplayRuntimeSharedWalletRiskReservationSnapshot,
  "reservation_hash"
>

export interface ReplayPortfolioAllocationReservationSnapshot {
  schema_version: typeof REPLAY_PORTFOLIO_ALLOCATION_RESERVATION_SCHEMA_VERSION
  reservation_id: string
  reservation_ref: string
  reservation_hash: string
  issued_at: string
  expires_at: string
  status: "reserved"
  authority_id: "research-control-plane"
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  portfolio_plan_hash: string
  settlement_asset: string
  shared_initial_cash: number
  allocation_policy_version: "simultaneous-entry-greedy-priority-no-resize-v1"
  exposure_policy_version: "entry-execution-notional-gross-and-absolute-net-v1"
  risk_budget_policy_version: "entry-to-frozen-stop-adverse-execution-plus-round-trip-fees-v1"
  rejection_precedence: "lane_risk_then_cash_then_gross_then_absolute_net_then_portfolio_risk"
  max_gross_exposure_amount: number
  max_abs_net_exposure_amount: number
  max_portfolio_risk_amount: number
  lanes: Array<{
    lane_id: string
    priority_rank: number
    trial_id: string
    run_id: string
    trial_reservation_ref: string
    trial_reservation_hash: string
    max_lane_risk_amount: number
  }>
  limitations: [
    "market_next_open_full_fill_or_reject_no_resize_entry_slice_only",
    "entry_notional_exposure_and_frozen_stop_loss_budget_not_dynamic_var",
    "no_exit_funding_liquidation_cross_margin_partial_fill_or_borrow",
  ]
}

export type ReplayPortfolioAllocationReservationBody = Omit<
  ReplayPortfolioAllocationReservationSnapshot,
  "reservation_hash"
>

export interface ReplayPortfolioReallocationReservationSnapshot {
  schema_version: typeof REPLAY_PORTFOLIO_REALLOCATION_RESERVATION_SCHEMA_VERSION
  reservation_id: string
  reservation_ref: string
  reservation_hash: string
  issued_at: string
  expires_at: string
  status: "reserved"
  authority_id: "research-control-plane"
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  portfolio_plan_hash: string
  settlement_asset: string
  portfolio_initial_cash: number
  predecessor_integrated_result_hash: string
  predecessor_artifact_manifest_hash: string
  reallocation_cycle: 2
  earliest_reallocation_time: string
  opening_cash_policy: "predecessor_ending_available_cash_after_full_flat_release"
  eligibility_policy: "all_predecessor_positions_closed_and_exposure_risk_zero"
  allocation_policy_version: "simultaneous-entry-greedy-priority-no-resize-v1"
  max_gross_exposure_amount: number
  max_abs_net_exposure_amount: number
  max_portfolio_risk_amount: number
  lanes: Array<{
    lane_id: string
    priority_rank: number
    trial_id: string
    run_id: string
    trial_reservation_ref: string
    trial_reservation_hash: string
    max_lane_risk_amount: number
  }>
  limitations: [
    "second_cycle_only_after_authoritative_full_flat_release",
    "opening_cash_derived_from_predecessor_result_not_control_plane_estimate",
    "no_third_cycle_partial_cross_margin_borrow_or_fast",
  ]
}

export type ReplayPortfolioReallocationReservationBody = Omit<ReplayPortfolioReallocationReservationSnapshot, "reservation_hash">

export interface ReplayPortfolioCycleSequenceReservationSnapshot {
  schema_version: typeof REPLAY_PORTFOLIO_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION
  reservation_id: string
  reservation_ref: string
  reservation_hash: string
  issued_at: string
  expires_at: string
  status: "reserved"
  authority_id: "research-control-plane"
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  settlement_asset: string
  initial_cash: number
  cycle_count: number
  max_cycle_count: typeof REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES
  opening_cash_policy: "first_cycle_initial_then_predecessor_ending_available"
  successor_eligibility_policy: "predecessor_full_flat_exposure_and_risk_zero"
  expansion_policy: "exact_predeclared_cycles_no_runtime_append_or_search_expansion"
  cycles: Array<{
    cycle_index: number
    allocation_plan_hash: string
    risk_plan_hash: string
    earliest_cycle_time: string
    max_gross_exposure_amount: number
    max_abs_net_exposure_amount: number
    max_portfolio_risk_amount: number
    lanes: Array<{
      lane_id: string
      priority_rank: number
      trial_id: string
      run_id: string
      trial_reservation_ref: string
      trial_reservation_hash: string
      max_lane_risk_amount: number
    }>
  }>
  limitations: [
    "one_to_eight_predeclared_full_flat_cycles_only",
    "cycle_opening_cash_is_runtime_predecessor_evidence_not_control_plane_estimate",
    "no_partial_cross_margin_borrow_real_liquidity_fast_or_runtime_cycle_expansion",
  ]
}

export type ReplayPortfolioCycleSequenceReservationBody = Omit<
  ReplayPortfolioCycleSequenceReservationSnapshot,
  "reservation_hash"
>

export interface ReplayPortfolioTwoFixedPartialReservationSnapshot {
  schema_version: typeof REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_RESERVATION_SCHEMA_VERSION
  reservation_id: string
  reservation_ref: string
  reservation_hash: string
  issued_at: string
  expires_at: string
  status: "reserved"
  authority_id: "research-control-plane"
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  settlement_asset: string
  source_terminal_evidence_hash: string
  source_terminal_artifact_manifest_hash: string
  risk_result_hash: string
  projection_policy_version: "two-predeclared-fixed-partials-terminal-risk-v1"
  lanes: Array<{
    lane_id: string
    priority_rank: number
    trial_id: string
    run_id: string
    trial_reservation_ref: string
    trial_reservation_hash: string
    request_hash: string
    source_terminal_record_hash: string
    isolated_collateral: number
  }>
  limitations: [
    "exactly_two_predeclared_fixed_quantity_partial_reduces_per_opened_lane",
    "projection_only_no_contract_search_review_or_lifecycle_authority",
    "no_dynamic_sizing_third_partial_post_partial_mutation_reentry_cross_margin_borrow_real_liquidity_or_fast",
  ]
}
export type ReplayPortfolioTwoFixedPartialReservationBody = Omit<
  ReplayPortfolioTwoFixedPartialReservationSnapshot,
  "reservation_hash"
>

export interface ReplayPortfolioTwoFixedPartialCycleSequenceReservationSnapshot {
  schema_version: typeof REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION
  reservation_id: string
  reservation_ref: string
  reservation_hash: string
  issued_at: string
  expires_at: string
  status: "reserved"
  authority_id: "research-control-plane"
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  settlement_asset: string
  initial_cash: number
  cycle_count: number
  max_cycle_count: typeof REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES
  opening_cash_policy: "first_cycle_initial_then_predecessor_committed_trial_balance"
  successor_eligibility_policy: "predecessor_committed_full_flat_exposure_collateral_and_risk_zero"
  expansion_policy: "exact_predeclared_child_reservations_no_runtime_append_or_search_expansion"
  cycles: Array<{
    cycle_index: number
    two_fixed_partial_reservation_hash: string
    earliest_cycle_time: string
    lanes: Array<{
      lane_id: string
      priority_rank: number
      trial_id: string
      run_id: string
      trial_reservation_hash: string
      request_hash: string
    }>
  }>
  limitations: [
    "one_to_eight_predeclared_two_fixed_partial_full_flat_cycles_only",
    "cycle_opening_cash_must_equal_predecessor_committed_trial_balance",
    "no_dynamic_sizing_third_partial_post_partial_mutation_reentry_cross_margin_borrow_real_liquidity_fast_or_runtime_cycle_expansion",
  ]
}
export type ReplayPortfolioTwoFixedPartialCycleSequenceReservationBody = Omit<
  ReplayPortfolioTwoFixedPartialCycleSequenceReservationSnapshot,
  "reservation_hash"
>

export interface ReplayPortfolioPostPartialStopReplacementCycleSequenceReservationSnapshot {
  schema_version:
    typeof REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION
  reservation_id: string
  reservation_ref: string
  reservation_hash: string
  issued_at: string
  expires_at: string
  status: "reserved"
  authority_id: "research-control-plane"
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  portfolio_id: string
  settlement_asset: string
  initial_cash: number
  cycle_count: number
  max_cycle_count: typeof REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES
  opening_cash_policy: "first_cycle_initial_then_predecessor_committed_trial_balance"
  successor_eligibility_policy:
    "predecessor_committed_full_flat_collateral_exposure_unrealized_and_current_risk_zero"
  expansion_policy: "exact_predeclared_lane_trials_no_runtime_append_or_search_expansion"
  cycles: Array<{
    cycle_index: number
    earliest_cycle_time: string
    lanes: Array<{
      lane_id: string
      priority_rank: number
      trial_id: string
      run_id: string
      trial_reservation_ref: string
      trial_reservation_hash: string
      request_hash: string
    }>
  }>
  limitations: [
    "one_to_eight_predeclared_post_partial_stop_replacement_full_flat_cycles_only",
    "cycle_opening_cash_must_equal_predecessor_committed_trial_balance",
    "no_open_successor_dynamic_sizing_between_partial_or_repeated_mutation_third_partial_reentry_cross_margin_borrow_real_liquidity_fast_or_runtime_cycle_expansion",
  ]
}
export type ReplayPortfolioPostPartialStopReplacementCycleSequenceReservationBody = Omit<
  ReplayPortfolioPostPartialStopReplacementCycleSequenceReservationSnapshot,
  "reservation_hash"
>

export interface ReplayAttemptLeaseSnapshot {
  schema_version: typeof REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  trial_id: string
  run_id: string
  reservation_ref: string
  reservation_hash: string
  request_hash: string
  status: "claimed" | "running"
  lease_generation: number
  claimed_at: string
  heartbeat_at: string
  lease_expires_at: string
}

export interface ReplaySuccessorVerificationLeaseRenewalRequest {
  schema_version: typeof REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_REQUEST_SCHEMA_VERSION
  request_id: string
  request_ref: string
  request_key: string
  request_hash: string
  request_policy_version:
    typeof REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_REQUEST_POLICY_VERSION
  status: "successor_verification_lease_renewal_requested"
  requester_owner: "replay_runner"
  authority_target: "research_control_plane"
  purpose: "second_reproducibility_member_same_attempt_successor_generation"
  source_successor_authority_contract_hash: string
  source_reproducibility_pair_contract_hash: string
  source_first_schedule_admission_hash: string
  source_first_execution_envelope_hash: string
  logical_request_id: string
  worker_request_hash: string
  replay_execution_request_hash: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  expected_current_lease_generation: number
  expected_current_attempt_lease_hash: string
  minimum_successor_lease_generation: number
  requested_lease_expires_at: string
  source_evidence_role: "opaque_replay_hash_binding_control_plane_does_not_revalidate_replay_lineage"
  request_authority: "none_control_plane_must_atomically_admit_or_reject"
  process_authority: "none"
  harness_authority: "none"
  economic_authority: "none"
}

export type ReplaySuccessorVerificationLeaseRenewalRequestBody = Omit<
  ReplaySuccessorVerificationLeaseRenewalRequest,
  "request_hash"
>

export interface ReplaySuccessorVerificationLeaseRenewalReceipt {
  schema_version: typeof REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_RECEIPT_SCHEMA_VERSION
  receipt_id: string
  receipt_ref: string
  receipt_hash: string
  receipt_policy_version:
    typeof REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_RECEIPT_POLICY_VERSION
  status: "successor_verification_lease_renewed"
  authority_owner: "research_control_plane"
  authority_source: "research_control_plane_state_store"
  registry_table: "rd_replay_successor_verification_lease_renewal"
  registry_row_immutability: "sqlite_update_and_delete_triggers"
  source_request_id: string
  source_request_ref: string
  source_request_hash: string
  source_request: ReplaySuccessorVerificationLeaseRenewalRequest
  source_evidence_validation: "opaque_hash_binding_only_replay_lineage_not_revalidated"
  renewal_transaction:
    "single_control_plane_transaction_exact_predecessor_fencing_update_and_receipt_insert"
  clock_source: "control_plane_authority_process_clock_port"
  clock_independence: "authority_internal_sampling_without_caller_heartbeat_time"
  caller_heartbeat_time_input: "forbidden"
  external_time_attestation: "not_provided"
  renewed_at: string
  predecessor_attempt_lease_hash: string
  predecessor_attempt_lease: ReplayAttemptLeaseSnapshot
  successor_attempt_lease_hash: string
  successor_attempt_lease: ReplayAttemptLeaseSnapshot
  generation_relation: "successor_equals_predecessor_plus_one"
  immutable_attempt_binding:
    "attempt_ordinal_worker_trial_run_reservation_request_and_claimed_at_exactly_equal"
  requested_expiry_relation: "successor_expiry_equals_control_plane_admitted_request_expiry"
  successor_authority: "lease_generation_only_fresh_execution_lineage_still_required"
  process_authority: "none"
  harness_authority: "none"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplaySuccessorVerificationLeaseRenewalReceiptBody = Omit<
  ReplaySuccessorVerificationLeaseRenewalReceipt,
  "receipt_hash"
>

export interface ReplayAttemptLeaseObservationSnapshot {
  schema_version: typeof REPLAY_ATTEMPT_LEASE_OBSERVATION_SCHEMA_VERSION
  observation_id: string
  observation_ref: string
  observation_hash: string
  observation_policy_version: typeof REPLAY_ATTEMPT_LEASE_OBSERVATION_POLICY_VERSION
  status: "active_lease_observed"
  observed_at: string
  authority_owner: "research_control_plane"
  authority_source: "research_control_plane_state_store"
  read_consistency: "single_control_plane_transaction"
  clock_evidence: "caller_supplied_utc_not_external_time_attestation"
  trial_id: string
  run_id: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  attempt_lease_hash: string
  attempt_lease: ReplayAttemptLeaseSnapshot
}

export type ReplayAttemptLeaseObservationBody = Omit<ReplayAttemptLeaseObservationSnapshot, "observation_hash">

export interface ReplayAttemptLeaseObservationRegistryReadReceipt {
  schema_version: typeof REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_SCHEMA_VERSION
  receipt_id: string
  receipt_ref: string
  receipt_hash: string
  receipt_policy_version: typeof REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_POLICY_VERSION
  status: "registered_active_lease_observation_read"
  authority_owner: "research_control_plane"
  authority_source: "research_control_plane_state_store"
  registry_table: "rd_replay_attempt_lease_observation"
  registry_key: string
  registry_row_immutability: "sqlite_update_and_delete_triggers"
  read_consistency: "single_control_plane_transaction"
  registry_read_provenance: "registered_row_and_current_attempt_exact_match"
  registered_at: string
  read_at: string
  clock_evidence: "caller_supplied_utc_not_external_time_attestation"
  external_time_attestation: "not_provided"
  source_observation_id: string
  source_observation_ref: string
  source_observation_hash: string
  source_observation: ReplayAttemptLeaseObservationSnapshot
  current_attempt_status: "claimed" | "running"
  current_attempt_lease_hash: string
  current_attempt_lease: ReplayAttemptLeaseSnapshot
}

export type ReplayAttemptLeaseObservationRegistryReadReceiptBody = Omit<
  ReplayAttemptLeaseObservationRegistryReadReceipt,
  "receipt_hash"
>

export interface ReplayDispatchClockAttestation {
  schema_version: typeof REPLAY_DISPATCH_CLOCK_ATTESTATION_SCHEMA_VERSION
  attestation_id: string
  attestation_ref: string
  attestation_hash: string
  attestation_policy_version: typeof REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION
  status: "authority_clock_bracketed_registry_read"
  authority_owner: "research_control_plane"
  authority_source: "research_control_plane_state_store"
  clock_source: "control_plane_authority_process_clock_port"
  clock_independence: "authority_internal_sampling_without_caller_timestamp_input"
  caller_time_input: "forbidden"
  wall_clock_source: "javascript_date_now_utc"
  monotonic_clock_source: "process_hrtime_bigint"
  external_time_attestation: "not_provided"
  registry_read_bracketing: "wall_and_monotonic_samples_before_and_after_single_transaction_read"
  registry_read_started_at: string
  registry_read_completed_at: string
  registry_read_started_monotonic_ns: string
  registry_read_completed_monotonic_ns: string
  source_registry_read_receipt_id: string
  source_registry_read_receipt_ref: string
  source_registry_read_receipt_hash: string
  source_registry_read_receipt: ReplayAttemptLeaseObservationRegistryReadReceipt
  attempt_id: string
  worker_id: string
  lease_generation: number
  current_attempt_lease_hash: string
}

export type ReplayDispatchClockAttestationBody = Omit<ReplayDispatchClockAttestation, "attestation_hash">

export function replayDispatchClockAttestationIdentityHash(input: {
  source_registry_read_receipt_hash: string
  registry_read_started_at: string
  registry_read_completed_at: string
  registry_read_started_monotonic_ns: string
  registry_read_completed_monotonic_ns: string
  attestation_policy_version: typeof REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION
}): string {
  return createHash("sha256").update(canonicalReservationJson(input), "utf8").digest("hex")
}

export interface ReplaySpawnBoundaryRevalidationRequest {
  schema_version: typeof REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_SCHEMA_VERSION
  request_id: string
  request_ref: string
  request_key: string
  request_hash: string
  request_policy_version: typeof REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_POLICY_VERSION
  status: "capsule_bound_current_attempt_revalidation_requested"
  requester_owner: "replay_runner"
  authority_target: "research_control_plane"
  purpose: "revalidate_exact_current_attempt_after_capsule_commit_before_spawn"
  source_authority_capsule_record_hash: string
  authority_capsule_hash: string
  source_authority_process_launch_intent_hash: string
  source_authority_execution_admission_command_hash: string
  source_authority_transport_contract_hash: string
  process_artifact_hash: string
  worker_request_hash: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  expected_current_attempt_lease_hash: string
  expected_valid_before: string
  challenge_policy: "one_capsule_bound_challenge_no_caller_time_or_state_substitution"
  retry_policy: "fresh_command_intent_capsule_authority_lineage_required_after_failed_or_stale_challenge"
  process_authority: "none"
}

export type ReplaySpawnBoundaryRevalidationRequestBody = Omit<
  ReplaySpawnBoundaryRevalidationRequest,
  "request_hash"
>

export interface ReplaySpawnBoundaryRevalidationReceipt {
  schema_version: typeof REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_SCHEMA_VERSION
  receipt_id: string
  receipt_ref: string
  receipt_hash: string
  receipt_policy_version: typeof REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_POLICY_VERSION
  status: "capsule_bound_current_attempt_revalidated"
  authority_owner: "research_control_plane"
  authority_source: "research_control_plane_state_store"
  source_request_id: string
  source_request_ref: string
  source_request_hash: string
  source_request: ReplaySpawnBoundaryRevalidationRequest
  clock_source: "control_plane_authority_process_clock_port"
  clock_independence: "authority_internal_sampling_without_caller_timestamp_input"
  caller_time_input: "forbidden"
  wall_clock_source: "javascript_date_now_utc"
  monotonic_clock_source: "process_hrtime_bigint"
  external_time_attestation: "not_provided"
  current_attempt_read:
    "single_control_plane_transaction_exact_attempt_worker_generation_and_lease_hash"
  registry_read_started_at: string
  registry_read_completed_at: string
  registry_read_started_monotonic_ns: string
  registry_read_completed_monotonic_ns: string
  current_attempt_status: "claimed" | "running"
  current_attempt_lease_hash: string
  current_attempt_lease: ReplayAttemptLeaseSnapshot
  revalidated_at: string
  valid_before: string
  spawn_candidate_authority: "single_immediate_spawn_candidate_not_process_start_evidence"
  race_limit: "receipt_cannot_prove_absence_of_cancellation_or_fencing_after_completed_read"
  process_authority: "none"
}

export type ReplaySpawnBoundaryRevalidationReceiptBody = Omit<
  ReplaySpawnBoundaryRevalidationReceipt,
  "receipt_hash"
>

export function replaySpawnBoundaryRevalidationRequestKey(input: {
  source_authority_capsule_record_hash: string
  attempt_id: string
  worker_id: string
  lease_generation: number
  request_policy_version: typeof REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_POLICY_VERSION
}): string {
  for (const [field, item] of Object.entries({
    source_authority_capsule_record_hash: input.source_authority_capsule_record_hash,
  })) requireHash(item, `spawn_boundary_revalidation_request_key.${field}`)
  requireText(input.attempt_id, "spawn_boundary_revalidation_request_key.attempt_id")
  requireText(input.worker_id, "spawn_boundary_revalidation_request_key.worker_id")
  if (!Number.isSafeInteger(input.lease_generation) || input.lease_generation < 1
      || input.request_policy_version !== REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_POLICY_VERSION) {
    fail("spawn boundary revalidation request key")
  }
  return createHash("sha256").update(canonicalReservationJson(input), "utf8").digest("hex")
}

export function replaySpawnBoundaryRevalidationReceiptIdentityHash(input: {
  source_request_hash: string
  registry_read_started_at: string
  registry_read_completed_at: string
  registry_read_started_monotonic_ns: string
  registry_read_completed_monotonic_ns: string
  receipt_policy_version: typeof REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_POLICY_VERSION
}): string {
  requireHash(input.source_request_hash, "spawn_boundary_revalidation_receipt_identity.request_hash")
  return createHash("sha256").update(canonicalReservationJson(input), "utf8").digest("hex")
}

export interface ReplayResumeAuthorizationSnapshot {
  schema_version: typeof REPLAY_RESUME_AUTHORIZATION_SCHEMA_VERSION
  authorization_id: string
  authorization_ref: string
  authorization_hash: string
  issued_at: string
  status: "authorized"
  trial_id: string
  run_id: string
  request_hash: string
  reservation_ref: string
  reservation_hash: string
  source_attempt_id: string
  source_attempt_ordinal: number
  source_attempt_status: "cancelled" | "expired"
  diagnostic_checkpoint_ref: string
  diagnostic_checkpoint_hash: string
  target_attempt_id: string
  target_attempt_ordinal: number
  target_worker_id: string
  target_claimed_at: string
  target_lease_generation_floor: number
  target_attempt_lease_hash: string
}

export interface ReplayCheckpointReceiptSnapshot {
  schema_version: typeof REPLAY_CHECKPOINT_RECEIPT_SCHEMA_VERSION
  receipt_id: string
  receipt_ref: string
  receipt_hash: string
  recorded_at: string
  status: "recorded"
  trial_id: string
  run_id: string
  request_hash: string
  reservation_ref: string
  reservation_hash: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  attempt_lease_hash: string
  diagnostic_checkpoint_ref: string
  diagnostic_checkpoint_hash: string
  engine_checkpoint_ref: string
  engine_checkpoint_payload_hash: string
  engine_checkpoint_hash: string
  storage_policy_version: typeof REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION
  next_source_offset: number
}

export type ReplayCheckpointReceiptBody = Omit<ReplayCheckpointReceiptSnapshot, "receipt_hash">
export type ReplayResumeAuthorizationBody = Omit<ReplayResumeAuthorizationSnapshot, "authorization_hash">

export interface DraftStrategyAuthorization {
  schema_version: typeof DRAFT_AUTHORIZATION_SCHEMA_VERSION
  decision: "accept_for_draft"
  decision_id: string
  reviewer_run_id: string
  primary_result_id: string
  primary_result_hash: string
  selected_trial_id: string
  selected_candidate_id: string
  candidate_frozen_at: string
  identity: ResearchIdentityBinding
}

export interface StrategyDraftBinding {
  schema_version: typeof STRATEGY_DRAFT_BINDING_SCHEMA_VERSION
  draft_id: string
  strategy_id: string
  strategy_version: string
  strategy_ref: string
  strategy_policy_hash: string
  materialization_status: "ready"
  created_at: string
  authorization: DraftStrategyAuthorization
}

export function assertResearchIdentityBinding(value: ResearchIdentityBinding): void {
  assertIdentityFields(value)
}

export function assertTrialReservationSnapshot(value: TrialReservationSnapshot): void {
  if (value.schema_version !== TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION) fail("reservation schema_version")
  requireText(value.reservation_id, "reservation.reservation_id")
  requireText(value.reservation_ref, "reservation.reservation_ref")
  requireUtcTimestamp(value.issued_at, "reservation.issued_at")
  requireUtcTimestamp(value.expires_at, "reservation.expires_at")
  if (Date.parse(value.expires_at) <= Date.parse(value.issued_at)) {
    fail("reservation timestamps must satisfy issued_at < expires_at")
  }
  if (value.status !== "reserved") fail("reservation status must be reserved")
  assertIdentityFields(value.identity)
  if (!Number.isSafeInteger(value.trial_ordinal) || value.trial_ordinal < 1) fail("reservation.trial_ordinal must be positive")
  requireText(value.run_id, "reservation.run_id")
  if (typeof value.counts_against_budget !== "boolean") fail("reservation.counts_against_budget must be boolean")
  requireText(value.trial_accounting_policy_version, "reservation.trial_accounting_policy_version")
  requireHash(value.candidate_assignment_hash, "reservation.candidate_assignment_hash")
  const bindings = value.bindings
  for (const [field, binding] of Object.entries({
    replay_idempotency_key: bindings.replay_idempotency_key,
    dataset_manifest_ref: bindings.dataset_manifest_ref,
    simulator_policy_version: bindings.simulator_policy_version,
  })) requireText(binding, `reservation.bindings.${field}`)
  for (const [field, binding] of Object.entries({
    execution_spec_hash: bindings.execution_spec_hash,
    dataset_hash: bindings.dataset_hash,
    supplemental_facts_hash: bindings.supplemental_facts_hash,
    supplemental_requirement_set_hash: bindings.supplemental_requirement_set_hash,
    venue_risk_policy_schedule_hash: bindings.venue_risk_policy_schedule_hash,
    instrument_spec_schedule_hash: bindings.instrument_spec_schedule_hash,
    instrument_status_schedule_hash: bindings.instrument_status_schedule_hash,
    instrument_status_provenance_hash: bindings.instrument_status_provenance_hash,
    instrument_status_provider_capability_hash: bindings.instrument_status_provider_capability_hash,
    instrument_status_provider_certification_hash: bindings.instrument_status_provider_certification_hash,
    harness_hash: bindings.harness_hash,
    assumptions_hash: bindings.assumptions_hash,
    cost_policy_hash: bindings.cost_policy_hash,
    margin_policy_hash: bindings.margin_policy_hash,
  })) requireHash(binding, `reservation.bindings.${field}`)
  if (bindings.liquidity_capacity_attestation_hash !== null) {
    requireHash(bindings.liquidity_capacity_attestation_hash, "reservation.bindings.liquidity_capacity_attestation_hash")
  }
  assertReplayInstrumentStatusProviderCertificationSnapshot(value.instrument_status_provider_certification)
  if (bindings.instrument_status_provider_capability_hash !== value.instrument_status_provider_certification.provider_capability_hash) {
    fail("reservation provider capability does not match its certification")
  }
  if (bindings.instrument_status_provider_certification_hash !== value.instrument_status_provider_certification.certification_hash) {
    fail("reservation provider certification hash does not match its snapshot")
  }
  if (Date.parse(value.issued_at) < Date.parse(value.instrument_status_provider_certification.certified_at)
      || Date.parse(value.issued_at) >= Date.parse(value.instrument_status_provider_certification.valid_until)) {
    fail("reservation must be issued while provider certification is valid")
  }
  if (bindings.execution_mode !== "step") fail("reservation only supports step execution")
  if (!Array.isArray(value.required_capabilities) || value.required_capabilities.length === 0) {
    fail("reservation.required_capabilities must not be empty")
  }
  const capabilities = value.required_capabilities.map((capability, index) => requireText(capability, `reservation.required_capabilities[${index}]`))
  const normalized = [...new Set(capabilities)].sort()
  if (normalized.length !== capabilities.length || normalized.some((capability, index) => capability !== capabilities[index])) {
    fail("reservation.required_capabilities must be unique and sorted")
  }
}

export function createReplaySharedInitialCapitalReservationSnapshot(
  body: ReplaySharedInitialCapitalReservationBody,
): ReplaySharedInitialCapitalReservationSnapshot {
  const value = {
    ...body,
    reservation_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplaySharedInitialCapitalReservationSnapshot(value)
  return value
}

export function assertReplaySharedInitialCapitalReservationSnapshot(
  value: ReplaySharedInitialCapitalReservationSnapshot,
): void {
  requireExactObjectFields(value, [
    "schema_version", "reservation_id", "reservation_ref", "reservation_hash", "issued_at", "expires_at",
    "status", "authority_id", "experiment_id", "trial_group_id", "trial_group_hash", "batch_id",
    "batch_plan_hash", "settlement_asset", "capital_policy_version", "execution_priority_policy",
    "shared_initial_cash", "total_allocated_initial_cash", "lanes", "limitations",
  ], "shared_initial_capital_reservation")
  if (value.schema_version !== REPLAY_SHARED_INITIAL_CAPITAL_RESERVATION_SCHEMA_VERSION) {
    fail("shared initial capital reservation schema_version")
  }
  for (const [field, item] of Object.entries({
    reservation_id: value.reservation_id,
    reservation_ref: value.reservation_ref,
    experiment_id: value.experiment_id,
    trial_group_id: value.trial_group_id,
    batch_id: value.batch_id,
    settlement_asset: value.settlement_asset,
  })) requireText(item, `shared_initial_capital_reservation.${field}`)
  for (const [field, item] of Object.entries({
    reservation_hash: value.reservation_hash,
    trial_group_hash: value.trial_group_hash,
    batch_plan_hash: value.batch_plan_hash,
  })) requireHash(item, `shared_initial_capital_reservation.${field}`)
  requireUtcTimestamp(value.issued_at, "shared_initial_capital_reservation.issued_at")
  requireUtcTimestamp(value.expires_at, "shared_initial_capital_reservation.expires_at")
  if (Date.parse(value.expires_at) <= Date.parse(value.issued_at)) {
    fail("shared initial capital reservation timestamps must satisfy issued_at < expires_at")
  }
  if (value.status !== "reserved" || value.authority_id !== "research-control-plane"
      || value.capital_policy_version !== "rd-shared-initial-capital-static-preallocation-v1"
      || value.execution_priority_policy !== "control_plane_explicit_rank_no_ties") {
    fail("shared initial capital reservation policy is unsupported")
  }
  requirePositiveFinite(value.shared_initial_cash, "shared_initial_capital_reservation.shared_initial_cash")
  requirePositiveFinite(
    value.total_allocated_initial_cash,
    "shared_initial_capital_reservation.total_allocated_initial_cash",
  )
  if (!Array.isArray(value.lanes) || value.lanes.length < 2) {
    fail("shared initial capital reservation requires at least two lanes")
  }
  const laneIds = new Set<string>()
  const trialIds = new Set<string>()
  const runIds = new Set<string>()
  const reservationHashes = new Set<string>()
  for (let index = 0; index < value.lanes.length; index += 1) {
    const lane = value.lanes[index]!
    requireExactObjectFields(lane, [
      "lane_id", "priority_rank", "trial_id", "run_id", "trial_reservation_ref",
      "trial_reservation_hash", "allocated_initial_cash",
    ], "shared_initial_capital_reservation.lane")
    requireText(lane.lane_id, "shared_initial_capital_reservation.lane_id")
    requireText(lane.trial_id, "shared_initial_capital_reservation.trial_id")
    requireText(lane.run_id, "shared_initial_capital_reservation.run_id")
    requireText(lane.trial_reservation_ref, "shared_initial_capital_reservation.trial_reservation_ref")
    requireHash(lane.trial_reservation_hash, "shared_initial_capital_reservation.trial_reservation_hash")
    requirePositiveFinite(lane.allocated_initial_cash, "shared_initial_capital_reservation.allocated_initial_cash")
    if (lane.priority_rank !== index + 1 || laneIds.has(lane.lane_id) || trialIds.has(lane.trial_id)
        || runIds.has(lane.run_id) || reservationHashes.has(lane.trial_reservation_hash)) {
      fail("shared initial capital reservation lanes require consecutive explicit priority and unique authority")
    }
    laneIds.add(lane.lane_id)
    trialIds.add(lane.trial_id)
    runIds.add(lane.run_id)
    reservationHashes.add(lane.trial_reservation_hash)
  }
  const allocated = exactFiniteNumberSum(value.lanes.map((lane) => lane.allocated_initial_cash))
  if (!exactFiniteNumberEquals(allocated, value.total_allocated_initial_cash)
      || !exactFiniteNumberEquals(allocated, value.shared_initial_cash)) {
    fail("shared initial capital reservation must fully allocate one cash pool exactly once")
  }
  const expectedLimitations: ReplaySharedInitialCapitalReservationSnapshot["limitations"] = [
    "no_runtime_cash_reuse_or_rebalancing",
    "no_cross_lane_margin_or_liquidation",
    "no_concurrent_matching_claim",
  ]
  if (canonicalReservationJson(value.limitations) !== canonicalReservationJson(expectedLimitations)) {
    fail("shared initial capital reservation limitations were weakened")
  }
  const { reservation_hash: reservationHash, ...body } = value
  const expectedHash = createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")
  if (reservationHash !== expectedHash) fail("shared initial capital reservation hash mismatch")
}

export function createReplayRuntimeSharedWalletReservationSnapshot(
  body: ReplayRuntimeSharedWalletReservationBody,
): ReplayRuntimeSharedWalletReservationSnapshot {
  const value = {
    ...body,
    reservation_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplayRuntimeSharedWalletReservationSnapshot(value)
  return value
}

export function assertReplayRuntimeSharedWalletReservationSnapshot(
  value: ReplayRuntimeSharedWalletReservationSnapshot,
): void {
  requireExactObjectFields(value, [
    "schema_version", "reservation_id", "reservation_ref", "reservation_hash", "issued_at", "expires_at",
    "status", "authority_id", "experiment_id", "trial_group_id", "trial_group_hash", "portfolio_id",
    "portfolio_plan_hash", "settlement_asset", "shared_initial_cash", "capital_policy_version",
    "simultaneous_order_policy", "lanes", "limitations",
  ], "runtime_shared_wallet_reservation")
  if (value.schema_version !== REPLAY_RUNTIME_SHARED_WALLET_RESERVATION_SCHEMA_VERSION) {
    fail("runtime shared wallet reservation schema_version")
  }
  for (const [field, item] of Object.entries({
    reservation_id: value.reservation_id,
    reservation_ref: value.reservation_ref,
    experiment_id: value.experiment_id,
    trial_group_id: value.trial_group_id,
    portfolio_id: value.portfolio_id,
    settlement_asset: value.settlement_asset,
  })) requireText(item, `runtime_shared_wallet_reservation.${field}`)
  for (const [field, item] of Object.entries({
    reservation_hash: value.reservation_hash,
    trial_group_hash: value.trial_group_hash,
    portfolio_plan_hash: value.portfolio_plan_hash,
  })) requireHash(item, `runtime_shared_wallet_reservation.${field}`)
  requireUtcTimestamp(value.issued_at, "runtime_shared_wallet_reservation.issued_at")
  requireUtcTimestamp(value.expires_at, "runtime_shared_wallet_reservation.expires_at")
  if (Date.parse(value.expires_at) <= Date.parse(value.issued_at)) {
    fail("runtime shared wallet reservation timestamps must satisfy issued_at < expires_at")
  }
  if (value.status !== "reserved" || value.authority_id !== "research-control-plane"
      || value.capital_policy_version !== "rd-runtime-shared-wallet-isolated-entry-v1"
      || value.simultaneous_order_policy !== "event_time_then_control_plane_priority") {
    fail("runtime shared wallet reservation policy is unsupported")
  }
  requirePositiveFinite(value.shared_initial_cash, "runtime_shared_wallet_reservation.shared_initial_cash")
  if (!Array.isArray(value.lanes) || value.lanes.length < 2) {
    fail("runtime shared wallet reservation requires at least two lanes")
  }
  const laneIds = new Set<string>()
  const trialIds = new Set<string>()
  const runIds = new Set<string>()
  const reservationHashes = new Set<string>()
  for (let index = 0; index < value.lanes.length; index += 1) {
    const lane = value.lanes[index]!
    requireExactObjectFields(lane, [
      "lane_id", "priority_rank", "trial_id", "run_id", "trial_reservation_ref", "trial_reservation_hash",
    ], "runtime_shared_wallet_reservation.lane")
    requireText(lane.lane_id, "runtime_shared_wallet_reservation.lane_id")
    requireText(lane.trial_id, "runtime_shared_wallet_reservation.trial_id")
    requireText(lane.run_id, "runtime_shared_wallet_reservation.run_id")
    requireText(lane.trial_reservation_ref, "runtime_shared_wallet_reservation.trial_reservation_ref")
    requireHash(lane.trial_reservation_hash, "runtime_shared_wallet_reservation.trial_reservation_hash")
    if (lane.priority_rank !== index + 1 || laneIds.has(lane.lane_id) || trialIds.has(lane.trial_id)
        || runIds.has(lane.run_id) || reservationHashes.has(lane.trial_reservation_hash)) {
      fail("runtime shared wallet reservation lanes require consecutive explicit priority and unique authority")
    }
    laneIds.add(lane.lane_id)
    trialIds.add(lane.trial_id)
    runIds.add(lane.run_id)
    reservationHashes.add(lane.trial_reservation_hash)
  }
  const expectedLimitations: ReplayRuntimeSharedWalletReservationSnapshot["limitations"] = [
    "market_next_open_entry_only",
    "isolated_margin_no_cross_margin",
    "no_exit_funding_liquidation_or_cash_release",
  ]
  if (canonicalReservationJson(value.limitations) !== canonicalReservationJson(expectedLimitations)) {
    fail("runtime shared wallet reservation limitations were weakened")
  }
  const { reservation_hash: reservationHash, ...body } = value
  const expectedHash = createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")
  if (reservationHash !== expectedHash) fail("runtime shared wallet reservation hash mismatch")
}

export function createReplayRuntimeSharedWalletLifecycleReservationSnapshot(
  body: ReplayRuntimeSharedWalletLifecycleReservationBody,
): ReplayRuntimeSharedWalletLifecycleReservationSnapshot {
  const value = {
    ...body,
    reservation_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplayRuntimeSharedWalletLifecycleReservationSnapshot(value)
  return value
}

export function assertReplayRuntimeSharedWalletLifecycleReservationSnapshot(
  value: ReplayRuntimeSharedWalletLifecycleReservationSnapshot,
): void {
  requireExactObjectFields(value, [
    "schema_version", "reservation_id", "reservation_ref", "reservation_hash", "issued_at", "expires_at",
    "status", "authority_id", "experiment_id", "trial_group_id", "trial_group_hash", "portfolio_id",
    "portfolio_plan_hash", "settlement_asset", "shared_initial_cash", "capital_policy_version",
    "same_time_cash_policy", "lanes", "limitations",
  ], "runtime_shared_wallet_lifecycle_reservation")
  if (value.schema_version !== REPLAY_RUNTIME_SHARED_WALLET_LIFECYCLE_RESERVATION_SCHEMA_VERSION) {
    fail("runtime shared wallet lifecycle reservation schema_version")
  }
  for (const [field, item] of Object.entries({
    reservation_id: value.reservation_id, reservation_ref: value.reservation_ref,
    experiment_id: value.experiment_id, trial_group_id: value.trial_group_id,
    portfolio_id: value.portfolio_id, settlement_asset: value.settlement_asset,
  })) requireText(item, `runtime_shared_wallet_lifecycle_reservation.${field}`)
  for (const [field, item] of Object.entries({
    reservation_hash: value.reservation_hash, trial_group_hash: value.trial_group_hash,
    portfolio_plan_hash: value.portfolio_plan_hash,
  })) requireHash(item, `runtime_shared_wallet_lifecycle_reservation.${field}`)
  requireUtcTimestamp(value.issued_at, "runtime_shared_wallet_lifecycle_reservation.issued_at")
  requireUtcTimestamp(value.expires_at, "runtime_shared_wallet_lifecycle_reservation.expires_at")
  if (Date.parse(value.expires_at) <= Date.parse(value.issued_at)) {
    fail("runtime shared wallet lifecycle reservation timestamps must satisfy issued_at < expires_at")
  }
  if (value.status !== "reserved" || value.authority_id !== "research-control-plane"
      || value.capital_policy_version !== "rd-runtime-shared-wallet-entry-exit-release-v1"
      || value.same_time_cash_policy !== "exit_release_before_entry_admission_then_control_plane_priority") {
    fail("runtime shared wallet lifecycle reservation policy is unsupported")
  }
  requirePositiveFinite(value.shared_initial_cash, "runtime_shared_wallet_lifecycle_reservation.shared_initial_cash")
  if (!Array.isArray(value.lanes) || value.lanes.length < 2) {
    fail("runtime shared wallet lifecycle reservation requires at least two lanes")
  }
  const identities = new Set<string>()
  for (let index = 0; index < value.lanes.length; index += 1) {
    const lane = value.lanes[index]!
    requireExactObjectFields(lane, [
      "lane_id", "priority_rank", "trial_id", "run_id", "trial_reservation_ref", "trial_reservation_hash",
    ], "runtime_shared_wallet_lifecycle_reservation.lane")
    for (const [field, item] of Object.entries({
      lane_id: lane.lane_id, trial_id: lane.trial_id, run_id: lane.run_id,
      trial_reservation_ref: lane.trial_reservation_ref,
    })) requireText(item, `runtime_shared_wallet_lifecycle_reservation.${field}`)
    requireHash(lane.trial_reservation_hash, "runtime_shared_wallet_lifecycle_reservation.trial_reservation_hash")
    const identity = canonicalReservationJson([
      lane.lane_id, lane.trial_id, lane.run_id, lane.trial_reservation_hash,
    ])
    if (lane.priority_rank !== index + 1 || identities.has(identity)) {
      fail("runtime shared wallet lifecycle reservation lanes require consecutive priority and unique authority")
    }
    identities.add(identity)
  }
  if (new Set(value.lanes.map((lane) => lane.lane_id)).size !== value.lanes.length
      || new Set(value.lanes.map((lane) => lane.trial_id)).size !== value.lanes.length
      || new Set(value.lanes.map((lane) => lane.run_id)).size !== value.lanes.length
      || new Set(value.lanes.map((lane) => lane.trial_reservation_hash)).size !== value.lanes.length) {
    fail("runtime shared wallet lifecycle reservation authority identities must each be unique")
  }
  const expectedLimitations: ReplayRuntimeSharedWalletLifecycleReservationSnapshot["limitations"] = [
    "market_next_open_entry_and_full_exit_only",
    "isolated_margin_no_cross_margin",
    "no_funding_liquidation_or_partial_position",
  ]
  if (canonicalReservationJson(value.limitations) !== canonicalReservationJson(expectedLimitations)) {
    fail("runtime shared wallet lifecycle reservation limitations were weakened")
  }
  const { reservation_hash: reservationHash, ...body } = value
  if (reservationHash !== createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")) {
    fail("runtime shared wallet lifecycle reservation hash mismatch")
  }
}

export function createReplayRuntimeSharedWalletFundingReservationSnapshot(
  body: ReplayRuntimeSharedWalletFundingReservationBody,
): ReplayRuntimeSharedWalletFundingReservationSnapshot {
  const value = {
    ...body,
    reservation_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplayRuntimeSharedWalletFundingReservationSnapshot(value)
  return value
}

export function assertReplayRuntimeSharedWalletFundingReservationSnapshot(
  value: ReplayRuntimeSharedWalletFundingReservationSnapshot,
): void {
  requireExactObjectFields(value, [
    "schema_version", "reservation_id", "reservation_ref", "reservation_hash", "issued_at", "expires_at",
    "status", "authority_id", "experiment_id", "trial_group_id", "trial_group_hash", "portfolio_id",
    "portfolio_plan_hash", "settlement_asset", "shared_initial_cash", "capital_policy_version",
    "funding_policy_version", "same_time_cash_policy", "lanes", "limitations",
  ], "runtime_shared_wallet_funding_reservation")
  if (value.schema_version !== REPLAY_RUNTIME_SHARED_WALLET_FUNDING_RESERVATION_SCHEMA_VERSION) {
    fail("runtime shared wallet funding reservation schema_version")
  }
  for (const [field, item] of Object.entries({
    reservation_id: value.reservation_id, reservation_ref: value.reservation_ref,
    experiment_id: value.experiment_id, trial_group_id: value.trial_group_id,
    portfolio_id: value.portfolio_id, settlement_asset: value.settlement_asset,
  })) requireText(item, `runtime_shared_wallet_funding_reservation.${field}`)
  for (const [field, item] of Object.entries({
    reservation_hash: value.reservation_hash, trial_group_hash: value.trial_group_hash,
    portfolio_plan_hash: value.portfolio_plan_hash,
  })) requireHash(item, `runtime_shared_wallet_funding_reservation.${field}`)
  requireUtcTimestamp(value.issued_at, "runtime_shared_wallet_funding_reservation.issued_at")
  requireUtcTimestamp(value.expires_at, "runtime_shared_wallet_funding_reservation.expires_at")
  if (Date.parse(value.expires_at) <= Date.parse(value.issued_at)) {
    fail("runtime shared wallet funding reservation timestamps must satisfy issued_at < expires_at")
  }
  if (value.status !== "reserved" || value.authority_id !== "research-control-plane"
      || value.capital_policy_version !== "rd-runtime-shared-wallet-exact-funding-v1"
      || value.funding_policy_version !== "exact-event-time-t-minus-position-v1"
      || value.same_time_cash_policy !== "funding_before_exit_before_entry_then_control_plane_priority") {
    fail("runtime shared wallet funding reservation policy is unsupported")
  }
  requirePositiveFinite(value.shared_initial_cash, "runtime_shared_wallet_funding_reservation.shared_initial_cash")
  if (!Array.isArray(value.lanes) || value.lanes.length < 2) {
    fail("runtime shared wallet funding reservation requires at least two lanes")
  }
  const laneIds = new Set<string>()
  const trialIds = new Set<string>()
  const runIds = new Set<string>()
  const reservationHashes = new Set<string>()
  for (let index = 0; index < value.lanes.length; index += 1) {
    const lane = value.lanes[index]!
    requireExactObjectFields(lane, [
      "lane_id", "priority_rank", "trial_id", "run_id", "trial_reservation_ref", "trial_reservation_hash",
    ], "runtime_shared_wallet_funding_reservation.lane")
    requireText(lane.lane_id, "runtime_shared_wallet_funding_reservation.lane_id")
    requireText(lane.trial_id, "runtime_shared_wallet_funding_reservation.trial_id")
    requireText(lane.run_id, "runtime_shared_wallet_funding_reservation.run_id")
    requireText(lane.trial_reservation_ref, "runtime_shared_wallet_funding_reservation.trial_reservation_ref")
    requireHash(lane.trial_reservation_hash, "runtime_shared_wallet_funding_reservation.trial_reservation_hash")
    if (lane.priority_rank !== index + 1 || laneIds.has(lane.lane_id) || trialIds.has(lane.trial_id)
        || runIds.has(lane.run_id) || reservationHashes.has(lane.trial_reservation_hash)) {
      fail("runtime shared wallet funding reservation lanes require consecutive priority and unique authority")
    }
    laneIds.add(lane.lane_id)
    trialIds.add(lane.trial_id)
    runIds.add(lane.run_id)
    reservationHashes.add(lane.trial_reservation_hash)
  }
  const limitations: ReplayRuntimeSharedWalletFundingReservationSnapshot["limitations"] = [
    "market_next_open_entry_full_exit_and_exact_funding_only",
    "isolated_margin_no_cross_margin",
    "no_liquidation_partial_position_or_borrow",
  ]
  if (canonicalReservationJson(value.limitations) !== canonicalReservationJson(limitations)) {
    fail("runtime shared wallet funding reservation limitations were weakened")
  }
  const { reservation_hash: reservationHash, ...body } = value
  if (reservationHash !== createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")) {
    fail("runtime shared wallet funding reservation hash mismatch")
  }
}

export function createReplayRuntimeSharedWalletRiskReservationSnapshot(
  body: ReplayRuntimeSharedWalletRiskReservationBody,
): ReplayRuntimeSharedWalletRiskReservationSnapshot {
  const value = {
    ...body,
    reservation_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplayRuntimeSharedWalletRiskReservationSnapshot(value)
  return value
}

export function assertReplayRuntimeSharedWalletRiskReservationSnapshot(
  value: ReplayRuntimeSharedWalletRiskReservationSnapshot,
): void {
  requireExactObjectFields(value, [
    "schema_version", "reservation_id", "reservation_ref", "reservation_hash", "issued_at", "expires_at",
    "status", "authority_id", "experiment_id", "trial_group_id", "trial_group_hash", "portfolio_id",
    "portfolio_plan_hash", "settlement_asset", "shared_initial_cash", "capital_policy_version",
    "funding_policy_version", "risk_policy_version", "same_time_cash_policy", "lanes", "limitations",
  ], "runtime_shared_wallet_risk_reservation")
  if (value.schema_version !== REPLAY_RUNTIME_SHARED_WALLET_RISK_RESERVATION_SCHEMA_VERSION) {
    fail("runtime shared wallet risk reservation schema_version")
  }
  for (const [field, item] of Object.entries({
    reservation_id: value.reservation_id, reservation_ref: value.reservation_ref,
    experiment_id: value.experiment_id, trial_group_id: value.trial_group_id,
    portfolio_id: value.portfolio_id, settlement_asset: value.settlement_asset,
  })) requireText(item, `runtime_shared_wallet_risk_reservation.${field}`)
  for (const [field, item] of Object.entries({
    reservation_hash: value.reservation_hash, trial_group_hash: value.trial_group_hash,
    portfolio_plan_hash: value.portfolio_plan_hash,
  })) requireHash(item, `runtime_shared_wallet_risk_reservation.${field}`)
  requireUtcTimestamp(value.issued_at, "runtime_shared_wallet_risk_reservation.issued_at")
  requireUtcTimestamp(value.expires_at, "runtime_shared_wallet_risk_reservation.expires_at")
  if (Date.parse(value.expires_at) <= Date.parse(value.issued_at)) {
    fail("runtime shared wallet risk reservation timestamps must satisfy issued_at < expires_at")
  }
  if (value.status !== "reserved" || value.authority_id !== "research-control-plane"
      || value.capital_policy_version !== "rd-runtime-shared-wallet-exact-risk-v1"
      || value.funding_policy_version !== "exact-event-time-t-minus-position-v1"
      || value.risk_policy_version !== "complete-exact-mark-isolated-maintenance-full-liquidation-v1"
      || value.same_time_cash_policy !== "funding_then_exact_risk_then_liquidation_then_exit_then_entry_then_control_plane_priority") {
    fail("runtime shared wallet risk reservation policy is unsupported")
  }
  requirePositiveFinite(value.shared_initial_cash, "runtime_shared_wallet_risk_reservation.shared_initial_cash")
  if (!Array.isArray(value.lanes) || value.lanes.length < 2) {
    fail("runtime shared wallet risk reservation requires at least two lanes")
  }
  const laneIds = new Set<string>()
  const trialIds = new Set<string>()
  const runIds = new Set<string>()
  const reservationHashes = new Set<string>()
  for (let index = 0; index < value.lanes.length; index += 1) {
    const lane = value.lanes[index]!
    requireExactObjectFields(lane, [
      "lane_id", "priority_rank", "trial_id", "run_id", "trial_reservation_ref", "trial_reservation_hash",
    ], "runtime_shared_wallet_risk_reservation.lane")
    requireText(lane.lane_id, "runtime_shared_wallet_risk_reservation.lane_id")
    requireText(lane.trial_id, "runtime_shared_wallet_risk_reservation.trial_id")
    requireText(lane.run_id, "runtime_shared_wallet_risk_reservation.run_id")
    requireText(lane.trial_reservation_ref, "runtime_shared_wallet_risk_reservation.trial_reservation_ref")
    requireHash(lane.trial_reservation_hash, "runtime_shared_wallet_risk_reservation.trial_reservation_hash")
    if (lane.priority_rank !== index + 1 || laneIds.has(lane.lane_id) || trialIds.has(lane.trial_id)
        || runIds.has(lane.run_id) || reservationHashes.has(lane.trial_reservation_hash)) {
      fail("runtime shared wallet risk reservation lanes require consecutive priority and unique authority")
    }
    laneIds.add(lane.lane_id)
    trialIds.add(lane.trial_id)
    runIds.add(lane.run_id)
    reservationHashes.add(lane.trial_reservation_hash)
  }
  const limitations: ReplayRuntimeSharedWalletRiskReservationSnapshot["limitations"] = [
    "market_next_open_entry_full_exit_exact_funding_and_mark_risk_only",
    "isolated_margin_full_liquidation_no_cross_margin",
    "no_partial_liquidation_borrow_insurance_or_adl",
  ]
  if (canonicalReservationJson(value.limitations) !== canonicalReservationJson(limitations)) {
    fail("runtime shared wallet risk reservation limitations were weakened")
  }
  const { reservation_hash: reservationHash, ...body } = value
  if (reservationHash !== createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")) {
    fail("runtime shared wallet risk reservation hash mismatch")
  }
}

export function createReplayPortfolioAllocationReservationSnapshot(
  body: ReplayPortfolioAllocationReservationBody,
): ReplayPortfolioAllocationReservationSnapshot {
  const value = {
    ...structuredClone(body),
    reservation_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplayPortfolioAllocationReservationSnapshot(value)
  return value
}

export function assertReplayPortfolioAllocationReservationSnapshot(
  value: ReplayPortfolioAllocationReservationSnapshot,
): void {
  requireExactObjectFields(value, [
    "schema_version", "reservation_id", "reservation_ref", "reservation_hash", "issued_at", "expires_at",
    "status", "authority_id", "experiment_id", "trial_group_id", "trial_group_hash", "portfolio_id",
    "portfolio_plan_hash", "settlement_asset", "shared_initial_cash", "allocation_policy_version",
    "exposure_policy_version", "risk_budget_policy_version", "rejection_precedence",
    "max_gross_exposure_amount", "max_abs_net_exposure_amount", "max_portfolio_risk_amount",
    "lanes", "limitations",
  ], "portfolio_allocation_reservation")
  if (value.schema_version !== REPLAY_PORTFOLIO_ALLOCATION_RESERVATION_SCHEMA_VERSION) {
    fail("portfolio allocation reservation schema_version")
  }
  for (const [field, item] of Object.entries({
    reservation_id: value.reservation_id, reservation_ref: value.reservation_ref,
    experiment_id: value.experiment_id, trial_group_id: value.trial_group_id,
    portfolio_id: value.portfolio_id, settlement_asset: value.settlement_asset,
  })) requireText(item, `portfolio_allocation_reservation.${field}`)
  for (const [field, item] of Object.entries({
    reservation_hash: value.reservation_hash, trial_group_hash: value.trial_group_hash,
    portfolio_plan_hash: value.portfolio_plan_hash,
  })) requireHash(item, `portfolio_allocation_reservation.${field}`)
  requireUtcTimestamp(value.issued_at, "portfolio_allocation_reservation.issued_at")
  requireUtcTimestamp(value.expires_at, "portfolio_allocation_reservation.expires_at")
  if (Date.parse(value.expires_at) <= Date.parse(value.issued_at)) {
    fail("portfolio allocation reservation timestamps must satisfy issued_at < expires_at")
  }
  if (value.status !== "reserved" || value.authority_id !== "research-control-plane"
      || value.allocation_policy_version !== "simultaneous-entry-greedy-priority-no-resize-v1"
      || value.exposure_policy_version !== "entry-execution-notional-gross-and-absolute-net-v1"
      || value.risk_budget_policy_version
        !== "entry-to-frozen-stop-adverse-execution-plus-round-trip-fees-v1"
      || value.rejection_precedence
        !== "lane_risk_then_cash_then_gross_then_absolute_net_then_portfolio_risk") {
    fail("portfolio allocation reservation policy is unsupported")
  }
  requirePositiveFinite(value.shared_initial_cash, "portfolio_allocation_reservation.shared_initial_cash")
  requirePositiveFinite(value.max_gross_exposure_amount,
    "portfolio_allocation_reservation.max_gross_exposure_amount")
  requirePositiveFinite(value.max_abs_net_exposure_amount,
    "portfolio_allocation_reservation.max_abs_net_exposure_amount")
  requirePositiveFinite(value.max_portfolio_risk_amount,
    "portfolio_allocation_reservation.max_portfolio_risk_amount")
  if (value.max_abs_net_exposure_amount > value.max_gross_exposure_amount
      || value.max_portfolio_risk_amount > value.shared_initial_cash) {
    fail("portfolio allocation reservation caps are inconsistent")
  }
  if (!Array.isArray(value.lanes) || value.lanes.length < 2) {
    fail("portfolio allocation reservation requires at least two lanes")
  }
  const laneIds = new Set<string>()
  const trialIds = new Set<string>()
  const runIds = new Set<string>()
  const reservationHashes = new Set<string>()
  for (let index = 0; index < value.lanes.length; index += 1) {
    const lane = value.lanes[index]!
    requireExactObjectFields(lane, [
      "lane_id", "priority_rank", "trial_id", "run_id", "trial_reservation_ref",
      "trial_reservation_hash", "max_lane_risk_amount",
    ], "portfolio_allocation_reservation.lane")
    requireText(lane.lane_id, "portfolio_allocation_reservation.lane_id")
    requireText(lane.trial_id, "portfolio_allocation_reservation.trial_id")
    requireText(lane.run_id, "portfolio_allocation_reservation.run_id")
    requireText(lane.trial_reservation_ref, "portfolio_allocation_reservation.trial_reservation_ref")
    requireHash(lane.trial_reservation_hash, "portfolio_allocation_reservation.trial_reservation_hash")
    requirePositiveFinite(lane.max_lane_risk_amount, "portfolio_allocation_reservation.max_lane_risk_amount")
    if (lane.max_lane_risk_amount > value.max_portfolio_risk_amount || lane.priority_rank !== index + 1
        || laneIds.has(lane.lane_id) || trialIds.has(lane.trial_id) || runIds.has(lane.run_id)
        || reservationHashes.has(lane.trial_reservation_hash)) {
      fail("portfolio allocation reservation lanes require bounded risk, consecutive priority and unique authority")
    }
    laneIds.add(lane.lane_id)
    trialIds.add(lane.trial_id)
    runIds.add(lane.run_id)
    reservationHashes.add(lane.trial_reservation_hash)
  }
  const limitations: ReplayPortfolioAllocationReservationSnapshot["limitations"] = [
    "market_next_open_full_fill_or_reject_no_resize_entry_slice_only",
    "entry_notional_exposure_and_frozen_stop_loss_budget_not_dynamic_var",
    "no_exit_funding_liquidation_cross_margin_partial_fill_or_borrow",
  ]
  if (canonicalReservationJson(value.limitations) !== canonicalReservationJson(limitations)) {
    fail("portfolio allocation reservation limitations were weakened")
  }
  const { reservation_hash: reservationHash, ...body } = value
  if (reservationHash !== createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")) {
    fail("portfolio allocation reservation hash mismatch")
  }
}

export function createReplayPortfolioReallocationReservationSnapshot(
  body: ReplayPortfolioReallocationReservationBody,
): ReplayPortfolioReallocationReservationSnapshot {
  const value = {
    ...structuredClone(body),
    reservation_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplayPortfolioReallocationReservationSnapshot(value)
  return value
}

export function assertReplayPortfolioReallocationReservationSnapshot(
  value: ReplayPortfolioReallocationReservationSnapshot,
): void {
  requireExactObjectFields(value, [
    "schema_version", "reservation_id", "reservation_ref", "reservation_hash", "issued_at", "expires_at",
    "status", "authority_id", "experiment_id", "trial_group_id", "trial_group_hash", "portfolio_id",
    "portfolio_plan_hash", "settlement_asset", "portfolio_initial_cash", "predecessor_integrated_result_hash",
    "predecessor_artifact_manifest_hash", "reallocation_cycle", "earliest_reallocation_time",
    "opening_cash_policy", "eligibility_policy", "allocation_policy_version", "max_gross_exposure_amount",
    "max_abs_net_exposure_amount", "max_portfolio_risk_amount", "lanes", "limitations",
  ], "portfolio_reallocation_reservation")
  for (const text of [value.reservation_id, value.reservation_ref, value.experiment_id, value.trial_group_id,
    value.portfolio_id, value.settlement_asset]) requireText(text, "portfolio_reallocation_reservation.text")
  for (const hash of [value.reservation_hash, value.trial_group_hash, value.portfolio_plan_hash,
    value.predecessor_integrated_result_hash, value.predecessor_artifact_manifest_hash]) {
    requireHash(hash, "portfolio_reallocation_reservation.hash")
  }
  requireUtcTimestamp(value.issued_at, "portfolio_reallocation_reservation.issued_at")
  requireUtcTimestamp(value.expires_at, "portfolio_reallocation_reservation.expires_at")
  requireUtcTimestamp(value.earliest_reallocation_time, "portfolio_reallocation_reservation.earliest_reallocation_time")
  if (value.schema_version !== REPLAY_PORTFOLIO_REALLOCATION_RESERVATION_SCHEMA_VERSION
      || value.status !== "reserved" || value.authority_id !== "research-control-plane"
      || value.reallocation_cycle !== 2
      || value.opening_cash_policy !== "predecessor_ending_available_cash_after_full_flat_release"
      || value.eligibility_policy !== "all_predecessor_positions_closed_and_exposure_risk_zero"
      || value.allocation_policy_version !== "simultaneous-entry-greedy-priority-no-resize-v1"
      || Date.parse(value.expires_at) <= Date.parse(value.issued_at)
      || Date.parse(value.earliest_reallocation_time) < Date.parse(value.issued_at)) fail("portfolio reallocation policy")
  for (const [name, amount] of Object.entries({ initial: value.portfolio_initial_cash,
    gross: value.max_gross_exposure_amount, net: value.max_abs_net_exposure_amount,
    risk: value.max_portfolio_risk_amount })) requirePositiveFinite(amount, `portfolio_reallocation_reservation.${name}`)
  if (value.max_abs_net_exposure_amount > value.max_gross_exposure_amount
      || value.max_portfolio_risk_amount > value.portfolio_initial_cash || value.lanes.length < 2) fail("portfolio reallocation caps")
  const laneIds = new Set<string>()
  const trialIds = new Set<string>()
  const runIds = new Set<string>()
  const reservationHashes = new Set<string>()
  value.lanes.forEach((lane, index) => {
    requireExactObjectFields(lane, ["lane_id", "priority_rank", "trial_id", "run_id", "trial_reservation_ref",
      "trial_reservation_hash", "max_lane_risk_amount"], "portfolio_reallocation_reservation.lane")
    requireHash(lane.trial_reservation_hash, "portfolio_reallocation_reservation.lane.hash")
    requirePositiveFinite(lane.max_lane_risk_amount, "portfolio_reallocation_reservation.lane.risk")
    requireText(lane.lane_id, "portfolio_reallocation_reservation.lane.lane_id")
    requireText(lane.trial_id, "portfolio_reallocation_reservation.lane.trial_id")
    requireText(lane.run_id, "portfolio_reallocation_reservation.lane.run_id")
    requireText(lane.trial_reservation_ref, "portfolio_reallocation_reservation.lane.trial_reservation_ref")
    if (lane.priority_rank !== index + 1 || lane.max_lane_risk_amount > value.max_portfolio_risk_amount
        || laneIds.has(lane.lane_id) || trialIds.has(lane.trial_id) || runIds.has(lane.run_id)
        || reservationHashes.has(lane.trial_reservation_hash)) fail("portfolio reallocation lanes")
    laneIds.add(lane.lane_id)
    trialIds.add(lane.trial_id)
    runIds.add(lane.run_id)
    reservationHashes.add(lane.trial_reservation_hash)
  })
  const limitations: ReplayPortfolioReallocationReservationSnapshot["limitations"] = [
    "second_cycle_only_after_authoritative_full_flat_release",
    "opening_cash_derived_from_predecessor_result_not_control_plane_estimate",
    "no_third_cycle_partial_cross_margin_borrow_or_fast",
  ]
  if (canonicalReservationJson(value.limitations) !== canonicalReservationJson(limitations)) fail("portfolio reallocation limitations")
  const { reservation_hash: hash, ...body } = value
  if (hash !== createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")) fail("portfolio reallocation hash")
}

export function createReplayPortfolioCycleSequenceReservationSnapshot(
  body: ReplayPortfolioCycleSequenceReservationBody,
): ReplayPortfolioCycleSequenceReservationSnapshot {
  const value = {
    ...structuredClone(body),
    reservation_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplayPortfolioCycleSequenceReservationSnapshot(value)
  return value
}

export function assertReplayPortfolioCycleSequenceReservationSnapshot(
  value: ReplayPortfolioCycleSequenceReservationSnapshot,
): void {
  requireExactObjectFields(value, [
    "schema_version", "reservation_id", "reservation_ref", "reservation_hash", "issued_at", "expires_at",
    "status", "authority_id", "experiment_id", "trial_group_id", "trial_group_hash", "portfolio_id",
    "settlement_asset", "initial_cash", "cycle_count", "max_cycle_count", "opening_cash_policy",
    "successor_eligibility_policy", "expansion_policy", "cycles", "limitations",
  ], "portfolio_cycle_sequence_reservation")
  for (const text of [value.reservation_id, value.reservation_ref, value.experiment_id, value.trial_group_id,
    value.portfolio_id, value.settlement_asset]) requireText(text, "portfolio_cycle_sequence_reservation.text")
  for (const hash of [value.reservation_hash, value.trial_group_hash]) {
    requireHash(hash, "portfolio_cycle_sequence_reservation.hash")
  }
  requireUtcTimestamp(value.issued_at, "portfolio_cycle_sequence_reservation.issued_at")
  requireUtcTimestamp(value.expires_at, "portfolio_cycle_sequence_reservation.expires_at")
  requirePositiveFinite(value.initial_cash, "portfolio_cycle_sequence_reservation.initial_cash")
  if (value.schema_version !== REPLAY_PORTFOLIO_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION
      || value.status !== "reserved" || value.authority_id !== "research-control-plane"
      || value.max_cycle_count !== REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES
      || value.opening_cash_policy !== "first_cycle_initial_then_predecessor_ending_available"
      || value.successor_eligibility_policy !== "predecessor_full_flat_exposure_and_risk_zero"
      || value.expansion_policy !== "exact_predeclared_cycles_no_runtime_append_or_search_expansion"
      || Date.parse(value.expires_at) <= Date.parse(value.issued_at)
      || !Number.isSafeInteger(value.cycle_count) || value.cycle_count < 1
      || value.cycle_count > REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES
      || value.cycles.length !== value.cycle_count) fail("portfolio cycle sequence policy")
  let priorTime = Number.NEGATIVE_INFINITY
  const trialIds = new Set<string>()
  const runIds = new Set<string>()
  const reservationHashes = new Set<string>()
  for (const [cycleOffset, cycle] of value.cycles.entries()) {
    requireExactObjectFields(cycle, [
      "cycle_index", "allocation_plan_hash", "risk_plan_hash", "earliest_cycle_time",
      "max_gross_exposure_amount", "max_abs_net_exposure_amount", "max_portfolio_risk_amount", "lanes",
    ], "portfolio_cycle_sequence_reservation.cycle")
    requireHash(cycle.allocation_plan_hash, "portfolio_cycle_sequence_reservation.cycle.allocation_plan_hash")
    requireHash(cycle.risk_plan_hash, "portfolio_cycle_sequence_reservation.cycle.risk_plan_hash")
    requireUtcTimestamp(cycle.earliest_cycle_time, "portfolio_cycle_sequence_reservation.cycle.earliest_cycle_time")
    if (cycle.cycle_index !== cycleOffset + 1 || Date.parse(cycle.earliest_cycle_time) <= priorTime
        || Date.parse(cycle.earliest_cycle_time) < Date.parse(value.issued_at)
        || Date.parse(cycle.earliest_cycle_time) >= Date.parse(value.expires_at)) fail("portfolio cycle sequence order")
    priorTime = Date.parse(cycle.earliest_cycle_time)
    for (const [name, amount] of Object.entries({ gross: cycle.max_gross_exposure_amount,
      net: cycle.max_abs_net_exposure_amount, risk: cycle.max_portfolio_risk_amount })) {
      requirePositiveFinite(amount, `portfolio_cycle_sequence_reservation.cycle.${name}`)
    }
    if (cycle.max_abs_net_exposure_amount > cycle.max_gross_exposure_amount
        || cycle.max_portfolio_risk_amount > value.initial_cash || cycle.lanes.length < 2) {
      fail("portfolio cycle sequence caps")
    }
    const laneIds = new Set<string>()
    cycle.lanes.forEach((lane, laneOffset) => {
      requireExactObjectFields(lane, ["lane_id", "priority_rank", "trial_id", "run_id",
        "trial_reservation_ref", "trial_reservation_hash", "max_lane_risk_amount"],
      "portfolio_cycle_sequence_reservation.lane")
      requireText(lane.lane_id, "portfolio_cycle_sequence_reservation.lane.lane_id")
      requireText(lane.trial_id, "portfolio_cycle_sequence_reservation.lane.trial_id")
      requireText(lane.run_id, "portfolio_cycle_sequence_reservation.lane.run_id")
      requireText(lane.trial_reservation_ref, "portfolio_cycle_sequence_reservation.lane.trial_reservation_ref")
      requireHash(lane.trial_reservation_hash, "portfolio_cycle_sequence_reservation.lane.hash")
      requirePositiveFinite(lane.max_lane_risk_amount, "portfolio_cycle_sequence_reservation.lane.risk")
      if (lane.priority_rank !== laneOffset + 1 || lane.max_lane_risk_amount > cycle.max_portfolio_risk_amount
          || laneIds.has(lane.lane_id) || trialIds.has(lane.trial_id) || runIds.has(lane.run_id)
          || reservationHashes.has(lane.trial_reservation_hash)) fail("portfolio cycle sequence lanes")
      laneIds.add(lane.lane_id)
      trialIds.add(lane.trial_id)
      runIds.add(lane.run_id)
      reservationHashes.add(lane.trial_reservation_hash)
    })
  }
  const limitations: ReplayPortfolioCycleSequenceReservationSnapshot["limitations"] = [
    "one_to_eight_predeclared_full_flat_cycles_only",
    "cycle_opening_cash_is_runtime_predecessor_evidence_not_control_plane_estimate",
    "no_partial_cross_margin_borrow_real_liquidity_fast_or_runtime_cycle_expansion",
  ]
  if (canonicalReservationJson(value.limitations) !== canonicalReservationJson(limitations)) {
    fail("portfolio cycle sequence limitations")
  }
  const { reservation_hash: hash, ...body } = value
  if (hash !== createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")) {
    fail("portfolio cycle sequence hash")
  }
}

export function createReplayPortfolioTwoFixedPartialReservationSnapshot(
  body: ReplayPortfolioTwoFixedPartialReservationBody,
): ReplayPortfolioTwoFixedPartialReservationSnapshot {
  const value = { ...structuredClone(body),
    reservation_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex") }
  assertReplayPortfolioTwoFixedPartialReservationSnapshot(value)
  return value
}

export function assertReplayPortfolioTwoFixedPartialReservationSnapshot(
  value: ReplayPortfolioTwoFixedPartialReservationSnapshot,
): void {
  requireExactObjectFields(value, [
    "schema_version", "reservation_id", "reservation_ref", "reservation_hash", "issued_at", "expires_at",
    "status", "authority_id", "experiment_id", "trial_group_id", "trial_group_hash", "portfolio_id",
    "settlement_asset", "source_terminal_evidence_hash", "source_terminal_artifact_manifest_hash",
    "risk_result_hash", "projection_policy_version", "lanes", "limitations",
  ], "portfolio_two_fixed_partial_reservation")
  for (const text of [value.reservation_id, value.reservation_ref, value.experiment_id,
    value.trial_group_id, value.portfolio_id, value.settlement_asset]) {
    requireText(text, "portfolio_two_fixed_partial_reservation.text")
  }
  for (const hash of [value.reservation_hash, value.trial_group_hash, value.source_terminal_evidence_hash,
    value.source_terminal_artifact_manifest_hash, value.risk_result_hash]) {
    requireHash(hash, "portfolio_two_fixed_partial_reservation.hash")
  }
  requireUtcTimestamp(value.issued_at, "portfolio_two_fixed_partial_reservation.issued_at")
  requireUtcTimestamp(value.expires_at, "portfolio_two_fixed_partial_reservation.expires_at")
  if (value.schema_version !== REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_RESERVATION_SCHEMA_VERSION
      || value.status !== "reserved" || value.authority_id !== "research-control-plane"
      || value.projection_policy_version !== "two-predeclared-fixed-partials-terminal-risk-v1"
      || Date.parse(value.expires_at) <= Date.parse(value.issued_at)
      || value.lanes.length === 0) fail("portfolio two-fixed-partial reservation policy")
  const laneIds = new Set<string>(); const trialIds = new Set<string>(); const runIds = new Set<string>()
  const trialReservationHashes = new Set<string>(); const requestHashes = new Set<string>()
  value.lanes.forEach((lane, index) => {
    requireExactObjectFields(lane, ["lane_id", "priority_rank", "trial_id", "run_id",
      "trial_reservation_ref", "trial_reservation_hash", "request_hash", "source_terminal_record_hash",
      "isolated_collateral"], "portfolio_two_fixed_partial_reservation.lane")
    for (const text of [lane.lane_id, lane.trial_id, lane.run_id, lane.trial_reservation_ref]) {
      requireText(text, "portfolio_two_fixed_partial_reservation.lane.text")
    }
    for (const hash of [lane.trial_reservation_hash, lane.request_hash, lane.source_terminal_record_hash]) {
      requireHash(hash, "portfolio_two_fixed_partial_reservation.lane.hash")
    }
    requirePositiveFinite(lane.isolated_collateral, "portfolio_two_fixed_partial_reservation.lane.collateral")
    if (lane.priority_rank !== index + 1 || laneIds.has(lane.lane_id) || trialIds.has(lane.trial_id)
        || runIds.has(lane.run_id) || trialReservationHashes.has(lane.trial_reservation_hash)
        || requestHashes.has(lane.request_hash)) fail("portfolio two-fixed-partial reservation lanes")
    laneIds.add(lane.lane_id); trialIds.add(lane.trial_id); runIds.add(lane.run_id)
    trialReservationHashes.add(lane.trial_reservation_hash); requestHashes.add(lane.request_hash)
  })
  const limitations: ReplayPortfolioTwoFixedPartialReservationSnapshot["limitations"] = [
    "exactly_two_predeclared_fixed_quantity_partial_reduces_per_opened_lane",
    "projection_only_no_contract_search_review_or_lifecycle_authority",
    "no_dynamic_sizing_third_partial_post_partial_mutation_reentry_cross_margin_borrow_real_liquidity_or_fast",
  ]
  if (canonicalReservationJson(value.limitations) !== canonicalReservationJson(limitations)) {
    fail("portfolio two-fixed-partial reservation limitations")
  }
  const { reservation_hash: hash, ...body } = value
  if (hash !== createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")) {
    fail("portfolio two-fixed-partial reservation hash")
  }
}

export function createReplayPortfolioTwoFixedPartialCycleSequenceReservationSnapshot(
  body: ReplayPortfolioTwoFixedPartialCycleSequenceReservationBody,
): ReplayPortfolioTwoFixedPartialCycleSequenceReservationSnapshot {
  const value = { ...structuredClone(body),
    reservation_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex") }
  assertReplayPortfolioTwoFixedPartialCycleSequenceReservationSnapshot(value)
  return value
}

export function assertReplayPortfolioTwoFixedPartialCycleSequenceReservationSnapshot(
  value: ReplayPortfolioTwoFixedPartialCycleSequenceReservationSnapshot,
): void {
  requireExactObjectFields(value, ["schema_version", "reservation_id", "reservation_ref", "reservation_hash",
    "issued_at", "expires_at", "status", "authority_id", "experiment_id", "trial_group_id",
    "trial_group_hash", "portfolio_id", "settlement_asset", "initial_cash", "cycle_count",
    "max_cycle_count", "opening_cash_policy", "successor_eligibility_policy", "expansion_policy",
    "cycles", "limitations"], "portfolio_two_fixed_partial_cycle_sequence_reservation")
  for (const text of [value.reservation_id, value.reservation_ref, value.experiment_id,
    value.trial_group_id, value.portfolio_id, value.settlement_asset]) {
    requireText(text, "portfolio_two_fixed_partial_cycle_sequence_reservation.text")
  }
  for (const hash of [value.reservation_hash, value.trial_group_hash]) {
    requireHash(hash, "portfolio_two_fixed_partial_cycle_sequence_reservation.hash")
  }
  requireUtcTimestamp(value.issued_at, "portfolio_two_fixed_partial_cycle_sequence_reservation.issued_at")
  requireUtcTimestamp(value.expires_at, "portfolio_two_fixed_partial_cycle_sequence_reservation.expires_at")
  requirePositiveFinite(value.initial_cash, "portfolio_two_fixed_partial_cycle_sequence_reservation.initial_cash")
  if (value.schema_version !== REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION
      || value.status !== "reserved" || value.authority_id !== "research-control-plane"
      || Date.parse(value.expires_at) <= Date.parse(value.issued_at)
      || value.cycle_count !== value.cycles.length || value.cycle_count < 1
      || value.cycle_count > REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES
      || value.max_cycle_count !== REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES
      || value.opening_cash_policy !== "first_cycle_initial_then_predecessor_committed_trial_balance"
      || value.successor_eligibility_policy
        !== "predecessor_committed_full_flat_exposure_collateral_and_risk_zero"
      || value.expansion_policy !== "exact_predeclared_child_reservations_no_runtime_append_or_search_expansion") {
    fail("portfolio two-fixed-partial cycle sequence policy")
  }
  const childHashes = new Set<string>(); const trialIds = new Set<string>(); const runIds = new Set<string>()
  let priorTime = Number.NEGATIVE_INFINITY
  value.cycles.forEach((cycle, index) => {
    requireExactObjectFields(cycle, ["cycle_index", "two_fixed_partial_reservation_hash",
      "earliest_cycle_time", "lanes"], "portfolio_two_fixed_partial_cycle_sequence_reservation.cycle")
    requireHash(cycle.two_fixed_partial_reservation_hash,
      "portfolio_two_fixed_partial_cycle_sequence_reservation.child_hash")
    requireUtcTimestamp(cycle.earliest_cycle_time,
      "portfolio_two_fixed_partial_cycle_sequence_reservation.earliest_cycle_time")
    const time = Date.parse(cycle.earliest_cycle_time)
    if (cycle.cycle_index !== index + 1 || childHashes.has(cycle.two_fixed_partial_reservation_hash)
        || time <= priorTime || cycle.lanes.length === 0) fail("portfolio two-fixed-partial cycle sequence order")
    childHashes.add(cycle.two_fixed_partial_reservation_hash); priorTime = time
    const laneIds = new Set<string>(); const reservationHashes = new Set<string>(); const requestHashes = new Set<string>()
    cycle.lanes.forEach((lane, laneIndex) => {
      requireExactObjectFields(lane, ["lane_id", "priority_rank", "trial_id", "run_id",
        "trial_reservation_hash", "request_hash"], "portfolio_two_fixed_partial_cycle_sequence_reservation.lane")
      for (const text of [lane.lane_id, lane.trial_id, lane.run_id]) {
        requireText(text, "portfolio_two_fixed_partial_cycle_sequence_reservation.lane.text")
      }
      for (const hash of [lane.trial_reservation_hash, lane.request_hash]) {
        requireHash(hash, "portfolio_two_fixed_partial_cycle_sequence_reservation.lane.hash")
      }
      if (lane.priority_rank !== laneIndex + 1 || laneIds.has(lane.lane_id)
          || trialIds.has(lane.trial_id) || runIds.has(lane.run_id)
          || reservationHashes.has(lane.trial_reservation_hash) || requestHashes.has(lane.request_hash)) {
        fail("portfolio two-fixed-partial cycle sequence lanes")
      }
      laneIds.add(lane.lane_id); trialIds.add(lane.trial_id); runIds.add(lane.run_id)
      reservationHashes.add(lane.trial_reservation_hash); requestHashes.add(lane.request_hash)
    })
  })
  const limitations: ReplayPortfolioTwoFixedPartialCycleSequenceReservationSnapshot["limitations"] = [
    "one_to_eight_predeclared_two_fixed_partial_full_flat_cycles_only",
    "cycle_opening_cash_must_equal_predecessor_committed_trial_balance",
    "no_dynamic_sizing_third_partial_post_partial_mutation_reentry_cross_margin_borrow_real_liquidity_fast_or_runtime_cycle_expansion",
  ]
  if (canonicalReservationJson(value.limitations) !== canonicalReservationJson(limitations)) {
    fail("portfolio two-fixed-partial cycle sequence limitations")
  }
  const { reservation_hash: hash, ...body } = value
  if (hash !== createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")) {
    fail("portfolio two-fixed-partial cycle sequence hash")
  }
}

export function createReplayPortfolioPostPartialStopReplacementCycleSequenceReservationSnapshot(
  body: ReplayPortfolioPostPartialStopReplacementCycleSequenceReservationBody,
): ReplayPortfolioPostPartialStopReplacementCycleSequenceReservationSnapshot {
  const value = { ...structuredClone(body),
    reservation_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex") }
  assertReplayPortfolioPostPartialStopReplacementCycleSequenceReservationSnapshot(value)
  return value
}

export function assertReplayPortfolioPostPartialStopReplacementCycleSequenceReservationSnapshot(
  value: ReplayPortfolioPostPartialStopReplacementCycleSequenceReservationSnapshot,
): void {
  const area = "portfolio_post_partial_stop_replacement_cycle_sequence_reservation"
  requireExactObjectFields(value, ["schema_version", "reservation_id", "reservation_ref", "reservation_hash",
    "issued_at", "expires_at", "status", "authority_id", "experiment_id", "trial_group_id",
    "trial_group_hash", "portfolio_id", "settlement_asset", "initial_cash", "cycle_count",
    "max_cycle_count", "opening_cash_policy", "successor_eligibility_policy", "expansion_policy",
    "cycles", "limitations"], area)
  for (const text of [value.reservation_id, value.reservation_ref, value.experiment_id,
    value.trial_group_id, value.portfolio_id, value.settlement_asset]) requireText(text, `${area}.text`)
  for (const hash of [value.reservation_hash, value.trial_group_hash]) requireHash(hash, `${area}.hash`)
  requireUtcTimestamp(value.issued_at, `${area}.issued_at`)
  requireUtcTimestamp(value.expires_at, `${area}.expires_at`)
  requirePositiveFinite(value.initial_cash, `${area}.initial_cash`)
  if (value.schema_version
        !== REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION
      || value.status !== "reserved" || value.authority_id !== "research-control-plane"
      || Date.parse(value.expires_at) <= Date.parse(value.issued_at)
      || value.cycle_count !== value.cycles.length || value.cycle_count < 1
      || value.cycle_count > REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES
      || value.max_cycle_count !== REPLAY_PORTFOLIO_CYCLE_SEQUENCE_MAX_CYCLES
      || value.opening_cash_policy !== "first_cycle_initial_then_predecessor_committed_trial_balance"
      || value.successor_eligibility_policy
        !== "predecessor_committed_full_flat_collateral_exposure_unrealized_and_current_risk_zero"
      || value.expansion_policy !== "exact_predeclared_lane_trials_no_runtime_append_or_search_expansion") {
    fail("portfolio post-partial stop-replacement cycle sequence policy")
  }
  const trialIds = new Set<string>(); const runIds = new Set<string>()
  const reservationHashes = new Set<string>(); const requestHashes = new Set<string>()
  let priorTime = Number.NEGATIVE_INFINITY
  value.cycles.forEach((cycle, index) => {
    requireExactObjectFields(cycle, ["cycle_index", "earliest_cycle_time", "lanes"], `${area}.cycle`)
    requireUtcTimestamp(cycle.earliest_cycle_time, `${area}.earliest_cycle_time`)
    const time = Date.parse(cycle.earliest_cycle_time)
    if (cycle.cycle_index !== index + 1 || time <= priorTime || cycle.lanes.length === 0) {
      fail("portfolio post-partial stop-replacement cycle sequence order")
    }
    priorTime = time
    const laneIds = new Set<string>()
    cycle.lanes.forEach((lane, laneIndex) => {
      requireExactObjectFields(lane, ["lane_id", "priority_rank", "trial_id", "run_id",
        "trial_reservation_ref", "trial_reservation_hash", "request_hash"], `${area}.lane`)
      for (const text of [lane.lane_id, lane.trial_id, lane.run_id, lane.trial_reservation_ref]) {
        requireText(text, `${area}.lane.text`)
      }
      for (const hash of [lane.trial_reservation_hash, lane.request_hash]) requireHash(hash, `${area}.lane.hash`)
      if (lane.priority_rank !== laneIndex + 1 || laneIds.has(lane.lane_id)
          || trialIds.has(lane.trial_id) || runIds.has(lane.run_id)
          || reservationHashes.has(lane.trial_reservation_hash) || requestHashes.has(lane.request_hash)) {
        fail("portfolio post-partial stop-replacement cycle sequence lanes")
      }
      laneIds.add(lane.lane_id); trialIds.add(lane.trial_id); runIds.add(lane.run_id)
      reservationHashes.add(lane.trial_reservation_hash); requestHashes.add(lane.request_hash)
    })
  })
  const limitations: ReplayPortfolioPostPartialStopReplacementCycleSequenceReservationSnapshot["limitations"] = [
    "one_to_eight_predeclared_post_partial_stop_replacement_full_flat_cycles_only",
    "cycle_opening_cash_must_equal_predecessor_committed_trial_balance",
    "no_open_successor_dynamic_sizing_between_partial_or_repeated_mutation_third_partial_reentry_cross_margin_borrow_real_liquidity_fast_or_runtime_cycle_expansion",
  ]
  if (canonicalReservationJson(value.limitations) !== canonicalReservationJson(limitations)) {
    fail("portfolio post-partial stop-replacement cycle sequence limitations")
  }
  const { reservation_hash: hash, ...body } = value
  if (hash !== createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")) {
    fail("portfolio post-partial stop-replacement cycle sequence hash")
  }
}

export function createReplayInstrumentStatusProviderCertificationSnapshot(
  body: ReplayInstrumentStatusProviderCertificationBody,
): ReplayInstrumentStatusProviderCertificationSnapshot {
  const value: ReplayInstrumentStatusProviderCertificationSnapshot = {
    ...body,
    certification_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplayInstrumentStatusProviderCertificationSnapshot(value)
  return value
}

export function assertReplayInstrumentStatusProviderCertificationSnapshot(
  value: ReplayInstrumentStatusProviderCertificationSnapshot,
): void {
  if (value.schema_version !== REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION) {
    fail("provider certification schema_version")
  }
  for (const [field, item] of Object.entries({
    certification_id: value.certification_id,
    certification_ref: value.certification_ref,
    certifier_id: value.certifier_id,
    certification_policy_version: value.certification_policy_version,
    producer_id: value.producer_id,
    producer_version: value.producer_version,
    normalization_policy_version: value.normalization_policy_version,
  })) requireText(item, `provider_certification.${field}`)
  for (const [field, item] of Object.entries({
    certification_hash: value.certification_hash,
    provider_capability_hash: value.provider_capability_hash,
    producer_build_hash: value.producer_build_hash,
    normalization_policy_hash: value.normalization_policy_hash,
  })) requireHash(item, `provider_certification.${field}`)
  requireUtcTimestamp(value.certified_at, "provider_certification.certified_at")
  requireUtcTimestamp(value.valid_until, "provider_certification.valid_until")
  if (Date.parse(value.valid_until) <= Date.parse(value.certified_at)) fail("provider certification validity window must be positive")
  if (value.status !== "certified") fail("provider certification status must be certified")
  if (value.producer_domain !== "market-data-products") fail("provider certification producer_domain")
  if (value.allowed_source_kind !== "venue_status_event_archive") fail("provider certification source kind")
  if (value.allowed_completeness !== "complete_history") fail("provider certification completeness")
  const { certification_hash: certificationHash, ...body } = value
  const expected = createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")
  if (certificationHash !== expected) fail("provider certification hash mismatch")
}

export function createReplayInstrumentStatusProviderCertificationTermination(
  body: ReplayInstrumentStatusProviderCertificationTerminationBody,
): ReplayInstrumentStatusProviderCertificationTermination {
  const value: ReplayInstrumentStatusProviderCertificationTermination = {
    ...body,
    termination_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplayInstrumentStatusProviderCertificationTermination(value)
  return value
}

export function assertReplayInstrumentStatusProviderCertificationTermination(
  value: ReplayInstrumentStatusProviderCertificationTermination,
): void {
  if (value.schema_version !== REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_TERMINATION_SCHEMA_VERSION) {
    fail("provider certification termination schema_version")
  }
  for (const [field, item] of Object.entries({
    termination_id: value.termination_id,
    termination_ref: value.termination_ref,
    authority_id: value.authority_id,
    termination_policy_version: value.termination_policy_version,
  })) requireText(item, `provider_certification_termination.${field}`)
  for (const [field, item] of Object.entries({
    termination_hash: value.termination_hash,
    certification_hash: value.certification_hash,
  })) requireHash(item, `provider_certification_termination.${field}`)
  requireUtcTimestamp(value.recorded_at, "provider_certification_termination.recorded_at")
  requireUtcTimestamp(value.effective_at, "provider_certification_termination.effective_at")
  if (Date.parse(value.effective_at) < Date.parse(value.recorded_at)) {
    fail("provider certification termination cannot be retroactive")
  }
  if (value.termination_type !== "revoked" && value.termination_type !== "superseded") {
    fail("provider certification termination type")
  }
  const reasons: ReplayInstrumentStatusProviderCertificationTerminationReason[] = [
    "provider_build_rotation",
    "normalization_policy_rotation",
    "capability_rotation",
    "certification_error",
    "determinism_regression",
    "security_incident",
    "provider_retired",
  ]
  if (!reasons.includes(value.reason_code)) fail("provider certification termination reason_code")
  if (value.termination_type === "superseded") {
    requireHash(value.successor_certification_hash, "provider_certification_termination.successor_certification_hash")
    if (value.successor_certification_hash === value.certification_hash) {
      fail("provider certification cannot supersede itself")
    }
  } else if (value.successor_certification_hash !== null) {
    fail("revoked provider certification cannot name a successor")
  }
  const { termination_hash: terminationHash, ...body } = value
  const expected = createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")
  if (terminationHash !== expected) fail("provider certification termination hash mismatch")
}

export function createReplayAggregateTradeProviderCertificationSnapshot(
  body: ReplayAggregateTradeProviderCertificationBody,
): ReplayAggregateTradeProviderCertificationSnapshot {
  const value: ReplayAggregateTradeProviderCertificationSnapshot = {
    ...body,
    certification_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplayAggregateTradeProviderCertificationSnapshot(value)
  return value
}

export function assertReplayAggregateTradeProviderCertificationSnapshot(
  value: ReplayAggregateTradeProviderCertificationSnapshot,
): void {
  if (value.schema_version !== REPLAY_AGGREGATE_TRADE_PROVIDER_CERTIFICATION_SCHEMA_VERSION) {
    fail("aggregate trade provider certification schema_version")
  }
  for (const [field, item] of Object.entries({
    certification_id: value.certification_id,
    certification_ref: value.certification_ref,
    certifier_id: value.certifier_id,
    certification_policy_version: value.certification_policy_version,
    producer_version: value.producer_version,
  })) requireText(item, `aggregate_trade_provider_certification.${field}`)
  for (const [field, item] of Object.entries({
    certification_hash: value.certification_hash,
    provider_capability_hash: value.provider_capability_hash,
    producer_build_hash: value.producer_build_hash,
    provider_policy_hash: value.provider_policy_hash,
  })) requireHash(item, `aggregate_trade_provider_certification.${field}`)
  requireUtcTimestamp(value.certified_at, "aggregate_trade_provider_certification.certified_at")
  requireUtcTimestamp(value.valid_until, "aggregate_trade_provider_certification.valid_until")
  if (Date.parse(value.valid_until) <= Date.parse(value.certified_at)) {
    fail("aggregate trade provider certification validity window must be positive")
  }
  if (value.status !== "certified"
      || value.producer_domain !== "market-data-products"
      || value.producer_id !== "market-data.aggregate-trade-provider"
      || value.accepted_archive_schema !== "trade.market-data-aggregate-trade-archive.v1"
      || value.emitted_event_schema !== "trade.rd-replay-aggregate-trade-event.v1"
      || value.emitted_attestation_schema !== "trade.rd-replay-aggregate-trade-coverage-attestation.v1"
      || value.allowed_source_kind !== "venue_aggregate_trade_archive"
      || value.allowed_external_completeness !== "not_verified") {
    fail("aggregate trade provider certification capability policy")
  }
  const { certification_hash: certificationHash, ...body } = value
  const expected = createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")
  if (certificationHash !== expected) fail("aggregate trade provider certification hash mismatch")
}

export function createReplayAggregateTradeProviderCertificationTermination(
  body: ReplayAggregateTradeProviderCertificationTerminationBody,
): ReplayAggregateTradeProviderCertificationTermination {
  const value: ReplayAggregateTradeProviderCertificationTermination = {
    ...body,
    termination_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplayAggregateTradeProviderCertificationTermination(value)
  return value
}

export function assertReplayAggregateTradeProviderCertificationTermination(
  value: ReplayAggregateTradeProviderCertificationTermination,
): void {
  if (value.schema_version !== REPLAY_AGGREGATE_TRADE_PROVIDER_CERTIFICATION_TERMINATION_SCHEMA_VERSION) {
    fail("aggregate trade provider certification termination schema_version")
  }
  for (const [field, item] of Object.entries({
    termination_id: value.termination_id,
    termination_ref: value.termination_ref,
    authority_id: value.authority_id,
    termination_policy_version: value.termination_policy_version,
  })) requireText(item, `aggregate_trade_provider_certification_termination.${field}`)
  requireHash(value.termination_hash, "aggregate_trade_provider_certification_termination.termination_hash")
  requireHash(value.certification_hash, "aggregate_trade_provider_certification_termination.certification_hash")
  requireUtcTimestamp(value.recorded_at, "aggregate_trade_provider_certification_termination.recorded_at")
  requireUtcTimestamp(value.effective_at, "aggregate_trade_provider_certification_termination.effective_at")
  if (Date.parse(value.effective_at) < Date.parse(value.recorded_at)) {
    fail("aggregate trade provider certification termination cannot be retroactive")
  }
  if (value.termination_type !== "revoked" && value.termination_type !== "superseded") {
    fail("aggregate trade provider certification termination type")
  }
  const reasons: ReplayAggregateTradeProviderCertificationTerminationReason[] = [
    "provider_build_rotation",
    "normalization_policy_rotation",
    "capability_rotation",
    "certification_error",
    "determinism_regression",
    "security_incident",
    "provider_retired",
  ]
  if (!reasons.includes(value.reason_code)) fail("aggregate trade provider certification termination reason_code")
  if (value.termination_type === "superseded") {
    requireHash(
      value.successor_certification_hash,
      "aggregate_trade_provider_certification_termination.successor_certification_hash",
    )
    if (value.successor_certification_hash === value.certification_hash) {
      fail("aggregate trade provider certification cannot supersede itself")
    }
  } else if (value.successor_certification_hash !== null) {
    fail("revoked aggregate trade provider certification cannot name a successor")
  }
  const { termination_hash: terminationHash, ...body } = value
  const expected = createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")
  if (terminationHash !== expected) fail("aggregate trade provider certification termination hash mismatch")
}

export function createReplayAggregateTradeEvidenceAdmissionSnapshot(
  body: ReplayAggregateTradeEvidenceAdmissionBody,
): ReplayAggregateTradeEvidenceAdmissionSnapshot {
  const value: ReplayAggregateTradeEvidenceAdmissionSnapshot = {
    ...body,
    admission_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplayAggregateTradeEvidenceAdmissionSnapshot(value)
  return value
}

export function assertReplayAggregateTradeEvidenceAdmissionSnapshot(
  value: ReplayAggregateTradeEvidenceAdmissionSnapshot,
): void {
  if (value.schema_version !== REPLAY_AGGREGATE_TRADE_EVIDENCE_ADMISSION_SCHEMA_VERSION) {
    fail("aggregate trade evidence admission schema_version")
  }
  for (const [field, item] of Object.entries({
    admission_id: value.admission_id,
    admission_ref: value.admission_ref,
    authority_id: value.authority_id,
    admission_policy_version: value.admission_policy_version,
    trial_id: value.trial_id,
    run_id: value.run_id,
    reservation_ref: value.reservation_ref,
    archive_id: value.archive_id,
    evidence_ref: value.evidence_ref,
  })) requireText(item, `aggregate_trade_evidence_admission.${field}`)
  for (const [field, item] of Object.entries({
    admission_hash: value.admission_hash,
    reservation_hash: value.reservation_hash,
    provider_capability_hash: value.provider_capability_hash,
    provider_certification_hash: value.provider_certification_hash,
    archive_hash: value.archive_hash,
    source_receipt_hash: value.source_receipt_hash,
    completeness_audit_hash: value.completeness_audit_hash,
    evidence_hash: value.evidence_hash,
    coverage_attestation_hash: value.coverage_attestation_hash,
  })) requireHash(item, `aggregate_trade_evidence_admission.${field}`)
  requireUtcTimestamp(value.issued_at, "aggregate_trade_evidence_admission.issued_at")
  requireUtcTimestamp(value.evidence_produced_at, "aggregate_trade_evidence_admission.evidence_produced_at")
  requireUtcTimestamp(value.coverage_start, "aggregate_trade_evidence_admission.coverage_start")
  requireUtcTimestamp(value.coverage_end, "aggregate_trade_evidence_admission.coverage_end")
  if (Date.parse(value.coverage_start) >= Date.parse(value.coverage_end)
      || Date.parse(value.evidence_produced_at) < Date.parse(value.coverage_end)
      || Date.parse(value.issued_at) < Date.parse(value.evidence_produced_at)) {
    fail("aggregate trade evidence admission chronology")
  }
  assertReplayAggregateTradeProviderCertificationSnapshot(value.provider_certification)
  if (value.provider_capability_hash !== value.provider_certification.provider_capability_hash
      || value.provider_certification_hash !== value.provider_certification.certification_hash) {
    fail("aggregate trade evidence admission provider certification binding")
  }
  if (Date.parse(value.issued_at) < Date.parse(value.provider_certification.certified_at)
      || Date.parse(value.issued_at) >= Date.parse(value.provider_certification.valid_until)) {
    fail("aggregate trade evidence admission requires a currently valid provider certification")
  }
  if (value.status !== "admitted"
      || value.external_completeness !== "not_verified"
      || value.scope !== "pre_integration_exact_price_path_only") {
    fail("aggregate trade evidence admission cannot authorize execution or overclaim completeness")
  }
  const { admission_hash: admissionHash, ...body } = value
  const expected = createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")
  if (admissionHash !== expected) fail("aggregate trade evidence admission hash mismatch")
}

export function createReplayCrossSourceOrderingAdmissionSnapshot(
  body: ReplayCrossSourceOrderingAdmissionBody,
): ReplayCrossSourceOrderingAdmissionSnapshot {
  const value: ReplayCrossSourceOrderingAdmissionSnapshot = {
    ...body,
    admission_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplayCrossSourceOrderingAdmissionSnapshot(value)
  return value
}

export function assertReplayCrossSourceOrderingAdmissionSnapshot(
  value: ReplayCrossSourceOrderingAdmissionSnapshot,
): void {
  if (value.schema_version !== REPLAY_CROSS_SOURCE_ORDERING_ADMISSION_SCHEMA_VERSION) {
    fail("cross-source ordering admission schema_version")
  }
  for (const [field, item] of Object.entries({
    admission_id: value.admission_id,
    admission_ref: value.admission_ref,
    authority_id: value.authority_id,
    admission_policy_version: value.admission_policy_version,
    trial_id: value.trial_id,
    run_id: value.run_id,
    reservation_ref: value.reservation_ref,
    aggregate_trade_evidence_admission_ref: value.aggregate_trade_evidence_admission_ref,
    ordering_attestation_id: value.ordering_attestation_id,
    symbol: value.symbol,
    timeframe: value.timeframe,
    dataset_manifest_ref: value.dataset_manifest_ref,
  })) requireText(item, `cross_source_ordering_admission.${field}`)
  for (const [field, item] of Object.entries({
    admission_hash: value.admission_hash,
    reservation_hash: value.reservation_hash,
    aggregate_trade_evidence_admission_hash: value.aggregate_trade_evidence_admission_hash,
    aggregate_trade_coverage_attestation_hash: value.aggregate_trade_coverage_attestation_hash,
    ordering_attestation_hash: value.ordering_attestation_hash,
    dataset_hash: value.dataset_hash,
    instrument_status_schedule_hash: value.instrument_status_schedule_hash,
    instrument_status_provenance_hash: value.instrument_status_provenance_hash,
    instrument_status_events_hash: value.instrument_status_events_hash,
    funding_events_hash: value.funding_events_hash,
    aggregate_trade_events_hash: value.aggregate_trade_events_hash,
    ohlcv_bars_hash: value.ohlcv_bars_hash,
    source_collections_hash: value.source_collections_hash,
    ordered_events_hash: value.ordered_events_hash,
    ambiguity_groups_hash: value.ambiguity_groups_hash,
    limitations_hash: value.limitations_hash,
  })) requireHash(item, `cross_source_ordering_admission.${field}`)
  requireUtcTimestamp(value.issued_at, "cross_source_ordering_admission.issued_at")
  requireUtcTimestamp(value.window_start_inclusive, "cross_source_ordering_admission.window_start_inclusive")
  requireUtcTimestamp(value.window_end_exclusive, "cross_source_ordering_admission.window_end_exclusive")
  if (Date.parse(value.window_start_inclusive) >= Date.parse(value.window_end_exclusive)) {
    fail("cross-source ordering admission window must be positive and half-open")
  }
  if (canonicalReservationJson(value.source_kinds)
      !== canonicalReservationJson(["instrument_status", "funding", "aggregate_trade", "ohlcv"])) {
    fail("cross-source ordering admission requires the four-source canonical set")
  }
  const allowedLimitations: ReplayCrossSourceOrderingAdmissionLimitation[] = [
    "cross-source-global-sequence-unavailable",
    "source-clock-resolution-does-not-prove-within-timestamp-order",
    "aggregate-trade-external-completeness-not-verified",
    "funding-external-completeness-not-asserted",
    "ohlcv-aggregate-trade-bar-link-not-attested",
    "instrument-status-effective-vs-availability-separated",
  ]
  const canonicalLimitations = allowedLimitations.filter((limitation) => value.limitations.includes(limitation))
  if (canonicalReservationJson(value.limitations) !== canonicalReservationJson(canonicalLimitations)
      || !value.limitations.includes("aggregate-trade-external-completeness-not-verified")
      || !value.limitations.includes("funding-external-completeness-not-asserted")
      || !value.limitations.includes("ohlcv-aggregate-trade-bar-link-not-attested")) {
    fail("cross-source ordering admission limitations are incomplete or non-canonical")
  }
  const expectedLimitationsHash = createHash("sha256")
    .update(canonicalReservationJson(value.limitations), "utf8").digest("hex")
  if (value.limitations_hash !== expectedLimitationsHash) fail("cross-source ordering admission limitations hash mismatch")
  if (!Number.isSafeInteger(value.ambiguity_group_count) || value.ambiguity_group_count < 0) {
    fail("cross-source ordering admission ambiguity_group_count")
  }
  const hasGlobalSequenceLimitation = value.limitations.includes("cross-source-global-sequence-unavailable")
  const hasClockResolutionLimitation = value.limitations.includes("source-clock-resolution-does-not-prove-within-timestamp-order")
  if (hasGlobalSequenceLimitation !== hasClockResolutionLimitation) {
    fail("cross-source ordering admission collision limitations must appear together")
  }
  const collisionLimitationsPresent = hasGlobalSequenceLimitation && hasClockResolutionLimitation
  if ((value.ordering_resolution === "resolution_limited" && (value.ambiguity_group_count < 1 || !collisionLimitationsPresent))
      || (value.ordering_resolution === "exact_by_declared_timestamps"
        && (value.ambiguity_group_count !== 0 || collisionLimitationsPresent))) {
    fail("cross-source ordering admission resolution overclaims evidence")
  }
  if (value.status !== "admitted"
      || value.ordering_attestation_schema_version !== "trade.rd-replay-cross-source-ordering-attestation.v1"
      || value.event_key_policy_version !== "rd-replay-cross-source-event-key-v1"
      || value.external_completeness !== "not_verified"
      || value.scope !== "pre_integration_cross_source_ordering_only"
      || value.economic_authority !== "none") {
    fail("cross-source ordering admission cannot authorize economic execution or overclaim completeness")
  }
  const { admission_hash: admissionHash, ...body } = value
  const expected = createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")
  if (admissionHash !== expected) fail("cross-source ordering admission hash mismatch")
}

export function createReplayBarLinkedAggregateTradePathAuthoritySnapshot(
  body: ReplayBarLinkedAggregateTradePathAuthorityBody,
): ReplayBarLinkedAggregateTradePathAuthoritySnapshot {
  const value: ReplayBarLinkedAggregateTradePathAuthoritySnapshot = {
    ...body,
    authority_snapshot_hash: createHash("sha256")
      .update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplayBarLinkedAggregateTradePathAuthoritySnapshot(value)
  return value
}

export function assertReplayBarLinkedAggregateTradePathAuthoritySnapshot(
  value: ReplayBarLinkedAggregateTradePathAuthoritySnapshot,
): void {
  requireExactObjectFields(value, [
    "schema_version", "authority_snapshot_id", "authority_snapshot_ref", "authority_snapshot_hash",
    "status", "issued_at", "authority_id", "authority_policy_version", "trial_id", "run_id",
    "reservation_ref", "reservation_hash", "request_schema_version", "request_hash", "entry_order_hash",
    "dataset_manifest_ref", "dataset_hash", "aggregate_trade_evidence_admission_ref",
    "aggregate_trade_evidence_admission_hash", "cross_source_ordering_admission_ref",
    "cross_source_ordering_admission_hash", "bar_link_attestation_id", "bar_link_attestation_hash",
    "bar_link_schema_version", "bar_link_policy_version", "venue_id", "symbol", "timeframe",
    "window_start_inclusive", "window_end_exclusive", "latest_component_available_at",
    "kline_record_hash", "replay_market_bar_hash", "aggregate_trade_coverage_attestation_hash",
    "aggregate_trade_events_hash", "entry_side", "entry_trigger_price", "protective_stop_price",
    "protective_target_price", "consumer_capability", "entry_scope", "path_resolution_authority",
    "path_observation_rule", "path_source_authority", "cross_source_ordering_authority",
    "fill_quantity_authority", "cost_authority", "external_completeness", "runner_compatibility",
    "activation", "limitations", "limitations_hash",
  ], "bar-linked aggregate-trade path authority")
  if (value.schema_version !== REPLAY_BAR_LINKED_AGGREGATE_TRADE_PATH_AUTHORITY_SCHEMA_VERSION) {
    fail("bar-linked aggregate-trade path authority schema_version")
  }
  for (const [field, item] of Object.entries({
    authority_snapshot_id: value.authority_snapshot_id,
    authority_snapshot_ref: value.authority_snapshot_ref,
    authority_id: value.authority_id,
    authority_policy_version: value.authority_policy_version,
    trial_id: value.trial_id,
    run_id: value.run_id,
    reservation_ref: value.reservation_ref,
    dataset_manifest_ref: value.dataset_manifest_ref,
    aggregate_trade_evidence_admission_ref: value.aggregate_trade_evidence_admission_ref,
    cross_source_ordering_admission_ref: value.cross_source_ordering_admission_ref,
    bar_link_attestation_id: value.bar_link_attestation_id,
    symbol: value.symbol,
    timeframe: value.timeframe,
  })) requireText(item, `bar_linked_path_authority.${field}`)
  for (const [field, item] of Object.entries({
    authority_snapshot_hash: value.authority_snapshot_hash,
    reservation_hash: value.reservation_hash,
    request_hash: value.request_hash,
    entry_order_hash: value.entry_order_hash,
    dataset_hash: value.dataset_hash,
    aggregate_trade_evidence_admission_hash: value.aggregate_trade_evidence_admission_hash,
    cross_source_ordering_admission_hash: value.cross_source_ordering_admission_hash,
    bar_link_attestation_hash: value.bar_link_attestation_hash,
    kline_record_hash: value.kline_record_hash,
    replay_market_bar_hash: value.replay_market_bar_hash,
    aggregate_trade_coverage_attestation_hash: value.aggregate_trade_coverage_attestation_hash,
    aggregate_trade_events_hash: value.aggregate_trade_events_hash,
    limitations_hash: value.limitations_hash,
  })) requireHash(item, `bar_linked_path_authority.${field}`)
  for (const [field, item] of Object.entries({
    issued_at: value.issued_at,
    window_start_inclusive: value.window_start_inclusive,
    window_end_exclusive: value.window_end_exclusive,
    latest_component_available_at: value.latest_component_available_at,
  })) requireUtcTimestamp(item, `bar_linked_path_authority.${field}`)
  if (Date.parse(value.window_start_inclusive) >= Date.parse(value.window_end_exclusive)
      || Date.parse(value.latest_component_available_at) < Date.parse(value.window_end_exclusive)
      || Date.parse(value.issued_at) < Date.parse(value.latest_component_available_at)) {
    fail("bar-linked aggregate-trade path authority chronology")
  }
  requirePositiveFinite(value.entry_trigger_price, "bar_linked_path_authority.entry_trigger_price")
  requirePositiveFinite(value.protective_stop_price, "bar_linked_path_authority.protective_stop_price")
  requirePositiveFinite(value.protective_target_price, "bar_linked_path_authority.protective_target_price")
  if ((value.entry_side === "long"
    && !(value.protective_stop_price < value.entry_trigger_price
      && value.entry_trigger_price < value.protective_target_price))
      || (value.entry_side === "short"
        && !(value.protective_target_price < value.entry_trigger_price
          && value.entry_trigger_price < value.protective_stop_price))) {
    fail("bar-linked aggregate-trade path authority entry/protection price order")
  }
  if (value.status !== "authorized"
      || value.request_schema_version !== "trade.rd-replay-execution-request.v38"
      || value.bar_link_schema_version !== "trade.rd-replay-kline-aggregate-trade-bar-link-attestation.v1"
      || value.bar_link_policy_version !== "rd-replay-kline-aggregate-trade-bar-link-v1"
      || value.venue_id !== "binance-usdm"
      || value.consumer_capability !== "bounded_initial_stop_market_same_bar_post_entry_protection_ordering"
      || value.entry_scope !== "initial_stop_market_entry_only"
      || value.path_resolution_authority !== "authorized_for_bound_request_and_bar"
      || value.path_observation_rule !== "strictly_after_entry_trigger_trade"
      || value.path_source_authority !== "ordered_aggregate_trade_prices_within_linked_bar_only"
      || value.cross_source_ordering_authority !== "lineage_only_not_global_sequence"
      || value.fill_quantity_authority !== "none" || value.cost_authority !== "none"
      || value.external_completeness !== "not_verified"
      || value.runner_compatibility !== "not_bound"
      || value.activation !== "forbidden_until_exact_request_runner_consumer") {
    fail("bar-linked aggregate-trade path authority scope escalation")
  }
  if (canonicalReservationJson(value.limitations)
      !== canonicalReservationJson(REPLAY_BAR_LINKED_AGGREGATE_TRADE_PATH_AUTHORITY_LIMITATIONS)) {
    fail("bar-linked aggregate-trade path authority limitation drift")
  }
  const expectedLimitationsHash = createHash("sha256")
    .update(canonicalReservationJson(value.limitations), "utf8").digest("hex")
  if (value.limitations_hash !== expectedLimitationsHash) {
    fail("bar-linked aggregate-trade path authority limitations hash mismatch")
  }
  const { authority_snapshot_hash: authorityHash, ...body } = value
  const expected = createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")
  if (authorityHash !== expected) fail("bar-linked aggregate-trade path authority hash mismatch")
}

export function createReplayDecisionObservationBundleAdmissionSnapshot(
  body: ReplayDecisionObservationBundleAdmissionBody,
): ReplayDecisionObservationBundleAdmissionSnapshot {
  const value: ReplayDecisionObservationBundleAdmissionSnapshot = {
    ...body,
    admission_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplayDecisionObservationBundleAdmissionSnapshot(value)
  return value
}

export function assertReplayDecisionObservationBundleAdmissionSnapshot(
  value: ReplayDecisionObservationBundleAdmissionSnapshot,
): void {
  if (value.schema_version !== REPLAY_DECISION_OBSERVATION_BUNDLE_ADMISSION_SCHEMA_VERSION) {
    fail("decision observation bundle admission schema_version")
  }
  for (const [field, item] of Object.entries({
    admission_id: value.admission_id,
    admission_ref: value.admission_ref,
    authority_id: value.authority_id,
    admission_policy_version: value.admission_policy_version,
    trial_id: value.trial_id,
    run_id: value.run_id,
    reservation_ref: value.reservation_ref,
    dataset_manifest_ref: value.dataset_manifest_ref,
    ordering_admission_ref: value.ordering_admission_ref,
    wire_manifest_id: value.wire_manifest_id,
    bundle_id: value.bundle_id,
    binding_set_id: value.binding_set_id,
  })) requireText(item, `decision_observation_bundle_admission.${field}`)
  for (const [field, item] of Object.entries({
    admission_hash: value.admission_hash,
    reservation_hash: value.reservation_hash,
    request_hash: value.request_hash,
    dataset_hash: value.dataset_hash,
    ordering_admission_hash: value.ordering_admission_hash,
    wire_manifest_hash: value.wire_manifest_hash,
    decision_schedule_hash: value.decision_schedule_hash,
    bundle_hash: value.bundle_hash,
    binding_set_hash: value.binding_set_hash,
    projections_hash: value.projections_hash,
    observation_values_hashes_hash: value.observation_values_hashes_hash,
  })) requireHash(item, `decision_observation_bundle_admission.${field}`)
  requireUtcTimestamp(value.issued_at, "decision_observation_bundle_admission.issued_at")
  requireUtcTimestamp(value.first_as_of_time, "decision_observation_bundle_admission.first_as_of_time")
  requireUtcTimestamp(value.last_as_of_time, "decision_observation_bundle_admission.last_as_of_time")
  if (Date.parse(value.first_as_of_time) > Date.parse(value.last_as_of_time)) {
    fail("decision observation bundle admission observation window")
  }
  if (!Number.isSafeInteger(value.decision_schedule_entry_count)
      || value.decision_schedule_entry_count < 1
      || !Number.isSafeInteger(value.projection_count)
      || value.projection_count !== value.decision_schedule_entry_count) {
    fail("decision observation bundle admission cardinality")
  }
  if (value.status !== "admitted"
      || value.request_schema_version !== "trade.rd-replay-execution-request.v38"
      || value.wire_policy_version !== "rd-replay-source-event-wire-v2"
      || value.bundle_policy_version !== "rd-replay-source-event-decision-observation-bundle-v1"
      || value.consumer_capability !== "non_economic_decision_observation_audit"
      || value.scope !== "pre_integration_non_economic_observation_audit_only"
      || value.parent_lineage_validation !== "wire_identity_and_schedule_binding_only"
      || value.projection_derivation_compatibility !== "not_certified"
      || value.decision_input_compatibility !== "not_asserted"
      || value.harness_compatibility !== "not_bound"
      || value.harness_invocation !== "forbidden"
      || value.runner_compatibility !== "not_bound"
      || value.decision_authority !== "none"
      || value.signal_authority !== "none"
      || value.order_authority !== "none"
      || value.economic_authority !== "none") {
    fail("decision observation bundle admission cannot authorize execution")
  }
  const { admission_hash: admissionHash, ...body } = value
  const expected = createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")
  if (admissionHash !== expected) fail("decision observation bundle admission hash mismatch")
}

export function createReplayDecisionObservationBundleDerivationAdmissionSnapshot(
  body: ReplayDecisionObservationBundleDerivationAdmissionBody,
): ReplayDecisionObservationBundleDerivationAdmissionSnapshot {
  const value: ReplayDecisionObservationBundleDerivationAdmissionSnapshot = {
    ...body,
    admission_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplayDecisionObservationBundleDerivationAdmissionSnapshot(value)
  return value
}

export function assertReplayDecisionObservationBundleDerivationAdmissionSnapshot(
  value: ReplayDecisionObservationBundleDerivationAdmissionSnapshot,
): void {
  if (value.schema_version !== REPLAY_DECISION_OBSERVATION_BUNDLE_DERIVATION_ADMISSION_SCHEMA_VERSION) {
    fail("decision observation bundle derivation admission schema_version")
  }
  assertExactSnapshotFields(
    value,
    REPLAY_DECISION_OBSERVATION_BUNDLE_DERIVATION_ADMISSION_FIELDS,
    "decision observation bundle derivation admission",
  )
  for (const [field, item] of Object.entries({
    admission_id: value.admission_id,
    admission_ref: value.admission_ref,
    authority_id: value.authority_id,
    admission_policy_version: value.admission_policy_version,
    trial_id: value.trial_id,
    run_id: value.run_id,
    reservation_ref: value.reservation_ref,
    dataset_manifest_ref: value.dataset_manifest_ref,
    bundle_admission_ref: value.bundle_admission_ref,
    wire_manifest_id: value.wire_manifest_id,
    bundle_id: value.bundle_id,
    binding_set_id: value.binding_set_id,
    derivation_attestation_id: value.derivation_attestation_id,
  })) requireText(item, `decision_observation_bundle_derivation_admission.${field}`)
  for (const [field, item] of Object.entries({
    admission_hash: value.admission_hash,
    reservation_hash: value.reservation_hash,
    request_hash: value.request_hash,
    dataset_hash: value.dataset_hash,
    bundle_admission_hash: value.bundle_admission_hash,
    ordering_admission_hash: value.ordering_admission_hash,
    wire_manifest_hash: value.wire_manifest_hash,
    decision_schedule_hash: value.decision_schedule_hash,
    bundle_hash: value.bundle_hash,
    binding_set_hash: value.binding_set_hash,
    derivation_attestation_hash: value.derivation_attestation_hash,
    boundaries_hash: value.boundaries_hash,
  })) requireHash(item, `decision_observation_bundle_derivation_admission.${field}`)
  requireUtcTimestamp(value.issued_at, "decision_observation_bundle_derivation_admission.issued_at")
  requireUtcTimestamp(value.first_decision_time, "decision_observation_bundle_derivation_admission.first_decision_time")
  requireUtcTimestamp(value.last_decision_time, "decision_observation_bundle_derivation_admission.last_decision_time")
  if (Date.parse(value.first_decision_time) > Date.parse(value.last_decision_time)) {
    fail("decision observation bundle derivation admission decision window")
  }
  if (!Number.isSafeInteger(value.boundary_count) || value.boundary_count < 1) {
    fail("decision observation bundle derivation admission boundary_count")
  }
  if (value.status !== "admitted"
      || value.derivation_policy_version !== "rd-replay-source-event-decision-observation-bundle-derivation-v1"
      || value.certification_result !== "certified_against_supplied_parent_chain"
      || value.common_parent_rule !== "one_wire_gate_trace_cursor_for_all_boundaries"
      || value.consumer_capability !== "non_economic_decision_observation_derivation_audit"
      || value.scope !== "pre_integration_non_economic_derivation_admission_only"
      || value.control_plane_validation !== "attestation_schema_hash_and_admitted_bundle_binding"
      || value.control_plane_parent_replay !== "not_performed"
      || value.independent_verification !== "external_parent_replay_required"
      || value.decision_input_compatibility !== "not_asserted"
      || value.harness_compatibility !== "not_bound"
      || value.harness_invocation !== "forbidden"
      || value.runner_compatibility !== "not_bound"
      || value.decision_authority !== "none"
      || value.signal_authority !== "none"
      || value.order_authority !== "none"
      || value.economic_authority !== "none") {
    fail("decision observation bundle derivation admission cannot authorize execution")
  }
  const { admission_hash: admissionHash, ...body } = value
  const expected = createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")
  if (admissionHash !== expected) fail("decision observation bundle derivation admission hash mismatch")
}

export function createReplayReservationCancellationSnapshot(
  body: ReplayReservationCancellationBody,
): ReplayReservationCancellationSnapshot {
  const value: ReplayReservationCancellationSnapshot = {
    ...body,
    cancellation_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplayReservationCancellationSnapshot(value)
  return value
}

export function assertReplayReservationCancellationSnapshot(
  value: ReplayReservationCancellationSnapshot,
): void {
  if (value.schema_version !== REPLAY_RESERVATION_CANCELLATION_SCHEMA_VERSION) fail("reservation cancellation schema_version")
  assertCancellationCommon(value, "reservation_cancellation")
  requireUtcTimestamp(value.effective_at, "reservation_cancellation.effective_at")
  if (Date.parse(value.effective_at) < Date.parse(value.recorded_at)) {
    fail("reservation cancellation cannot be retroactive")
  }
  for (const [field, item] of Object.entries({
    trial_id: value.trial_id,
    run_id: value.run_id,
    reservation_ref: value.reservation_ref,
  })) requireText(item, `reservation_cancellation.${field}`)
  requireHash(value.reservation_hash, "reservation_cancellation.reservation_hash")
  if (value.scope !== "future_attempt_claims") fail("reservation cancellation scope")
  assertCancellationHash(value, "reservation cancellation")
}

export function createReplayAttemptCancellationSnapshot(
  body: ReplayAttemptCancellationBody,
): ReplayAttemptCancellationSnapshot {
  const value: ReplayAttemptCancellationSnapshot = {
    ...body,
    cancellation_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplayAttemptCancellationSnapshot(value)
  return value
}

export function assertReplayAttemptCancellationSnapshot(
  value: ReplayAttemptCancellationSnapshot,
): void {
  if (value.schema_version !== REPLAY_ATTEMPT_CANCELLATION_SCHEMA_VERSION) fail("attempt cancellation schema_version")
  assertCancellationCommon(value, "attempt_cancellation")
  for (const [field, item] of Object.entries({
    trial_id: value.trial_id,
    run_id: value.run_id,
    reservation_ref: value.reservation_ref,
    attempt_id: value.attempt_id,
    worker_id: value.worker_id,
  })) requireText(item, `attempt_cancellation.${field}`)
  for (const [field, item] of Object.entries({
    reservation_hash: value.reservation_hash,
    request_hash: value.request_hash,
  })) requireHash(item, `attempt_cancellation.${field}`)
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1) {
    fail("attempt_cancellation.attempt_ordinal must be positive")
  }
  if (!Number.isSafeInteger(value.target_lease_generation) || value.target_lease_generation < 1) {
    fail("attempt_cancellation.target_lease_generation must be positive")
  }
  if (value.scope !== "active_attempt") fail("attempt cancellation scope")
  assertCancellationHash(value, "attempt cancellation")
}

export function createReplayAttemptCancellationObservationSnapshot(
  body: ReplayAttemptCancellationObservationBody,
): ReplayAttemptCancellationObservationSnapshot {
  const value: ReplayAttemptCancellationObservationSnapshot = {
    ...body,
    observation_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplayAttemptCancellationObservationSnapshot(value)
  return value
}

export function assertReplayAttemptCancellationObservationSnapshot(
  value: ReplayAttemptCancellationObservationSnapshot,
): void {
  if (value.schema_version !== REPLAY_ATTEMPT_CANCELLATION_OBSERVATION_SCHEMA_VERSION) {
    fail("attempt cancellation observation schema_version")
  }
  for (const [field, item] of Object.entries({
    observation_id: value.observation_id,
    observation_ref: value.observation_ref,
    cancellation_id: value.cancellation_id,
    cancellation_ref: value.cancellation_ref,
    trial_id: value.trial_id,
    run_id: value.run_id,
    reservation_ref: value.reservation_ref,
    attempt_id: value.attempt_id,
    worker_id: value.worker_id,
  })) requireText(item, `attempt_cancellation_observation.${field}`)
  for (const [field, item] of Object.entries({
    observation_hash: value.observation_hash,
    cancellation_hash: value.cancellation_hash,
    reservation_hash: value.reservation_hash,
    request_hash: value.request_hash,
  })) requireHash(item, `attempt_cancellation_observation.${field}`)
  requireUtcTimestamp(value.observed_at, "attempt_cancellation_observation.observed_at")
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1) {
    fail("attempt_cancellation_observation.attempt_ordinal must be positive")
  }
  if (!Number.isSafeInteger(value.target_lease_generation) || value.target_lease_generation < 1) {
    fail("attempt_cancellation_observation.target_lease_generation must be positive")
  }
  if (value.status !== "observed"
      || value.outcome_schema_version !== "trade.rd-replay-run-outcome.v35"
      || value.outcome_status !== "cancelled"
      || value.outcome_failure_code !== "execution-cancelled-at-checkpoint"
      || value.partial_result_published !== false) {
    fail("attempt cancellation observation outcome is not authoritative cancellation acknowledgement")
  }
  const { observation_hash: observationHash, ...body } = value
  const expected = createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")
  if (observationHash !== expected) fail("attempt cancellation observation hash mismatch")
}

export function hashTrialReservationSnapshot(value: TrialReservationSnapshot): string {
  assertTrialReservationSnapshot(value)
  return createHash("sha256").update(canonicalReservationJson(value), "utf8").digest("hex")
}

export function assertReplayAttemptLeaseSnapshot(value: ReplayAttemptLeaseSnapshot): void {
  if (value.schema_version !== REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION) fail("attempt lease schema_version")
  requireText(value.attempt_id, "attempt.attempt_id")
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1) fail("attempt.attempt_ordinal must be positive")
  requireText(value.worker_id, "attempt.worker_id")
  requireText(value.trial_id, "attempt.trial_id")
  requireText(value.run_id, "attempt.run_id")
  requireText(value.reservation_ref, "attempt.reservation_ref")
  requireHash(value.reservation_hash, "attempt.reservation_hash")
  requireHash(value.request_hash, "attempt.request_hash")
  if (value.status !== "claimed" && value.status !== "running") fail("attempt status must be claimed or running")
  if (!Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) fail("attempt.lease_generation must be positive")
  requireUtcTimestamp(value.claimed_at, "attempt.claimed_at")
  requireUtcTimestamp(value.heartbeat_at, "attempt.heartbeat_at")
  requireUtcTimestamp(value.lease_expires_at, "attempt.lease_expires_at")
  const claimed = Date.parse(value.claimed_at)
  const heartbeat = Date.parse(value.heartbeat_at)
  const expires = Date.parse(value.lease_expires_at)
  if (heartbeat < claimed || expires <= heartbeat) fail("attempt lease timestamps must satisfy claimed_at <= heartbeat_at < lease_expires_at")
}

export function hashReplayAttemptLeaseSnapshot(value: ReplayAttemptLeaseSnapshot): string {
  assertReplayAttemptLeaseSnapshot(value)
  return createHash("sha256").update(canonicalReservationJson(value), "utf8").digest("hex")
}

export function replaySuccessorVerificationLeaseRenewalRequestKey(input: {
  source_successor_authority_contract_hash: string
  attempt_id: string
  worker_id: string
  expected_current_lease_generation: number
  request_policy_version:
    typeof REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_REQUEST_POLICY_VERSION
}): string {
  requireHash(input.source_successor_authority_contract_hash,
    "successor_verification_lease_renewal_request_key.source_contract_hash")
  requireText(input.attempt_id, "successor_verification_lease_renewal_request_key.attempt_id")
  requireText(input.worker_id, "successor_verification_lease_renewal_request_key.worker_id")
  if (!Number.isSafeInteger(input.expected_current_lease_generation)
      || input.expected_current_lease_generation < 1
      || input.request_policy_version
        !== REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_REQUEST_POLICY_VERSION) {
    fail("successor verification Lease renewal Request key")
  }
  return createHash("sha256").update(canonicalReservationJson(input), "utf8").digest("hex")
}

export function createReplaySuccessorVerificationLeaseRenewalRequest(
  body: ReplaySuccessorVerificationLeaseRenewalRequestBody,
): ReplaySuccessorVerificationLeaseRenewalRequest {
  const value = {
    ...structuredClone(body),
    request_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplaySuccessorVerificationLeaseRenewalRequest(value)
  return value
}

export function assertReplaySuccessorVerificationLeaseRenewalRequest(
  value: ReplaySuccessorVerificationLeaseRenewalRequest,
): void {
  assertExactSnapshotFields(value, REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_REQUEST_FIELDS,
    "successor verification Lease renewal Request")
  if (value.schema_version !== REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_REQUEST_SCHEMA_VERSION
      || value.request_policy_version
        !== REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_REQUEST_POLICY_VERSION
      || value.status !== "successor_verification_lease_renewal_requested"
      || value.requester_owner !== "replay_runner" || value.authority_target !== "research_control_plane"
      || value.purpose !== "second_reproducibility_member_same_attempt_successor_generation"
      || value.source_evidence_role
        !== "opaque_replay_hash_binding_control_plane_does_not_revalidate_replay_lineage"
      || value.request_authority !== "none_control_plane_must_atomically_admit_or_reject"
      || value.process_authority !== "none" || value.harness_authority !== "none"
      || value.economic_authority !== "none") {
    fail("successor verification Lease renewal Request policy or authority")
  }
  for (const [field, item] of Object.entries({
    request_id: value.request_id, request_ref: value.request_ref, logical_request_id: value.logical_request_id,
    attempt_id: value.attempt_id, worker_id: value.worker_id,
  })) requireText(item, `successor_verification_lease_renewal_request.${field}`)
  for (const [field, item] of Object.entries({
    request_key: value.request_key, request_hash: value.request_hash,
    source_successor_authority_contract_hash: value.source_successor_authority_contract_hash,
    source_reproducibility_pair_contract_hash: value.source_reproducibility_pair_contract_hash,
    source_first_schedule_admission_hash: value.source_first_schedule_admission_hash,
    source_first_execution_envelope_hash: value.source_first_execution_envelope_hash,
    worker_request_hash: value.worker_request_hash,
    replay_execution_request_hash: value.replay_execution_request_hash,
    expected_current_attempt_lease_hash: value.expected_current_attempt_lease_hash,
  })) requireHash(item, `successor_verification_lease_renewal_request.${field}`)
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.expected_current_lease_generation)
      || value.expected_current_lease_generation < 1
      || value.minimum_successor_lease_generation !== value.expected_current_lease_generation + 1) {
    fail("successor verification Lease renewal Request ordinal or generation")
  }
  requireUtcTimestamp(value.requested_lease_expires_at,
    "successor_verification_lease_renewal_request.requested_lease_expires_at")
  const key = replaySuccessorVerificationLeaseRenewalRequestKey({
    source_successor_authority_contract_hash: value.source_successor_authority_contract_hash,
    attempt_id: value.attempt_id,
    worker_id: value.worker_id,
    expected_current_lease_generation: value.expected_current_lease_generation,
    request_policy_version: REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_REQUEST_POLICY_VERSION,
  })
  if (value.request_key !== key
      || value.request_id !== `replay-successor-verification-lease-renewal-${key.slice(0, 24)}`
      || value.request_ref !== `request://replay-successor-verification-lease-renewal/${key.slice(0, 24)}`) {
    fail("successor verification Lease renewal Request identity")
  }
  const { request_hash: requestHash, ...body } = value
  const expected = createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")
  if (requestHash !== expected) fail("successor verification Lease renewal Request hash mismatch")
}

export function replaySuccessorVerificationLeaseRenewalReceiptIdentityHash(input: {
  source_request_hash: string
  predecessor_attempt_lease_hash: string
  successor_attempt_lease_hash: string
  receipt_policy_version:
    typeof REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_RECEIPT_POLICY_VERSION
}): string {
  requireHash(input.source_request_hash, "successor_verification_lease_renewal_receipt.request_hash")
  requireHash(input.predecessor_attempt_lease_hash,
    "successor_verification_lease_renewal_receipt.predecessor_lease_hash")
  requireHash(input.successor_attempt_lease_hash,
    "successor_verification_lease_renewal_receipt.successor_lease_hash")
  if (input.receipt_policy_version
      !== REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_RECEIPT_POLICY_VERSION) {
    fail("successor verification Lease renewal Receipt policy")
  }
  return createHash("sha256").update(canonicalReservationJson(input), "utf8").digest("hex")
}

export function createReplaySuccessorVerificationLeaseRenewalReceipt(
  body: ReplaySuccessorVerificationLeaseRenewalReceiptBody,
): ReplaySuccessorVerificationLeaseRenewalReceipt {
  const value = {
    ...structuredClone(body),
    receipt_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplaySuccessorVerificationLeaseRenewalReceipt(value)
  return value
}

export function assertReplaySuccessorVerificationLeaseRenewalReceipt(
  value: ReplaySuccessorVerificationLeaseRenewalReceipt,
): void {
  assertExactSnapshotFields(value, REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_RECEIPT_FIELDS,
    "successor verification Lease renewal Receipt")
  if (value.schema_version !== REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_RECEIPT_SCHEMA_VERSION
      || value.receipt_policy_version
        !== REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_RECEIPT_POLICY_VERSION
      || value.status !== "successor_verification_lease_renewed"
      || value.authority_owner !== "research_control_plane"
      || value.authority_source !== "research_control_plane_state_store"
      || value.registry_table !== "rd_replay_successor_verification_lease_renewal"
      || value.registry_row_immutability !== "sqlite_update_and_delete_triggers"
      || value.source_evidence_validation !== "opaque_hash_binding_only_replay_lineage_not_revalidated"
      || value.renewal_transaction
        !== "single_control_plane_transaction_exact_predecessor_fencing_update_and_receipt_insert"
      || value.clock_source !== "control_plane_authority_process_clock_port"
      || value.clock_independence !== "authority_internal_sampling_without_caller_heartbeat_time"
      || value.caller_heartbeat_time_input !== "forbidden"
      || value.external_time_attestation !== "not_provided"
      || value.generation_relation !== "successor_equals_predecessor_plus_one"
      || value.immutable_attempt_binding
        !== "attempt_ordinal_worker_trial_run_reservation_request_and_claimed_at_exactly_equal"
      || value.requested_expiry_relation
        !== "successor_expiry_equals_control_plane_admitted_request_expiry"
      || value.successor_authority !== "lease_generation_only_fresh_execution_lineage_still_required"
      || value.process_authority !== "none" || value.harness_authority !== "none"
      || value.decision_output_authority !== "none" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.trial_authority !== "none") {
    fail("successor verification Lease renewal Receipt policy or authority")
  }
  for (const [field, item] of Object.entries({
    receipt_id: value.receipt_id, receipt_ref: value.receipt_ref,
    source_request_id: value.source_request_id, source_request_ref: value.source_request_ref,
  })) requireText(item, `successor_verification_lease_renewal_receipt.${field}`)
  for (const [field, item] of Object.entries({
    receipt_hash: value.receipt_hash, source_request_hash: value.source_request_hash,
    predecessor_attempt_lease_hash: value.predecessor_attempt_lease_hash,
    successor_attempt_lease_hash: value.successor_attempt_lease_hash,
  })) requireHash(item, `successor_verification_lease_renewal_receipt.${field}`)
  requireUtcTimestamp(value.renewed_at, "successor_verification_lease_renewal_receipt.renewed_at")
  assertReplaySuccessorVerificationLeaseRenewalRequest(value.source_request)
  assertReplayAttemptLeaseSnapshot(value.predecessor_attempt_lease)
  assertReplayAttemptLeaseSnapshot(value.successor_attempt_lease)
  const request = value.source_request
  const predecessor = value.predecessor_attempt_lease
  const successor = value.successor_attempt_lease
  if (value.source_request_id !== request.request_id || value.source_request_ref !== request.request_ref
      || value.source_request_hash !== request.request_hash
      || value.predecessor_attempt_lease_hash !== hashReplayAttemptLeaseSnapshot(predecessor)
      || value.successor_attempt_lease_hash !== hashReplayAttemptLeaseSnapshot(successor)
      || request.attempt_id !== predecessor.attempt_id || request.attempt_ordinal !== predecessor.attempt_ordinal
      || request.worker_id !== predecessor.worker_id
      || request.expected_current_lease_generation !== predecessor.lease_generation
      || request.expected_current_attempt_lease_hash !== value.predecessor_attempt_lease_hash
      || request.minimum_successor_lease_generation !== successor.lease_generation
      || successor.lease_generation !== predecessor.lease_generation + 1
      || successor.status !== "running" || successor.heartbeat_at !== value.renewed_at
      || successor.lease_expires_at !== request.requested_lease_expires_at
      || successor.attempt_id !== predecessor.attempt_id
      || successor.attempt_ordinal !== predecessor.attempt_ordinal
      || successor.worker_id !== predecessor.worker_id || successor.trial_id !== predecessor.trial_id
      || successor.run_id !== predecessor.run_id || successor.reservation_ref !== predecessor.reservation_ref
      || successor.reservation_hash !== predecessor.reservation_hash
      || successor.request_hash !== predecessor.request_hash || successor.claimed_at !== predecessor.claimed_at) {
    fail("successor verification Lease renewal Receipt lineage or fencing mismatch")
  }
  const renewedAt = Date.parse(value.renewed_at)
  if (renewedAt < Date.parse(predecessor.heartbeat_at)
      || renewedAt >= Date.parse(predecessor.lease_expires_at)
      || Date.parse(successor.lease_expires_at) <= Date.parse(predecessor.lease_expires_at)) {
    fail("successor verification Lease renewal Receipt chronology")
  }
  const identity = replaySuccessorVerificationLeaseRenewalReceiptIdentityHash({
    source_request_hash: request.request_hash,
    predecessor_attempt_lease_hash: value.predecessor_attempt_lease_hash,
    successor_attempt_lease_hash: value.successor_attempt_lease_hash,
    receipt_policy_version: REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_RECEIPT_POLICY_VERSION,
  })
  if (value.receipt_id !== `replay-successor-verification-lease-renewal-receipt-${identity.slice(0, 24)}`
      || value.receipt_ref
        !== `receipt://replay-successor-verification-lease-renewal/${identity.slice(0, 24)}`) {
    fail("successor verification Lease renewal Receipt identity")
  }
  const { receipt_hash: receiptHash, ...body } = value
  const expected = createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")
  if (receiptHash !== expected) fail("successor verification Lease renewal Receipt hash mismatch")
}

const REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_REQUEST_FIELDS = [
  "attempt_id", "attempt_ordinal", "authority_target", "economic_authority",
  "expected_current_attempt_lease_hash", "expected_current_lease_generation", "harness_authority",
  "logical_request_id", "minimum_successor_lease_generation", "process_authority", "purpose",
  "replay_execution_request_hash", "request_authority", "request_hash", "request_id", "request_key",
  "request_policy_version", "request_ref", "requested_lease_expires_at", "requester_owner", "schema_version",
  "source_evidence_role", "source_first_execution_envelope_hash", "source_first_schedule_admission_hash",
  "source_reproducibility_pair_contract_hash", "source_successor_authority_contract_hash", "status",
  "worker_id", "worker_request_hash",
].sort()

const REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_RECEIPT_FIELDS = [
  "authority_owner", "authority_source", "caller_heartbeat_time_input", "clock_independence", "clock_source",
  "decision_output_authority", "economic_authority", "external_time_attestation", "generation_relation",
  "harness_authority", "immutable_attempt_binding", "order_authority", "predecessor_attempt_lease",
  "predecessor_attempt_lease_hash", "process_authority", "receipt_hash", "receipt_id", "receipt_policy_version",
  "receipt_ref", "registry_row_immutability", "registry_table", "renewal_transaction", "renewed_at",
  "requested_expiry_relation", "schema_version", "signal_authority", "source_evidence_validation",
  "source_request", "source_request_hash", "source_request_id", "source_request_ref", "status",
  "successor_attempt_lease", "successor_attempt_lease_hash", "successor_authority", "trial_authority",
].sort()

export function createReplayAttemptLeaseObservationSnapshot(
  body: ReplayAttemptLeaseObservationBody,
): ReplayAttemptLeaseObservationSnapshot {
  const value: ReplayAttemptLeaseObservationSnapshot = {
    ...structuredClone(body),
    observation_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplayAttemptLeaseObservationSnapshot(value)
  return value
}

export function assertReplayAttemptLeaseObservationSnapshot(
  value: ReplayAttemptLeaseObservationSnapshot,
): void {
  if (value.schema_version !== REPLAY_ATTEMPT_LEASE_OBSERVATION_SCHEMA_VERSION
      || value.observation_policy_version !== REPLAY_ATTEMPT_LEASE_OBSERVATION_POLICY_VERSION
      || value.status !== "active_lease_observed"
      || value.authority_owner !== "research_control_plane"
      || value.authority_source !== "research_control_plane_state_store"
      || value.read_consistency !== "single_control_plane_transaction"
      || value.clock_evidence !== "caller_supplied_utc_not_external_time_attestation") {
    fail("attempt lease observation policy or authority")
  }
  for (const [field, item] of Object.entries({
    observation_id: value.observation_id,
    observation_ref: value.observation_ref,
    trial_id: value.trial_id,
    run_id: value.run_id,
    attempt_id: value.attempt_id,
    worker_id: value.worker_id,
  })) requireText(item, `attempt_lease_observation.${field}`)
  requireHash(value.observation_hash, "attempt_lease_observation.observation_hash")
  requireHash(value.attempt_lease_hash, "attempt_lease_observation.attempt_lease_hash")
  requireUtcTimestamp(value.observed_at, "attempt_lease_observation.observed_at")
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) {
    fail("attempt lease observation ordinal and generation must be positive")
  }
  assertReplayAttemptLeaseSnapshot(value.attempt_lease)
  const lease = value.attempt_lease
  if (value.attempt_lease_hash !== hashReplayAttemptLeaseSnapshot(lease)
      || value.trial_id !== lease.trial_id || value.run_id !== lease.run_id
      || value.attempt_id !== lease.attempt_id || value.attempt_ordinal !== lease.attempt_ordinal
      || value.worker_id !== lease.worker_id || value.lease_generation !== lease.lease_generation) {
    fail("attempt lease observation does not bind its Lease")
  }
  const observed = Date.parse(value.observed_at)
  if (observed < Date.parse(lease.heartbeat_at) || observed >= Date.parse(lease.lease_expires_at)) {
    fail("attempt lease observation must satisfy heartbeat_at <= observed_at < lease_expires_at")
  }
  const { observation_hash: observationHash, ...body } = value
  const expected = createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")
  if (observationHash !== expected) fail("attempt lease observation hash mismatch")
}

export function createReplayAttemptLeaseObservationRegistryReadReceipt(
  body: ReplayAttemptLeaseObservationRegistryReadReceiptBody,
): ReplayAttemptLeaseObservationRegistryReadReceipt {
  const value = {
    ...structuredClone(body),
    receipt_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplayAttemptLeaseObservationRegistryReadReceipt(value)
  return value
}

export function assertReplayAttemptLeaseObservationRegistryReadReceipt(
  value: ReplayAttemptLeaseObservationRegistryReadReceipt,
): void {
  if (value.schema_version !== REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_SCHEMA_VERSION
      || value.receipt_policy_version
        !== REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_POLICY_VERSION
      || value.status !== "registered_active_lease_observation_read"
      || value.authority_owner !== "research_control_plane"
      || value.authority_source !== "research_control_plane_state_store"
      || value.registry_table !== "rd_replay_attempt_lease_observation"
      || value.registry_row_immutability !== "sqlite_update_and_delete_triggers"
      || value.read_consistency !== "single_control_plane_transaction"
      || value.registry_read_provenance !== "registered_row_and_current_attempt_exact_match"
      || value.clock_evidence !== "caller_supplied_utc_not_external_time_attestation"
      || value.external_time_attestation !== "not_provided") {
    fail("attempt lease observation registry read receipt policy or authority")
  }
  for (const [field, item] of Object.entries({
    receipt_id: value.receipt_id,
    receipt_ref: value.receipt_ref,
    registry_key: value.registry_key,
    source_observation_id: value.source_observation_id,
    source_observation_ref: value.source_observation_ref,
  })) requireText(item, `attempt_lease_observation_registry_read_receipt.${field}`)
  for (const [field, item] of Object.entries({
    receipt_hash: value.receipt_hash,
    source_observation_hash: value.source_observation_hash,
    current_attempt_lease_hash: value.current_attempt_lease_hash,
  })) requireHash(item, `attempt_lease_observation_registry_read_receipt.${field}`)
  requireUtcTimestamp(value.registered_at, "attempt_lease_observation_registry_read_receipt.registered_at")
  requireUtcTimestamp(value.read_at, "attempt_lease_observation_registry_read_receipt.read_at")
  assertReplayAttemptLeaseObservationSnapshot(value.source_observation)
  assertReplayAttemptLeaseSnapshot(value.current_attempt_lease)
  const observation = value.source_observation
  const lease = value.current_attempt_lease
  if (value.registry_key !== observation.observation_id
      || value.source_observation_id !== observation.observation_id
      || value.source_observation_ref !== observation.observation_ref
      || value.source_observation_hash !== observation.observation_hash
      || value.current_attempt_status !== lease.status
      || value.current_attempt_lease_hash !== hashReplayAttemptLeaseSnapshot(lease)
      || value.current_attempt_lease_hash !== observation.attempt_lease_hash
      || canonicalReservationJson(lease) !== canonicalReservationJson(observation.attempt_lease)) {
    fail("attempt lease observation registry read receipt source or current Lease mismatch")
  }
  const registeredAt = Date.parse(value.registered_at)
  const readAt = Date.parse(value.read_at)
  if (registeredAt < Date.parse(observation.observed_at)
      || readAt < registeredAt || readAt >= Date.parse(lease.lease_expires_at)) {
    fail("attempt lease observation registry read receipt chronology")
  }
  const discriminator = `${observation.observation_hash.slice(0, 16)}-${readAt}`
  if (value.receipt_id !== `replay-attempt-lease-observation-registry-read-${discriminator}`
      || value.receipt_ref !== `receipt://replay-attempt-lease-observation-registry-read/${discriminator}`) {
    fail("attempt lease observation registry read receipt identity")
  }
  const { receipt_hash: receiptHash, ...body } = value
  const expected = createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")
  if (receiptHash !== expected) fail("attempt lease observation registry read receipt hash mismatch")
}

export function createReplayDispatchClockAttestation(
  body: ReplayDispatchClockAttestationBody,
): ReplayDispatchClockAttestation {
  const value = {
    ...structuredClone(body),
    attestation_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplayDispatchClockAttestation(value)
  return value
}

export function assertReplayDispatchClockAttestation(value: ReplayDispatchClockAttestation): void {
  if (value.schema_version !== REPLAY_DISPATCH_CLOCK_ATTESTATION_SCHEMA_VERSION
      || value.attestation_policy_version !== REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION
      || value.status !== "authority_clock_bracketed_registry_read"
      || value.authority_owner !== "research_control_plane"
      || value.authority_source !== "research_control_plane_state_store"
      || value.clock_source !== "control_plane_authority_process_clock_port"
      || value.clock_independence !== "authority_internal_sampling_without_caller_timestamp_input"
      || value.caller_time_input !== "forbidden"
      || value.wall_clock_source !== "javascript_date_now_utc"
      || value.monotonic_clock_source !== "process_hrtime_bigint"
      || value.external_time_attestation !== "not_provided"
      || value.registry_read_bracketing
        !== "wall_and_monotonic_samples_before_and_after_single_transaction_read") {
    fail("dispatch clock attestation policy or authority")
  }
  for (const [field, item] of Object.entries({
    attestation_id: value.attestation_id,
    attestation_ref: value.attestation_ref,
    source_registry_read_receipt_id: value.source_registry_read_receipt_id,
    source_registry_read_receipt_ref: value.source_registry_read_receipt_ref,
    attempt_id: value.attempt_id,
    worker_id: value.worker_id,
  })) requireText(item, `dispatch_clock_attestation.${field}`)
  for (const [field, item] of Object.entries({
    attestation_hash: value.attestation_hash,
    source_registry_read_receipt_hash: value.source_registry_read_receipt_hash,
    current_attempt_lease_hash: value.current_attempt_lease_hash,
  })) requireHash(item, `dispatch_clock_attestation.${field}`)
  requireUtcTimestamp(value.registry_read_started_at, "dispatch_clock_attestation.registry_read_started_at")
  requireUtcTimestamp(value.registry_read_completed_at, "dispatch_clock_attestation.registry_read_completed_at")
  if (!/^\d+$/.test(value.registry_read_started_monotonic_ns)
      || !/^\d+$/.test(value.registry_read_completed_monotonic_ns)
      || BigInt(value.registry_read_completed_monotonic_ns) <= BigInt(value.registry_read_started_monotonic_ns)) {
    fail("dispatch clock attestation monotonic bracket")
  }
  if (!Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) {
    fail("dispatch clock attestation lease generation")
  }
  assertReplayAttemptLeaseObservationRegistryReadReceipt(value.source_registry_read_receipt)
  const receipt = value.source_registry_read_receipt
  const lease = receipt.current_attempt_lease
  if (value.source_registry_read_receipt_id !== receipt.receipt_id
      || value.source_registry_read_receipt_ref !== receipt.receipt_ref
      || value.source_registry_read_receipt_hash !== receipt.receipt_hash
      || value.attempt_id !== lease.attempt_id || value.worker_id !== lease.worker_id
      || value.lease_generation !== lease.lease_generation
      || value.current_attempt_lease_hash !== receipt.current_attempt_lease_hash
      || value.registry_read_started_at !== receipt.read_at
      || Date.parse(value.registry_read_completed_at) < Date.parse(value.registry_read_started_at)
      || Date.parse(value.registry_read_completed_at) >= Date.parse(lease.lease_expires_at)) {
    fail("dispatch clock attestation receipt or chronology mismatch")
  }
  const identityHash = replayDispatchClockAttestationIdentityHash({
    source_registry_read_receipt_hash: receipt.receipt_hash,
    registry_read_started_at: value.registry_read_started_at,
    registry_read_completed_at: value.registry_read_completed_at,
    registry_read_started_monotonic_ns: value.registry_read_started_monotonic_ns,
    registry_read_completed_monotonic_ns: value.registry_read_completed_monotonic_ns,
    attestation_policy_version: value.attestation_policy_version,
  })
  if (value.attestation_id !== `replay-dispatch-clock-attestation-${identityHash.slice(0, 24)}`
      || value.attestation_ref !== `attestation://replay-dispatch-clock/${identityHash.slice(0, 24)}`) {
    fail("dispatch clock attestation identity")
  }
  const { attestation_hash: attestationHash, ...body } = value
  const expected = createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")
  if (attestationHash !== expected) fail("dispatch clock attestation hash mismatch")
}

export function createReplaySpawnBoundaryRevalidationRequest(
  body: ReplaySpawnBoundaryRevalidationRequestBody,
): ReplaySpawnBoundaryRevalidationRequest {
  const value = {
    ...structuredClone(body),
    request_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplaySpawnBoundaryRevalidationRequest(value)
  return value
}

export function assertReplaySpawnBoundaryRevalidationRequest(
  value: ReplaySpawnBoundaryRevalidationRequest,
): void {
  assertExactFields(value, REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_FIELDS,
    "spawn boundary revalidation request")
  if (value.schema_version !== REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_SCHEMA_VERSION
      || value.request_policy_version !== REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_POLICY_VERSION
      || value.status !== "capsule_bound_current_attempt_revalidation_requested"
      || value.requester_owner !== "replay_runner"
      || value.authority_target !== "research_control_plane"
      || value.purpose !== "revalidate_exact_current_attempt_after_capsule_commit_before_spawn"
      || value.challenge_policy !== "one_capsule_bound_challenge_no_caller_time_or_state_substitution"
      || value.retry_policy
        !== "fresh_command_intent_capsule_authority_lineage_required_after_failed_or_stale_challenge"
      || value.process_authority !== "none") {
    fail("spawn boundary revalidation request policy or authority")
  }
  for (const [field, item] of Object.entries({
    request_id: value.request_id, request_ref: value.request_ref,
    attempt_id: value.attempt_id, worker_id: value.worker_id,
  })) requireText(item, `spawn_boundary_revalidation_request.${field}`)
  for (const [field, item] of Object.entries({
    request_key: value.request_key, request_hash: value.request_hash,
    source_authority_capsule_record_hash: value.source_authority_capsule_record_hash,
    authority_capsule_hash: value.authority_capsule_hash,
    source_authority_process_launch_intent_hash: value.source_authority_process_launch_intent_hash,
    source_authority_execution_admission_command_hash:
      value.source_authority_execution_admission_command_hash,
    source_authority_transport_contract_hash: value.source_authority_transport_contract_hash,
    process_artifact_hash: value.process_artifact_hash, worker_request_hash: value.worker_request_hash,
    expected_current_attempt_lease_hash: value.expected_current_attempt_lease_hash,
  })) requireHash(item, `spawn_boundary_revalidation_request.${field}`)
  requireUtcTimestamp(value.expected_valid_before, "spawn_boundary_revalidation_request.expected_valid_before")
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) {
    fail("spawn boundary revalidation request Attempt binding")
  }
  const expectedKey = replaySpawnBoundaryRevalidationRequestKey({
    source_authority_capsule_record_hash: value.source_authority_capsule_record_hash,
    attempt_id: value.attempt_id,
    worker_id: value.worker_id,
    lease_generation: value.lease_generation,
    request_policy_version: value.request_policy_version,
  })
  if (value.request_key !== expectedKey
      || value.request_id !== `replay-spawn-boundary-revalidation-request-${expectedKey.slice(0, 24)}`
      || value.request_ref !== `request://replay-spawn-boundary-revalidation/${expectedKey.slice(0, 24)}`) {
    fail("spawn boundary revalidation request identity")
  }
  const { request_hash: requestHash, ...body } = value
  const expected = createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")
  if (requestHash !== expected) fail("spawn boundary revalidation request hash mismatch")
}

export function createReplaySpawnBoundaryRevalidationReceipt(
  body: ReplaySpawnBoundaryRevalidationReceiptBody,
): ReplaySpawnBoundaryRevalidationReceipt {
  const value = {
    ...structuredClone(body),
    receipt_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplaySpawnBoundaryRevalidationReceipt(value)
  return value
}

export function assertReplaySpawnBoundaryRevalidationReceipt(
  value: ReplaySpawnBoundaryRevalidationReceipt,
): void {
  assertExactFields(value, REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_FIELDS,
    "spawn boundary revalidation receipt")
  if (value.schema_version !== REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_SCHEMA_VERSION
      || value.receipt_policy_version !== REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_POLICY_VERSION
      || value.status !== "capsule_bound_current_attempt_revalidated"
      || value.authority_owner !== "research_control_plane"
      || value.authority_source !== "research_control_plane_state_store"
      || value.clock_source !== "control_plane_authority_process_clock_port"
      || value.clock_independence !== "authority_internal_sampling_without_caller_timestamp_input"
      || value.caller_time_input !== "forbidden"
      || value.wall_clock_source !== "javascript_date_now_utc"
      || value.monotonic_clock_source !== "process_hrtime_bigint"
      || value.external_time_attestation !== "not_provided"
      || value.current_attempt_read
        !== "single_control_plane_transaction_exact_attempt_worker_generation_and_lease_hash"
      || value.spawn_candidate_authority !== "single_immediate_spawn_candidate_not_process_start_evidence"
      || value.race_limit
        !== "receipt_cannot_prove_absence_of_cancellation_or_fencing_after_completed_read"
      || value.process_authority !== "none") {
    fail("spawn boundary revalidation receipt policy or authority")
  }
  for (const [field, item] of Object.entries({
    receipt_id: value.receipt_id, receipt_ref: value.receipt_ref,
    source_request_id: value.source_request_id, source_request_ref: value.source_request_ref,
  })) requireText(item, `spawn_boundary_revalidation_receipt.${field}`)
  for (const [field, item] of Object.entries({
    receipt_hash: value.receipt_hash, source_request_hash: value.source_request_hash,
    current_attempt_lease_hash: value.current_attempt_lease_hash,
  })) requireHash(item, `spawn_boundary_revalidation_receipt.${field}`)
  for (const [field, item] of Object.entries({
    registry_read_started_at: value.registry_read_started_at,
    registry_read_completed_at: value.registry_read_completed_at,
    revalidated_at: value.revalidated_at, valid_before: value.valid_before,
  })) requireUtcTimestamp(item, `spawn_boundary_revalidation_receipt.${field}`)
  if (!/^\d+$/.test(value.registry_read_started_monotonic_ns)
      || !/^\d+$/.test(value.registry_read_completed_monotonic_ns)
      || BigInt(value.registry_read_completed_monotonic_ns)
        <= BigInt(value.registry_read_started_monotonic_ns)) {
    fail("spawn boundary revalidation receipt monotonic bracket")
  }
  assertReplaySpawnBoundaryRevalidationRequest(value.source_request)
  assertReplayAttemptLeaseSnapshot(value.current_attempt_lease)
  const request = value.source_request
  const lease = value.current_attempt_lease
  if (value.source_request_id !== request.request_id || value.source_request_ref !== request.request_ref
      || value.source_request_hash !== request.request_hash
      || value.current_attempt_status !== lease.status
      || value.current_attempt_lease_hash !== hashReplayAttemptLeaseSnapshot(lease)
      || value.current_attempt_lease_hash !== request.expected_current_attempt_lease_hash
      || lease.attempt_id !== request.attempt_id || lease.attempt_ordinal !== request.attempt_ordinal
      || lease.worker_id !== request.worker_id || lease.lease_generation !== request.lease_generation
      || Date.parse(value.registry_read_completed_at) < Date.parse(value.registry_read_started_at)
      || value.revalidated_at !== value.registry_read_completed_at
      || value.valid_before !== lease.lease_expires_at
      || value.valid_before !== request.expected_valid_before
      || Date.parse(value.registry_read_completed_at) >= Date.parse(value.valid_before)) {
    fail("spawn boundary revalidation receipt request, Lease, or chronology mismatch")
  }
  const identityHash = replaySpawnBoundaryRevalidationReceiptIdentityHash({
    source_request_hash: request.request_hash,
    registry_read_started_at: value.registry_read_started_at,
    registry_read_completed_at: value.registry_read_completed_at,
    registry_read_started_monotonic_ns: value.registry_read_started_monotonic_ns,
    registry_read_completed_monotonic_ns: value.registry_read_completed_monotonic_ns,
    receipt_policy_version: value.receipt_policy_version,
  })
  if (value.receipt_id !== `replay-spawn-boundary-revalidation-receipt-${identityHash.slice(0, 24)}`
      || value.receipt_ref !== `receipt://replay-spawn-boundary-revalidation/${identityHash.slice(0, 24)}`) {
    fail("spawn boundary revalidation receipt identity")
  }
  const { receipt_hash: receiptHash, ...body } = value
  const expected = createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")
  if (receiptHash !== expected) fail("spawn boundary revalidation receipt hash mismatch")
}

const REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_FIELDS = ["attempt_id", "attempt_ordinal",
  "authority_capsule_hash", "authority_target", "challenge_policy", "expected_current_attempt_lease_hash",
  "expected_valid_before", "lease_generation", "process_artifact_hash", "process_authority", "purpose",
  "request_hash", "request_id", "request_key", "request_policy_version", "request_ref", "requester_owner",
  "retry_policy", "schema_version", "source_authority_capsule_record_hash",
  "source_authority_execution_admission_command_hash", "source_authority_process_launch_intent_hash",
  "source_authority_transport_contract_hash", "status", "worker_id", "worker_request_hash"].sort()

const REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_FIELDS = ["authority_owner", "authority_source",
  "caller_time_input", "clock_independence", "clock_source", "current_attempt_lease",
  "current_attempt_lease_hash", "current_attempt_read", "current_attempt_status", "external_time_attestation",
  "monotonic_clock_source", "process_authority", "race_limit", "receipt_hash", "receipt_id",
  "receipt_policy_version", "receipt_ref", "registry_read_completed_at",
  "registry_read_completed_monotonic_ns", "registry_read_started_at", "registry_read_started_monotonic_ns",
  "revalidated_at", "schema_version", "source_request", "source_request_hash", "source_request_id",
  "source_request_ref", "spawn_candidate_authority", "status", "valid_before", "wall_clock_source"].sort()

function assertExactFields(value: object, fields: string[], label: string): void {
  if (canonicalReservationJson(Object.keys(value).sort()) !== canonicalReservationJson(fields)) {
    fail(`${label} field whitelist drift`)
  }
}

export function assertReplayCheckpointReceiptSnapshot(value: ReplayCheckpointReceiptSnapshot): void {
  if (value.schema_version !== REPLAY_CHECKPOINT_RECEIPT_SCHEMA_VERSION) fail("checkpoint receipt schema_version")
  for (const [field, item] of Object.entries({
    receipt_id: value.receipt_id,
    receipt_ref: value.receipt_ref,
    trial_id: value.trial_id,
    run_id: value.run_id,
    reservation_ref: value.reservation_ref,
    attempt_id: value.attempt_id,
    worker_id: value.worker_id,
    diagnostic_checkpoint_ref: value.diagnostic_checkpoint_ref,
    engine_checkpoint_ref: value.engine_checkpoint_ref,
    storage_policy_version: value.storage_policy_version,
  })) requireText(item, `checkpoint_receipt.${field}`)
  for (const [field, item] of Object.entries({
    receipt_hash: value.receipt_hash,
    request_hash: value.request_hash,
    reservation_hash: value.reservation_hash,
    attempt_lease_hash: value.attempt_lease_hash,
    diagnostic_checkpoint_hash: value.diagnostic_checkpoint_hash,
    engine_checkpoint_payload_hash: value.engine_checkpoint_payload_hash,
    engine_checkpoint_hash: value.engine_checkpoint_hash,
  })) requireHash(item, `checkpoint_receipt.${field}`)
  requireUtcTimestamp(value.recorded_at, "checkpoint_receipt.recorded_at")
  if (value.status !== "recorded") fail("checkpoint receipt status must be recorded")
  if (value.storage_policy_version !== REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION) {
    fail("checkpoint receipt storage policy is not supported")
  }
  for (const [field, item] of Object.entries({
    attempt_ordinal: value.attempt_ordinal,
    lease_generation: value.lease_generation,
    next_source_offset: value.next_source_offset,
  })) {
    if (!Number.isSafeInteger(item) || item < 1) fail(`checkpoint_receipt.${field} must be positive`)
  }
  const { receipt_hash: receiptHash, ...body } = value
  if (receiptHash !== createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")) {
    fail("checkpoint receipt hash mismatch")
  }
}

export function createReplayCheckpointReceiptSnapshot(
  body: ReplayCheckpointReceiptBody,
): ReplayCheckpointReceiptSnapshot {
  const value: ReplayCheckpointReceiptSnapshot = {
    ...body,
    receipt_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplayCheckpointReceiptSnapshot(value)
  return value
}

export function hashReplayCheckpointReceiptSnapshot(value: ReplayCheckpointReceiptSnapshot): string {
  assertReplayCheckpointReceiptSnapshot(value)
  return value.receipt_hash
}

export function assertReplayResumeAuthorizationSnapshot(value: ReplayResumeAuthorizationSnapshot): void {
  if (value.schema_version !== REPLAY_RESUME_AUTHORIZATION_SCHEMA_VERSION) fail("resume authorization schema_version")
  for (const [field, item] of Object.entries({
    authorization_id: value.authorization_id,
    authorization_ref: value.authorization_ref,
    trial_id: value.trial_id,
    run_id: value.run_id,
    reservation_ref: value.reservation_ref,
    source_attempt_id: value.source_attempt_id,
    diagnostic_checkpoint_ref: value.diagnostic_checkpoint_ref,
    target_attempt_id: value.target_attempt_id,
    target_worker_id: value.target_worker_id,
  })) requireText(item, `resume_authorization.${field}`)
  for (const [field, item] of Object.entries({
    authorization_hash: value.authorization_hash,
    request_hash: value.request_hash,
    reservation_hash: value.reservation_hash,
    diagnostic_checkpoint_hash: value.diagnostic_checkpoint_hash,
    target_attempt_lease_hash: value.target_attempt_lease_hash,
  })) requireHash(item, `resume_authorization.${field}`)
  requireUtcTimestamp(value.issued_at, "resume_authorization.issued_at")
  requireUtcTimestamp(value.target_claimed_at, "resume_authorization.target_claimed_at")
  if (value.status !== "authorized") fail("resume authorization status must be authorized")
  if (value.source_attempt_status !== "cancelled" && value.source_attempt_status !== "expired") {
    fail("resume authorization source Attempt must be cancelled or expired")
  }
  for (const [field, item] of Object.entries({
    source_attempt_ordinal: value.source_attempt_ordinal,
    target_attempt_ordinal: value.target_attempt_ordinal,
    target_lease_generation_floor: value.target_lease_generation_floor,
  })) {
    if (!Number.isSafeInteger(item) || item < 1) fail(`resume_authorization.${field} must be positive`)
  }
  if (value.source_attempt_id === value.target_attempt_id
      || value.target_attempt_ordinal <= value.source_attempt_ordinal) {
    fail("resume authorization target Attempt must be a later Attempt")
  }
  const { authorization_hash: authorizationHash, ...body } = value
  if (authorizationHash !== createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")) {
    fail("resume authorization hash mismatch")
  }
}

export function createReplayResumeAuthorizationSnapshot(
  body: ReplayResumeAuthorizationBody,
): ReplayResumeAuthorizationSnapshot {
  const value: ReplayResumeAuthorizationSnapshot = {
    ...body,
    authorization_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplayResumeAuthorizationSnapshot(value)
  return value
}

export function hashReplayResumeAuthorizationSnapshot(value: ReplayResumeAuthorizationSnapshot): string {
  assertReplayResumeAuthorizationSnapshot(value)
  return value.authorization_hash
}

export function assertDraftStrategyAuthorization(value: DraftStrategyAuthorization): void {
  if (value.schema_version !== DRAFT_AUTHORIZATION_SCHEMA_VERSION) fail("authorization schema_version")
  if (value.decision !== "accept_for_draft") fail("authorization decision")
  requireText(value.decision_id, "authorization.decision_id")
  requireText(value.reviewer_run_id, "authorization.reviewer_run_id")
  requireText(value.primary_result_id, "authorization.primary_result_id")
  requireHash(value.primary_result_hash, "authorization.primary_result_hash")
  requireText(value.selected_trial_id, "authorization.selected_trial_id")
  requireText(value.selected_candidate_id, "authorization.selected_candidate_id")
  requireTimestamp(value.candidate_frozen_at, "authorization.candidate_frozen_at")
  assertIdentityFields(value.identity)
  if (value.selected_trial_id !== value.identity.trial_id) fail("selected Trial does not match identity")
  if (value.selected_candidate_id !== value.identity.candidate_id) fail("selected Candidate does not match identity")
}

export function assertStrategyDraftBinding(value: StrategyDraftBinding): void {
  if (value.schema_version !== STRATEGY_DRAFT_BINDING_SCHEMA_VERSION) fail("draft binding schema_version")
  requireText(value.draft_id, "draft_id")
  requireText(value.strategy_id, "strategy_id")
  requireText(value.strategy_version, "strategy_version")
  requireText(value.strategy_ref, "strategy_ref")
  requireHash(value.strategy_policy_hash, "strategy_policy_hash")
  if (value.materialization_status !== "ready") fail("draft is not ready")
  requireTimestamp(value.created_at, "created_at")
  assertDraftStrategyAuthorization(value.authorization)
}

function assertIdentityFields(value: ResearchIdentityBinding): void {
  if (value.schema_version !== CONTROL_PLANE_IDENTITY_SCHEMA_VERSION) fail("identity schema_version")
  requireText(value.experiment_id, "identity.experiment_id")
  requireText(value.trial_group_id, "identity.trial_group_id")
  requireHash(value.trial_group_hash, "identity.trial_group_hash")
  requireText(value.trial_id, "identity.trial_id")
  requireText(value.candidate_id, "identity.candidate_id")
  requireHash(value.candidate_hash, "identity.candidate_hash")
  requireText(value.identity_hash_policy_version, "identity.identity_hash_policy_version")
  requireHash(value.experiment_contract_hash, "identity.experiment_contract_hash")
}

function assertCancellationCommon(
  value: ReplayReservationCancellationSnapshot | ReplayAttemptCancellationSnapshot,
  fieldPrefix: string,
): void {
  for (const [field, item] of Object.entries({
    cancellation_id: value.cancellation_id,
    cancellation_ref: value.cancellation_ref,
    authority_id: value.authority_id,
    cancellation_policy_version: value.cancellation_policy_version,
  })) requireText(item, `${fieldPrefix}.${field}`)
  requireHash(value.cancellation_hash, `${fieldPrefix}.cancellation_hash`)
  requireUtcTimestamp(value.recorded_at, `${fieldPrefix}.recorded_at`)
  if (value.status !== "cancelled") fail(`${fieldPrefix}.status must be cancelled`)
  const reasons: ReplayExecutionCancellationReason[] = [
    "provider_certification_incident",
    "data_integrity_incident",
    "harness_security_incident",
    "policy_withdrawal",
    "operator_emergency_stop",
  ]
  if (!reasons.includes(value.reason_code)) fail(`${fieldPrefix}.reason_code`)
}

function assertCancellationHash(
  value: ReplayReservationCancellationSnapshot | ReplayAttemptCancellationSnapshot,
  label: string,
): void {
  const { cancellation_hash: cancellationHash, ...body } = value
  const expected = createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")
  if (cancellationHash !== expected) fail(`${label} hash mismatch`)
}

const REPLAY_DECISION_OBSERVATION_BUNDLE_DERIVATION_ADMISSION_FIELDS = [
  "admission_hash", "admission_id", "admission_policy_version", "admission_ref",
  "authority_id", "binding_set_hash", "binding_set_id", "boundaries_hash",
  "boundary_count", "bundle_admission_hash", "bundle_admission_ref", "bundle_hash",
  "bundle_id", "certification_result", "common_parent_rule", "consumer_capability",
  "control_plane_parent_replay", "control_plane_validation", "dataset_hash",
  "dataset_manifest_ref", "decision_authority", "decision_input_compatibility",
  "decision_schedule_hash", "derivation_attestation_hash", "derivation_attestation_id",
  "derivation_policy_version", "economic_authority", "first_decision_time",
  "harness_compatibility", "harness_invocation", "independent_verification", "issued_at",
  "last_decision_time", "order_authority", "ordering_admission_hash", "request_hash",
  "reservation_hash", "reservation_ref", "run_id", "runner_compatibility", "schema_version",
  "scope", "signal_authority", "status", "trial_id", "wire_manifest_hash", "wire_manifest_id",
].sort()

function assertExactSnapshotFields(value: object, expected: string[], label: string): void {
  if (canonicalReservationJson(Object.keys(value).sort()) !== canonicalReservationJson(expected)) {
    fail(`${label} field whitelist drift`)
  }
}

function requireExactObjectFields(value: object, expected: string[], label: string): void {
  assertExactSnapshotFields(value, [...expected].sort(), label)
}

interface ExactFiniteNumber {
  coefficient: bigint
  scale: number
}

function exactFiniteNumberSum(values: number[]): ExactFiniteNumber {
  return values.map(exactFiniteNumber).reduce((total, value) => {
    const scale = Math.max(total.scale, value.scale)
    return normalizeExactFiniteNumber({
      coefficient: total.coefficient * 10n ** BigInt(scale - total.scale)
        + value.coefficient * 10n ** BigInt(scale - value.scale),
      scale,
    })
  }, { coefficient: 0n, scale: 0 })
}

function exactFiniteNumberEquals(left: ExactFiniteNumber, right: number): boolean {
  const normalizedLeft = normalizeExactFiniteNumber(left)
  const normalizedRight = exactFiniteNumber(right)
  return normalizedLeft.coefficient === normalizedRight.coefficient && normalizedLeft.scale === normalizedRight.scale
}

function exactFiniteNumber(value: number): ExactFiniteNumber {
  if (!Number.isFinite(value)) fail("exact finite number input")
  const [mantissa, exponentText = "0"] = String(Object.is(value, -0) ? 0 : value).toLowerCase().split("e")
  const exponent = Number(exponentText)
  const sign = mantissa.startsWith("-") ? -1n : 1n
  const unsigned = mantissa.replace(/^[+-]/, "")
  const [integer, fraction = ""] = unsigned.split(".")
  let coefficient = sign * BigInt(`${integer}${fraction}`)
  let scale = fraction.length - exponent
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale)
    scale = 0
  }
  return normalizeExactFiniteNumber({ coefficient, scale })
}

function normalizeExactFiniteNumber(value: ExactFiniteNumber): ExactFiniteNumber {
  let { coefficient, scale } = value
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n
    scale -= 1
  }
  return { coefficient, scale }
}

function requirePositiveFinite(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) fail(`${field} must be positive and finite`)
}

function requireHash(value: unknown, field: string): void {
  const text = requireText(value, field)
  if (!/^[a-f0-9]{64}$/.test(text)) fail(`${field} must be a lowercase sha256 hex digest`)
}

function requireTimestamp(value: unknown, field: string): void {
  const text = requireText(value, field)
  if (!Number.isFinite(Date.parse(text))) fail(`${field} must be an ISO timestamp`)
}

function requireUtcTimestamp(value: unknown, field: string): void {
  const text = requireText(value, field)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(text) || !Number.isFinite(Date.parse(text))) {
    fail(`${field} must be an RFC 3339 UTC timestamp`)
  }
}

function canonicalReservationJson(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"))
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("reservation hash rejects non-finite numbers")
    return JSON.stringify(Object.is(value, -0) ? 0 : value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalReservationJson).join(",")}]`
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .map((source) => ({ source, normalized: source.normalize("NFC") }))
      .sort((left, right) => left.normalized < right.normalized ? -1 : left.normalized > right.normalized ? 1 : 0)
    if (new Set(entries.map((entry) => entry.normalized)).size !== entries.length) fail("reservation hash key collision after NFC normalization")
    return `{${entries.map((entry) => `${JSON.stringify(entry.normalized)}:${canonicalReservationJson(record[entry.source])}`).join(",")}}`
  }
  fail("reservation hash rejects unsupported values")
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(`${field} is required`)
  return value.trim()
}

function fail(message: string): never {
  throw new Error(message)
}
