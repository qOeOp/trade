import { expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createReplayAttemptLeaseObservationSnapshot, type ReplayAttemptLeaseObservationBody, type ReplayAttemptLeaseObservationSnapshot } from "../../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import type { ReplayDecisionHarnessDispatchClaim } from "../../../../contracts/src/lib/replay-decision-harness-dispatch-claim"
import type { ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-contract"
import { assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-pre-issue-bundle"
import type { ReplayDecisionHarnessWorkerV10SuccessorTransportContract } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-transport-contract"
import { assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundleLineage, buildReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle } from "../../lib/replay-decision-harness-worker-v10-execution-admission-pre-issue-bundle"
import { readReplayWorkerV10ExecutionAdmissionPreIssueBundle, registerReplayWorkerV10ExecutionAdmissionPreIssueBundle } from "../../lib/replay-worker-v10-execution-admission-pre-issue-registry"

export interface ReplayWorkerV10PreIssueBundleStageInput {
  registry_root: string
  execution_admission_contract: ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract
  dispatch_claim: ReplayDecisionHarnessDispatchClaim
  lease_observation_body: ReplayAttemptLeaseObservationBody
  claim_observation: ReplayAttemptLeaseObservationSnapshot
  renewed_claim_observation: ReplayAttemptLeaseObservationSnapshot
  successor_transport_contract: ReplayDecisionHarnessWorkerV10SuccessorTransportContract
  profile(stage: string): void
}

export function runReplayWorkerV10PreIssueBundleStage(
  input: ReplayWorkerV10PreIssueBundleStageInput,
) {
  const observation = createReplayAttemptLeaseObservationSnapshot({
    ...input.lease_observation_body,
    observation_id: "lease-observation-envelope-pre-issue",
    observation_ref: "observation://replay-attempt-lease/envelope-pre-issue",
    observed_at: "2026-07-14T00:00:34Z",
  })
  const bundleInput = {
    source_execution_admission_contract: input.execution_admission_contract,
    source_dispatch_claim: input.dispatch_claim,
    source_current_lease_observation: observation,
  }
  const bundle = buildReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle(bundleInput)
  input.profile("pre-issue bundle")
  expect(bundle.status).toBe("claim_and_lease_evidence_bound_command_issue_blocked")
  expect(bundle.durable_claim_binding).toBe("exact_local_cas_dispatch_claim_bound")
  expect(bundle.lease_revalidation_status)
    .toBe("fresh_under_control_plane_receipt_with_caller_supplied_clock_only")
  expect(bundle.predecessor_blocker_closure)
    .toBe("dispatch_claim_and_current_lease_revalidation_bound_without_closing_provenance_or_clock")
  expect(bundle.control_plane_registry_read_provenance)
    .toBe("not_materialized_observation_wire_only")
  expect(bundle.clock_evidence).toBe("caller_supplied_utc_not_external_time_attestation")
  expect(bundle.target_worker_request_hash)
    .toBe(input.execution_admission_contract.target_worker_request_hash)
  expect(bundle.attempt_id).toBe(input.dispatch_claim.attempt_id)
  expect(bundle.lease_generation).toBe(input.dispatch_claim.lease_generation)
  expect(bundle.successor_process_artifact_hash)
    .toBe(input.successor_transport_contract.successor_process_artifact_hash)
  expect(bundle.transport_contract_hash).toBe(input.successor_transport_contract.contract_hash)
  expect(bundle.execution_admission_command).toBeNull()
  expect(bundle.execution_admission_command_instance_count).toBe(0)
  expect(bundle.blockers).toEqual([
    "control_plane_registry_read_provenance_not_materialized",
    "independent_dispatch_clock_attestation_not_materialized",
    "execution_admission_command_instance_not_issued",
    "attempt_bound_stdio_process_launch_intent_not_materialized",
    "attempt_bound_stdio_process_receipt_not_materialized",
    "worker_request_frame_write_and_decode_not_materialized",
    "worker_response_frame_read_and_admission_not_materialized",
  ])
  expect(bundle.dispatch_occurrence).toBe("not_materialized")
  expect(bundle.transport_activation).toBe("blocked")
  expect(bundle.harness_invocation).toBe("forbidden")
  expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle(bundle))
    .not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundleLineage(
    bundle,
    bundleInput,
  )).not.toThrow()
  expect(() => buildReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle({
    ...bundleInput,
    source_current_lease_observation: input.claim_observation,
  })).toThrow("observation is not post-claim fresh")
  expect(() => buildReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle({
    ...bundleInput,
    source_current_lease_observation: input.renewed_claim_observation,
  })).toThrow("parent binding drift")
  expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle({
    ...bundle,
    execution_admission_command_instance_count: 1 as never,
  })).toThrow("unsupported decision harness Worker v10 Execution Admission pre-issue authority")

  const missingRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-pre-issue-missing-"))
  try {
    expect(() => registerReplayWorkerV10ExecutionAdmissionPreIssueBundle({
      registry_root: missingRoot,
      ...bundleInput,
    })).toThrow()
  } finally {
    rmSync(missingRoot, { recursive: true, force: true })
  }
  expect(registerReplayWorkerV10ExecutionAdmissionPreIssueBundle({
    registry_root: input.registry_root,
    ...bundleInput,
  })).toEqual(bundle)
  expect(registerReplayWorkerV10ExecutionAdmissionPreIssueBundle({
    registry_root: input.registry_root,
    source_execution_admission_contract: structuredClone(input.execution_admission_contract),
    source_dispatch_claim: structuredClone(input.dispatch_claim),
    source_current_lease_observation: structuredClone(observation),
  })).toEqual(bundle)
  expect(readReplayWorkerV10ExecutionAdmissionPreIssueBundle({
    registry_root: input.registry_root,
    ...bundleInput,
  })).toEqual(bundle)
  return { pre_issue_observation: observation, pre_issue_input: bundleInput, pre_issue_bundle: bundle }
}
