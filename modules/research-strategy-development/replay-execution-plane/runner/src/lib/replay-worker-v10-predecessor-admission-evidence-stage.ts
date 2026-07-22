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
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import type { ReplayDecisionHarnessDispatchClaim } from "../../../contracts/src/lib/replay-decision-harness-dispatch-claim"
import type { ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-contract"
import type { ReplayDecisionHarnessWorkerV10SuccessorTransportContract } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-transport-contract"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-pre-issue-bundle"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-registry-provenance"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundleLineage,
  buildReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle,
} from "./replay-decision-harness-worker-v10-execution-admission-pre-issue-bundle"
import {
  readReplayWorkerV10ExecutionAdmissionPreIssueBundle,
  registerReplayWorkerV10ExecutionAdmissionPreIssueBundle,
} from "./replay-worker-v10-execution-admission-pre-issue-registry"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenanceLineage,
  buildReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance,
} from "./replay-decision-harness-worker-v10-execution-admission-registry-provenance"
import {
  readReplayWorkerV10ExecutionAdmissionRegistryProvenance,
  registerReplayWorkerV10ExecutionAdmissionRegistryProvenance,
} from "./replay-worker-v10-execution-admission-registry-provenance-registry"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestationLineage,
  buildReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation,
} from "./replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import {
  readReplayWorkerV10ExecutionAdmissionClockAttestation,
  registerReplayWorkerV10ExecutionAdmissionClockAttestation,
} from "./replay-worker-v10-execution-admission-clock-attestation-registry"

export interface ReplayWorkerV10PredecessorAdmissionEvidenceStageInput {
  registry_root: string
  execution_admission_contract: ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract
  dispatch_claim: ReplayDecisionHarnessDispatchClaim
  lease_observation_body: ReplayAttemptLeaseObservationBody
  claim_observation: ReplayAttemptLeaseObservationSnapshot
  renewed_claim_observation: ReplayAttemptLeaseObservationSnapshot
  successor_transport_contract: ReplayDecisionHarnessWorkerV10SuccessorTransportContract
  profile(stage: string): void
}

export function runReplayWorkerV10PredecessorAdmissionEvidenceStage(
  input: ReplayWorkerV10PredecessorAdmissionEvidenceStageInput,
) {
  const dispatchEvidenceRegistryRoot = input.registry_root
  const executionAdmissionContract = input.execution_admission_contract
  const dispatchClaim = input.dispatch_claim
  const leaseObservationBody = input.lease_observation_body
  const claimObservation = input.claim_observation
  const claimRenewedObservation = input.renewed_claim_observation
  const successorTransportContract = input.successor_transport_contract
  const replayProfile = input.profile

  const preIssueObservation = createReplayAttemptLeaseObservationSnapshot({
    ...leaseObservationBody,
    observation_id: "lease-observation-envelope-pre-issue",
    observation_ref: "observation://replay-attempt-lease/envelope-pre-issue",
    observed_at: "2026-07-14T00:00:34Z",
  })
  const preIssueInput = {
    source_execution_admission_contract: executionAdmissionContract,
    source_dispatch_claim: dispatchClaim,
    source_current_lease_observation: preIssueObservation,
  }
  const preIssueBundle = buildReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle(preIssueInput)
  replayProfile("pre-issue bundle")
  expect(preIssueBundle.status).toBe("claim_and_lease_evidence_bound_command_issue_blocked")
  expect(preIssueBundle.durable_claim_binding).toBe("exact_local_cas_dispatch_claim_bound")
  expect(preIssueBundle.lease_revalidation_status)
    .toBe("fresh_under_control_plane_receipt_with_caller_supplied_clock_only")
  expect(preIssueBundle.predecessor_blocker_closure)
    .toBe("dispatch_claim_and_current_lease_revalidation_bound_without_closing_provenance_or_clock")
  expect(preIssueBundle.control_plane_registry_read_provenance)
    .toBe("not_materialized_observation_wire_only")
  expect(preIssueBundle.clock_evidence).toBe("caller_supplied_utc_not_external_time_attestation")
  expect(preIssueBundle.target_worker_request_hash).toBe(executionAdmissionContract.target_worker_request_hash)
  expect(preIssueBundle.attempt_id).toBe(dispatchClaim.attempt_id)
  expect(preIssueBundle.lease_generation).toBe(dispatchClaim.lease_generation)
  expect(preIssueBundle.successor_process_artifact_hash)
    .toBe(successorTransportContract.successor_process_artifact_hash)
  expect(preIssueBundle.transport_contract_hash).toBe(successorTransportContract.contract_hash)
  expect(preIssueBundle.execution_admission_command).toBeNull()
  expect(preIssueBundle.execution_admission_command_instance_count).toBe(0)
  expect(preIssueBundle.blockers).toEqual([
    "control_plane_registry_read_provenance_not_materialized",
    "independent_dispatch_clock_attestation_not_materialized",
    "execution_admission_command_instance_not_issued",
    "attempt_bound_stdio_process_launch_intent_not_materialized",
    "attempt_bound_stdio_process_receipt_not_materialized",
    "worker_request_frame_write_and_decode_not_materialized",
    "worker_response_frame_read_and_admission_not_materialized",
  ])
  expect(preIssueBundle.dispatch_occurrence).toBe("not_materialized")
  expect(preIssueBundle.transport_activation).toBe("blocked")
  expect(preIssueBundle.harness_invocation).toBe("forbidden")
  expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle(preIssueBundle))
    .not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundleLineage(
    preIssueBundle,
    preIssueInput,
  )).not.toThrow()
  expect(() => buildReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle({
    ...preIssueInput,
    source_current_lease_observation: claimObservation,
  })).toThrow("observation is not post-claim fresh")
  expect(() => buildReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle({
    ...preIssueInput,
    source_current_lease_observation: claimRenewedObservation,
  })).toThrow("parent binding drift")
  expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle({
    ...preIssueBundle,
    execution_admission_command_instance_count: 1 as never,
  })).toThrow("unsupported decision harness Worker v10 Execution Admission pre-issue authority")

  const missingPreIssueRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-pre-issue-missing-"))
  try {
    expect(() => registerReplayWorkerV10ExecutionAdmissionPreIssueBundle({
      registry_root: missingPreIssueRoot,
      ...preIssueInput,
    })).toThrow()
  } finally {
    rmSync(missingPreIssueRoot, { recursive: true, force: true })
  }
  expect(registerReplayWorkerV10ExecutionAdmissionPreIssueBundle({
    registry_root: dispatchEvidenceRegistryRoot,
    ...preIssueInput,
  })).toEqual(preIssueBundle)
  expect(registerReplayWorkerV10ExecutionAdmissionPreIssueBundle({
    registry_root: dispatchEvidenceRegistryRoot,
    source_execution_admission_contract: structuredClone(executionAdmissionContract),
    source_dispatch_claim: structuredClone(dispatchClaim),
    source_current_lease_observation: structuredClone(preIssueObservation),
  })).toEqual(preIssueBundle)
  expect(readReplayWorkerV10ExecutionAdmissionPreIssueBundle({
    registry_root: dispatchEvidenceRegistryRoot,
    ...preIssueInput,
  })).toEqual(preIssueBundle)
  const registryReadReceipt = createReplayAttemptLeaseObservationRegistryReadReceipt({
    schema_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_SCHEMA_VERSION,
    receipt_id: `replay-attempt-lease-observation-registry-read-${preIssueObservation.observation_hash.slice(0, 16)}-${Date.parse("2026-07-14T00:00:35Z")}`,
    receipt_ref: `receipt://replay-attempt-lease-observation-registry-read/${preIssueObservation.observation_hash.slice(0, 16)}-${Date.parse("2026-07-14T00:00:35Z")}`,
    receipt_policy_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_POLICY_VERSION,
    status: "registered_active_lease_observation_read",
    authority_owner: "research_control_plane",
    authority_source: "research_control_plane_state_store",
    registry_table: "rd_replay_attempt_lease_observation",
    registry_key: preIssueObservation.observation_id,
    registry_row_immutability: "sqlite_update_and_delete_triggers",
    read_consistency: "single_control_plane_transaction",
    registry_read_provenance: "registered_row_and_current_attempt_exact_match",
    registered_at: "2026-07-14T00:00:34Z",
    read_at: "2026-07-14T00:00:35Z",
    clock_evidence: "caller_supplied_utc_not_external_time_attestation",
    external_time_attestation: "not_provided",
    source_observation_id: preIssueObservation.observation_id,
    source_observation_ref: preIssueObservation.observation_ref,
    source_observation_hash: preIssueObservation.observation_hash,
    source_observation: preIssueObservation,
    current_attempt_status: preIssueObservation.attempt_lease.status,
    current_attempt_lease_hash: preIssueObservation.attempt_lease_hash,
    current_attempt_lease: preIssueObservation.attempt_lease,
  })
  const registryProvenanceInput = {
    source_pre_issue_bundle: preIssueBundle,
    control_plane_registry_read_receipt: registryReadReceipt,
  }
  const registryProvenance = buildReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance(
    registryProvenanceInput,
  )
  replayProfile("registry provenance")
  expect(registryProvenance.status).toBe("registry_provenance_bound_independent_clock_blocked")
  expect(registryProvenance.control_plane_registry_read_provenance)
    .toBe("registered_row_and_current_attempt_exact_match_bound")
  expect(registryProvenance.predecessor_blocker_closure)
    .toBe("control_plane_registry_read_provenance_closed_only")
  expect(registryProvenance.external_time_attestation).toBe("not_provided")
  expect(registryProvenance.execution_admission_command_instance_count).toBe(0)
  expect(registryProvenance.blockers).toEqual([
    "independent_dispatch_clock_attestation_not_materialized",
    "execution_admission_command_instance_not_issued",
    "attempt_bound_stdio_process_launch_intent_not_materialized",
    "attempt_bound_stdio_process_receipt_not_materialized",
    "worker_request_frame_write_and_decode_not_materialized",
    "worker_response_frame_read_and_admission_not_materialized",
  ])
  expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance(registryProvenance))
    .not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenanceLineage(
    registryProvenance,
    registryProvenanceInput,
  )).not.toThrow()
  expect(() => buildReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance({
    ...registryProvenanceInput,
    control_plane_registry_read_receipt: { ...registryReadReceipt, receipt_hash: "1".repeat(64) },
  })).toThrow()
  const missingProvenanceRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-registry-provenance-missing-"))
  try {
    expect(() => registerReplayWorkerV10ExecutionAdmissionRegistryProvenance({
      registry_root: missingProvenanceRoot,
      ...registryProvenanceInput,
    })).toThrow("requires the exact durable pre-issue bundle")
  } finally {
    rmSync(missingProvenanceRoot, { recursive: true, force: true })
  }
  expect(registerReplayWorkerV10ExecutionAdmissionRegistryProvenance({
    registry_root: dispatchEvidenceRegistryRoot,
    ...registryProvenanceInput,
  })).toEqual(registryProvenance)
  expect(registerReplayWorkerV10ExecutionAdmissionRegistryProvenance({
    registry_root: dispatchEvidenceRegistryRoot,
    source_pre_issue_bundle: structuredClone(preIssueBundle),
    control_plane_registry_read_receipt: structuredClone(registryReadReceipt),
  })).toEqual(registryProvenance)
  expect(readReplayWorkerV10ExecutionAdmissionRegistryProvenance({
    registry_root: dispatchEvidenceRegistryRoot,
    ...registryProvenanceInput,
  })).toEqual(registryProvenance)
  const clockIdentityHash = replayDispatchClockAttestationIdentityHash({
    source_registry_read_receipt_hash: registryReadReceipt.receipt_hash,
    registry_read_started_at: registryReadReceipt.read_at,
    registry_read_completed_at: "2026-07-14T00:00:36Z",
    registry_read_started_monotonic_ns: "3000000",
    registry_read_completed_monotonic_ns: "3000100",
    attestation_policy_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION,
  })
  const clockAttestation = createReplayDispatchClockAttestation({
    schema_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_SCHEMA_VERSION,
    attestation_id: `replay-dispatch-clock-attestation-${clockIdentityHash.slice(0, 24)}`,
    attestation_ref: `attestation://replay-dispatch-clock/${clockIdentityHash.slice(0, 24)}`,
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
    registry_read_started_at: registryReadReceipt.read_at,
    registry_read_completed_at: "2026-07-14T00:00:36Z",
    registry_read_started_monotonic_ns: "3000000",
    registry_read_completed_monotonic_ns: "3000100",
    source_registry_read_receipt_id: registryReadReceipt.receipt_id,
    source_registry_read_receipt_ref: registryReadReceipt.receipt_ref,
    source_registry_read_receipt_hash: registryReadReceipt.receipt_hash,
    source_registry_read_receipt: registryReadReceipt,
    attempt_id: registryReadReceipt.current_attempt_lease.attempt_id,
    worker_id: registryReadReceipt.current_attempt_lease.worker_id,
    lease_generation: registryReadReceipt.current_attempt_lease.lease_generation,
    current_attempt_lease_hash: registryReadReceipt.current_attempt_lease_hash,
  })
  const clockBindingInput = {
    source_registry_provenance: registryProvenance,
    control_plane_clock_attestation: clockAttestation,
  }
  const clockBinding = buildReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation(clockBindingInput)
  replayProfile("clock binding")
  expect(clockBinding.status).toBe("authority_clock_attested_command_issue_blocked")
  expect(clockBinding.independent_dispatch_clock_attestation).toBe("authority_internal_dual_sample_bound")
  expect(clockBinding.clock_authority_limit).toBe("local_control_plane_process_clock_not_signed_remote_or_tsa_time")
  expect(clockBinding.predecessor_blocker_closure).toBe("independent_dispatch_clock_attestation_closed_only")
  expect(clockBinding.execution_admission_command_instance_count).toBe(0)
  expect(clockBinding.blockers).toEqual([
    "execution_admission_command_instance_not_issued",
    "attempt_bound_stdio_process_launch_intent_not_materialized",
    "attempt_bound_stdio_process_receipt_not_materialized",
    "worker_request_frame_write_and_decode_not_materialized",
    "worker_response_frame_read_and_admission_not_materialized",
  ])
  expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation(clockBinding)).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestationLineage(
    clockBinding,
    clockBindingInput,
  )).not.toThrow()
  expect(() => buildReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation({
    ...clockBindingInput,
    control_plane_clock_attestation: { ...clockAttestation, attestation_hash: "2".repeat(64) },
  })).toThrow()
  const missingClockRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-clock-attestation-missing-"))
  try {
    expect(() => registerReplayWorkerV10ExecutionAdmissionClockAttestation({
      registry_root: missingClockRoot,
      ...clockBindingInput,
    })).toThrow("requires the exact durable registry provenance")
  } finally {
    rmSync(missingClockRoot, { recursive: true, force: true })
  }
  expect(registerReplayWorkerV10ExecutionAdmissionClockAttestation({
    registry_root: dispatchEvidenceRegistryRoot,
    ...clockBindingInput,
  })).toEqual(clockBinding)
  expect(readReplayWorkerV10ExecutionAdmissionClockAttestation({
    registry_root: dispatchEvidenceRegistryRoot,
    ...clockBindingInput,
  })).toEqual(clockBinding)

  return {
    pre_issue_observation: preIssueObservation,
    pre_issue_input: preIssueInput,
    pre_issue_bundle: preIssueBundle,
    registry_read_receipt: registryReadReceipt,
    registry_provenance_input: registryProvenanceInput,
    registry_provenance: registryProvenance,
    clock_attestation: clockAttestation,
    clock_binding_input: clockBindingInput,
    clock_binding: clockBinding,
  }
}
