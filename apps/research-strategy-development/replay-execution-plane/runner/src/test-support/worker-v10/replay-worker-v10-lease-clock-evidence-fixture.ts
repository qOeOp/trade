import {
  REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_POLICY_VERSION,
  REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_SCHEMA_VERSION,
  REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION,
  REPLAY_DISPATCH_CLOCK_ATTESTATION_SCHEMA_VERSION,
  createReplayAttemptLeaseObservationRegistryReadReceipt,
  createReplayDispatchClockAttestation,
  replayDispatchClockAttestationIdentityHash,
  type ReplayAttemptLeaseObservationSnapshot,
} from "../../../../../research-control-plane/contracts/src/lib/control-plane-contracts"

export function createReplayWorkerV10LeaseClockEvidenceFixture(input: {
  observation: ReplayAttemptLeaseObservationSnapshot
  registered_at: string
  read_at: string
  read_started_monotonic_ns: string
}) {
  const receipt = createReplayAttemptLeaseObservationRegistryReadReceipt({
    schema_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_SCHEMA_VERSION,
    receipt_id:
      `replay-attempt-lease-observation-registry-read-${input.observation.observation_hash.slice(0, 16)}-${Date.parse(input.read_at)}`,
    receipt_ref:
      `receipt://replay-attempt-lease-observation-registry-read/${input.observation.observation_hash.slice(0, 16)}-${Date.parse(input.read_at)}`,
    receipt_policy_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_POLICY_VERSION,
    status: "registered_active_lease_observation_read",
    authority_owner: "research_control_plane",
    authority_source: "research_control_plane_state_store",
    registry_table: "rd_replay_attempt_lease_observation",
    registry_key: input.observation.observation_id,
    registry_row_immutability: "sqlite_update_and_delete_triggers",
    read_consistency: "single_control_plane_transaction",
    registry_read_provenance: "registered_row_and_current_attempt_exact_match",
    registered_at: input.registered_at,
    read_at: input.read_at,
    clock_evidence: "caller_supplied_utc_not_external_time_attestation",
    external_time_attestation: "not_provided",
    source_observation_id: input.observation.observation_id,
    source_observation_ref: input.observation.observation_ref,
    source_observation_hash: input.observation.observation_hash,
    source_observation: input.observation,
    current_attempt_status: input.observation.attempt_lease.status,
    current_attempt_lease_hash: input.observation.attempt_lease_hash,
    current_attempt_lease: input.observation.attempt_lease,
  })
  return {
    registry_receipt: receipt,
    build_clock: (completedAt: string, completedMonotonicNs: string) => {
      const identityHash = replayDispatchClockAttestationIdentityHash({
        source_registry_read_receipt_hash: receipt.receipt_hash,
        registry_read_started_at: input.read_at,
        registry_read_completed_at: completedAt,
        registry_read_started_monotonic_ns: input.read_started_monotonic_ns,
        registry_read_completed_monotonic_ns: completedMonotonicNs,
        attestation_policy_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION,
      })
      return createReplayDispatchClockAttestation({
        schema_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_SCHEMA_VERSION,
        attestation_id: `replay-dispatch-clock-attestation-${identityHash.slice(0, 24)}`,
        attestation_ref: `attestation://replay-dispatch-clock/${identityHash.slice(0, 24)}`,
        attestation_policy_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION,
        status: "authority_clock_bracketed_registry_read",
        authority_owner: "research_control_plane",
        authority_source: "research_control_plane_state_store",
        clock_source: "control_plane_authority_process_clock_port",
        clock_independence: "authority_internal_sampling_without_caller_timestamp_input",
        caller_time_input: "forbidden",
        wall_clock_source: "javascript_date_now_utc",
        monotonic_clock_source: "process_hrtime_bigint",
        external_time_attestation: "not_provided",
        registry_read_bracketing:
          "wall_and_monotonic_samples_before_and_after_single_transaction_read",
        registry_read_started_at: input.read_at,
        registry_read_completed_at: completedAt,
        registry_read_started_monotonic_ns: input.read_started_monotonic_ns,
        registry_read_completed_monotonic_ns: completedMonotonicNs,
        source_registry_read_receipt_id: receipt.receipt_id,
        source_registry_read_receipt_ref: receipt.receipt_ref,
        source_registry_read_receipt_hash: receipt.receipt_hash,
        source_registry_read_receipt: receipt,
        attempt_id: receipt.current_attempt_lease.attempt_id,
        worker_id: receipt.current_attempt_lease.worker_id,
        lease_generation: receipt.current_attempt_lease.lease_generation,
        current_attempt_lease_hash: receipt.current_attempt_lease_hash,
      })
    },
  }
}
