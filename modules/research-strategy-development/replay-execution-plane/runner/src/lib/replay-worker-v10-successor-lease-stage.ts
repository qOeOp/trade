import { expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  assertReplaySuccessorVerificationLeaseRenewalReceipt,
  hashReplayAttemptLeaseSnapshot,
  type ReplayAttemptLeaseSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import type { ReplayDecisionHarnessExecutionEnvelope } from "../../../contracts/src/lib/replay-decision-harness-execution-envelope"
import type { ReplayDecisionHarnessWorkerRequestV10 } from "../../../contracts/src/lib/replay-decision-harness-worker-request-v10"
import type { ReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-schedule-admission"
import type { ReplayDecisionHarnessWorkerV10ReproducibilityPairContract } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-reproducibility-pair-contract"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_IMMUTABLE_BINDINGS,
  assertReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-verification-authority-contract"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-lease-admission"
import {
  readReplayWorkerV10SuccessorVerificationAuthorityContract,
  registerReplayWorkerV10SuccessorVerificationAuthorityContract,
} from "./replay-worker-v10-successor-verification-authority-contract-registry"
import {
  admitReplayWorkerV10SuccessorLease,
  readReplayWorkerV10SuccessorLeaseAdmission,
} from "./replay-worker-v10-successor-lease-admission-registry"
import {
  readReplayWorkerV10SuccessorVerificationLeaseRenewalRequest,
} from "./replay-worker-v10-successor-verification-lease-renewal-request-registry"
import { createReplayWorkerV10SuccessorLeaseRenewalPortFixture } from "./replay-worker-v10-successor-lease-renewal-port-fixture"

export interface ReplayWorkerV10SuccessorLeaseStageInput {
  registry_root: string
  reproducibility_pair_contract:
    ReplayDecisionHarnessWorkerV10ReproducibilityPairContract
  first_execution_envelope: ReplayDecisionHarnessExecutionEnvelope
  first_schedule_admission: ReplayDecisionHarnessWorkerV10AuthorityScheduleAdmission
  first_worker_request: ReplayDecisionHarnessWorkerRequestV10
  replay_execution_request_hash: string
  predecessor_attempt_lease: ReplayAttemptLeaseSnapshot
  profile(stage: string): void
}

export function runReplayWorkerV10SuccessorLeaseStage(
  input: ReplayWorkerV10SuccessorLeaseStageInput,
) {
  const dispatchEvidenceRegistryRoot = input.registry_root
  const reproducibilityPairContract = input.reproducibility_pair_contract
  const executionEnvelope = input.first_execution_envelope
  const authorityScheduleAdmission = input.first_schedule_admission
  const firstRequestV10 = input.first_worker_request
  const authorityBinding = { request_hash: input.replay_execution_request_hash }
  const attemptLease = input.predecessor_attempt_lease
  const replayProfile = input.profile

  const missingSuccessorAuthorityRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-successor-missing-"))
  try {
    expect(() => registerReplayWorkerV10SuccessorVerificationAuthorityContract({
      registry_root: missingSuccessorAuthorityRoot,
      source_reproducibility_pair_contract: reproducibilityPairContract,
    })).toThrow("requires the exact durable Spawn Boundary Revalidation")
  } finally {
    rmSync(missingSuccessorAuthorityRoot, { recursive: true, force: true })
  }
  const successorAuthorityContract = registerReplayWorkerV10SuccessorVerificationAuthorityContract({
    registry_root: dispatchEvidenceRegistryRoot,
    source_reproducibility_pair_contract: reproducibilityPairContract,
  })
  expect(successorAuthorityContract.status)
    .toBe("same_attempt_successor_generation_selected_not_materialized")
  expect(successorAuthorityContract.selected_successor_authority_kind)
    .toBe("same_attempt_higher_lease_generation")
  expect(successorAuthorityContract.selection_reason)
    .toBe("reproducibility_verification_is_one_attempt_execution_obligation_not_a_terminal_retry")
  expect(successorAuthorityContract.cross_attempt_policy)
    .toBe("new_attempt_reserved_for_control_plane_authorized_recovery_after_prior_attempt_terminal_or_expired")
  expect(successorAuthorityContract.replay_renewal_authority).toBe("none_control_plane_only")
  expect(successorAuthorityContract.source_first_attempt_id).toBe(executionEnvelope.attempt_id)
  expect(successorAuthorityContract.source_first_attempt_ordinal).toBe(executionEnvelope.attempt_ordinal)
  expect(successorAuthorityContract.source_first_worker_id).toBe(executionEnvelope.worker_id)
  expect(successorAuthorityContract.source_first_lease_generation).toBe(executionEnvelope.lease_generation)
  expect(successorAuthorityContract.minimum_successor_lease_generation)
    .toBe(executionEnvelope.lease_generation + 1)
  expect(successorAuthorityContract.required_immutable_bindings)
    .toEqual([...REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_IMMUTABLE_BINDINGS])
  expect(successorAuthorityContract.successor_attempt_lease).toBeNull()
  expect(successorAuthorityContract.successor_execution_envelope).toBeNull()
  expect(successorAuthorityContract.successor_execution_admission_command).toBeNull()
  expect(successorAuthorityContract.successor_process_launch_intent).toBeNull()
  expect(successorAuthorityContract.successor_authority_capsule).toBeNull()
  expect(successorAuthorityContract.successor_authority_lineage_count).toBe(0)
  expect(successorAuthorityContract.second_schedule_admission_count).toBe(0)
  expect(successorAuthorityContract.reproducibility_pair_count).toBe(0)
  expect(successorAuthorityContract.harness_receipt_count).toBe(0)
  expect(successorAuthorityContract.blockers).toEqual([
    "control_plane_successor_lease_evidence_not_materialized",
    "predecessor_linked_successor_execution_envelope_not_materialized",
    "successor_command_intent_capsule_and_process_lineage_not_materialized",
    "second_distinct_fresh_process_schedule_admission_not_materialized",
    "response_reproducibility_pair_not_materialized",
    "worker_v10_harness_receipt_not_materialized",
  ])
  expect(successorAuthorityContract.signal_authority).toBe("none")
  expect(successorAuthorityContract.order_authority).toBe("none")
  expect(successorAuthorityContract.economic_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract(
    successorAuthorityContract,
  )).not.toThrow()
  expect(readReplayWorkerV10SuccessorVerificationAuthorityContract({
    registry_root: dispatchEvidenceRegistryRoot,
    source_reproducibility_pair_contract: reproducibilityPairContract,
  })).toEqual(successorAuthorityContract)
  expect(registerReplayWorkerV10SuccessorVerificationAuthorityContract({
    registry_root: dispatchEvidenceRegistryRoot,
    source_reproducibility_pair_contract: structuredClone(reproducibilityPairContract),
  })).toEqual(successorAuthorityContract)

  const requestedSuccessorLeaseExpiry = "2026-07-14T00:10:00Z"
  let successorRenewalPortCallCount = 0
  const successorLeaseResult = admitReplayWorkerV10SuccessorLease({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_authority_contract: successorAuthorityContract,
    requested_lease_expires_at: requestedSuccessorLeaseExpiry,
    authority_port: createReplayWorkerV10SuccessorLeaseRenewalPortFixture({
      successor_authority_contract: successorAuthorityContract,
      reproducibility_pair_contract: reproducibilityPairContract,
      schedule_admission: authorityScheduleAdmission,
      execution_envelope: executionEnvelope,
      worker_request: firstRequestV10,
      replay_execution_request_hash: authorityBinding.request_hash,
      predecessor_attempt_lease: attemptLease,
      on_call: () => { successorRenewalPortCallCount += 1 },
    }),
  })
  replayProfile("successor lease")
  expect(successorRenewalPortCallCount).toBe(1)
  expect(successorLeaseResult.renewal_request.requested_lease_expires_at)
    .toBe(requestedSuccessorLeaseExpiry)
  expect(successorLeaseResult.renewal_request.request_authority)
    .toBe("none_control_plane_must_atomically_admit_or_reject")
  expect(() => assertReplaySuccessorVerificationLeaseRenewalReceipt(
    successorLeaseResult.control_plane_renewal_receipt,
  )).not.toThrow()
  const successorLeaseAdmission = successorLeaseResult.successor_lease_admission
  expect(successorLeaseAdmission.status)
    .toBe("successor_attempt_lease_admitted_lineage_not_materialized")
  expect(successorLeaseAdmission.source_successor_authority_contract_hash)
    .toBe(successorAuthorityContract.contract_hash)
  expect(successorLeaseAdmission.predecessor_attempt_lease_hash)
    .toBe(hashReplayAttemptLeaseSnapshot(attemptLease))
  expect(successorLeaseAdmission.successor_lease_generation).toBe(attemptLease.lease_generation + 1)
  expect(successorLeaseAdmission.successor_attempt_lease_count).toBe(1)
  expect(successorLeaseAdmission.successor_execution_envelope_count).toBe(0)
  expect(successorLeaseAdmission.successor_authority_lineage_count).toBe(0)
  expect(successorLeaseAdmission.second_schedule_admission_count).toBe(0)
  expect(successorLeaseAdmission.reproducibility_pair_count).toBe(0)
  expect(successorLeaseAdmission.harness_receipt_count).toBe(0)
  expect(successorLeaseAdmission.successor_lease_authority)
    .toBe("admitted_for_fresh_lineage_construction_only")
  expect(successorLeaseAdmission.successor_process_authority)
    .toBe("none_fresh_envelope_command_intent_capsule_revalidation_required")
  expect(successorLeaseAdmission.blockers).toEqual([
    "predecessor_linked_successor_execution_envelope_not_materialized",
    "successor_command_intent_capsule_and_process_lineage_not_materialized",
    "second_distinct_fresh_process_schedule_admission_not_materialized",
    "response_reproducibility_pair_not_materialized",
    "worker_v10_harness_receipt_not_materialized",
  ])
  expect(successorLeaseAdmission.signal_authority).toBe("none")
  expect(successorLeaseAdmission.order_authority).toBe("none")
  expect(successorLeaseAdmission.economic_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission(
    successorLeaseAdmission,
  )).not.toThrow()
  expect(readReplayWorkerV10SuccessorVerificationLeaseRenewalRequest({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_authority_contract: successorAuthorityContract,
    requested_lease_expires_at: requestedSuccessorLeaseExpiry,
  })).toEqual(successorLeaseResult.renewal_request)
  expect(readReplayWorkerV10SuccessorLeaseAdmission({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_authority_contract: successorAuthorityContract,
    source_renewal_request: successorLeaseResult.renewal_request,
  })).toEqual(successorLeaseAdmission)
  expect(admitReplayWorkerV10SuccessorLease({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_authority_contract: structuredClone(successorAuthorityContract),
    requested_lease_expires_at: requestedSuccessorLeaseExpiry,
    authority_port: {
      renew: () => {
        successorRenewalPortCallCount += 1
        throw new Error("durable admission retry must not call Control Plane again")
      },
    },
  })).toEqual(successorLeaseResult)
  expect(successorRenewalPortCallCount).toBe(1)
  expect(() => admitReplayWorkerV10SuccessorLease({
    registry_root: dispatchEvidenceRegistryRoot,
    source_successor_authority_contract: successorAuthorityContract,
    requested_lease_expires_at: "2026-07-14T00:11:00Z",
    authority_port: { renew: () => successorLeaseResult.control_plane_renewal_receipt },
  })).toThrow("natural key has different evidence")

  return {
    authority_contract: successorAuthorityContract,
    requested_lease_expiry: requestedSuccessorLeaseExpiry,
    result: successorLeaseResult,
    admission: successorLeaseAdmission,
  }
}
