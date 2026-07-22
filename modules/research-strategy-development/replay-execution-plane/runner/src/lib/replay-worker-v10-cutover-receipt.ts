import { createReplayDecisionHarnessWorkerV10AuthorityRequestFrame, type ReplayDecisionHarnessWorkerV10AuthorityResponseFrame } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-frame-build-contract"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_RECEIPT_SCHEMA_VERSION,
  createReplayDecisionHarnessWorkerV10CutoverReceipt,
  type ReplayDecisionHarnessWorkerV10CutoverReceipt,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-cutover-receipt"
import {
  REPLAY_DECISION_HARNESS_BUILD_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_CUTOVER_WORKER_PROTOCOL_VERSION,
  REPLAY_DECISION_HARNESS_LOADER_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_REGISTRY_POLICY_VERSION,
  canonicalHash,
  canonicalJson,
} from "../../../contracts/src/lib/replay-contracts"
import type { ReplaySpawnBoundaryRevalidationReceipt } from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { firstReplayWorkerV10Registration } from "./replay-worker-v10-cutover-lineage"
import type { ExecuteReplayWorkerV10CutoverInput, ReplayWorkerV10CutoverAdapter } from "./replay-worker-v10-cutover-types"

interface CutoverReceiptEvidence {
  key: string
  input: ExecuteReplayWorkerV10CutoverInput
  adapter: ReplayWorkerV10CutoverAdapter
  revalidation_receipt: ReplaySpawnBoundaryRevalidationReceipt
  request_frame: ReturnType<typeof createReplayDecisionHarnessWorkerV10AuthorityRequestFrame>
  response_frame: ReplayDecisionHarnessWorkerV10AuthorityResponseFrame
  activated_artifact_hash: string
  observed_child_pid: number
  process_instance_id: string
}

export function buildReplayWorkerV10CutoverReceipt(
  evidence: CutoverReceiptEvidence,
): ReplayDecisionHarnessWorkerV10CutoverReceipt {
  const pair = evidence.input.source_pair_contract
  const successor = evidence.input.source_successor_spawn_revalidation
  const firstFrame = pair.source_schedule_admission.source_response_validation.response_frame
  if (!firstFrame) throw new Error("Worker v10 cutover first response frame is missing")
  const workerRequest = pair.source_schedule_admission.source_response_validation
    .source_dispatch_receipt.source_dispatch_attempt.request_frame.worker_request
  const registration = firstReplayWorkerV10Registration(pair)
  const firstResponse = firstFrame.worker_response
  const secondResponse = evidence.response_frame.worker_response
  if (canonicalJson(firstResponse) !== canonicalJson(secondResponse)) {
    throw new Error("Worker v10 cutover reproducibility parity failed")
  }
  const pairHash = canonicalHash({
    first_process_instance_id: pair.source_process_instance_id,
    first_worker_response_hash: firstResponse.response_hash,
    second_process_instance_id: evidence.process_instance_id,
    second_worker_response_hash: secondResponse.response_hash,
    worker_request_hash: workerRequest.request_hash,
  })
  return createReplayDecisionHarnessWorkerV10CutoverReceipt({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_RECEIPT_SCHEMA_VERSION,
    receipt_id: `decision-harness-worker-v10-cutover-${evidence.key.slice(0, 24)}`,
    receipt_key: evidence.key,
    cutover_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_POLICY_VERSION,
    run_id: workerRequest.run_id,
    harness_hash: registration.source_bundle.bundle_hash,
    source_bundle_ref: registration.source_bundle.bundle_ref,
    source_bundle_hash: registration.source_bundle.bundle_hash,
    build_attestation_hash: registration.build_attestation.attestation_hash,
    build_artifact_hash: registration.build_attestation.artifact.sha256,
    runtime_executable_hash: registration.build_attestation.runtime.executable_sha256,
    registry_policy_version: REPLAY_DECISION_HARNESS_REGISTRY_POLICY_VERSION,
    build_policy_version: REPLAY_DECISION_HARNESS_BUILD_POLICY_VERSION,
    loader_policy_version: REPLAY_DECISION_HARNESS_LOADER_POLICY_VERSION,
    worker_protocol_version: REPLAY_DECISION_HARNESS_CUTOVER_WORKER_PROTOCOL_VERSION,
    execution_policy: "two_fresh_authority_subprocesses_exact_schedule_cutover",
    decision_input_snapshot_hash: workerRequest.decision_input_snapshot_hash,
    decision_market_input_snapshot_hash: workerRequest.decision_market_input_snapshot_hash,
    decision_state_snapshot_hash: workerRequest.decision_state_snapshot_hash,
    request_context_hash: workerRequest.request_context_hash,
    worker_response_hash: firstResponse.response_hash,
    worker_verification_response_hash: secondResponse.response_hash,
    status: "admitted_two_fresh_process_pair_and_exact_schedule_effect",
    source_pair_contract_hash: pair.contract_hash,
    source_pair_contract: structuredClone(pair),
    source_successor_spawn_revalidation_hash: successor.binding_hash,
    source_successor_spawn_revalidation: structuredClone(successor),
    activated_process_artifact_hash: evidence.activated_artifact_hash,
    cutover_transport_contract_hash: evidence.adapter.transport_contract_hash,
    cutover_execution_admission_command_hash: evidence.adapter.execution_admission_command_hash,
    cutover_process_launch_intent_hash: evidence.adapter.process_launch_intent_hash,
    cutover_authority_capsule_record_hash: evidence.adapter.authority_capsule_record_hash,
    cutover_authority_capsule_hash: evidence.adapter.authority_capsule_hash,
    cutover_spawn_revalidation_request: evidence.adapter.revalidation_request,
    cutover_spawn_revalidation_receipt: structuredClone(evidence.revalidation_receipt),
    worker_request_hash: workerRequest.request_hash,
    first_process_instance_id: pair.source_process_instance_id,
    first_observed_child_pid: pair.source_observed_child_pid,
    second_process_instance_id: evidence.process_instance_id,
    second_observed_child_pid: evidence.observed_child_pid,
    second_request_frame_hash: evidence.request_frame.frame_hash,
    second_request_frame: evidence.request_frame,
    first_response_frame_hash: firstFrame.frame_hash,
    second_response_frame_hash: evidence.response_frame.frame_hash,
    second_response_frame: evidence.response_frame,
    first_worker_response_hash: firstResponse.response_hash,
    second_worker_response_hash: secondResponse.response_hash,
    selected_schedule_entry_hash: pair.selected_schedule_entry_hash,
    decision_output: structuredClone(secondResponse.decision_output),
    decision_output_hash: canonicalHash(secondResponse.decision_output),
    trace: structuredClone(secondResponse.trace),
    trace_hash: canonicalHash(secondResponse.trace),
    reproducibility_pair_hash: pairHash,
    response_instance_count: 2,
    schedule_admission_count: 2,
    reproducibility_pair_count: 1,
    harness_receipt_count: 1,
    process_independence: "distinct_pid_process_instance_and_authority_lineage",
    response_parity: "canonical_inner_worker_response_exact",
    schedule_admission: "both_members_match_exact_frozen_schedule",
    economic_authority: "granted_exact_frozen_schedule_effect",
    signal_authority: "derived_only_from_admitted_decision_output",
    order_authority: "derived_only_from_admitted_decision_output",
    trial_authority: "result_artifact_only_no_control_plane_mutation",
    blockers: [],
  })
}
