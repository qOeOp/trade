import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  assertReplayAttemptLeaseEnvelopeView,
  type ReplayAttemptLeaseEnvelopeView,
} from "./replay-decision-harness-execution-envelope"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract,
  type ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract,
} from "./replay-decision-harness-worker-v10-successor-verification-authority-contract"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_LEASE_ADMISSION_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-successor-lease-admission.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_LEASE_ADMISSION_POLICY_VERSION =
  "rd-replay-harness-worker-v10-successor-lease-admission-v1" as const

export const REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_REQUEST_VIEW_SCHEMA_VERSION =
  "trade.rd-replay-successor-verification-lease-renewal-request.v1" as const
export const REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_REQUEST_VIEW_POLICY_VERSION =
  "rd-replay-successor-verification-lease-renewal-request-v1" as const
export const REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_RECEIPT_VIEW_SCHEMA_VERSION =
  "trade.rd-replay-successor-verification-lease-renewal-receipt.v1" as const
export const REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_RECEIPT_VIEW_POLICY_VERSION =
  "rd-replay-successor-verification-lease-renewal-receipt-v1" as const

// Replay owns these immutable inbound wire views. The Runner adapter validates the source
// values with the Control Plane contract before constructing this admission.
export interface ReplaySuccessorVerificationLeaseRenewalRequestView {
  schema_version: typeof REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_REQUEST_VIEW_SCHEMA_VERSION
  request_id: string
  request_ref: string
  request_key: string
  request_hash: string
  request_policy_version:
    typeof REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_REQUEST_VIEW_POLICY_VERSION
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

export interface ReplaySuccessorVerificationLeaseRenewalReceiptView {
  schema_version: typeof REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_RECEIPT_VIEW_SCHEMA_VERSION
  receipt_id: string
  receipt_ref: string
  receipt_hash: string
  receipt_policy_version:
    typeof REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_RECEIPT_VIEW_POLICY_VERSION
  status: "successor_verification_lease_renewed"
  authority_owner: "research_control_plane"
  authority_source: "research_control_plane_state_store"
  registry_table: "rd_replay_successor_verification_lease_renewal"
  registry_row_immutability: "sqlite_update_and_delete_triggers"
  source_request_id: string
  source_request_ref: string
  source_request_hash: string
  source_request: ReplaySuccessorVerificationLeaseRenewalRequestView
  source_evidence_validation: "opaque_hash_binding_only_replay_lineage_not_revalidated"
  renewal_transaction:
    "single_control_plane_transaction_exact_predecessor_fencing_update_and_receipt_insert"
  clock_source: "control_plane_authority_process_clock_port"
  clock_independence: "authority_internal_sampling_without_caller_heartbeat_time"
  caller_heartbeat_time_input: "forbidden"
  external_time_attestation: "not_provided"
  renewed_at: string
  predecessor_attempt_lease_hash: string
  predecessor_attempt_lease: ReplayAttemptLeaseEnvelopeView
  successor_attempt_lease_hash: string
  successor_attempt_lease: ReplayAttemptLeaseEnvelopeView
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

export interface ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_LEASE_ADMISSION_SCHEMA_VERSION
  admission_id: string
  admission_ref: string
  admission_key: string
  admission_hash: string
  admission_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_LEASE_ADMISSION_POLICY_VERSION
  scope: "one_durable_successor_authority_and_control_plane_renewal_receipt_bound_lease_admission"
  owner: "replay_runner_worker_v10_successor_lease_admission_registry"
  purpose: "admit_one_control_plane_successor_lease_for_fresh_second_member_lineage_construction"
  status: "successor_attempt_lease_admitted_lineage_not_materialized"
  source_successor_authority_contract_hash: string
  source_successor_authority_contract:
    ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract
  source_reproducibility_pair_contract_hash: string
  source_first_schedule_admission_hash: string
  source_first_execution_envelope_hash: string
  source_renewal_request_hash: string
  source_renewal_request: ReplaySuccessorVerificationLeaseRenewalRequestView
  control_plane_renewal_receipt_hash: string
  control_plane_renewal_receipt: ReplaySuccessorVerificationLeaseRenewalReceiptView
  predecessor_attempt_lease_hash: string
  successor_attempt_lease_hash: string
  successor_attempt_lease: ReplayAttemptLeaseEnvelopeView
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  predecessor_lease_generation: number
  successor_lease_generation: number
  parent_validation:
    "exact_durable_r4_141_selection_request_and_control_plane_receipt_full_lineage_match"
  request_registry_durability: "replay_local_immutable_cas_regular_file_canonical_json"
  control_plane_receipt_registry_durability: "control_plane_sqlite_immutable_update_delete_triggers"
  renewal_request_count: 1
  control_plane_renewal_receipt_count: 1
  successor_attempt_lease_count: 1
  successor_execution_envelope_count: 0
  successor_authority_lineage_count: 0
  second_schedule_admission_count: 0
  reproducibility_pair_count: 0
  harness_receipt_count: 0
  successor_lease_authority: "admitted_for_fresh_lineage_construction_only"
  successor_process_authority: "none_fresh_envelope_command_intent_capsule_revalidation_required"
  blockers: [
    "predecessor_linked_successor_execution_envelope_not_materialized",
    "successor_command_intent_capsule_and_process_lineage_not_materialized",
    "second_distinct_fresh_process_schedule_admission_not_materialized",
    "response_reproducibility_pair_not_materialized",
    "worker_v10_harness_receipt_not_materialized",
  ]
  decision_output_authority: "first_schedule_matched_claim_only_successor_lease_admitted"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmissionBody = Omit<
  ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission,
  "admission_hash"
>

export function replayDecisionHarnessWorkerV10SuccessorLeaseAdmissionKey(input: {
  source_successor_authority_contract_hash: string
  source_renewal_request_hash: string
  admission_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_LEASE_ADMISSION_POLICY_VERSION
}): string {
  requireHash(input.source_successor_authority_contract_hash, "successor Lease admission authority hash")
  requireHash(input.source_renewal_request_hash, "successor Lease admission Request hash")
  if (input.admission_policy_version
      !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_LEASE_ADMISSION_POLICY_VERSION) {
    throw new Error("unsupported Worker v10 successor Lease admission natural key")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission(
  body: ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmissionBody,
): ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission {
  const value = { ...structuredClone(body), admission_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission(
  value: ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission,
): void {
  assertFields(value)
  if (value.schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_LEASE_ADMISSION_SCHEMA_VERSION
      || value.admission_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_LEASE_ADMISSION_POLICY_VERSION
      || value.scope
        !== "one_durable_successor_authority_and_control_plane_renewal_receipt_bound_lease_admission"
      || value.owner !== "replay_runner_worker_v10_successor_lease_admission_registry"
      || value.purpose
        !== "admit_one_control_plane_successor_lease_for_fresh_second_member_lineage_construction"
      || value.status !== "successor_attempt_lease_admitted_lineage_not_materialized"
      || value.parent_validation
        !== "exact_durable_r4_141_selection_request_and_control_plane_receipt_full_lineage_match"
      || value.request_registry_durability !== "replay_local_immutable_cas_regular_file_canonical_json"
      || value.control_plane_receipt_registry_durability
        !== "control_plane_sqlite_immutable_update_delete_triggers"
      || value.renewal_request_count !== 1 || value.control_plane_renewal_receipt_count !== 1
      || value.successor_attempt_lease_count !== 1 || value.successor_execution_envelope_count !== 0
      || value.successor_authority_lineage_count !== 0 || value.second_schedule_admission_count !== 0
      || value.reproducibility_pair_count !== 0 || value.harness_receipt_count !== 0
      || value.successor_lease_authority !== "admitted_for_fresh_lineage_construction_only"
      || value.successor_process_authority
        !== "none_fresh_envelope_command_intent_capsule_revalidation_required"
      || canonicalJson(value.blockers) !== canonicalJson([
        "predecessor_linked_successor_execution_envelope_not_materialized",
        "successor_command_intent_capsule_and_process_lineage_not_materialized",
        "second_distinct_fresh_process_schedule_admission_not_materialized",
        "response_reproducibility_pair_not_materialized",
        "worker_v10_harness_receipt_not_materialized",
      ])
      || value.decision_output_authority
        !== "first_schedule_matched_claim_only_successor_lease_admitted"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported Worker v10 successor Lease admission")
  }
  for (const item of [value.admission_id, value.admission_ref, value.attempt_id, value.worker_id]) {
    requireText(item, "Worker v10 successor Lease admission identity")
  }
  for (const item of [value.admission_key, value.admission_hash,
    value.source_successor_authority_contract_hash, value.source_reproducibility_pair_contract_hash,
    value.source_first_schedule_admission_hash, value.source_first_execution_envelope_hash,
    value.source_renewal_request_hash, value.control_plane_renewal_receipt_hash,
    value.predecessor_attempt_lease_hash, value.successor_attempt_lease_hash]) {
    requireHash(item, "Worker v10 successor Lease admission hash")
  }
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.predecessor_lease_generation)
      || value.predecessor_lease_generation < 1
      || value.successor_lease_generation !== value.predecessor_lease_generation + 1) {
    throw new Error("Worker v10 successor Lease admission Attempt generation is invalid")
  }
  assertReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract(
    value.source_successor_authority_contract,
  )
  assertReplaySuccessorVerificationLeaseRenewalRequestView(value.source_renewal_request)
  assertReplaySuccessorVerificationLeaseRenewalReceiptView(value.control_plane_renewal_receipt)
  const authority = value.source_successor_authority_contract
  const pair = authority.source_reproducibility_pair_contract
  const request = value.source_renewal_request
  const receipt = value.control_plane_renewal_receipt
  const predecessor = receipt.predecessor_attempt_lease
  const successor = receipt.successor_attempt_lease
  const key = replayDecisionHarnessWorkerV10SuccessorLeaseAdmissionKey({
    source_successor_authority_contract_hash: authority.contract_hash,
    source_renewal_request_hash: request.request_hash,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_LEASE_ADMISSION_POLICY_VERSION,
  })
  if (value.admission_key !== key
      || value.admission_id !== `decision-harness-worker-v10-successor-lease-${key.slice(0, 24)}`
      || value.admission_ref !== `admission://replay-decision-harness-worker-v10-successor-lease/${key.slice(0, 24)}`
      || value.source_successor_authority_contract_hash !== authority.contract_hash
      || value.source_reproducibility_pair_contract_hash !== pair.contract_hash
      || value.source_first_schedule_admission_hash !== authority.source_first_schedule_admission_hash
      || value.source_first_execution_envelope_hash !== authority.source_first_execution_envelope_hash
      || value.source_renewal_request_hash !== request.request_hash
      || value.control_plane_renewal_receipt_hash !== receipt.receipt_hash
      || receipt.source_request_hash !== request.request_hash
      || canonicalJson(receipt.source_request) !== canonicalJson(request)
      || request.source_successor_authority_contract_hash !== authority.contract_hash
      || request.source_reproducibility_pair_contract_hash !== pair.contract_hash
      || request.source_first_schedule_admission_hash !== authority.source_first_schedule_admission_hash
      || request.source_first_execution_envelope_hash !== authority.source_first_execution_envelope_hash
      || request.logical_request_id !== pair.logical_request_id
      || request.worker_request_hash !== pair.worker_request_hash
      || request.replay_execution_request_hash !== pair.replay_execution_request_hash
      || request.attempt_id !== authority.source_first_attempt_id
      || request.attempt_ordinal !== authority.source_first_attempt_ordinal
      || request.worker_id !== authority.source_first_worker_id
      || request.expected_current_lease_generation !== authority.source_first_lease_generation
      || request.expected_current_attempt_lease_hash !== authority.source_first_attempt_lease_hash
      || request.minimum_successor_lease_generation !== authority.minimum_successor_lease_generation
      || value.predecessor_attempt_lease_hash !== receipt.predecessor_attempt_lease_hash
      || value.predecessor_attempt_lease_hash !== canonicalHash(predecessor)
      || value.predecessor_attempt_lease_hash !== authority.source_first_attempt_lease_hash
      || value.successor_attempt_lease_hash !== receipt.successor_attempt_lease_hash
      || value.successor_attempt_lease_hash !== canonicalHash(successor)
      || canonicalJson(value.successor_attempt_lease) !== canonicalJson(successor)
      || value.attempt_id !== successor.attempt_id || value.attempt_ordinal !== successor.attempt_ordinal
      || value.worker_id !== successor.worker_id
      || value.predecessor_lease_generation !== predecessor.lease_generation
      || value.successor_lease_generation !== successor.lease_generation) {
    throw new Error("Worker v10 successor Lease admission lineage drift")
  }
  const { admission_hash: admissionHash, ...body } = value
  if (admissionHash !== canonicalHash(body)) {
    throw new Error("Worker v10 successor Lease admission hash mismatch")
  }
}

export function assertReplaySuccessorVerificationLeaseRenewalRequestView(
  value: ReplaySuccessorVerificationLeaseRenewalRequestView,
): void {
  assertViewFields(value, REQUEST_VIEW_FIELDS, "successor Lease renewal Request wire view")
  if (value.schema_version !== REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_REQUEST_VIEW_SCHEMA_VERSION
      || value.request_policy_version
        !== REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_REQUEST_VIEW_POLICY_VERSION
      || value.status !== "successor_verification_lease_renewal_requested"
      || value.requester_owner !== "replay_runner" || value.authority_target !== "research_control_plane"
      || value.purpose !== "second_reproducibility_member_same_attempt_successor_generation"
      || value.source_evidence_role
        !== "opaque_replay_hash_binding_control_plane_does_not_revalidate_replay_lineage"
      || value.request_authority !== "none_control_plane_must_atomically_admit_or_reject"
      || value.process_authority !== "none" || value.harness_authority !== "none"
      || value.economic_authority !== "none") {
    throw new Error("unsupported successor Lease renewal Request wire view")
  }
  for (const item of [value.request_id, value.request_ref, value.logical_request_id,
    value.attempt_id, value.worker_id]) requireText(item, "successor Lease renewal Request identity")
  for (const item of [value.request_key, value.request_hash,
    value.source_successor_authority_contract_hash, value.source_reproducibility_pair_contract_hash,
    value.source_first_schedule_admission_hash, value.source_first_execution_envelope_hash,
    value.worker_request_hash, value.replay_execution_request_hash,
    value.expected_current_attempt_lease_hash]) requireHash(item, "successor Lease renewal Request hash")
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.expected_current_lease_generation)
      || value.expected_current_lease_generation < 1
      || value.minimum_successor_lease_generation !== value.expected_current_lease_generation + 1
      || !isUtc(value.requested_lease_expires_at)) {
    throw new Error("successor Lease renewal Request wire view generation or expiry")
  }
  const key = canonicalHash({
    source_successor_authority_contract_hash: value.source_successor_authority_contract_hash,
    attempt_id: value.attempt_id,
    worker_id: value.worker_id,
    expected_current_lease_generation: value.expected_current_lease_generation,
    request_policy_version: value.request_policy_version,
  })
  const { request_hash: requestHash, ...body } = value
  if (value.request_key !== key
      || value.request_id !== `replay-successor-verification-lease-renewal-${key.slice(0, 24)}`
      || value.request_ref !== `request://replay-successor-verification-lease-renewal/${key.slice(0, 24)}`
      || requestHash !== canonicalHash(body)) {
    throw new Error("successor Lease renewal Request wire view identity or hash mismatch")
  }
}

export function assertReplaySuccessorVerificationLeaseRenewalReceiptView(
  value: ReplaySuccessorVerificationLeaseRenewalReceiptView,
): void {
  assertViewFields(value, RECEIPT_VIEW_FIELDS, "successor Lease renewal Receipt wire view")
  if (value.schema_version !== REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_RECEIPT_VIEW_SCHEMA_VERSION
      || value.receipt_policy_version
        !== REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_RECEIPT_VIEW_POLICY_VERSION
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
    throw new Error("unsupported successor Lease renewal Receipt wire view")
  }
  for (const item of [value.receipt_id, value.receipt_ref, value.source_request_id,
    value.source_request_ref]) requireText(item, "successor Lease renewal Receipt identity")
  for (const item of [value.receipt_hash, value.source_request_hash,
    value.predecessor_attempt_lease_hash, value.successor_attempt_lease_hash]) {
    requireHash(item, "successor Lease renewal Receipt hash")
  }
  if (!isUtc(value.renewed_at)) throw new Error("successor Lease renewal Receipt renewed_at")
  assertReplaySuccessorVerificationLeaseRenewalRequestView(value.source_request)
  assertReplayAttemptLeaseEnvelopeView(value.predecessor_attempt_lease)
  assertReplayAttemptLeaseEnvelopeView(value.successor_attempt_lease)
  const request = value.source_request
  const predecessor = value.predecessor_attempt_lease
  const successor = value.successor_attempt_lease
  if (value.source_request_id !== request.request_id || value.source_request_ref !== request.request_ref
      || value.source_request_hash !== request.request_hash
      || value.predecessor_attempt_lease_hash !== canonicalHash(predecessor)
      || value.successor_attempt_lease_hash !== canonicalHash(successor)
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
      || successor.request_hash !== predecessor.request_hash || successor.claimed_at !== predecessor.claimed_at
      || Date.parse(value.renewed_at) < Date.parse(predecessor.heartbeat_at)
      || Date.parse(value.renewed_at) >= Date.parse(predecessor.lease_expires_at)
      || Date.parse(successor.lease_expires_at) <= Date.parse(predecessor.lease_expires_at)) {
    throw new Error("successor Lease renewal Receipt wire view lineage mismatch")
  }
  const identity = canonicalHash({
    source_request_hash: request.request_hash,
    predecessor_attempt_lease_hash: value.predecessor_attempt_lease_hash,
    successor_attempt_lease_hash: value.successor_attempt_lease_hash,
    receipt_policy_version: value.receipt_policy_version,
  })
  const { receipt_hash: receiptHash, ...body } = value
  if (value.receipt_id !== `replay-successor-verification-lease-renewal-receipt-${identity.slice(0, 24)}`
      || value.receipt_ref
        !== `receipt://replay-successor-verification-lease-renewal/${identity.slice(0, 24)}`
      || receiptHash !== canonicalHash(body)) {
    throw new Error("successor Lease renewal Receipt wire view identity or hash mismatch")
  }
}

const REQUEST_VIEW_FIELDS = ["attempt_id", "attempt_ordinal", "authority_target", "economic_authority",
  "expected_current_attempt_lease_hash", "expected_current_lease_generation", "harness_authority",
  "logical_request_id", "minimum_successor_lease_generation", "process_authority", "purpose",
  "replay_execution_request_hash", "request_authority", "request_hash", "request_id", "request_key",
  "request_policy_version", "request_ref", "requested_lease_expires_at", "requester_owner", "schema_version",
  "source_evidence_role", "source_first_execution_envelope_hash", "source_first_schedule_admission_hash",
  "source_reproducibility_pair_contract_hash", "source_successor_authority_contract_hash", "status",
  "worker_id", "worker_request_hash"].sort()

const RECEIPT_VIEW_FIELDS = ["authority_owner", "authority_source", "caller_heartbeat_time_input",
  "clock_independence", "clock_source", "decision_output_authority", "economic_authority",
  "external_time_attestation", "generation_relation", "harness_authority", "immutable_attempt_binding",
  "order_authority", "predecessor_attempt_lease", "predecessor_attempt_lease_hash", "process_authority",
  "receipt_hash", "receipt_id", "receipt_policy_version", "receipt_ref", "registry_row_immutability",
  "registry_table", "renewal_transaction", "renewed_at", "requested_expiry_relation", "schema_version",
  "signal_authority", "source_evidence_validation", "source_request", "source_request_hash",
  "source_request_id", "source_request_ref", "status", "successor_attempt_lease",
  "successor_attempt_lease_hash", "successor_authority", "trial_authority"].sort()

function assertViewFields(value: object, expected: string[], label: string): void {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(expected)) {
    throw new Error(`${label} fields drift`)
  }
}

function isUtc(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value))
}

const FIELDS = ["admission_hash", "admission_id", "admission_key", "admission_policy_version",
  "admission_ref", "attempt_id", "attempt_ordinal", "blockers", "control_plane_renewal_receipt",
  "control_plane_renewal_receipt_count", "control_plane_renewal_receipt_hash",
  "control_plane_receipt_registry_durability", "decision_output_authority", "economic_authority",
  "harness_receipt_count", "order_authority", "owner", "parent_validation",
  "predecessor_attempt_lease_hash", "predecessor_lease_generation", "purpose",
  "renewal_request_count", "reproducibility_pair_count", "request_registry_durability", "schema_version",
  "scope", "second_schedule_admission_count", "signal_authority", "source_first_execution_envelope_hash",
  "source_first_schedule_admission_hash", "source_renewal_request", "source_renewal_request_hash",
  "source_reproducibility_pair_contract_hash", "source_successor_authority_contract",
  "source_successor_authority_contract_hash", "status", "successor_attempt_lease",
  "successor_attempt_lease_count", "successor_attempt_lease_hash", "successor_authority_lineage_count",
  "successor_execution_envelope_count", "successor_lease_authority", "successor_lease_generation",
  "successor_process_authority", "trial_authority", "worker_id"].sort()

function assertFields(value: object): void {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(FIELDS)) {
    throw new Error("Worker v10 successor Lease admission fields drift")
  }
}
