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
export const REPLAY_DECISION_OBSERVATION_BUNDLE_ADMISSION_SCHEMA_VERSION = "trade.rd-replay-decision-observation-bundle-admission.v1" as const
export const REPLAY_DECISION_OBSERVATION_BUNDLE_DERIVATION_ADMISSION_SCHEMA_VERSION = "trade.rd-replay-decision-observation-bundle-derivation-admission.v1" as const
export const REPLAY_RESERVATION_CANCELLATION_SCHEMA_VERSION = "trade.rd-replay-reservation-cancellation.v1" as const
export const REPLAY_ATTEMPT_CANCELLATION_SCHEMA_VERSION = "trade.rd-replay-attempt-cancellation.v1" as const
export const REPLAY_ATTEMPT_CANCELLATION_OBSERVATION_SCHEMA_VERSION = "trade.rd-replay-attempt-cancellation-observation.v1" as const
export const REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION = "trade.rd-replay-attempt-lease.v1" as const
export const REPLAY_ATTEMPT_LEASE_OBSERVATION_SCHEMA_VERSION = "trade.rd-replay-attempt-lease-observation.v1" as const
export const REPLAY_ATTEMPT_LEASE_OBSERVATION_POLICY_VERSION = "rd-replay-attempt-lease-observation-v1" as const
export const REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_SCHEMA_VERSION =
  "trade.rd-replay-attempt-lease-observation-registry-read-receipt.v1" as const
export const REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_POLICY_VERSION =
  "rd-replay-attempt-lease-observation-registry-read-receipt-v1" as const
export const REPLAY_CHECKPOINT_RECEIPT_SCHEMA_VERSION = "trade.rd-replay-checkpoint-receipt.v2" as const
export const REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION = REPLAY_LOCAL_ARTIFACT_STORAGE_POLICY_VERSION
export const REPLAY_RESUME_AUTHORIZATION_SCHEMA_VERSION = "trade.rd-replay-resume-authorization-snapshot.v1" as const

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
  request_schema_version: "trade.rd-replay-execution-request.v30"
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
      || value.request_schema_version !== "trade.rd-replay-execution-request.v30"
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
