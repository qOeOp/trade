import type { ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-spawn-boundary-revalidation"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_POLICY_VERSION } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-cutover-receipt"
import {
  REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_POLICY_VERSION,
  REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_SCHEMA_VERSION,
  assertReplaySpawnBoundaryRevalidationReceipt,
  createReplaySpawnBoundaryRevalidationRequest,
  replaySpawnBoundaryRevalidationRequestKey,
  type ReplaySpawnBoundaryRevalidationReceipt,
  type ReplaySpawnBoundaryRevalidationRequest,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import type {
  ExecuteReplayWorkerV10CutoverInput,
  ReplayWorkerV10CutoverAdapter,
} from "./replay-worker-v10-cutover-types"

export function deriveReplayWorkerV10CutoverAdapter(
  input: ExecuteReplayWorkerV10CutoverInput,
  activatedArtifactHash: string,
): ReplayWorkerV10CutoverAdapter {
  const successor = input.source_successor_spawn_revalidation
  const transportContractHash = canonicalHash({
    policy: REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_POLICY_VERSION,
    source_successor_transport_contract_hash: successor.source_artifact_bound_transport_contract_hash,
    activated_process_artifact_hash: activatedArtifactHash,
  })
  const executionAdmissionCommandHash = canonicalHash({
    policy: REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_POLICY_VERSION,
    source_successor_execution_admission_command_hash: successor.source_execution_admission_command_hash,
    cutover_transport_contract_hash: transportContractHash,
  })
  const processLaunchIntentHash = canonicalHash({
    policy: REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_POLICY_VERSION,
    source_successor_process_launch_intent_hash: successor.source_successor_process_launch_intent_hash,
    cutover_execution_admission_command_hash: executionAdmissionCommandHash,
    activated_process_artifact_hash: activatedArtifactHash,
  })
  const authorityCapsule = {
    execution_admission_command_hash: executionAdmissionCommandHash,
    execution_envelope_hash: successor.source_execution_envelope_hash,
    logical_request_id: successor.target_logical_request_id,
    process_artifact_hash: activatedArtifactHash,
    process_launch_intent_hash: processLaunchIntentHash,
    transport_contract_hash: transportContractHash,
    worker_request_hash: successor.target_worker_request_hash,
  }
  const authorityCapsuleHash = canonicalHash(authorityCapsule)
  const authorityCapsuleRecordHash = canonicalHash({
    policy: REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_POLICY_VERSION,
    source_successor_authority_capsule_record_hash:
      input.source_successor_authority_capsule.record_hash,
    authority_capsule: authorityCapsule,
  })
  return {
    transport_contract_hash: transportContractHash,
    execution_admission_command_hash: executionAdmissionCommandHash,
    process_launch_intent_hash: processLaunchIntentHash,
    authority_capsule: authorityCapsule,
    authority_capsule_hash: authorityCapsuleHash,
    authority_capsule_record_hash: authorityCapsuleRecordHash,
    revalidation_request: buildRevalidationRequest(successor, authorityCapsuleRecordHash,
      authorityCapsuleHash, processLaunchIntentHash, executionAdmissionCommandHash,
      transportContractHash, activatedArtifactHash),
  }
}

function buildRevalidationRequest(
  successor: ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation,
  capsuleRecordHash: string,
  capsuleHash: string,
  intentHash: string,
  commandHash: string,
  transportHash: string,
  artifactHash: string,
): ReplaySpawnBoundaryRevalidationRequest {
  const key = replaySpawnBoundaryRevalidationRequestKey({
    source_authority_capsule_record_hash: capsuleRecordHash,
    attempt_id: successor.attempt_id,
    worker_id: successor.worker_id,
    lease_generation: successor.lease_generation,
    request_policy_version: REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_POLICY_VERSION,
  })
  return createReplaySpawnBoundaryRevalidationRequest({
    schema_version: REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_SCHEMA_VERSION,
    request_id: `replay-spawn-boundary-revalidation-request-${key.slice(0, 24)}`,
    request_ref: `request://replay-spawn-boundary-revalidation/${key.slice(0, 24)}`,
    request_key: key,
    request_policy_version: REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_POLICY_VERSION,
    status: "capsule_bound_current_attempt_revalidation_requested",
    requester_owner: "replay_runner",
    authority_target: "research_control_plane",
    purpose: "revalidate_exact_current_attempt_after_capsule_commit_before_spawn",
    source_authority_capsule_record_hash: capsuleRecordHash,
    authority_capsule_hash: capsuleHash,
    source_authority_process_launch_intent_hash: intentHash,
    source_authority_execution_admission_command_hash: commandHash,
    source_authority_transport_contract_hash: transportHash,
    process_artifact_hash: artifactHash,
    worker_request_hash: successor.target_worker_request_hash,
    attempt_id: successor.attempt_id,
    attempt_ordinal: successor.attempt_ordinal,
    worker_id: successor.worker_id,
    lease_generation: successor.lease_generation,
    expected_current_attempt_lease_hash: successor.current_attempt_lease_hash,
    expected_valid_before: successor.valid_before,
    challenge_policy: "one_capsule_bound_challenge_no_caller_time_or_state_substitution",
    retry_policy:
      "fresh_command_intent_capsule_authority_lineage_required_after_failed_or_stale_challenge",
    process_authority: "none",
  })
}

export function assertReplayWorkerV10CutoverRevalidation(
  request: ReplaySpawnBoundaryRevalidationRequest,
  receipt: ReplaySpawnBoundaryRevalidationReceipt,
  successor: ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation,
): void {
  assertReplaySpawnBoundaryRevalidationReceipt(receipt)
  if (receipt.source_request_hash !== request.request_hash
      || canonicalJson(receipt.source_request) !== canonicalJson(request)
      || receipt.current_attempt_status !== "running"
      || receipt.current_attempt_lease_hash !== successor.current_attempt_lease_hash
      || receipt.current_attempt_lease.attempt_id !== successor.attempt_id
      || receipt.current_attempt_lease.attempt_ordinal !== successor.attempt_ordinal
      || receipt.current_attempt_lease.worker_id !== successor.worker_id
      || receipt.current_attempt_lease.lease_generation !== successor.lease_generation
      || receipt.valid_before !== successor.valid_before) {
    throw new Error("Worker v10 cutover Control Plane revalidation mismatch")
  }
}
