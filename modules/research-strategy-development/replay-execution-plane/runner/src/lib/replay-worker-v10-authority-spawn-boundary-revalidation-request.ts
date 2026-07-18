import {
  REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_POLICY_VERSION,
  REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_SCHEMA_VERSION,
  createReplaySpawnBoundaryRevalidationRequest,
  replaySpawnBoundaryRevalidationRequestKey,
  type ReplaySpawnBoundaryRevalidationRequest,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord,
  type ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-capsule"

export interface BuildReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequestInput {
  source_authority_capsule: ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord
}

export function buildReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequest(
  input: BuildReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequestInput,
): ReplaySpawnBoundaryRevalidationRequest {
  assertReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord(input.source_authority_capsule)
  const capsule = input.source_authority_capsule
  const key = replaySpawnBoundaryRevalidationRequestKey({
    source_authority_capsule_record_hash: capsule.record_hash,
    attempt_id: capsule.attempt_id,
    worker_id: capsule.worker_id,
    lease_generation: capsule.lease_generation,
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
    source_authority_capsule_record_hash: capsule.record_hash,
    authority_capsule_hash: capsule.capsule_hash,
    source_authority_process_launch_intent_hash: capsule.source_authority_process_launch_intent_hash,
    source_authority_execution_admission_command_hash:
      capsule.source_authority_execution_admission_command_hash,
    source_authority_transport_contract_hash: capsule.source_authority_transport_contract_hash,
    process_artifact_hash: capsule.process_artifact_hash,
    worker_request_hash: capsule.worker_request_hash,
    attempt_id: capsule.attempt_id,
    attempt_ordinal: capsule.attempt_ordinal,
    worker_id: capsule.worker_id,
    lease_generation: capsule.lease_generation,
    expected_current_attempt_lease_hash: capsule.current_attempt_lease_hash,
    expected_valid_before: capsule.valid_before,
    challenge_policy: "one_capsule_bound_challenge_no_caller_time_or_state_substitution",
    retry_policy: "fresh_command_intent_capsule_authority_lineage_required_after_failed_or_stale_challenge",
    process_authority: "none",
  })
}
