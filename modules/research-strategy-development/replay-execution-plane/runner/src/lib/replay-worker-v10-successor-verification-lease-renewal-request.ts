import {
  REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_REQUEST_POLICY_VERSION,
  REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_REQUEST_SCHEMA_VERSION,
  createReplaySuccessorVerificationLeaseRenewalRequest,
  hashReplayAttemptLeaseSnapshot,
  replaySuccessorVerificationLeaseRenewalRequestKey,
  type ReplayAttemptLeaseSnapshot,
  type ReplaySuccessorVerificationLeaseRenewalRequest,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract,
  type ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-verification-authority-contract"

export interface BuildReplayWorkerV10SuccessorVerificationLeaseRenewalRequestInput {
  source_successor_authority_contract:
    ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract
  requested_lease_expires_at: string
}

export function buildReplayWorkerV10SuccessorVerificationLeaseRenewalRequest(
  input: BuildReplayWorkerV10SuccessorVerificationLeaseRenewalRequestInput,
): ReplaySuccessorVerificationLeaseRenewalRequest {
  assertReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract(
    input.source_successor_authority_contract,
  )
  const authority = input.source_successor_authority_contract
  const pair = authority.source_reproducibility_pair_contract
  const predecessor = extractFirstAttemptLease(authority)
  if (!Number.isFinite(Date.parse(input.requested_lease_expires_at))
      || Date.parse(input.requested_lease_expires_at) <= Date.parse(predecessor.lease_expires_at)) {
    throw new Error("successor verification Lease renewal Request must propose a later UTC expiry")
  }
  const key = replaySuccessorVerificationLeaseRenewalRequestKey({
    source_successor_authority_contract_hash: authority.contract_hash,
    attempt_id: authority.source_first_attempt_id,
    worker_id: authority.source_first_worker_id,
    expected_current_lease_generation: authority.source_first_lease_generation,
    request_policy_version: REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_REQUEST_POLICY_VERSION,
  })
  return createReplaySuccessorVerificationLeaseRenewalRequest({
    schema_version: REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_REQUEST_SCHEMA_VERSION,
    request_id: `replay-successor-verification-lease-renewal-${key.slice(0, 24)}`,
    request_ref: `request://replay-successor-verification-lease-renewal/${key.slice(0, 24)}`,
    request_key: key,
    request_policy_version: REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_REQUEST_POLICY_VERSION,
    status: "successor_verification_lease_renewal_requested",
    requester_owner: "replay_runner",
    authority_target: "research_control_plane",
    purpose: "second_reproducibility_member_same_attempt_successor_generation",
    source_successor_authority_contract_hash: authority.contract_hash,
    source_reproducibility_pair_contract_hash: pair.contract_hash,
    source_first_schedule_admission_hash: authority.source_first_schedule_admission_hash,
    source_first_execution_envelope_hash: authority.source_first_execution_envelope_hash,
    logical_request_id: pair.logical_request_id,
    worker_request_hash: pair.worker_request_hash,
    replay_execution_request_hash: pair.replay_execution_request_hash,
    attempt_id: authority.source_first_attempt_id,
    attempt_ordinal: authority.source_first_attempt_ordinal,
    worker_id: authority.source_first_worker_id,
    expected_current_lease_generation: authority.source_first_lease_generation,
    expected_current_attempt_lease_hash: authority.source_first_attempt_lease_hash,
    minimum_successor_lease_generation: authority.minimum_successor_lease_generation,
    requested_lease_expires_at: input.requested_lease_expires_at,
    source_evidence_role: "opaque_replay_hash_binding_control_plane_does_not_revalidate_replay_lineage",
    request_authority: "none_control_plane_must_atomically_admit_or_reject",
    process_authority: "none",
    harness_authority: "none",
    economic_authority: "none",
  })
}

function extractFirstAttemptLease(
  authority: ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract,
): ReplayAttemptLeaseSnapshot {
  const launch = authority.source_reproducibility_pair_contract.source_schedule_admission
    .source_response_validation.source_dispatch_receipt.source_dispatch_attempt.source_process_launch_receipt
  const command = launch.source_launch_attempt.source_spawn_revalidation.source_authority_capsule
    .source_authority_process_launch_intent.source_authority_execution_admission_command
  const lease = command.control_plane_clock_attestation.source_registry_read_receipt.current_attempt_lease
  if (hashReplayAttemptLeaseSnapshot(lease) !== authority.source_first_attempt_lease_hash) {
    throw new Error("successor verification authority does not embed its exact predecessor Lease")
  }
  return structuredClone(lease)
}
