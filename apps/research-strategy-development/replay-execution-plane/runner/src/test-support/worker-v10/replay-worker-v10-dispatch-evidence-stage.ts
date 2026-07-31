import { expect } from "bun:test"
import type {
  ReplayAttemptLeaseSnapshot,
} from "../../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  assertReplayDecisionHarnessDispatchEvidenceRegistration,
  type ReplayDecisionHarnessDispatchEvidenceRegistration,
} from "../../../../contracts/src/lib/replay-decision-harness-dispatch-evidence-registration"
import type {
  ReplayDecisionHarnessDispatchLeaseAuthorityBinding,
} from "../../../../contracts/src/lib/replay-decision-harness-dispatch-lease-authority-binding"
import {
  readReplayDispatchEvidence,
  registerReplayDispatchEvidence,
} from "../../lib/replay-dispatch-evidence-registry"

export interface ReplayWorkerV10DispatchEvidenceStageInput {
  registry_root: string
  authority_binding: ReplayDecisionHarnessDispatchLeaseAuthorityBinding
  attempt_lease: ReplayAttemptLeaseSnapshot
  profile(stage: string): void
}

export interface ReplayWorkerV10DispatchEvidenceStageOutput {
  dispatch_evidence_registration: ReplayDecisionHarnessDispatchEvidenceRegistration
}

export function runReplayWorkerV10DispatchEvidenceStage(
  input: ReplayWorkerV10DispatchEvidenceStageInput,
): ReplayWorkerV10DispatchEvidenceStageOutput {
  const dispatchEvidenceRegistryRoot = input.registry_root
  const dispatchAuthorityBinding = input.authority_binding
  const attemptLease = input.attempt_lease
  input.profile("dispatch envelope and lease binding")

  expect(() => registerReplayDispatchEvidence({
    registry_root: dispatchEvidenceRegistryRoot,
    authority_binding: dispatchAuthorityBinding,
    registered_at: attemptLease.lease_expires_at,
  })).toThrow("must occur inside the observed Lease window")
  const dispatchEvidenceRegistration = registerReplayDispatchEvidence({
    registry_root: dispatchEvidenceRegistryRoot,
    authority_binding: dispatchAuthorityBinding,
    registered_at: "2026-07-14T00:00:31Z",
  })
  expect(dispatchEvidenceRegistration.source_authority_binding_hash)
    .toBe(dispatchAuthorityBinding.binding_hash)
  expect(dispatchEvidenceRegistration.evidence_status).toBe("durable_pre_dispatch_evidence_only")
  expect(dispatchEvidenceRegistration.dispatch_claim).toBeNull()
  expect(dispatchEvidenceRegistration.dispatch_eligibility)
    .toBe("requires_future_current_lease_revalidation_and_one_time_dispatch_claim")
  expect(dispatchEvidenceRegistration.dispatch_occurrence).toBe("not_materialized")
  expect(() => assertReplayDecisionHarnessDispatchEvidenceRegistration(
    dispatchEvidenceRegistration,
  )).not.toThrow()
  expect(registerReplayDispatchEvidence({
    registry_root: dispatchEvidenceRegistryRoot,
    authority_binding: structuredClone(dispatchAuthorityBinding),
    registered_at: "2026-07-14T00:00:32Z",
  })).toEqual(dispatchEvidenceRegistration)
  expect(readReplayDispatchEvidence({
    registry_root: dispatchEvidenceRegistryRoot,
    attempt_id: dispatchEvidenceRegistration.attempt_id,
    lease_generation: dispatchEvidenceRegistration.lease_generation,
    logical_request_id: dispatchEvidenceRegistration.logical_request_id,
  })).toEqual(dispatchEvidenceRegistration)
  return {
    dispatch_evidence_registration: dispatchEvidenceRegistration,
  }
}
