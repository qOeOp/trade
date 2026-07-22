import { expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  REPLAY_ATTEMPT_LEASE_OBSERVATION_POLICY_VERSION,
  REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_POLICY_VERSION,
  REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_SCHEMA_VERSION,
  REPLAY_ATTEMPT_LEASE_OBSERVATION_SCHEMA_VERSION,
  REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION,
  REPLAY_DISPATCH_CLOCK_ATTESTATION_SCHEMA_VERSION,
  createReplayAttemptLeaseObservationRegistryReadReceipt,
  createReplayAttemptLeaseObservationSnapshot,
  createReplayDispatchClockAttestation,
  replayDispatchClockAttestationIdentityHash,
  type ReplayAttemptLeaseObservationSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-command-admission"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-contract-admission"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-stdio-probe-admission"
import { assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-process-launch-intent"
import {
  issueReplayWorkerV10SuccessorProcessLaunchIntent,
  readReplayWorkerV10SuccessorProcessLaunchIntent,
} from "./replay-worker-v10-successor-process-launch-intent-registry"

export interface ReplayWorkerV10SuccessorIntentStageInput {
  registry_root: string
  successor_command_admission:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission
  successor_execution_contract_admission:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission
  successor_stdio_probe_admission:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission
  command_observation: ReplayAttemptLeaseObservationSnapshot
  requested_successor_lease_expiry: string
  profile(stage: string): void
}

export function runReplayWorkerV10SuccessorIntentStage(
  input: ReplayWorkerV10SuccessorIntentStageInput,
) {
  const dispatchEvidenceRegistryRoot = input.registry_root
  const successorCommandAdmission = input.successor_command_admission
  const successorExecutionContractAdmission = input.successor_execution_contract_admission
  const successorStdioProbeAdmission = input.successor_stdio_probe_admission
  const successorCommandObservation = input.command_observation
  const successorExecutionCommand =
    successorCommandAdmission.successor_execution_admission_command
  const successorDispatchClaim = successorExecutionCommand.source_dispatch_claim
  const requestedSuccessorLeaseExpiry = input.requested_successor_lease_expiry
  const replayProfile = input.profile

  const successorIntentObservation = createReplayAttemptLeaseObservationSnapshot({
    schema_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_SCHEMA_VERSION,
    observation_id: "lease-observation-envelope-successor-intent",
    observation_ref: "observation://replay-attempt-lease/envelope-successor-intent",
    observation_policy_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_POLICY_VERSION,
    status: "active_lease_observed",
    observed_at: "2026-07-14T00:04:05Z",
    authority_owner: "research_control_plane",
    authority_source: "research_control_plane_state_store",
    read_consistency: "single_control_plane_transaction",
    clock_evidence: "caller_supplied_utc_not_external_time_attestation",
    trial_id: successorCommandObservation.trial_id,
    run_id: successorCommandObservation.run_id,
    attempt_id: successorCommandObservation.attempt_id,
    attempt_ordinal: successorCommandObservation.attempt_ordinal,
    worker_id: successorCommandObservation.worker_id,
    lease_generation: successorCommandObservation.lease_generation,
    attempt_lease_hash: successorCommandObservation.attempt_lease_hash,
    attempt_lease: structuredClone(successorCommandObservation.attempt_lease),
  })
  const successorIntentRegistryReceipt = createReplayAttemptLeaseObservationRegistryReadReceipt({
    schema_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_SCHEMA_VERSION,
    receipt_id:
      `replay-attempt-lease-observation-registry-read-${successorIntentObservation.observation_hash.slice(0, 16)}-${Date.parse("2026-07-14T00:04:06Z")}`,
    receipt_ref:
      `receipt://replay-attempt-lease-observation-registry-read/${successorIntentObservation.observation_hash.slice(0, 16)}-${Date.parse("2026-07-14T00:04:06Z")}`,
    receipt_policy_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_POLICY_VERSION,
    status: "registered_active_lease_observation_read",
    authority_owner: "research_control_plane",
    authority_source: "research_control_plane_state_store",
    registry_table: "rd_replay_attempt_lease_observation",
    registry_key: successorIntentObservation.observation_id,
    registry_row_immutability: "sqlite_update_and_delete_triggers",
    read_consistency: "single_control_plane_transaction",
    registry_read_provenance: "registered_row_and_current_attempt_exact_match",
    registered_at: successorIntentObservation.observed_at,
    read_at: "2026-07-14T00:04:06Z",
    clock_evidence: "caller_supplied_utc_not_external_time_attestation",
    external_time_attestation: "not_provided",
    source_observation_id: successorIntentObservation.observation_id,
    source_observation_ref: successorIntentObservation.observation_ref,
    source_observation_hash: successorIntentObservation.observation_hash,
    source_observation: structuredClone(successorIntentObservation),
    current_attempt_status: successorIntentObservation.attempt_lease.status,
    current_attempt_lease_hash: successorIntentObservation.attempt_lease_hash,
    current_attempt_lease: structuredClone(successorIntentObservation.attempt_lease),
  })
  const successorIntentClockIdentityHash = replayDispatchClockAttestationIdentityHash({
    source_registry_read_receipt_hash: successorIntentRegistryReceipt.receipt_hash,
    registry_read_started_at: successorIntentRegistryReceipt.read_at,
    registry_read_completed_at: "2026-07-14T00:04:07Z",
    registry_read_started_monotonic_ns: "9000000",
    registry_read_completed_monotonic_ns: "9000100",
    attestation_policy_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION,
  })
  const successorIntentClockAttestation = createReplayDispatchClockAttestation({
    schema_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_SCHEMA_VERSION,
    attestation_id: `replay-dispatch-clock-attestation-${successorIntentClockIdentityHash.slice(0, 24)}`,
    attestation_ref:
      `attestation://replay-dispatch-clock/${successorIntentClockIdentityHash.slice(0, 24)}`,
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
    registry_read_started_at: successorIntentRegistryReceipt.read_at,
    registry_read_completed_at: "2026-07-14T00:04:07Z",
    registry_read_started_monotonic_ns: "9000000",
    registry_read_completed_monotonic_ns: "9000100",
    source_registry_read_receipt_id: successorIntentRegistryReceipt.receipt_id,
    source_registry_read_receipt_ref: successorIntentRegistryReceipt.receipt_ref,
    source_registry_read_receipt_hash: successorIntentRegistryReceipt.receipt_hash,
    source_registry_read_receipt: structuredClone(successorIntentRegistryReceipt),
    attempt_id: successorIntentRegistryReceipt.current_attempt_lease.attempt_id,
    worker_id: successorIntentRegistryReceipt.current_attempt_lease.worker_id,
    lease_generation: successorIntentRegistryReceipt.current_attempt_lease.lease_generation,
    current_attempt_lease_hash: successorIntentRegistryReceipt.current_attempt_lease_hash,
  })
  const successorIntentInput = {
    source_successor_execution_command_admission: successorCommandAdmission,
    source_successor_execution_contract_admission: successorExecutionContractAdmission,
    source_successor_stdio_probe_admission: successorStdioProbeAdmission,
    post_command_lease_observation: successorIntentObservation,
    post_command_registry_read_receipt: successorIntentRegistryReceipt,
    post_command_clock_attestation: successorIntentClockAttestation,
  }
  const missingSuccessorIntentRoot = mkdtempSync(
    join(tmpdir(), "replay-worker-v10-successor-process-launch-intent-missing-"),
  )
  try {
    expect(() => issueReplayWorkerV10SuccessorProcessLaunchIntent({
      registry_root: missingSuccessorIntentRoot,
      ...successorIntentInput,
    })).toThrow("requires exact durable R4.148 Command Admission")
  } finally {
    rmSync(missingSuccessorIntentRoot, { recursive: true, force: true })
  }
  const successorProcessLaunchIntent = issueReplayWorkerV10SuccessorProcessLaunchIntent({
    registry_root: dispatchEvidenceRegistryRoot,
    ...successorIntentInput,
  })
  replayProfile("successor process intent")
  expect(successorProcessLaunchIntent.status)
    .toBe("successor_intent_committed_capsule_revalidation_and_process_not_materialized")
  expect(successorProcessLaunchIntent.source_successor_execution_command_admission_hash)
    .toBe(successorCommandAdmission.admission_hash)
  expect(successorProcessLaunchIntent.source_successor_execution_contract_admission_hash)
    .toBe(successorExecutionContractAdmission.admission_hash)
  expect(successorProcessLaunchIntent.source_successor_stdio_probe_admission_hash)
    .toBe(successorStdioProbeAdmission.admission_hash)
  expect(successorProcessLaunchIntent.source_execution_admission_command_hash)
    .toBe(successorExecutionCommand.command_hash)
  expect(successorProcessLaunchIntent.source_dispatch_claim_hash)
    .toBe(successorDispatchClaim.claim_hash)
  expect(successorProcessLaunchIntent.source_stdio_capability_hash)
    .toBe(successorStdioProbeAdmission.successor_stdio_capability_hash)
  expect(successorProcessLaunchIntent.post_command_lease_observation_hash)
    .toBe(successorIntentObservation.observation_hash)
  expect(successorProcessLaunchIntent.post_command_registry_read_receipt_hash)
    .toBe(successorIntentRegistryReceipt.receipt_hash)
  expect(successorProcessLaunchIntent.post_command_clock_attestation_hash)
    .toBe(successorIntentClockAttestation.attestation_hash)
  expect(successorProcessLaunchIntent.source_command_issued_at).toBe("2026-07-14T00:04:04Z")
  expect(successorProcessLaunchIntent.intent_issued_at).toBe("2026-07-14T00:04:07Z")
  expect(successorProcessLaunchIntent.valid_before).toBe(requestedSuccessorLeaseExpiry)
  expect(successorProcessLaunchIntent.runtime_id).toBe("bun")
  expect(successorProcessLaunchIntent.runtime_version)
    .toBe(successorStdioProbeAdmission.successor_stdio_artifact_evidence.runtime.runtime_version)
  expect(successorProcessLaunchIntent.runtime_executable_hash)
    .toBe(successorStdioProbeAdmission.successor_stdio_artifact_evidence.runtime.executable_sha256)
  expect(successorProcessLaunchIntent.process_artifact_hash)
    .toBe(successorExecutionCommand.successor_process_artifact_hash)
  expect(successorProcessLaunchIntent.successor_execution_admission_command_count).toBe(1)
  expect(successorProcessLaunchIntent.successor_process_launch_intent_count).toBe(1)
  expect(successorProcessLaunchIntent.successor_authority_capsule_count).toBe(0)
  expect(successorProcessLaunchIntent.successor_spawn_revalidation_count).toBe(0)
  expect(successorProcessLaunchIntent.successor_worker_process_count).toBe(0)
  expect(successorProcessLaunchIntent.successor_worker_request_frame_count).toBe(0)
  expect(successorProcessLaunchIntent.successor_worker_request_decode_count).toBe(0)
  expect(successorProcessLaunchIntent.second_response_count).toBe(0)
  expect(successorProcessLaunchIntent.second_schedule_admission_count).toBe(0)
  expect(successorProcessLaunchIntent.reproducibility_pair_count).toBe(0)
  expect(successorProcessLaunchIntent.harness_receipt_count).toBe(0)
  expect(successorProcessLaunchIntent.process_launch_authority)
    .toBe("not_granted_until_capsule_and_fresh_spawn_boundary_revalidation")
  expect(successorProcessLaunchIntent.transport_activation)
    .toBe("intent_issued_capsule_and_spawn_blocked")
  expect(successorProcessLaunchIntent.signal_authority).toBe("none")
  expect(successorProcessLaunchIntent.order_authority).toBe("none")
  expect(successorProcessLaunchIntent.economic_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent(
    successorProcessLaunchIntent,
  )).not.toThrow()
  expect(readReplayWorkerV10SuccessorProcessLaunchIntent({
    registry_root: dispatchEvidenceRegistryRoot,
    ...successorIntentInput,
  })).toEqual(successorProcessLaunchIntent)
  expect(issueReplayWorkerV10SuccessorProcessLaunchIntent({
    registry_root: dispatchEvidenceRegistryRoot,
    ...structuredClone(successorIntentInput),
  })).toEqual(successorProcessLaunchIntent)
  expect(() => issueReplayWorkerV10SuccessorProcessLaunchIntent({
    registry_root: dispatchEvidenceRegistryRoot,
    ...successorIntentInput,
    post_command_lease_observation: successorCommandObservation,
  })).toThrow("source or post-Command revalidation drift")
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent({
    ...successorProcessLaunchIntent,
    successor_worker_process_count: 1 as never,
  })).toThrow()

  return {
    intent_input: successorIntentInput,
    process_launch_intent: successorProcessLaunchIntent,
  }
}
