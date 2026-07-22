import { expect } from "bun:test"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
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
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import type { ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-lease-admission"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-contract-admission"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-stdio-probe-admission"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand,
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-command-admission"
import { assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-process-launch-intent"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleLineage,
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-authority-capsule"
import {
  issueReplayWorkerV10SuccessorExecutionCommand,
  readReplayWorkerV10SuccessorExecutionAdmissionCommand,
  readReplayWorkerV10SuccessorExecutionCommandAdmission,
  readReplayWorkerV10SuccessorExecutionDispatchClaim,
} from "./replay-worker-v10-successor-execution-command-registry"
import {
  issueReplayWorkerV10SuccessorProcessLaunchIntent,
  readReplayWorkerV10SuccessorProcessLaunchIntent,
} from "./replay-worker-v10-successor-process-launch-intent-registry"
import {
  materializeReplayWorkerV10SuccessorAuthorityCapsule,
  readReplayWorkerV10SuccessorAuthorityCapsule,
} from "./replay-worker-v10-successor-authority-capsule-registry"

export interface ReplayWorkerV10SuccessorCommandStageInput {
  registry_root: string
  successor_execution_contract_admission:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission
  successor_stdio_probe_admission:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission
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
  const successorStdioProbeAdmission = input.successor_stdio_probe_admission
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

  const successorCapsuleInput = {
    source_successor_process_launch_intent: successorProcessLaunchIntent,
  }
  const missingSuccessorCapsuleRoot = mkdtempSync(
    join(tmpdir(), "replay-worker-v10-successor-authority-capsule-missing-"),
  )
  try {
    expect(() => materializeReplayWorkerV10SuccessorAuthorityCapsule({
      registry_root: missingSuccessorCapsuleRoot,
      ...successorCapsuleInput,
    })).toThrow("requires exact durable R4.149 Process Launch Intent")
  } finally {
    rmSync(missingSuccessorCapsuleRoot, { recursive: true, force: true })
  }
  const successorAuthorityCapsule = materializeReplayWorkerV10SuccessorAuthorityCapsule({
    registry_root: dispatchEvidenceRegistryRoot,
    ...successorCapsuleInput,
  })
  replayProfile("successor authority capsule")
  expect(successorAuthorityCapsule.status)
    .toBe("successor_capsule_materialized_spawn_revalidation_and_process_not_materialized")
  expect(successorAuthorityCapsule.source_successor_process_launch_intent_hash)
    .toBe(successorProcessLaunchIntent.intent_hash)
  expect(successorAuthorityCapsule.source_parent_canonical_file_sha256).toHaveLength(64)
  expect(successorAuthorityCapsule.source_execution_admission_command_hash)
    .toBe(successorExecutionCommand.command_hash)
  expect(successorAuthorityCapsule.source_artifact_bound_transport_contract_hash)
    .toBe(successorExecutionContractAdmission.successor_artifact_bound_transport_contract_hash)
  expect(successorAuthorityCapsule.authority_capsule).toEqual({
    execution_admission_command_hash: successorExecutionCommand.command_hash,
    execution_envelope_hash: successorProcessLaunchIntent.source_execution_envelope_hash,
    logical_request_id: successorProcessLaunchIntent.target_logical_request_id,
    process_artifact_hash: successorProcessLaunchIntent.process_artifact_hash,
    process_launch_intent_hash: successorProcessLaunchIntent.intent_hash,
    transport_contract_hash: successorProcessLaunchIntent.source_artifact_bound_transport_contract_hash,
    worker_request_hash: successorProcessLaunchIntent.target_worker_request_hash,
  })
  expect(successorAuthorityCapsule.authority_capsule_canonical_json)
    .toBe(canonicalJson(successorAuthorityCapsule.authority_capsule))
  expect(successorAuthorityCapsule.capsule_hash)
    .toBe(canonicalHash(successorAuthorityCapsule.authority_capsule))
  expect(successorAuthorityCapsule.blockers).toEqual([
    "successor_spawn_boundary_revalidation_not_materialized",
    "successor_worker_process_and_request_dispatch_not_materialized",
    "second_response_schedule_pair_and_harness_receipt_not_materialized",
  ])
  expect(successorAuthorityCapsule.successor_execution_admission_command_count).toBe(1)
  expect(successorAuthorityCapsule.successor_process_launch_intent_count).toBe(1)
  expect(successorAuthorityCapsule.successor_authority_capsule_count).toBe(1)
  expect(successorAuthorityCapsule.successor_spawn_revalidation_count).toBe(0)
  expect(successorAuthorityCapsule.successor_worker_process_count).toBe(0)
  expect(successorAuthorityCapsule.successor_worker_request_frame_count).toBe(0)
  expect(successorAuthorityCapsule.successor_worker_request_decode_count).toBe(0)
  expect(successorAuthorityCapsule.second_response_count).toBe(0)
  expect(successorAuthorityCapsule.second_schedule_admission_count).toBe(0)
  expect(successorAuthorityCapsule.reproducibility_pair_count).toBe(0)
  expect(successorAuthorityCapsule.harness_receipt_count).toBe(0)
  expect(successorAuthorityCapsule.process_launch_authority)
    .toBe("not_granted_until_fresh_spawn_boundary_revalidation")
  expect(successorAuthorityCapsule.transport_activation)
    .toBe("successor_capsule_materialized_spawn_blocked")
  expect(successorAuthorityCapsule.signal_authority).toBe("none")
  expect(successorAuthorityCapsule.order_authority).toBe("none")
  expect(successorAuthorityCapsule.economic_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord(
    successorAuthorityCapsule,
  )).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleLineage(
    successorAuthorityCapsule,
    successorProcessLaunchIntent,
  )).not.toThrow()
  expect(readReplayWorkerV10SuccessorAuthorityCapsule({
    registry_root: dispatchEvidenceRegistryRoot,
    ...successorCapsuleInput,
  })).toEqual(successorAuthorityCapsule)
  expect(materializeReplayWorkerV10SuccessorAuthorityCapsule({
    registry_root: dispatchEvidenceRegistryRoot,
    ...structuredClone(successorCapsuleInput),
  })).toEqual(successorAuthorityCapsule)
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord({
    ...successorAuthorityCapsule,
    successor_worker_process_count: 1 as never,
  })).toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleLineage({
    ...successorAuthorityCapsule,
    authority_capsule: {
      ...successorAuthorityCapsule.authority_capsule,
      process_artifact_hash: "b".repeat(64),
    },
  }, successorProcessLaunchIntent)).toThrow()

  const successorCapsuleFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-successor-authority-capsule-${successorAuthorityCapsule.capsule_key}.json`)
  if (!successorCapsuleFile) throw new Error("expected successor Authority Capsule file")
  const successorIntentFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-successor-process-launch-intent-${successorProcessLaunchIntent.intent_key}.json`)
  if (!successorIntentFile) throw new Error("expected successor Process Launch Intent file")

  return {
    command_input: successorCommandInput,
    command_admission: successorCommandAdmission,
    dispatch_claim: successorDispatchClaim,
    execution_command: successorExecutionCommand,
    intent_input: successorIntentInput,
    process_launch_intent: successorProcessLaunchIntent,
    capsule_input: successorCapsuleInput,
    authority_capsule: successorAuthorityCapsule,
    capsule_file: successorCapsuleFile,
    intent_file: successorIntentFile,
  }
}
