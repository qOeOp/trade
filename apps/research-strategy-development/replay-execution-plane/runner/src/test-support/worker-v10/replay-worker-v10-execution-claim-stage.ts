import { expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createReplayAttemptLeaseObservationSnapshot,
  hashReplayAttemptLeaseSnapshot,
  type ReplayAttemptLeaseObservationBody,
  type ReplayAttemptLeaseObservationSnapshot,
  type ReplayAttemptLeaseSnapshot,
} from "../../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  assertReplayDecisionHarnessDispatchClaim,
  type ReplayDecisionHarnessDispatchClaim,
} from "../../../../contracts/src/lib/replay-decision-harness-dispatch-claim"
import type {
  ReplayDecisionHarnessDispatchEvidenceRegistration,
} from "../../../../contracts/src/lib/replay-decision-harness-dispatch-evidence-registration"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionContract,
} from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-contract"
import type {
  ReplayDecisionHarnessWorkerV10SuccessorTransportContract,
} from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-transport-contract"
import {
  claimReplayDispatch,
  readReplayDispatchClaim,
} from "../../lib/replay-dispatch-claim-registry"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionContractLineage,
  buildReplayDecisionHarnessWorkerV10ExecutionAdmissionContract,
} from "../../lib/replay-decision-harness-worker-v10-execution-admission-contract"
import {
  readReplayWorkerV10ExecutionAdmissionContract,
  registerReplayWorkerV10ExecutionAdmissionContract,
} from "../../lib/replay-worker-v10-execution-admission-contract-registry"

export interface ReplayWorkerV10ExecutionClaimStageInput {
  registry_root: string
  successor_transport_contract: ReplayDecisionHarnessWorkerV10SuccessorTransportContract
  lease_observation_body: ReplayAttemptLeaseObservationBody
  lease_observation: ReplayAttemptLeaseObservationSnapshot
  dispatch_evidence_registration: ReplayDecisionHarnessDispatchEvidenceRegistration
  attempt_lease: ReplayAttemptLeaseSnapshot
  renewed_lease: ReplayAttemptLeaseSnapshot
  profile(stage: string): void
}

export interface ReplayWorkerV10ExecutionClaimStageOutput {
  execution_admission_contract: ReturnType<
    typeof buildReplayDecisionHarnessWorkerV10ExecutionAdmissionContract
  >
  claim_observation: ReplayAttemptLeaseObservationSnapshot
  renewed_claim_observation: ReplayAttemptLeaseObservationSnapshot
  dispatch_claim: ReplayDecisionHarnessDispatchClaim
}

export function runReplayWorkerV10ExecutionClaimStage(
  input: ReplayWorkerV10ExecutionClaimStageInput,
): ReplayWorkerV10ExecutionClaimStageOutput {
  const dispatchEvidenceRegistryRoot = input.registry_root
  const successorTransportContract = input.successor_transport_contract
  const leaseObservationBody = input.lease_observation_body
  const leaseObservation = input.lease_observation
  const dispatchEvidenceRegistration = input.dispatch_evidence_registration
  const attemptLease = input.attempt_lease
  const renewedLease = input.renewed_lease
  const replayProfile = input.profile

  const missingExecutionAdmissionRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-admission-missing-"))
  try {
    expect(() => registerReplayWorkerV10ExecutionAdmissionContract({
      registry_root: missingExecutionAdmissionRoot,
      source_successor_transport_contract: successorTransportContract,
    })).toThrow()
  } finally {
    rmSync(missingExecutionAdmissionRoot, { recursive: true, force: true })
  }
  const executionAdmissionInput = {
    source_successor_transport_contract: successorTransportContract,
  }
  const executionAdmissionContract = buildReplayDecisionHarnessWorkerV10ExecutionAdmissionContract(
    executionAdmissionInput,
  )
  replayProfile("execution admission")
  expect(executionAdmissionContract.status)
    .toBe("authority_model_frozen_activation_blocked_zero_instance")
  expect(executionAdmissionContract.execution_authority_model)
    .toBe("separate_attempt_bound_execution_admission_command")
  expect(executionAdmissionContract.request_v11_decision)
    .toBe("not_required_for_authority_only_transition")
  expect(executionAdmissionContract.worker_request_v10_role)
    .toBe("immutable_non_executable_logical_payload_source")
  expect(executionAdmissionContract.worker_request_marker_policy)
    .toBe("preserved_not_overridden_or_reinterpreted")
  expect(executionAdmissionContract.effective_executable_object)
    .toBe("future_execution_admission_command_not_worker_request_v10")
  expect(executionAdmissionContract.target_worker_request_execution_admission).toBe("not_granted")
  expect(executionAdmissionContract.target_worker_request_transport_status).toBe("not_invoked")
  expect(executionAdmissionContract.future_command_required_bindings).toEqual([
    "worker_request_hash",
    "logical_request_id",
    "attempt_id",
    "attempt_ordinal",
    "worker_id",
    "lease_generation",
    "dispatch_claim_hash",
    "current_lease_observation_hash",
    "successor_process_artifact_hash",
    "transport_contract_hash",
  ])
  expect(executionAdmissionContract.blockers).toEqual([
    "exact_durable_dispatch_claim_not_bound",
    "control_plane_registry_read_provenance_not_materialized",
    "independent_dispatch_clock_attestation_not_materialized",
    "current_lease_revalidation_for_admission_command_not_materialized",
    "execution_admission_command_instance_not_issued",
    "attempt_bound_stdio_process_launch_intent_not_materialized",
    "attempt_bound_stdio_process_receipt_not_materialized",
    "worker_request_frame_write_and_decode_not_materialized",
    "worker_response_frame_read_and_admission_not_materialized",
  ])
  expect(executionAdmissionContract.admission_command_instance_count).toBe(0)
  expect(executionAdmissionContract.request_frame_instance_count).toBe(0)
  expect(executionAdmissionContract.request_write_receipt_count).toBe(0)
  expect(executionAdmissionContract.request_decode_receipt_count).toBe(0)
  expect(executionAdmissionContract.response_frame_instance_count).toBe(0)
  expect(executionAdmissionContract.response_read_receipt_count).toBe(0)
  expect(executionAdmissionContract.dispatch_occurrence).toBe("not_materialized")
  expect(executionAdmissionContract.transport_activation).toBe("blocked")
  expect(executionAdmissionContract.harness_invocation).toBe("forbidden")
  expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionContract(
    executionAdmissionContract,
  )).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionContractLineage(
    executionAdmissionContract,
    executionAdmissionInput,
  )).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionContract({
    ...executionAdmissionContract,
    worker_request_marker_policy: "overridden" as never,
  })).toThrow("unsupported decision harness Worker v10 Execution Admission Contract authority")
  expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionContract({
    ...executionAdmissionContract,
    admission_command_instance_count: 1 as never,
  })).toThrow("unsupported decision harness Worker v10 Execution Admission Contract authority")
  expect(registerReplayWorkerV10ExecutionAdmissionContract({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_transport_contract: successorTransportContract,
  })).toEqual(executionAdmissionContract)
  expect(registerReplayWorkerV10ExecutionAdmissionContract({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_transport_contract: structuredClone(successorTransportContract),
  })).toEqual(executionAdmissionContract)
  expect(readReplayWorkerV10ExecutionAdmissionContract({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_transport_contract: successorTransportContract,
  })).toEqual(executionAdmissionContract)

  const claimObservation = createReplayAttemptLeaseObservationSnapshot({
    ...leaseObservationBody,
    observation_id: "lease-observation-envelope-claim",
    observation_ref: "observation://replay-attempt-lease/envelope-claim",
    observed_at: "2026-07-14T00:00:32Z",
  })
  expect(() => claimReplayDispatch({
    registry_root: dispatchEvidenceRegistryRoot,
    source_registration: dispatchEvidenceRegistration,
    revalidation_observation: leaseObservation,
    dispatcher_claimant_id: "runner-claimant-1",
    claimed_at: "2026-07-14T00:00:33Z",
  })).toThrow("requires a post-registration Lease observation")
  expect(() => claimReplayDispatch({
    registry_root: dispatchEvidenceRegistryRoot,
    source_registration: dispatchEvidenceRegistration,
    revalidation_observation: claimObservation,
    dispatcher_claimant_id: "runner-claimant-1",
    claimed_at: attemptLease.lease_expires_at,
  })).toThrow("must occur inside the revalidated Lease window")
  const missingRegistrationRoot = mkdtempSync(join(tmpdir(), "replay-dispatch-claim-missing-"))
  try {
    expect(() => claimReplayDispatch({
      registry_root: missingRegistrationRoot,
      source_registration: dispatchEvidenceRegistration,
      revalidation_observation: claimObservation,
      dispatcher_claimant_id: "runner-claimant-1",
      claimed_at: "2026-07-14T00:00:33Z",
    })).toThrow("requires the exact durable Dispatch Evidence Registration")
  } finally {
    rmSync(missingRegistrationRoot, { recursive: true, force: true })
  }
  const claimRenewedObservation = createReplayAttemptLeaseObservationSnapshot({
    ...leaseObservationBody,
    observation_id: "lease-observation-envelope-claim-renewed",
    observation_ref: "observation://replay-attempt-lease/envelope-claim-renewed",
    observed_at: renewedLease.heartbeat_at,
    lease_generation: renewedLease.lease_generation,
    attempt_lease_hash: hashReplayAttemptLeaseSnapshot(renewedLease),
    attempt_lease: renewedLease,
  })
  expect(() => claimReplayDispatch({
    registry_root: dispatchEvidenceRegistryRoot,
    source_registration: dispatchEvidenceRegistration,
    revalidation_observation: claimRenewedObservation,
    dispatcher_claimant_id: "runner-claimant-1",
    claimed_at: "2026-07-14T00:02:01Z",
  })).toThrow("registration or Lease revalidation drift")

  const dispatchClaim = claimReplayDispatch({
    registry_root: dispatchEvidenceRegistryRoot,
    source_registration: dispatchEvidenceRegistration,
    revalidation_observation: claimObservation,
    dispatcher_claimant_id: "runner-claimant-1",
    claimed_at: "2026-07-14T00:00:33Z",
  })
  replayProfile("dispatch claim")
  expect(dispatchClaim.claim_effect)
    .toBe("at_most_one_local_claimant_while_cas_record_is_preserved")
  expect(dispatchClaim.delivery_guarantee).toBe("at_most_once_claim_can_lose_dispatch_before_occurrence")
  expect(dispatchClaim.dispatch_authorization)
    .toBe("cas_exclusivity_only_not_process_or_transport_authority")
  expect(dispatchClaim.dispatch_occurrence).toBe("not_materialized")
  expect(() => assertReplayDecisionHarnessDispatchClaim(dispatchClaim)).not.toThrow()
  expect(claimReplayDispatch({
    registry_root: dispatchEvidenceRegistryRoot,
    source_registration: structuredClone(dispatchEvidenceRegistration),
    revalidation_observation: structuredClone(claimObservation),
    dispatcher_claimant_id: "runner-claimant-1",
    claimed_at: "2026-07-14T00:00:34Z",
  })).toEqual(dispatchClaim)
  expect(() => claimReplayDispatch({
    registry_root: dispatchEvidenceRegistryRoot,
    source_registration: dispatchEvidenceRegistration,
    revalidation_observation: claimObservation,
    dispatcher_claimant_id: "runner-claimant-2",
    claimed_at: "2026-07-14T00:00:34Z",
  })).toThrow("natural key is already claimed by different authority")
  expect(readReplayDispatchClaim({
    registry_root: dispatchEvidenceRegistryRoot,
    attempt_id: dispatchEvidenceRegistration.attempt_id,
    lease_generation: dispatchEvidenceRegistration.lease_generation,
    logical_request_id: dispatchEvidenceRegistration.logical_request_id,
  })).toEqual(dispatchClaim)

  return {
    execution_admission_contract: executionAdmissionContract,
    claim_observation: claimObservation,
    renewed_claim_observation: claimRenewedObservation,
    dispatch_claim: dispatchClaim,
  }
}
