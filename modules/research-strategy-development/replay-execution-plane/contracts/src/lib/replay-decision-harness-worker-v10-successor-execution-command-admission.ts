import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  assertReplayDispatchClockAttestationView,
  type ReplayDispatchClockAttestationView,
} from "./replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import {
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
} from "./replay-decision-harness-worker-v10-successor-execution-contract-admission"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_COMMAND_ADMISSION_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-successor-execution-command-admission.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_COMMAND_ADMISSION_POLICY_VERSION =
  "rd-replay-harness-worker-v10-successor-execution-command-admission-v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_DISPATCH_CLAIM_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-successor-execution-dispatch-claim.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_DISPATCH_CLAIM_POLICY_VERSION =
  "rd-replay-harness-worker-v10-successor-execution-dispatch-claim-v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_COMMAND_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-successor-execution-admission-command.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION =
  "rd-replay-harness-worker-v10-successor-execution-admission-command-v1" as const

const COMMAND_BLOCKERS = [
  "successor_process_launch_intent_not_materialized",
  "successor_authority_capsule_not_materialized",
  "successor_spawn_boundary_revalidation_not_materialized",
  "successor_worker_process_and_request_dispatch_not_materialized",
] as const

const ADMISSION_BLOCKERS = [
  "successor_intent_capsule_revalidation_and_worker_process_not_materialized",
  "second_distinct_fresh_worker_process_schedule_admission_not_materialized",
  "response_reproducibility_pair_and_harness_receipt_not_materialized",
] as const

export interface ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim {
  schema_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_DISPATCH_CLAIM_SCHEMA_VERSION
  claim_id: string
  claim_ref: string
  claim_key: string
  claim_hash: string
  claim_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_DISPATCH_CLAIM_POLICY_VERSION
  scope: "one_successor_attempt_generation_local_dispatch_claim"
  owner: "replay_runner_worker_v10_successor_execution_command_registry"
  status: "successor_dispatch_exclusivity_claimed_command_not_issued"
  source_successor_execution_contract_admission_hash: string
  source_parent_canonical_file_sha256: string
  target_logical_request_id: string
  target_worker_request_hash: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  dispatcher_claimant_id: string
  claimed_at: string
  natural_key_policy: "one_claim_per_parent_request_attempt_worker_and_lease_generation"
  claim_effect: "at_most_one_local_successor_command_issuer_while_cas_record_is_preserved"
  claim_reuse_policy: "forbidden_across_parent_attempt_or_lease_generation"
  claim_authority_limit: "cas_exclusivity_only_not_command_process_transport_or_economic_authority"
  execution_admission_command_instance_count: 0
  worker_process_count: 0
  dispatch_occurrence: "not_materialized"
  transport_activation: "blocked"
  harness_invocation: "forbidden"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaimBody = Omit<
  ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim,
  "claim_hash"
>

export function replayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaimKey(input: {
  source_successor_execution_contract_admission_hash: string
  target_logical_request_id: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  claim_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_DISPATCH_CLAIM_POLICY_VERSION
}): string {
  for (const item of [input.source_successor_execution_contract_admission_hash,
    input.target_logical_request_id]) requireHash(item, "successor execution Dispatch Claim key hash")
  for (const item of [input.attempt_id, input.worker_id]) {
    requireText(item, "successor execution Dispatch Claim key identity")
  }
  if (!Number.isSafeInteger(input.attempt_ordinal) || input.attempt_ordinal < 1
      || !Number.isSafeInteger(input.lease_generation) || input.lease_generation < 1
      || input.claim_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_DISPATCH_CLAIM_POLICY_VERSION) {
    throw new Error("unsupported successor execution Dispatch Claim key")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim(
  body: ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaimBody,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim {
  const value = { ...structuredClone(body), claim_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim(
  value: ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim,
): void {
  assertExactFields(value, CLAIM_FIELDS, "successor execution Dispatch Claim")
  if (value.schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_DISPATCH_CLAIM_SCHEMA_VERSION
      || value.claim_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_DISPATCH_CLAIM_POLICY_VERSION
      || value.scope !== "one_successor_attempt_generation_local_dispatch_claim"
      || value.owner !== "replay_runner_worker_v10_successor_execution_command_registry"
      || value.status !== "successor_dispatch_exclusivity_claimed_command_not_issued"
      || value.natural_key_policy !== "one_claim_per_parent_request_attempt_worker_and_lease_generation"
      || value.claim_effect
        !== "at_most_one_local_successor_command_issuer_while_cas_record_is_preserved"
      || value.claim_reuse_policy !== "forbidden_across_parent_attempt_or_lease_generation"
      || value.claim_authority_limit
        !== "cas_exclusivity_only_not_command_process_transport_or_economic_authority"
      || value.execution_admission_command_instance_count !== 0 || value.worker_process_count !== 0
      || value.dispatch_occurrence !== "not_materialized" || value.transport_activation !== "blocked"
      || value.harness_invocation !== "forbidden" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.trial_authority !== "none") {
    throw new Error("unsupported successor execution Dispatch Claim authority")
  }
  for (const item of [value.claim_id, value.claim_ref, value.attempt_id, value.worker_id,
    value.dispatcher_claimant_id]) requireText(item, "successor execution Dispatch Claim identity")
  for (const item of [value.claim_key, value.claim_hash,
    value.source_successor_execution_contract_admission_hash, value.source_parent_canonical_file_sha256,
    value.target_logical_request_id, value.target_worker_request_hash]) {
    requireHash(item, "successor execution Dispatch Claim hash")
  }
  requireUtc(value.claimed_at, "successor execution Dispatch Claim claimed_at")
  const key = replayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaimKey({
    source_successor_execution_contract_admission_hash:
      value.source_successor_execution_contract_admission_hash,
    target_logical_request_id: value.target_logical_request_id,
    attempt_id: value.attempt_id,
    attempt_ordinal: value.attempt_ordinal,
    worker_id: value.worker_id,
    lease_generation: value.lease_generation,
    claim_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_DISPATCH_CLAIM_POLICY_VERSION,
  })
  const { claim_hash: claimHash, ...body } = value
  if (value.claim_key !== key
      || value.claim_id !== `decision-harness-worker-v10-successor-execution-claim-${key.slice(0, 24)}`
      || value.claim_ref !== `claim://replay-decision-harness-worker-v10-successor/${key.slice(0, 24)}`
      || claimHash !== canonicalHash(body)) {
    throw new Error("successor execution Dispatch Claim identity or hash mismatch")
  }
}

export interface ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand {
  schema_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_COMMAND_SCHEMA_VERSION
  command_id: string
  command_ref: string
  command_key: string
  command_hash: string
  command_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION
  scope: "one_successor_attempt_generation_bound_process_launch_intent_admission"
  owner: "replay_runner_worker_v10_successor_execution_command_registry"
  status: "successor_command_issued_process_launch_intent_not_materialized"
  source_successor_execution_contract_admission_hash: string
  source_parent_canonical_file_sha256: string
  source_execution_admission_contract_hash: string
  source_artifact_bound_transport_contract_hash: string
  source_dispatch_claim_hash: string
  source_dispatch_claim: ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim
  control_plane_registry_read_receipt_hash: string
  control_plane_clock_attestation_hash: string
  control_plane_clock_attestation: ReplayDispatchClockAttestationView
  target_logical_request_id: string
  target_worker_request_hash: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  current_lease_observation_hash: string
  current_attempt_lease_hash: string
  successor_process_artifact_hash: string
  transport_contract_hash: string
  issued_at: string
  valid_before: string
  command_identity_policy:
    "hash_exact_parent_request_attempt_generation_claim_lease_receipt_clock_artifact_and_transport"
  issuance_time_semantics: "control_plane_clock_attestation_completion_not_local_registry_commit_time"
  evidence_binding_policy:
    "exact_durable_parent_and_claim_plus_embedded_control_plane_clock_receipt_chain"
  natural_key_policy: "one_command_per_exact_successor_authority_evidence_set"
  execution_admission: "granted_for_exact_successor_process_launch_intent_creation_only"
  worker_request_v10_role: "immutable_non_executable_logical_payload_source"
  worker_request_marker_policy: "preserved_not_granted_and_not_invoked_until_later_dispatch"
  command_reuse_policy: "forbidden_across_parent_claim_attempt_or_lease_generation"
  renewal_policy: "new_lease_generation_requires_new_claim_observation_clock_and_command"
  retry_policy: "same_natural_key_requires_identical_evidence_new_attempt_requires_new_command"
  revocation_gate: "lease_expiry_cancellation_or_fencing_must_block_successor_intent"
  required_response_echo_fields: ["execution_admission_command_hash", "worker_request_hash"]
  command_instance_count: 1
  process_launch_intent_count: 0
  authority_capsule_count: 0
  spawn_revalidation_count: 0
  worker_process_count: 0
  request_frame_instance_count: 0
  request_decode_receipt_count: 0
  response_frame_instance_count: 0
  blocker_set_policy: "complete_deterministic_ordered_post_successor_command_blockers"
  blockers: typeof COMMAND_BLOCKERS
  dispatch_occurrence: "not_materialized"
  transport_activation: "command_issued_successor_intent_blocked"
  harness_invocation: "forbidden"
  response_admission: "not_granted"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommandBody = Omit<
  ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand,
  "command_hash"
>

export function replayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommandKey(input: {
  source_successor_execution_contract_admission_hash: string
  source_execution_admission_contract_hash: string
  source_dispatch_claim_hash: string
  control_plane_clock_attestation_hash: string
  target_worker_request_hash: string
  transport_contract_hash: string
  command_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION
}): string {
  for (const item of [input.source_successor_execution_contract_admission_hash,
    input.source_execution_admission_contract_hash, input.source_dispatch_claim_hash,
    input.control_plane_clock_attestation_hash, input.target_worker_request_hash,
    input.transport_contract_hash]) requireHash(item, "successor Execution Admission Command key hash")
  if (input.command_policy_version
      !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION) {
    throw new Error("unsupported successor Execution Admission Command key")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand(
  body: ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommandBody,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand {
  const value = { ...structuredClone(body), command_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand(
  value: ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand,
): void {
  assertExactFields(value, COMMAND_FIELDS, "successor Execution Admission Command")
  if (value.schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_COMMAND_SCHEMA_VERSION
      || value.command_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION
      || value.scope !== "one_successor_attempt_generation_bound_process_launch_intent_admission"
      || value.owner !== "replay_runner_worker_v10_successor_execution_command_registry"
      || value.status !== "successor_command_issued_process_launch_intent_not_materialized"
      || value.command_identity_policy
        !== "hash_exact_parent_request_attempt_generation_claim_lease_receipt_clock_artifact_and_transport"
      || value.issuance_time_semantics
        !== "control_plane_clock_attestation_completion_not_local_registry_commit_time"
      || value.evidence_binding_policy
        !== "exact_durable_parent_and_claim_plus_embedded_control_plane_clock_receipt_chain"
      || value.natural_key_policy !== "one_command_per_exact_successor_authority_evidence_set"
      || value.execution_admission
        !== "granted_for_exact_successor_process_launch_intent_creation_only"
      || value.worker_request_v10_role !== "immutable_non_executable_logical_payload_source"
      || value.worker_request_marker_policy
        !== "preserved_not_granted_and_not_invoked_until_later_dispatch"
      || value.command_reuse_policy !== "forbidden_across_parent_claim_attempt_or_lease_generation"
      || value.renewal_policy
        !== "new_lease_generation_requires_new_claim_observation_clock_and_command"
      || value.retry_policy
        !== "same_natural_key_requires_identical_evidence_new_attempt_requires_new_command"
      || value.revocation_gate
        !== "lease_expiry_cancellation_or_fencing_must_block_successor_intent"
      || canonicalJson(value.required_response_echo_fields)
        !== canonicalJson(["execution_admission_command_hash", "worker_request_hash"])
      || value.command_instance_count !== 1 || value.process_launch_intent_count !== 0
      || value.authority_capsule_count !== 0 || value.spawn_revalidation_count !== 0
      || value.worker_process_count !== 0 || value.request_frame_instance_count !== 0
      || value.request_decode_receipt_count !== 0 || value.response_frame_instance_count !== 0
      || value.blocker_set_policy !== "complete_deterministic_ordered_post_successor_command_blockers"
      || canonicalJson(value.blockers) !== canonicalJson(COMMAND_BLOCKERS)
      || value.dispatch_occurrence !== "not_materialized"
      || value.transport_activation !== "command_issued_successor_intent_blocked"
      || value.harness_invocation !== "forbidden" || value.response_admission !== "not_granted"
      || value.decision_output_authority !== "none" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.trial_authority !== "none") {
    throw new Error("unsupported successor Execution Admission Command authority")
  }
  for (const item of [value.command_id, value.command_ref, value.attempt_id, value.worker_id]) {
    requireText(item, "successor Execution Admission Command identity")
  }
  for (const item of [value.command_key, value.command_hash,
    value.source_successor_execution_contract_admission_hash, value.source_parent_canonical_file_sha256,
    value.source_execution_admission_contract_hash, value.source_artifact_bound_transport_contract_hash,
    value.source_dispatch_claim_hash, value.control_plane_registry_read_receipt_hash,
    value.control_plane_clock_attestation_hash, value.target_logical_request_id,
    value.target_worker_request_hash, value.current_lease_observation_hash,
    value.current_attempt_lease_hash, value.successor_process_artifact_hash,
    value.transport_contract_hash]) requireHash(item, "successor Execution Admission Command hash")
  requireUtc(value.issued_at, "successor Execution Admission Command issued_at")
  requireUtc(value.valid_before, "successor Execution Admission Command valid_before")
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim(value.source_dispatch_claim)
  assertReplayDispatchClockAttestationView(value.control_plane_clock_attestation)
  const claim = value.source_dispatch_claim
  const clock = value.control_plane_clock_attestation
  const receipt = clock.source_registry_read_receipt
  const observation = receipt.source_observation
  const lease = receipt.current_attempt_lease
  const key = replayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommandKey({
    source_successor_execution_contract_admission_hash:
      value.source_successor_execution_contract_admission_hash,
    source_execution_admission_contract_hash: value.source_execution_admission_contract_hash,
    source_dispatch_claim_hash: value.source_dispatch_claim_hash,
    control_plane_clock_attestation_hash: value.control_plane_clock_attestation_hash,
    target_worker_request_hash: value.target_worker_request_hash,
    transport_contract_hash: value.transport_contract_hash,
    command_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION,
  })
  const { command_hash: commandHash, ...body } = value
  if (value.command_key !== key
      || value.command_id !== `decision-harness-worker-v10-successor-execution-command-${key.slice(0, 24)}`
      || value.command_ref !== `command://replay-decision-harness-worker-v10-successor/${key.slice(0, 24)}`
      || value.source_dispatch_claim_hash !== claim.claim_hash
      || value.source_successor_execution_contract_admission_hash
        !== claim.source_successor_execution_contract_admission_hash
      || value.source_parent_canonical_file_sha256 !== claim.source_parent_canonical_file_sha256
      || value.source_artifact_bound_transport_contract_hash !== value.transport_contract_hash
      || value.control_plane_registry_read_receipt_hash !== receipt.receipt_hash
      || value.control_plane_clock_attestation_hash !== clock.attestation_hash
      || value.current_lease_observation_hash !== observation.observation_hash
      || value.current_attempt_lease_hash !== receipt.current_attempt_lease_hash
      || value.target_logical_request_id !== claim.target_logical_request_id
      || value.target_worker_request_hash !== claim.target_worker_request_hash
      || value.attempt_id !== claim.attempt_id || value.attempt_id !== clock.attempt_id
      || value.attempt_ordinal !== claim.attempt_ordinal
      || value.attempt_ordinal !== observation.attempt_ordinal
      || value.worker_id !== claim.worker_id || value.worker_id !== clock.worker_id
      || value.lease_generation !== claim.lease_generation
      || value.lease_generation !== clock.lease_generation
      || value.issued_at !== clock.registry_read_completed_at
      || value.valid_before !== lease.lease_expires_at
      || Date.parse(claim.claimed_at) >= Date.parse(observation.observed_at)
      || Date.parse(value.issued_at) >= Date.parse(value.valid_before)
      || commandHash !== canonicalHash(body)) {
    throw new Error("successor Execution Admission Command evidence or validity drift")
  }
}

export interface ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission {
  schema_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_COMMAND_ADMISSION_SCHEMA_VERSION
  admission_id: string
  admission_ref: string
  admission_key: string
  admission_hash: string
  admission_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_COMMAND_ADMISSION_POLICY_VERSION
  scope: "one_successor_dispatch_claim_and_execution_admission_command"
  owner: "replay_runner_worker_v10_successor_execution_command_registry"
  purpose: "issue_generation_specific_command_after_fresh_control_plane_authority_evidence"
  status: "successor_command_admitted_process_launch_intent_not_materialized"
  source_successor_execution_contract_admission_hash: string
  source_parent_canonical_file_sha256: string
  source_execution_admission_contract_hash: string
  source_artifact_bound_transport_contract_hash: string
  successor_dispatch_claim_hash: string
  successor_execution_admission_command_hash: string
  successor_execution_admission_command:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand
  target_logical_request_id: string
  target_worker_request_hash: string
  target_worker_request_execution_admission: "not_granted"
  target_worker_request_transport_status: "not_invoked"
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  predecessor_lease_generation: number
  successor_lease_generation: number
  parent_validation_policy:
    "first_registration_direct_parent_self_hash_successor_reads_file_sha256_key_hash_reference"
  evidence_binding_policy:
    "thin_direct_parent_hash_closure_with_embedded_command_authority_evidence"
  registry_durability: "replay_local_immutable_cas_regular_file_canonical_json"
  successor_dispatch_claim_count: 1
  successor_current_lease_observation_count: 1
  successor_registry_read_receipt_count: 1
  successor_clock_attestation_count: 1
  successor_execution_admission_command_count: 1
  successor_process_launch_intent_count: 0
  successor_authority_capsule_count: 0
  successor_spawn_revalidation_count: 0
  successor_worker_process_count: 0
  successor_worker_request_frame_count: 0
  successor_worker_request_decode_count: 0
  second_response_count: 0
  second_schedule_admission_count: 0
  reproducibility_pair_count: 0
  harness_receipt_count: 0
  transport_authority: "artifact_bound_command_issued_activation_blocked"
  command_authority: "issued_for_exact_successor_process_launch_intent_creation_only"
  worker_process_authority: "none"
  blockers: typeof ADMISSION_BLOCKERS
  decision_output_authority: "first_schedule_matched_claim_only_successor_command_admitted"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmissionBody = Omit<
  ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
  "admission_hash"
>

export function replayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmissionKey(input: {
  source_successor_execution_contract_admission_hash: string
  successor_dispatch_claim_hash: string
  successor_execution_admission_command_hash: string
  admission_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_COMMAND_ADMISSION_POLICY_VERSION
}): string {
  for (const item of [input.source_successor_execution_contract_admission_hash,
    input.successor_dispatch_claim_hash, input.successor_execution_admission_command_hash]) {
    requireHash(item, "successor execution Command Admission key hash")
  }
  if (input.admission_policy_version
      !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_COMMAND_ADMISSION_POLICY_VERSION) {
    throw new Error("unsupported successor execution Command Admission key")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission(
  body: ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmissionBody,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission {
  const value = { ...structuredClone(body), admission_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission(
  value: ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
): void {
  assertExactFields(value, ADMISSION_FIELDS, "successor execution Command Admission")
  if (value.schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_COMMAND_ADMISSION_SCHEMA_VERSION
      || value.admission_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_COMMAND_ADMISSION_POLICY_VERSION
      || value.scope !== "one_successor_dispatch_claim_and_execution_admission_command"
      || value.owner !== "replay_runner_worker_v10_successor_execution_command_registry"
      || value.purpose
        !== "issue_generation_specific_command_after_fresh_control_plane_authority_evidence"
      || value.status !== "successor_command_admitted_process_launch_intent_not_materialized"
      || value.target_worker_request_execution_admission !== "not_granted"
      || value.target_worker_request_transport_status !== "not_invoked"
      || value.parent_validation_policy
        !== "first_registration_direct_parent_self_hash_successor_reads_file_sha256_key_hash_reference"
      || value.evidence_binding_policy
        !== "thin_direct_parent_hash_closure_with_embedded_command_authority_evidence"
      || value.registry_durability !== "replay_local_immutable_cas_regular_file_canonical_json"
      || value.successor_dispatch_claim_count !== 1
      || value.successor_current_lease_observation_count !== 1
      || value.successor_registry_read_receipt_count !== 1
      || value.successor_clock_attestation_count !== 1
      || value.successor_execution_admission_command_count !== 1
      || value.successor_process_launch_intent_count !== 0 || value.successor_authority_capsule_count !== 0
      || value.successor_spawn_revalidation_count !== 0 || value.successor_worker_process_count !== 0
      || value.successor_worker_request_frame_count !== 0 || value.successor_worker_request_decode_count !== 0
      || value.second_response_count !== 0 || value.second_schedule_admission_count !== 0
      || value.reproducibility_pair_count !== 0 || value.harness_receipt_count !== 0
      || value.transport_authority !== "artifact_bound_command_issued_activation_blocked"
      || value.command_authority
        !== "issued_for_exact_successor_process_launch_intent_creation_only"
      || value.worker_process_authority !== "none"
      || canonicalJson(value.blockers) !== canonicalJson(ADMISSION_BLOCKERS)
      || value.decision_output_authority
        !== "first_schedule_matched_claim_only_successor_command_admitted"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported successor execution Command Admission authority")
  }
  for (const item of [value.admission_id, value.admission_ref, value.attempt_id, value.worker_id]) {
    requireText(item, "successor execution Command Admission identity")
  }
  for (const item of [value.admission_key, value.admission_hash,
    value.source_successor_execution_contract_admission_hash, value.source_parent_canonical_file_sha256,
    value.source_execution_admission_contract_hash, value.source_artifact_bound_transport_contract_hash,
    value.successor_dispatch_claim_hash, value.successor_execution_admission_command_hash,
    value.target_logical_request_id, value.target_worker_request_hash]) {
    requireHash(item, "successor execution Command Admission hash")
  }
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand(
    value.successor_execution_admission_command,
  )
  const command = value.successor_execution_admission_command
  const key = replayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmissionKey({
    source_successor_execution_contract_admission_hash:
      value.source_successor_execution_contract_admission_hash,
    successor_dispatch_claim_hash: value.successor_dispatch_claim_hash,
    successor_execution_admission_command_hash: value.successor_execution_admission_command_hash,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_COMMAND_ADMISSION_POLICY_VERSION,
  })
  const { admission_hash: admissionHash, ...body } = value
  if (value.admission_key !== key
      || value.admission_id !== `decision-harness-worker-v10-successor-command-${key.slice(0, 24)}`
      || value.admission_ref !== `admission://replay-decision-harness-worker-v10-successor-command/${key.slice(0, 24)}`
      || value.successor_dispatch_claim_hash !== command.source_dispatch_claim_hash
      || value.successor_execution_admission_command_hash !== command.command_hash
      || value.source_successor_execution_contract_admission_hash
        !== command.source_successor_execution_contract_admission_hash
      || value.source_execution_admission_contract_hash
        !== command.source_execution_admission_contract_hash
      || value.source_artifact_bound_transport_contract_hash
        !== command.source_artifact_bound_transport_contract_hash
      || value.target_logical_request_id !== command.target_logical_request_id
      || value.target_worker_request_hash !== command.target_worker_request_hash
      || value.attempt_id !== command.attempt_id || value.attempt_ordinal !== command.attempt_ordinal
      || value.worker_id !== command.worker_id
      || value.successor_lease_generation !== command.lease_generation
      || value.successor_lease_generation !== value.predecessor_lease_generation + 1
      || admissionHash !== canonicalHash(body)) {
    throw new Error("successor execution Command Admission lineage or hash drift")
  }
}

export function assertReplayDecisionHarnessWorkerV10SuccessorExecutionCommandLineage(
  value: ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
  parent: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
): void {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission(value)
  const command = value.successor_execution_admission_command
  const claim = command.source_dispatch_claim
  const transport = parent.successor_artifact_bound_transport_contract
  const execution = parent.successor_execution_admission_contract
  if (value.source_successor_execution_contract_admission_hash !== parent.admission_hash
      || value.source_execution_admission_contract_hash !== execution.contract_hash
      || value.source_artifact_bound_transport_contract_hash !== transport.contract_hash
      || command.source_successor_execution_contract_admission_hash !== parent.admission_hash
      || command.source_execution_admission_contract_hash !== execution.contract_hash
      || command.source_artifact_bound_transport_contract_hash !== transport.contract_hash
      || command.successor_process_artifact_hash !== transport.successor_process_artifact_hash
      || command.transport_contract_hash !== transport.contract_hash
      || command.target_logical_request_id !== parent.target_logical_request_id
      || command.target_worker_request_hash !== parent.target_worker_request_hash
      || claim.source_successor_execution_contract_admission_hash !== parent.admission_hash
      || claim.source_parent_canonical_file_sha256 !== value.source_parent_canonical_file_sha256
      || command.source_parent_canonical_file_sha256 !== value.source_parent_canonical_file_sha256
      || claim.attempt_id !== parent.attempt_id || claim.attempt_ordinal !== parent.attempt_ordinal
      || claim.worker_id !== parent.worker_id
      || claim.lease_generation !== parent.successor_lease_generation) {
    throw new Error("successor execution Command direct parent binding drift")
  }
}

const CLAIM_FIELDS = ["attempt_id", "attempt_ordinal", "claim_authority_limit", "claim_effect",
  "claim_hash", "claim_id", "claim_key", "claim_policy_version", "claim_ref", "claim_reuse_policy",
  "claimed_at", "dispatcher_claimant_id", "dispatch_occurrence", "economic_authority",
  "execution_admission_command_instance_count", "harness_invocation", "lease_generation",
  "natural_key_policy", "order_authority", "owner", "schema_version", "scope", "signal_authority",
  "source_parent_canonical_file_sha256", "source_successor_execution_contract_admission_hash", "status",
  "target_logical_request_id", "target_worker_request_hash", "transport_activation", "trial_authority",
  "worker_id", "worker_process_count"].sort()

const COMMAND_FIELDS = ["attempt_id", "attempt_ordinal", "authority_capsule_count", "blocker_set_policy",
  "blockers", "command_hash", "command_id", "command_identity_policy", "command_instance_count",
  "command_key", "command_policy_version", "command_ref", "command_reuse_policy",
  "control_plane_clock_attestation", "control_plane_clock_attestation_hash",
  "control_plane_registry_read_receipt_hash", "current_attempt_lease_hash",
  "current_lease_observation_hash", "decision_output_authority", "dispatch_occurrence",
  "economic_authority", "evidence_binding_policy", "execution_admission", "harness_invocation",
  "issuance_time_semantics", "issued_at", "lease_generation", "natural_key_policy", "order_authority",
  "owner", "process_launch_intent_count", "renewal_policy", "request_decode_receipt_count",
  "request_frame_instance_count", "required_response_echo_fields", "response_admission",
  "response_frame_instance_count", "retry_policy", "revocation_gate", "schema_version", "scope",
  "signal_authority", "source_artifact_bound_transport_contract_hash", "source_dispatch_claim",
  "source_dispatch_claim_hash", "source_execution_admission_contract_hash",
  "source_parent_canonical_file_sha256", "source_successor_execution_contract_admission_hash",
  "spawn_revalidation_count", "status", "successor_process_artifact_hash", "target_logical_request_id",
  "target_worker_request_hash", "transport_activation", "transport_contract_hash", "trial_authority",
  "valid_before", "worker_id", "worker_process_count", "worker_request_marker_policy",
  "worker_request_v10_role"].sort()

const ADMISSION_FIELDS = ["admission_hash", "admission_id", "admission_key", "admission_policy_version",
  "admission_ref", "attempt_id", "attempt_ordinal", "blockers", "command_authority",
  "decision_output_authority", "economic_authority", "evidence_binding_policy", "harness_receipt_count",
  "order_authority", "owner", "parent_validation_policy", "predecessor_lease_generation", "purpose",
  "registry_durability", "reproducibility_pair_count", "schema_version", "scope", "second_response_count",
  "second_schedule_admission_count", "signal_authority", "source_artifact_bound_transport_contract_hash",
  "source_execution_admission_contract_hash", "source_parent_canonical_file_sha256",
  "source_successor_execution_contract_admission_hash", "status", "successor_authority_capsule_count",
  "successor_clock_attestation_count", "successor_current_lease_observation_count",
  "successor_dispatch_claim_count", "successor_dispatch_claim_hash",
  "successor_execution_admission_command", "successor_execution_admission_command_count",
  "successor_execution_admission_command_hash", "successor_lease_generation",
  "successor_process_launch_intent_count", "successor_registry_read_receipt_count",
  "successor_spawn_revalidation_count", "successor_worker_process_count",
  "successor_worker_request_decode_count", "successor_worker_request_frame_count",
  "target_logical_request_id", "target_worker_request_execution_admission",
  "target_worker_request_hash", "target_worker_request_transport_status", "transport_authority",
  "trial_authority", "worker_id", "worker_process_authority"].sort()

function assertExactFields(value: object, expected: string[], label: string): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(expected)) {
    throw new Error(`${label} field whitelist drift`)
  }
}
