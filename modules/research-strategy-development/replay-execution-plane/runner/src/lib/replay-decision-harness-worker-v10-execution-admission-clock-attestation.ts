import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_CLOCK_ATTESTATION_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_CLOCK_ATTESTATION_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation,
  assertReplayDispatchClockAttestationView,
  createReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation,
  replayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestationBlockers,
  replayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestationKey,
  type ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation,
  type ReplayDispatchClockAttestationView,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance,
  type ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-registry-provenance"

export interface BuildReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestationInput {
  source_registry_provenance: ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance
  control_plane_clock_attestation: ReplayDispatchClockAttestationView
}

export function buildReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation(
  input: BuildReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestationInput,
): ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance(input.source_registry_provenance)
  assertReplayDispatchClockAttestationView(input.control_plane_clock_attestation)
  const provenance = input.source_registry_provenance
  const clock = input.control_plane_clock_attestation
  const key = replayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestationKey({
    registry_provenance_hash: provenance.provenance_hash,
    clock_attestation_hash: clock.attestation_hash,
    binding_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_CLOCK_ATTESTATION_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_CLOCK_ATTESTATION_SCHEMA_VERSION,
    binding_id: `decision-harness-worker-v10-execution-clock-attestation-${key.slice(0, 24)}`,
    binding_key: key,
    binding_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_CLOCK_ATTESTATION_POLICY_VERSION,
    scope: "attempt_bound_execution_admission_clock_attestation_only",
    owner: "replay_runner_worker_v10_execution_admission_clock_attestation_registry",
    status: "authority_clock_attested_command_issue_blocked",
    source_registry_provenance_id: provenance.provenance_id,
    source_registry_provenance_hash: provenance.provenance_hash,
    source_registry_provenance: structuredClone(provenance),
    control_plane_clock_attestation_id: clock.attestation_id,
    control_plane_clock_attestation_ref: clock.attestation_ref,
    control_plane_clock_attestation_hash: clock.attestation_hash,
    control_plane_clock_attestation: structuredClone(clock),
    target_logical_request_id: provenance.target_logical_request_id,
    target_worker_request_hash: provenance.target_worker_request_hash,
    attempt_id: provenance.attempt_id,
    attempt_ordinal: provenance.attempt_ordinal,
    worker_id: provenance.worker_id,
    lease_generation: provenance.lease_generation,
    current_attempt_lease_hash: provenance.current_attempt_lease_hash,
    independent_dispatch_clock_attestation: "authority_internal_dual_sample_bound",
    external_time_attestation: "not_provided_not_required_for_local_authority_clock_independence",
    clock_authority_limit: "local_control_plane_process_clock_not_signed_remote_or_tsa_time",
    predecessor_blocker_closure: "independent_dispatch_clock_attestation_closed_only",
    execution_admission_command: null,
    execution_admission_command_instance_count: 0,
    command_issue_status: "blocked",
    blocker_set_policy: "complete_deterministic_ordered_post_clock_attestation_blockers",
    blockers: replayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestationBlockers(),
    attempt_bound_process_launch_intent: null,
    attempt_bound_process_receipt: null,
    request_frame_instance_count: 0,
    request_write_receipt_count: 0,
    request_decode_receipt_count: 0,
    response_frame_instance_count: 0,
    response_read_receipt_count: 0,
    dispatch_occurrence: "not_materialized",
    transport_activation: "blocked",
    harness_invocation: "forbidden",
    response_admission: "not_granted",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}

export function assertReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestationLineage(
  value: ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation,
  input: BuildReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestationInput,
): void {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation(value)
  if (canonicalHash(value) !== canonicalHash(buildReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation(input))) {
    throw new Error("Execution Admission clock attestation lineage drift")
  }
}
