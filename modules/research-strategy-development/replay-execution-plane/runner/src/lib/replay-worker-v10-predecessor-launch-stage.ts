import { expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_POLICY_VERSION,
  REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_SCHEMA_VERSION,
  REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION,
  REPLAY_DISPATCH_CLOCK_ATTESTATION_SCHEMA_VERSION,
  createReplayAttemptLeaseObservationRegistryReadReceipt,
  createReplayAttemptLeaseObservationSnapshot,
  createReplayDispatchClockAttestation,
  replayDispatchClockAttestationIdentityHash,
  type ReplayAttemptLeaseObservationBody,
  type ReplayAttemptLeaseObservationRegistryReadReceipt,
  type ReplayAttemptLeaseObservationSnapshot,
  type ReplayAttemptLeaseSnapshot,
  type ReplayDispatchClockAttestation,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import type { ReplayDecisionHarnessDispatchClaim } from "../../../contracts/src/lib/replay-decision-harness-dispatch-claim"
import type { ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-command"
import {
  assertReplayDecisionHarnessWorkerV10ProcessLaunchIntent,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-process-launch-intent"
import {
  assertReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-process-launch-readiness-gate"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommandLineage,
  buildReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand,
} from "./replay-decision-harness-worker-v10-execution-admission-command"
import {
  issueReplayWorkerV10ExecutionAdmissionCommand,
  readReplayWorkerV10ExecutionAdmissionCommand,
} from "./replay-worker-v10-execution-admission-command-registry"
import {
  assertReplayDecisionHarnessWorkerV10ProcessLaunchIntentLineage,
  buildReplayDecisionHarnessWorkerV10ProcessLaunchIntent,
} from "./replay-decision-harness-worker-v10-process-launch-intent"
import {
  issueReplayWorkerV10ProcessLaunchIntent,
  readReplayWorkerV10ProcessLaunchIntent,
} from "./replay-worker-v10-process-launch-intent-registry"
import {
  readReplayWorkerV10ProcessLaunchReadinessGate,
  registerReplayWorkerV10ProcessLaunchReadinessGate,
} from "./replay-worker-v10-process-launch-readiness-gate-registry"

export interface ReplayWorkerV10PredecessorLaunchStageInput {
  registry_root: string
  clock_binding: ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation
  dispatch_claim: ReplayDecisionHarnessDispatchClaim
  pre_issue_observation: ReplayAttemptLeaseObservationSnapshot
  registry_read_receipt: ReplayAttemptLeaseObservationRegistryReadReceipt
  clock_attestation: ReplayDispatchClockAttestation
  attempt_lease: ReplayAttemptLeaseSnapshot
  lease_observation_body: ReplayAttemptLeaseObservationBody
  profile(stage: string): void
}

export function runReplayWorkerV10PredecessorLaunchStage(
  input: ReplayWorkerV10PredecessorLaunchStageInput,
) {
  const dispatchEvidenceRegistryRoot = input.registry_root
  const clockBinding = input.clock_binding
  const dispatchClaim = input.dispatch_claim
  const preIssueObservation = input.pre_issue_observation
  const registryReadReceipt = input.registry_read_receipt
  const clockAttestation = input.clock_attestation
  const attemptLease = input.attempt_lease
  const leaseObservationBody = input.lease_observation_body
  const replayProfile = input.profile

  const commandInput = { source_clock_binding: clockBinding }
  const executionAdmissionCommand = buildReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand(commandInput)
  replayProfile("execution command")
  expect(executionAdmissionCommand.status).toBe("issued_process_launch_intent_not_materialized")
  expect(executionAdmissionCommand.command_instance_count).toBe(1)
  expect(executionAdmissionCommand.execution_admission)
    .toBe("granted_for_exact_attempt_bound_process_launch_intent_creation_only")
  expect(executionAdmissionCommand.worker_request_hash).toBe(clockBinding.target_worker_request_hash)
  expect(executionAdmissionCommand.dispatch_claim_hash).toBe(dispatchClaim.claim_hash)
  expect(executionAdmissionCommand.current_lease_observation_hash).toBe(preIssueObservation.observation_hash)
  expect(executionAdmissionCommand.registry_read_receipt_hash).toBe(registryReadReceipt.receipt_hash)
  expect(executionAdmissionCommand.dispatch_clock_attestation_hash).toBe(clockAttestation.attestation_hash)
  expect(executionAdmissionCommand.issued_at).toBe(clockAttestation.registry_read_completed_at)
  expect(executionAdmissionCommand.valid_before).toBe(attemptLease.lease_expires_at)
  expect(executionAdmissionCommand.blockers).toEqual([
    "attempt_bound_stdio_process_launch_intent_not_materialized",
    "attempt_bound_stdio_process_receipt_not_materialized",
    "worker_request_frame_write_and_decode_not_materialized",
    "worker_response_frame_read_and_admission_not_materialized",
  ])
  expect(executionAdmissionCommand.attempt_bound_process_launch_intent_count).toBe(0)
  expect(executionAdmissionCommand.dispatch_occurrence).toBe("not_materialized")
  expect(executionAdmissionCommand.harness_invocation).toBe("forbidden")
  expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand(executionAdmissionCommand)).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommandLineage(
    executionAdmissionCommand,
    commandInput,
  )).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand({
    ...executionAdmissionCommand,
    attempt_bound_process_launch_intent_count: 1 as never,
  })).toThrow("unsupported Execution Admission Command authority")
  const missingCommandRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-execution-command-missing-"))
  try {
    expect(() => issueReplayWorkerV10ExecutionAdmissionCommand({
      registry_root: missingCommandRoot,
      ...commandInput,
    })).toThrow("requires the exact durable clock attestation binding")
  } finally {
    rmSync(missingCommandRoot, { recursive: true, force: true })
  }
  expect(issueReplayWorkerV10ExecutionAdmissionCommand({
    registry_root: dispatchEvidenceRegistryRoot,
    ...commandInput,
  })).toEqual(executionAdmissionCommand)
  expect(readReplayWorkerV10ExecutionAdmissionCommand({
    registry_root: dispatchEvidenceRegistryRoot,
    ...commandInput,
  })).toEqual(executionAdmissionCommand)

  const postCommandObservation = createReplayAttemptLeaseObservationSnapshot({
    ...leaseObservationBody,
    observation_id: "lease-observation-envelope-process-intent",
    observation_ref: "observation://replay-attempt-lease/process-intent",
    observed_at: "2026-07-14T00:00:38Z",
  })
  const postCommandReadAt = "2026-07-14T00:00:40Z"
  const postCommandRegistryReceipt = createReplayAttemptLeaseObservationRegistryReadReceipt({
    schema_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_SCHEMA_VERSION,
    receipt_id: `replay-attempt-lease-observation-registry-read-${postCommandObservation.observation_hash.slice(0, 16)}-${Date.parse(postCommandReadAt)}`,
    receipt_ref: `receipt://replay-attempt-lease-observation-registry-read/${postCommandObservation.observation_hash.slice(0, 16)}-${Date.parse(postCommandReadAt)}`,
    receipt_policy_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_POLICY_VERSION,
    status: "registered_active_lease_observation_read",
    authority_owner: "research_control_plane",
    authority_source: "research_control_plane_state_store",
    registry_table: "rd_replay_attempt_lease_observation",
    registry_key: postCommandObservation.observation_id,
    registry_row_immutability: "sqlite_update_and_delete_triggers",
    read_consistency: "single_control_plane_transaction",
    registry_read_provenance: "registered_row_and_current_attempt_exact_match",
    registered_at: "2026-07-14T00:00:39Z",
    read_at: postCommandReadAt,
    clock_evidence: "caller_supplied_utc_not_external_time_attestation",
    external_time_attestation: "not_provided",
    source_observation_id: postCommandObservation.observation_id,
    source_observation_ref: postCommandObservation.observation_ref,
    source_observation_hash: postCommandObservation.observation_hash,
    source_observation: postCommandObservation,
    current_attempt_status: postCommandObservation.attempt_lease.status,
    current_attempt_lease_hash: postCommandObservation.attempt_lease_hash,
    current_attempt_lease: postCommandObservation.attempt_lease,
  })
  const postCommandClockIdentityHash = replayDispatchClockAttestationIdentityHash({
    source_registry_read_receipt_hash: postCommandRegistryReceipt.receipt_hash,
    registry_read_started_at: postCommandReadAt,
    registry_read_completed_at: "2026-07-14T00:00:41Z",
    registry_read_started_monotonic_ns: "4000000",
    registry_read_completed_monotonic_ns: "4000100",
    attestation_policy_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION,
  })
  const postCommandClockAttestation = createReplayDispatchClockAttestation({
    schema_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_SCHEMA_VERSION,
    attestation_id: `replay-dispatch-clock-attestation-${postCommandClockIdentityHash.slice(0, 24)}`,
    attestation_ref: `attestation://replay-dispatch-clock/${postCommandClockIdentityHash.slice(0, 24)}`,
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
    registry_read_bracketing: "wall_and_monotonic_samples_before_and_after_single_transaction_read",
    registry_read_started_at: postCommandReadAt,
    registry_read_completed_at: "2026-07-14T00:00:41Z",
    registry_read_started_monotonic_ns: "4000000",
    registry_read_completed_monotonic_ns: "4000100",
    source_registry_read_receipt_id: postCommandRegistryReceipt.receipt_id,
    source_registry_read_receipt_ref: postCommandRegistryReceipt.receipt_ref,
    source_registry_read_receipt_hash: postCommandRegistryReceipt.receipt_hash,
    source_registry_read_receipt: postCommandRegistryReceipt,
    attempt_id: postCommandRegistryReceipt.current_attempt_lease.attempt_id,
    worker_id: postCommandRegistryReceipt.current_attempt_lease.worker_id,
    lease_generation: postCommandRegistryReceipt.current_attempt_lease.lease_generation,
    current_attempt_lease_hash: postCommandRegistryReceipt.current_attempt_lease_hash,
  })
  const processIntentInput = {
    source_execution_admission_command: executionAdmissionCommand,
    post_command_clock_attestation: postCommandClockAttestation,
  }
  const processLaunchIntent = buildReplayDecisionHarnessWorkerV10ProcessLaunchIntent(processIntentInput)
  replayProfile("process launch intent")
  expect(processLaunchIntent.status).toBe("intent_committed_process_not_started")
  expect(processLaunchIntent.process_launch_intent_instance_count).toBe(1)
  expect(processLaunchIntent.source_execution_admission_command_hash).toBe(executionAdmissionCommand.command_hash)
  expect(processLaunchIntent.post_command_lease_observation_hash).toBe(postCommandObservation.observation_hash)
  expect(processLaunchIntent.current_attempt_lease_hash).toBe(executionAdmissionCommand.current_attempt_lease_hash)
  expect(processLaunchIntent.process_artifact_hash).toBe(executionAdmissionCommand.successor_process_artifact_hash)
  expect(processLaunchIntent.intent_issued_at).toBe(postCommandClockAttestation.registry_read_completed_at)
  expect(processLaunchIntent.valid_before).toBe(attemptLease.lease_expires_at)
  expect(processLaunchIntent.process_launch_authority)
    .toBe("not_granted_until_fresh_spawn_boundary_revalidation")
  expect(processLaunchIntent.blockers).toEqual([
    "attempt_bound_stdio_process_receipt_not_materialized",
    "worker_request_frame_write_and_decode_not_materialized",
    "worker_response_frame_read_and_admission_not_materialized",
  ])
  expect(processLaunchIntent.attempt_bound_process_receipt_count).toBe(0)
  expect(processLaunchIntent.admitted_process_instance_count).toBe(0)
  expect(processLaunchIntent.process_launch_occurrence).toBe("not_materialized")
  expect(processLaunchIntent.dispatch_occurrence).toBe("not_materialized")
  expect(processLaunchIntent.harness_invocation).toBe("forbidden")
  expect(() => assertReplayDecisionHarnessWorkerV10ProcessLaunchIntent(processLaunchIntent)).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10ProcessLaunchIntentLineage(
    processLaunchIntent,
    processIntentInput,
  )).not.toThrow()
  expect(() => buildReplayDecisionHarnessWorkerV10ProcessLaunchIntent({
    ...processIntentInput,
    post_command_clock_attestation: clockAttestation,
  })).toThrow("parent, revalidation, or executable binding drift")
  expect(() => buildReplayDecisionHarnessWorkerV10ProcessLaunchIntent({
    ...processIntentInput,
    post_command_clock_attestation: {
      ...postCommandClockAttestation,
      source_registry_read_receipt: {
        ...postCommandRegistryReceipt,
        current_attempt_status: "cancelled" as never,
      },
    },
  })).toThrow()
  expect(() => buildReplayDecisionHarnessWorkerV10ProcessLaunchIntent({
    ...processIntentInput,
    post_command_clock_attestation: {
      ...postCommandClockAttestation,
      lease_generation: postCommandClockAttestation.lease_generation + 1,
    },
  })).toThrow()
  expect(() => buildReplayDecisionHarnessWorkerV10ProcessLaunchIntent({
    ...processIntentInput,
    post_command_clock_attestation: {
      ...postCommandClockAttestation,
      registry_read_completed_at: attemptLease.lease_expires_at,
    },
  })).toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10ProcessLaunchIntent({
    ...processLaunchIntent,
    process_launch_occurrence: "materialized" as never,
  })).toThrow("unsupported Worker v10 Process Launch Intent authority")
  const missingIntentRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-process-intent-missing-"))
  try {
    expect(() => issueReplayWorkerV10ProcessLaunchIntent({
      registry_root: missingIntentRoot,
      ...processIntentInput,
    })).toThrow("requires the exact durable Execution Admission Command")
  } finally {
    rmSync(missingIntentRoot, { recursive: true, force: true })
  }
  expect(issueReplayWorkerV10ProcessLaunchIntent({
    registry_root: dispatchEvidenceRegistryRoot,
    ...processIntentInput,
  })).toEqual(processLaunchIntent)
  expect(readReplayWorkerV10ProcessLaunchIntent({
    registry_root: dispatchEvidenceRegistryRoot,
    ...processIntentInput,
  })).toEqual(processLaunchIntent)

  const processReadinessInput = { source_process_launch_intent: processLaunchIntent }
  const missingReadinessRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-readiness-missing-"))
  try {
    expect(() => registerReplayWorkerV10ProcessLaunchReadinessGate({
      registry_root: missingReadinessRoot,
      ...processReadinessInput,
    })).toThrow("requires the exact durable Process Launch Intent")
  } finally {
    rmSync(missingReadinessRoot, { recursive: true, force: true })
  }
  const processLaunchReadiness = registerReplayWorkerV10ProcessLaunchReadinessGate({
    registry_root: dispatchEvidenceRegistryRoot,
    ...processReadinessInput,
  })
  replayProfile("process launch readiness")
  expect(processLaunchReadiness.status).toBe("blocked_intent_bound_artifact_not_dispatch_executable")
  expect(processLaunchReadiness.launch_decision).toBe("denied")
  expect(processLaunchReadiness.launch_decision_reason)
    .toBe("spawn_would_only_create_a_terminal_non_dispatch_process")
  expect(processLaunchReadiness.intent_bound_process_artifact_hash).toBe(processLaunchIntent.process_artifact_hash)
  expect(processLaunchReadiness.artifact_valid_frame_exit_code).toBe(70)
  expect(processLaunchReadiness.artifact_valid_frame_error_code).toBe("transport_activation_not_granted")
  expect(processLaunchReadiness.request_frame_authority_finding)
    .toBe("unadmitted_candidate_has_no_command_or_intent_hash")
  expect(processLaunchReadiness.response_frame_authority_finding)
    .toBe("unadmitted_candidate_has_no_execution_admission_command_hash")
  expect(processLaunchReadiness.exact_binding_consequence)
    .toBe("new_artifact_requires_new_transport_command_and_intent_versions")
  expect(processLaunchReadiness.required_cutover_objects).toEqual([
    "activated_stdio_build_capability",
    "command_bound_request_frame",
    "command_echoing_response_frame",
    "artifact_bound_successor_transport",
    "new_execution_admission_command",
    "new_process_launch_intent",
  ])
  expect(processLaunchReadiness.blockers).toEqual([
    "intent_bound_artifact_rejects_every_parseable_request_before_decode",
    "request_frame_v1_lacks_command_and_intent_authority_binding",
    "response_frame_v1_lacks_execution_admission_command_echo",
    "exact_artifact_binding_requires_versioned_downstream_reissue",
  ])
  expect(processLaunchReadiness.readiness_gate_instance_count).toBe(1)
  expect(processLaunchReadiness.process_launch_receipt_count).toBe(0)
  expect(processLaunchReadiness.admitted_process_instance_count).toBe(0)
  expect(processLaunchReadiness.request_frame_instance_count).toBe(0)
  expect(processLaunchReadiness.response_frame_instance_count).toBe(0)
  expect(processLaunchReadiness.dispatch_occurrence).toBe("not_materialized")
  expect(processLaunchReadiness.harness_invocation).toBe("forbidden")
  expect(() => assertReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate({
    ...processLaunchReadiness,
    launch_decision: "granted" as never,
  })).toThrow("unsupported Worker v10 Process Launch Readiness Gate authority")
  expect(readReplayWorkerV10ProcessLaunchReadinessGate({
    registry_root: dispatchEvidenceRegistryRoot,
    ...processReadinessInput,
  })).toEqual(processLaunchReadiness)

  return {
    command_input: commandInput,
    execution_command: executionAdmissionCommand,
    post_command_observation: postCommandObservation,
    post_command_read_at: postCommandReadAt,
    post_command_registry_receipt: postCommandRegistryReceipt,
    post_command_clock_attestation: postCommandClockAttestation,
    process_intent_input: processIntentInput,
    process_launch_intent: processLaunchIntent,
    process_readiness_input: processReadinessInput,
    process_launch_readiness: processLaunchReadiness,
  }
}

