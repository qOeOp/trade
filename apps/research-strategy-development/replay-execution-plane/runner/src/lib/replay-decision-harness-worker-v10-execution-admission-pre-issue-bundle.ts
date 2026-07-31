import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayDecisionHarnessDispatchClaim,
  type ReplayDecisionHarnessDispatchClaim,
} from "../../../contracts/src/lib/replay-decision-harness-dispatch-claim"
import {
  assertReplayAttemptLeaseObservationEnvelopeView,
  type ReplayAttemptLeaseObservationEnvelopeView,
} from "../../../contracts/src/lib/replay-decision-harness-dispatch-lease-authority-binding"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionContract,
  type ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-contract"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_PRE_ISSUE_BUNDLE_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_PRE_ISSUE_POLICY_VERSION,
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle,
  createReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle,
  replayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBlockers,
  replayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundleKey,
  type ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-pre-issue-bundle"

export interface BuildReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundleInput {
  source_execution_admission_contract: ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract
  source_dispatch_claim: ReplayDecisionHarnessDispatchClaim
  source_current_lease_observation: ReplayAttemptLeaseObservationEnvelopeView
}

export function buildReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle(
  input: BuildReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundleInput,
): ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionContract(input.source_execution_admission_contract)
  assertReplayDecisionHarnessDispatchClaim(input.source_dispatch_claim)
  assertReplayAttemptLeaseObservationEnvelopeView(input.source_current_lease_observation)
  const contract = input.source_execution_admission_contract
  const claim = input.source_dispatch_claim
  const observation = input.source_current_lease_observation
  const successor = contract.source_successor_transport_contract
  const bundleKey = replayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundleKey({
    execution_admission_contract_hash: contract.contract_hash,
    dispatch_claim_hash: claim.claim_hash,
    current_lease_observation_hash: observation.observation_hash,
    pre_issue_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_PRE_ISSUE_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle({
    schema_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_PRE_ISSUE_BUNDLE_SCHEMA_VERSION,
    bundle_id: `decision-harness-worker-v10-execution-pre-issue-${bundleKey.slice(0, 24)}`,
    bundle_key: bundleKey,
    pre_issue_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_PRE_ISSUE_POLICY_VERSION,
    scope: "attempt_bound_execution_admission_pre_issue_evidence_only",
    owner: "replay_runner_worker_v10_execution_admission_pre_issue_registry",
    purpose: "bind_exact_dispatch_claim_and_post_claim_lease_observation_without_issuing_command",
    status: "claim_and_lease_evidence_bound_command_issue_blocked",
    source_execution_admission_contract_id: contract.contract_id,
    source_execution_admission_contract_hash: contract.contract_hash,
    source_execution_admission_contract: structuredClone(contract),
    source_dispatch_claim_id: claim.claim_id,
    source_dispatch_claim_hash: claim.claim_hash,
    source_dispatch_claim: structuredClone(claim),
    source_current_lease_observation_id: observation.observation_id,
    source_current_lease_observation_ref: observation.observation_ref,
    source_current_lease_observation_hash: observation.observation_hash,
    source_current_lease_observation: structuredClone(observation),
    target_logical_request_id: contract.target_logical_request_id,
    target_worker_request_hash: contract.target_worker_request_hash,
    attempt_id: claim.attempt_id,
    attempt_ordinal: claim.attempt_ordinal,
    worker_id: claim.worker_id,
    lease_generation: claim.lease_generation,
    current_attempt_lease_hash: observation.attempt_lease_hash,
    successor_process_artifact_hash: successor.successor_process_artifact_hash,
    transport_contract_hash: successor.contract_hash,
    durable_claim_binding: "exact_local_cas_dispatch_claim_bound",
    claim_authority_limit: "cas_exclusivity_only_not_process_or_transport_authority",
    lease_observation_policy: "strictly_after_claim_same_exact_lease_generation_and_before_expiry",
    lease_revalidation_status: "fresh_under_control_plane_receipt_with_caller_supplied_clock_only",
    control_plane_registry_read_provenance: "not_materialized_observation_wire_only",
    clock_evidence: "caller_supplied_utc_not_external_time_attestation",
    predecessor_blocker_closure:
      "dispatch_claim_and_current_lease_revalidation_bound_without_closing_provenance_or_clock",
    execution_admission_command: null,
    execution_admission_command_instance_count: 0,
    command_issue_status: "blocked",
    blocker_set_policy: "complete_deterministic_ordered_post_bundle_pre_issue_blockers",
    blockers: replayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBlockers(),
    attempt_bound_process_launch_intent: null,
    attempt_bound_process_receipt: null,
    request_frame_instance_count: 0,
    request_write_receipt_count: 0,
    request_decode_receipt_count: 0,
    response_frame_instance_count: 0,
    response_read_receipt_count: 0,
    dispatch_occurrence: "not_materialized",
    transport_activation: "blocked",
    harness_invocation: "forbidden",
    response_admission: "not_granted",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}

export function assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundleLineage(
  value: ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle,
  input: BuildReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundleInput,
): void {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle(value)
  const expected = buildReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle(input)
  if (canonicalHash(value) !== canonicalHash(expected)) {
    throw new Error("decision harness Worker v10 Execution Admission pre-issue lineage drift")
  }
}
