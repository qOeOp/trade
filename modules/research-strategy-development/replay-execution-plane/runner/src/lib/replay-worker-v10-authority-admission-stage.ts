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
  type ReplayAttemptLeaseObservationSnapshot,
  type ReplayDispatchClockAttestation,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import type { ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-command"
import type { ReplayDecisionHarnessWorkerV10ProcessLaunchIntent } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-process-launch-intent"
import type { ReplayDecisionHarnessWorkerV10SuccessorTransportContract } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-transport-contract"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV,
  type ReplayDecisionHarnessWorkerV10ActivatedStdioCapability,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-activated-stdio-capability"
import type { ReplayDecisionHarnessWorkerV10AuthorityTransportContract } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-transport-contract"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_COMMAND_RESPONSE_ECHO_FIELDS,
  assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-execution-admission-command"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-process-launch-intent"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-capsule"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommandLineage,
  buildReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand,
} from "./replay-decision-harness-worker-v10-authority-execution-admission-command"
import {
  issueReplayWorkerV10AuthorityExecutionAdmissionCommand,
  readReplayWorkerV10AuthorityExecutionAdmissionCommand,
} from "./replay-worker-v10-authority-execution-admission-command-registry"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntentLineage,
  buildReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent,
} from "./replay-decision-harness-worker-v10-authority-process-launch-intent"
import {
  issueReplayWorkerV10AuthorityProcessLaunchIntent,
  readReplayWorkerV10AuthorityProcessLaunchIntent,
} from "./replay-worker-v10-authority-process-launch-intent-registry"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityCapsuleLineage,
  buildReplayDecisionHarnessWorkerV10AuthorityCapsule,
} from "./replay-decision-harness-worker-v10-authority-capsule"
import {
  materializeReplayWorkerV10AuthorityCapsule,
  readReplayWorkerV10AuthorityCapsule,
} from "./replay-worker-v10-authority-capsule-registry"

export interface ReplayWorkerV10AuthorityAdmissionStageInput {
  registry_root: string
  post_command_observation: ReplayAttemptLeaseObservationSnapshot
  authority_transport: ReplayDecisionHarnessWorkerV10AuthorityTransportContract
  activated_stdio: ReplayDecisionHarnessWorkerV10ActivatedStdioCapability
  predecessor_execution_command: ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand
  predecessor_process_launch_intent: ReplayDecisionHarnessWorkerV10ProcessLaunchIntent
  post_command_clock_attestation: ReplayDispatchClockAttestation
  predecessor_successor_transport_contract:
    ReplayDecisionHarnessWorkerV10SuccessorTransportContract
  lease_observation_body: ReplayAttemptLeaseObservationBody
}

export function runReplayWorkerV10AuthorityAdmissionStage(
  input: ReplayWorkerV10AuthorityAdmissionStageInput,
) {
  const dispatchEvidenceRegistryRoot = input.registry_root
  const postCommandObservation = input.post_command_observation
  const authorityTransport = input.authority_transport
  const activatedStdio = input.activated_stdio
  const executionAdmissionCommand = input.predecessor_execution_command
  const processLaunchIntent = input.predecessor_process_launch_intent
  const postCommandClockAttestation = input.post_command_clock_attestation
  const successorTransportContract = input.predecessor_successor_transport_contract
  const leaseObservationBody = input.lease_observation_body

  const authorityCommandReadAt = "2026-07-14T00:00:45Z"
  const authorityCommandRegistryReceipt = createReplayAttemptLeaseObservationRegistryReadReceipt({
    schema_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_SCHEMA_VERSION,
    receipt_id: `replay-attempt-lease-observation-registry-read-${postCommandObservation.observation_hash.slice(0, 16)}-${Date.parse(authorityCommandReadAt)}`,
    receipt_ref: `receipt://replay-attempt-lease-observation-registry-read/${postCommandObservation.observation_hash.slice(0, 16)}-${Date.parse(authorityCommandReadAt)}`,
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
    read_at: authorityCommandReadAt,
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
  const buildAuthorityCommandClock = (completedAt: string, completedMonotonicNs: string) => {
    const identityHash = replayDispatchClockAttestationIdentityHash({
      source_registry_read_receipt_hash: authorityCommandRegistryReceipt.receipt_hash,
      registry_read_started_at: authorityCommandReadAt,
      registry_read_completed_at: completedAt,
      registry_read_started_monotonic_ns: "5000000",
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
      registry_read_bracketing: "wall_and_monotonic_samples_before_and_after_single_transaction_read",
      registry_read_started_at: authorityCommandReadAt,
      registry_read_completed_at: completedAt,
      registry_read_started_monotonic_ns: "5000000",
      registry_read_completed_monotonic_ns: completedMonotonicNs,
      source_registry_read_receipt_id: authorityCommandRegistryReceipt.receipt_id,
      source_registry_read_receipt_ref: authorityCommandRegistryReceipt.receipt_ref,
      source_registry_read_receipt_hash: authorityCommandRegistryReceipt.receipt_hash,
      source_registry_read_receipt: authorityCommandRegistryReceipt,
      attempt_id: authorityCommandRegistryReceipt.current_attempt_lease.attempt_id,
      worker_id: authorityCommandRegistryReceipt.current_attempt_lease.worker_id,
      lease_generation: authorityCommandRegistryReceipt.current_attempt_lease.lease_generation,
      current_attempt_lease_hash: authorityCommandRegistryReceipt.current_attempt_lease_hash,
    })
  }
  const authorityCommandClock = buildAuthorityCommandClock("2026-07-14T00:00:46Z", "5000100")
  const authorityCommandInput = {
    source_authority_transport_contract: authorityTransport,
    control_plane_clock_attestation: authorityCommandClock,
  }
  const authorityCommand = buildReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand(
    authorityCommandInput,
  )
  expect(authorityCommand.status).toBe("issued_successor_intent_not_materialized_zero_process")
  expect(authorityCommand.source_authority_transport_contract_hash).toBe(authorityTransport.contract_hash)
  expect(authorityCommand.activated_process_artifact_hash).toBe(activatedStdio.artifact.sha256)
  expect(authorityCommand.source_predecessor_execution_admission_command_hash)
    .toBe(executionAdmissionCommand.command_hash)
  expect(authorityCommand.source_predecessor_process_launch_intent_hash).toBe(processLaunchIntent.intent_hash)
  expect(authorityCommand.issued_at).toBe(authorityCommandClock.registry_read_completed_at)
  expect(authorityCommand.required_response_echo_fields)
    .toEqual(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_COMMAND_RESPONSE_ECHO_FIELDS)
  expect(authorityCommand.blockers).toEqual([
    "successor_process_launch_intent_not_issued",
    "fresh_spawn_boundary_revalidation_not_materialized",
    "attempt_bound_process_launch_receipt_not_materialized",
    "authority_frame_write_decode_read_and_admission_not_materialized",
  ])
  expect(authorityCommand.authority_execution_admission_command_instance_count).toBe(1)
  expect(authorityCommand.successor_process_launch_intent_count).toBe(0)
  expect(authorityCommand.authority_capsule_instance_count).toBe(0)
  expect(authorityCommand.process_launch_receipt_count).toBe(0)
  expect(authorityCommand.request_frame_instance_count).toBe(0)
  expect(authorityCommand.response_frame_instance_count).toBe(0)
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand(authorityCommand))
    .not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommandLineage(
    authorityCommand,
    authorityCommandInput,
  )).not.toThrow()
  expect(() => buildReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand({
    ...authorityCommandInput,
    control_plane_clock_attestation: postCommandClockAttestation,
  })).toThrow("parent, freshness, or validity drift")
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand({
    ...authorityCommand,
    activated_process_artifact_hash: successorTransportContract.successor_process_artifact_hash,
  })).toThrow("parent, freshness, or validity drift")
  const missingAuthorityCommandRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-authority-command-missing-"))
  try {
    expect(() => issueReplayWorkerV10AuthorityExecutionAdmissionCommand({
      registry_root: missingAuthorityCommandRoot,
      ...authorityCommandInput,
    })).toThrow("requires the exact durable Authority Transport Contract")
  } finally {
    rmSync(missingAuthorityCommandRoot, { recursive: true, force: true })
  }
  expect(issueReplayWorkerV10AuthorityExecutionAdmissionCommand({
    registry_root: dispatchEvidenceRegistryRoot,
    ...authorityCommandInput,
  })).toEqual(authorityCommand)
  expect(readReplayWorkerV10AuthorityExecutionAdmissionCommand({
    registry_root: dispatchEvidenceRegistryRoot,
    ...authorityCommandInput,
  })).toEqual(authorityCommand)
  expect(() => issueReplayWorkerV10AuthorityExecutionAdmissionCommand({
    registry_root: dispatchEvidenceRegistryRoot,
    source_authority_transport_contract: authorityTransport,
    control_plane_clock_attestation: buildAuthorityCommandClock("2026-07-14T00:00:47Z", "5000200"),
  })).toThrow("natural key has different evidence")

  const authorityIntentObservation = createReplayAttemptLeaseObservationSnapshot({
    ...leaseObservationBody,
    observation_id: "lease-observation-envelope-authority-intent",
    observation_ref: "observation://replay-attempt-lease/authority-intent",
    observed_at: "2026-07-14T00:00:48Z",
  })
  const authorityIntentReadAt = "2026-07-14T00:00:50Z"
  const authorityIntentRegistryReceipt = createReplayAttemptLeaseObservationRegistryReadReceipt({
    schema_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_SCHEMA_VERSION,
    receipt_id: `replay-attempt-lease-observation-registry-read-${authorityIntentObservation.observation_hash.slice(0, 16)}-${Date.parse(authorityIntentReadAt)}`,
    receipt_ref: `receipt://replay-attempt-lease-observation-registry-read/${authorityIntentObservation.observation_hash.slice(0, 16)}-${Date.parse(authorityIntentReadAt)}`,
    receipt_policy_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_POLICY_VERSION,
    status: "registered_active_lease_observation_read",
    authority_owner: "research_control_plane",
    authority_source: "research_control_plane_state_store",
    registry_table: "rd_replay_attempt_lease_observation",
    registry_key: authorityIntentObservation.observation_id,
    registry_row_immutability: "sqlite_update_and_delete_triggers",
    read_consistency: "single_control_plane_transaction",
    registry_read_provenance: "registered_row_and_current_attempt_exact_match",
    registered_at: "2026-07-14T00:00:49Z",
    read_at: authorityIntentReadAt,
    clock_evidence: "caller_supplied_utc_not_external_time_attestation",
    external_time_attestation: "not_provided",
    source_observation_id: authorityIntentObservation.observation_id,
    source_observation_ref: authorityIntentObservation.observation_ref,
    source_observation_hash: authorityIntentObservation.observation_hash,
    source_observation: authorityIntentObservation,
    current_attempt_status: authorityIntentObservation.attempt_lease.status,
    current_attempt_lease_hash: authorityIntentObservation.attempt_lease_hash,
    current_attempt_lease: authorityIntentObservation.attempt_lease,
  })
  const buildAuthorityIntentClock = (completedAt: string, completedMonotonicNs: string) => {
    const identityHash = replayDispatchClockAttestationIdentityHash({
      source_registry_read_receipt_hash: authorityIntentRegistryReceipt.receipt_hash,
      registry_read_started_at: authorityIntentReadAt,
      registry_read_completed_at: completedAt,
      registry_read_started_monotonic_ns: "6000000",
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
      registry_read_bracketing: "wall_and_monotonic_samples_before_and_after_single_transaction_read",
      registry_read_started_at: authorityIntentReadAt,
      registry_read_completed_at: completedAt,
      registry_read_started_monotonic_ns: "6000000",
      registry_read_completed_monotonic_ns: completedMonotonicNs,
      source_registry_read_receipt_id: authorityIntentRegistryReceipt.receipt_id,
      source_registry_read_receipt_ref: authorityIntentRegistryReceipt.receipt_ref,
      source_registry_read_receipt_hash: authorityIntentRegistryReceipt.receipt_hash,
      source_registry_read_receipt: authorityIntentRegistryReceipt,
      attempt_id: authorityIntentRegistryReceipt.current_attempt_lease.attempt_id,
      worker_id: authorityIntentRegistryReceipt.current_attempt_lease.worker_id,
      lease_generation: authorityIntentRegistryReceipt.current_attempt_lease.lease_generation,
      current_attempt_lease_hash: authorityIntentRegistryReceipt.current_attempt_lease_hash,
    })
  }
  const authorityIntentClock = buildAuthorityIntentClock("2026-07-14T00:00:51Z", "6000100")
  const authorityIntentInput = {
    source_authority_execution_admission_command: authorityCommand,
    post_command_clock_attestation: authorityIntentClock,
  }
  const authorityIntent = buildReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent(
    authorityIntentInput,
  )
  expect(authorityIntent.status).toBe("intent_committed_capsule_and_process_not_materialized")
  expect(authorityIntent.source_authority_execution_admission_command_hash).toBe(authorityCommand.command_hash)
  expect(authorityIntent.source_authority_transport_contract_hash).toBe(authorityTransport.contract_hash)
  expect(authorityIntent.process_artifact_hash).toBe(activatedStdio.artifact.sha256)
  expect(authorityIntent.process_artifact_file_name).toBe("worker-v10-authority-stdio.mjs")
  expect(authorityIntent.intent_issued_at).toBe(authorityIntentClock.registry_read_completed_at)
  expect(authorityIntent.authority_capsule_environment_variable)
    .toBe(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV)
  expect(authorityIntent.authority_capsule_fields).toEqual(activatedStdio.authority_capsule_fields)
  expect(authorityIntent.authority_capsule_intent_binding)
    .toBe("intent_hash_added_after_exact_intent_commit_not_embedded_in_payload")
  expect(authorityIntent.blockers).toEqual([
    "authority_capsule_not_materialized",
    "fresh_spawn_boundary_revalidation_not_materialized",
    "attempt_bound_process_launch_receipt_not_materialized",
    "authority_frame_write_decode_read_and_admission_not_materialized",
  ])
  expect(authorityIntent.authority_process_launch_intent_instance_count).toBe(1)
  expect(authorityIntent.authority_capsule_instance_count).toBe(0)
  expect(authorityIntent.process_launch_receipt_count).toBe(0)
  expect(authorityIntent.admitted_process_instance_count).toBe(0)
  expect(authorityIntent.request_frame_instance_count).toBe(0)
  expect(authorityIntent.response_frame_instance_count).toBe(0)
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent(authorityIntent)).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntentLineage(
    authorityIntent,
    authorityIntentInput,
  )).not.toThrow()
  expect(() => buildReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent({
    ...authorityIntentInput,
    post_command_clock_attestation: authorityCommandClock,
  })).toThrow("parent, revalidation, or executable binding drift")
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent({
    ...authorityIntent,
    process_artifact_hash: successorTransportContract.successor_process_artifact_hash,
  })).toThrow("parent, revalidation, or executable binding drift")
  const missingAuthorityIntentRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-authority-intent-missing-"))
  try {
    expect(() => issueReplayWorkerV10AuthorityProcessLaunchIntent({
      registry_root: missingAuthorityIntentRoot,
      ...authorityIntentInput,
    })).toThrow("requires the exact durable Authority Command")
  } finally {
    rmSync(missingAuthorityIntentRoot, { recursive: true, force: true })
  }
  expect(issueReplayWorkerV10AuthorityProcessLaunchIntent({
    registry_root: dispatchEvidenceRegistryRoot,
    ...authorityIntentInput,
  })).toEqual(authorityIntent)
  expect(readReplayWorkerV10AuthorityProcessLaunchIntent({
    registry_root: dispatchEvidenceRegistryRoot,
    ...authorityIntentInput,
  })).toEqual(authorityIntent)
  expect(() => issueReplayWorkerV10AuthorityProcessLaunchIntent({
    registry_root: dispatchEvidenceRegistryRoot,
    source_authority_execution_admission_command: authorityCommand,
    post_command_clock_attestation: buildAuthorityIntentClock("2026-07-14T00:00:52Z", "6000200"),
  })).toThrow("natural key has different evidence")

  const authorityCapsuleInput = {
    source_authority_process_launch_intent: authorityIntent,
  }
  const authorityCapsule = buildReplayDecisionHarnessWorkerV10AuthorityCapsule(authorityCapsuleInput)
  expect(authorityCapsule.status)
    .toBe("capsule_materialized_spawn_revalidation_and_process_not_materialized")
  expect(authorityCapsule.source_authority_process_launch_intent_hash).toBe(authorityIntent.intent_hash)
  expect(authorityCapsule.source_authority_execution_admission_command_hash).toBe(authorityCommand.command_hash)
  expect(authorityCapsule.source_authority_transport_contract_hash).toBe(authorityTransport.contract_hash)
  expect(authorityCapsule.authority_capsule).toEqual({
    execution_admission_command_hash: authorityCommand.command_hash,
    execution_envelope_hash: authorityIntent.source_execution_envelope_hash,
    logical_request_id: authorityIntent.logical_request_id,
    process_artifact_hash: activatedStdio.artifact.sha256,
    process_launch_intent_hash: authorityIntent.intent_hash,
    transport_contract_hash: authorityTransport.contract_hash,
    worker_request_hash: authorityIntent.worker_request_hash,
  })
  expect(authorityCapsule.authority_capsule_canonical_json)
    .toBe(canonicalJson(authorityCapsule.authority_capsule))
  expect(authorityCapsule.capsule_hash).toBe(canonicalHash(authorityCapsule.authority_capsule))
  expect(authorityCapsule.blockers).toEqual([
    "fresh_spawn_boundary_revalidation_not_materialized",
    "attempt_bound_process_launch_receipt_not_materialized",
    "authority_frame_write_decode_read_and_admission_not_materialized",
  ])
  expect(authorityCapsule.authority_capsule_instance_count).toBe(1)
  expect(authorityCapsule.spawn_boundary_revalidation_receipt_count).toBe(0)
  expect(authorityCapsule.process_launch_receipt_count).toBe(0)
  expect(authorityCapsule.admitted_process_instance_count).toBe(0)
  expect(authorityCapsule.request_frame_instance_count).toBe(0)
  expect(authorityCapsule.response_frame_instance_count).toBe(0)
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord(authorityCapsule)).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityCapsuleLineage(
    authorityCapsule,
    authorityCapsuleInput,
  )).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord({
    ...authorityCapsule,
    authority_capsule: {
      ...authorityCapsule.authority_capsule,
      process_artifact_hash: successorTransportContract.successor_process_artifact_hash,
    },
  })).toThrow("parent or environment binding drift")
  const missingAuthorityCapsuleRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-authority-capsule-missing-"))
  try {
    expect(() => materializeReplayWorkerV10AuthorityCapsule({
      registry_root: missingAuthorityCapsuleRoot,
      ...authorityCapsuleInput,
    })).toThrow("requires the exact durable Authority Process Launch Intent")
  } finally {
    rmSync(missingAuthorityCapsuleRoot, { recursive: true, force: true })
  }
  expect(materializeReplayWorkerV10AuthorityCapsule({
    registry_root: dispatchEvidenceRegistryRoot,
    ...authorityCapsuleInput,
  })).toEqual(authorityCapsule)
  expect(materializeReplayWorkerV10AuthorityCapsule({
    registry_root: dispatchEvidenceRegistryRoot,
    ...authorityCapsuleInput,
  })).toEqual(authorityCapsule)
  expect(readReplayWorkerV10AuthorityCapsule({
    registry_root: dispatchEvidenceRegistryRoot,
    ...authorityCapsuleInput,
  })).toEqual(authorityCapsule)

  return {
    command_input: authorityCommandInput,
    command: authorityCommand,
    intent_input: authorityIntentInput,
    intent: authorityIntent,
    intent_registry_receipt: authorityIntentRegistryReceipt,
    capsule_input: authorityCapsuleInput,
    capsule: authorityCapsule,
  }
}
