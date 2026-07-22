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
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import type { ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-lease-admission"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-contract-admission"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand,
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-command-admission"
import {
  issueReplayWorkerV10SuccessorExecutionCommand,
  readReplayWorkerV10SuccessorExecutionAdmissionCommand,
  readReplayWorkerV10SuccessorExecutionCommandAdmission,
  readReplayWorkerV10SuccessorExecutionDispatchClaim,
} from "./replay-worker-v10-successor-execution-command-registry"

export interface ReplayWorkerV10SuccessorCommandStageInput {
  registry_root: string
  successor_execution_contract_admission:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission
  successor_lease_admission: ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission
  predecessor_lease_generation: number
  predecessor_execution_admission_command_hash: string
  requested_successor_lease_expiry: string
  profile(stage: string): void
}

export function runReplayWorkerV10SuccessorCommandStage(
  input: ReplayWorkerV10SuccessorCommandStageInput,
) {
  const dispatchEvidenceRegistryRoot = input.registry_root
  const successorExecutionContractAdmission = input.successor_execution_contract_admission
  const successorArtifactTransport =
    successorExecutionContractAdmission.successor_artifact_bound_transport_contract
  const successorExecutionAdmission =
    successorExecutionContractAdmission.successor_execution_admission_contract
  const successorLeaseAdmission = input.successor_lease_admission
  const attemptLease = { lease_generation: input.predecessor_lease_generation }
  const executionAdmissionCommand = {
    command_hash: input.predecessor_execution_admission_command_hash,
  }
  const requestedSuccessorLeaseExpiry = input.requested_successor_lease_expiry
  const replayProfile = input.profile

  const successorCommandObservation = createReplayAttemptLeaseObservationSnapshot({
    schema_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_SCHEMA_VERSION,
    observation_id: "lease-observation-envelope-successor-command",
    observation_ref: "observation://replay-attempt-lease/envelope-successor-command",
    observation_policy_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_POLICY_VERSION,
    status: "active_lease_observed",
    observed_at: "2026-07-14T00:04:02Z",
    authority_owner: "research_control_plane",
    authority_source: "research_control_plane_state_store",
    read_consistency: "single_control_plane_transaction",
    clock_evidence: "caller_supplied_utc_not_external_time_attestation",
    trial_id: successorLeaseAdmission.successor_attempt_lease.trial_id,
    run_id: successorLeaseAdmission.successor_attempt_lease.run_id,
    attempt_id: successorLeaseAdmission.successor_attempt_lease.attempt_id,
    attempt_ordinal: successorLeaseAdmission.successor_attempt_lease.attempt_ordinal,
    worker_id: successorLeaseAdmission.successor_attempt_lease.worker_id,
    lease_generation: successorLeaseAdmission.successor_attempt_lease.lease_generation,
    attempt_lease_hash: successorLeaseAdmission.successor_attempt_lease_hash,
    attempt_lease: structuredClone(successorLeaseAdmission.successor_attempt_lease),
  })
  const successorCommandRegistryReceipt = createReplayAttemptLeaseObservationRegistryReadReceipt({
    schema_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_SCHEMA_VERSION,
    receipt_id:
      `replay-attempt-lease-observation-registry-read-${successorCommandObservation.observation_hash.slice(0, 16)}-${Date.parse("2026-07-14T00:04:03Z")}`,
    receipt_ref:
      `receipt://replay-attempt-lease-observation-registry-read/${successorCommandObservation.observation_hash.slice(0, 16)}-${Date.parse("2026-07-14T00:04:03Z")}`,
    receipt_policy_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_POLICY_VERSION,
    status: "registered_active_lease_observation_read",
    authority_owner: "research_control_plane",
    authority_source: "research_control_plane_state_store",
    registry_table: "rd_replay_attempt_lease_observation",
    registry_key: successorCommandObservation.observation_id,
    registry_row_immutability: "sqlite_update_and_delete_triggers",
    read_consistency: "single_control_plane_transaction",
    registry_read_provenance: "registered_row_and_current_attempt_exact_match",
    registered_at: successorCommandObservation.observed_at,
    read_at: "2026-07-14T00:04:03Z",
    clock_evidence: "caller_supplied_utc_not_external_time_attestation",
    external_time_attestation: "not_provided",
    source_observation_id: successorCommandObservation.observation_id,
    source_observation_ref: successorCommandObservation.observation_ref,
    source_observation_hash: successorCommandObservation.observation_hash,
    source_observation: structuredClone(successorCommandObservation),
    current_attempt_status: successorCommandObservation.attempt_lease.status,
    current_attempt_lease_hash: successorCommandObservation.attempt_lease_hash,
    current_attempt_lease: structuredClone(successorCommandObservation.attempt_lease),
  })
  const successorCommandClockIdentityHash = replayDispatchClockAttestationIdentityHash({
    source_registry_read_receipt_hash: successorCommandRegistryReceipt.receipt_hash,
    registry_read_started_at: successorCommandRegistryReceipt.read_at,
    registry_read_completed_at: "2026-07-14T00:04:04Z",
    registry_read_started_monotonic_ns: "8000000",
    registry_read_completed_monotonic_ns: "8000100",
    attestation_policy_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION,
  })
  const successorCommandClockAttestation = createReplayDispatchClockAttestation({
    schema_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_SCHEMA_VERSION,
    attestation_id: `replay-dispatch-clock-attestation-${successorCommandClockIdentityHash.slice(0, 24)}`,
    attestation_ref:
      `attestation://replay-dispatch-clock/${successorCommandClockIdentityHash.slice(0, 24)}`,
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
    registry_read_started_at: successorCommandRegistryReceipt.read_at,
    registry_read_completed_at: "2026-07-14T00:04:04Z",
    registry_read_started_monotonic_ns: "8000000",
    registry_read_completed_monotonic_ns: "8000100",
    source_registry_read_receipt_id: successorCommandRegistryReceipt.receipt_id,
    source_registry_read_receipt_ref: successorCommandRegistryReceipt.receipt_ref,
    source_registry_read_receipt_hash: successorCommandRegistryReceipt.receipt_hash,
    source_registry_read_receipt: structuredClone(successorCommandRegistryReceipt),
    attempt_id: successorCommandRegistryReceipt.current_attempt_lease.attempt_id,
    worker_id: successorCommandRegistryReceipt.current_attempt_lease.worker_id,
    lease_generation: successorCommandRegistryReceipt.current_attempt_lease.lease_generation,
    current_attempt_lease_hash: successorCommandRegistryReceipt.current_attempt_lease_hash,
  })
  const successorCommandInput = {
    source_successor_execution_contract_admission: successorExecutionContractAdmission,
    source_current_lease_observation: successorCommandObservation,
    control_plane_registry_read_receipt: successorCommandRegistryReceipt,
    control_plane_clock_attestation: successorCommandClockAttestation,
    dispatcher_claimant_id: "runner-successor-command-claimant-1",
    claimed_at: "2026-07-14T00:04:01Z",
  }
  const missingSuccessorCommandRoot = mkdtempSync(
    join(tmpdir(), "replay-worker-v10-successor-execution-command-missing-"),
  )
  try {
    expect(() => issueReplayWorkerV10SuccessorExecutionCommand({
      registry_root: missingSuccessorCommandRoot,
      ...successorCommandInput,
    })).toThrow("requires its exact durable R4.147 parent")
  } finally {
    rmSync(missingSuccessorCommandRoot, { recursive: true, force: true })
  }
  const successorCommandAdmission = issueReplayWorkerV10SuccessorExecutionCommand({
    registry_root: dispatchEvidenceRegistryRoot,
    ...successorCommandInput,
  })
  replayProfile("successor execution command")
  const successorDispatchClaim =
    successorCommandAdmission.successor_execution_admission_command.source_dispatch_claim
  const successorExecutionCommand = successorCommandAdmission.successor_execution_admission_command
  expect(successorCommandAdmission.status)
    .toBe("successor_command_admitted_process_launch_intent_not_materialized")
  expect(successorCommandAdmission.source_successor_execution_contract_admission_hash)
    .toBe(successorExecutionContractAdmission.admission_hash)
  expect(successorCommandAdmission.source_execution_admission_contract_hash)
    .toBe(successorExecutionAdmission.contract_hash)
  expect(successorCommandAdmission.source_artifact_bound_transport_contract_hash)
    .toBe(successorArtifactTransport.contract_hash)
  expect(successorDispatchClaim.lease_generation).toBe(attemptLease.lease_generation + 1)
  expect(successorDispatchClaim.claim_effect)
    .toBe("at_most_one_local_successor_command_issuer_while_cas_record_is_preserved")
  expect(successorDispatchClaim.execution_admission_command_instance_count).toBe(0)
  expect(successorExecutionCommand.command_hash).not.toBe(executionAdmissionCommand.command_hash)
  expect(successorExecutionCommand.source_dispatch_claim_hash).toBe(successorDispatchClaim.claim_hash)
  expect(successorExecutionCommand.current_lease_observation_hash)
    .toBe(successorCommandObservation.observation_hash)
  expect(successorExecutionCommand.control_plane_registry_read_receipt_hash)
    .toBe(successorCommandRegistryReceipt.receipt_hash)
  expect(successorExecutionCommand.control_plane_clock_attestation_hash)
    .toBe(successorCommandClockAttestation.attestation_hash)
  expect(successorExecutionCommand.issued_at).toBe("2026-07-14T00:04:04Z")
  expect(successorExecutionCommand.valid_before).toBe(requestedSuccessorLeaseExpiry)
  expect(successorExecutionCommand.command_instance_count).toBe(1)
  expect(successorExecutionCommand.execution_admission)
    .toBe("granted_for_exact_successor_process_launch_intent_creation_only")
  expect(successorExecutionCommand.process_launch_intent_count).toBe(0)
  expect(successorExecutionCommand.worker_process_count).toBe(0)
  expect(successorExecutionCommand.request_frame_instance_count).toBe(0)
  expect(successorExecutionCommand.response_frame_instance_count).toBe(0)
  expect(successorCommandAdmission.successor_dispatch_claim_count).toBe(1)
  expect(successorCommandAdmission.successor_current_lease_observation_count).toBe(1)
  expect(successorCommandAdmission.successor_registry_read_receipt_count).toBe(1)
  expect(successorCommandAdmission.successor_clock_attestation_count).toBe(1)
  expect(successorCommandAdmission.successor_execution_admission_command_count).toBe(1)
  expect(successorCommandAdmission.successor_process_launch_intent_count).toBe(0)
  expect(successorCommandAdmission.successor_authority_capsule_count).toBe(0)
  expect(successorCommandAdmission.successor_spawn_revalidation_count).toBe(0)
  expect(successorCommandAdmission.successor_worker_process_count).toBe(0)
  expect(successorCommandAdmission.second_response_count).toBe(0)
  expect(successorCommandAdmission.second_schedule_admission_count).toBe(0)
  expect(successorCommandAdmission.reproducibility_pair_count).toBe(0)
  expect(successorCommandAdmission.harness_receipt_count).toBe(0)
  expect(successorCommandAdmission.transport_authority)
    .toBe("artifact_bound_command_issued_activation_blocked")
  expect(successorCommandAdmission.command_authority)
    .toBe("issued_for_exact_successor_process_launch_intent_creation_only")
  expect(successorCommandAdmission.worker_process_authority).toBe("none")
  expect(successorCommandAdmission.signal_authority).toBe("none")
  expect(successorCommandAdmission.order_authority).toBe("none")
  expect(successorCommandAdmission.economic_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim(
    successorDispatchClaim,
  )).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand(
    successorExecutionCommand,
  )).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission(
    successorCommandAdmission,
  )).not.toThrow()
  expect(readReplayWorkerV10SuccessorExecutionDispatchClaim({
    registry_root: dispatchEvidenceRegistryRoot,
    ...successorCommandInput,
  })).toEqual(successorDispatchClaim)
  expect(readReplayWorkerV10SuccessorExecutionAdmissionCommand({
    registry_root: dispatchEvidenceRegistryRoot,
    ...successorCommandInput,
  })).toEqual(successorExecutionCommand)
  expect(readReplayWorkerV10SuccessorExecutionCommandAdmission({
    registry_root: dispatchEvidenceRegistryRoot,
    ...successorCommandInput,
  })).toEqual(successorCommandAdmission)
  expect(issueReplayWorkerV10SuccessorExecutionCommand({
    registry_root: dispatchEvidenceRegistryRoot,
    ...structuredClone(successorCommandInput),
  })).toEqual(successorCommandAdmission)
  expect(() => issueReplayWorkerV10SuccessorExecutionCommand({
    registry_root: dispatchEvidenceRegistryRoot,
    ...successorCommandInput,
    dispatcher_claimant_id: "runner-successor-command-claimant-2",
  })).toThrow("Dispatch Claim natural key has different evidence")
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission({
    ...successorCommandAdmission,
    successor_worker_process_count: 1 as never,
  })).toThrow()

  return {
    command_observation: successorCommandObservation,
    command_input: successorCommandInput,
    command_admission: successorCommandAdmission,
    dispatch_claim: successorDispatchClaim,
    execution_command: successorExecutionCommand,
  }
}
