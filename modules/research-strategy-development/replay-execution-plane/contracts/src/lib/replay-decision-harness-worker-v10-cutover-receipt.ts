import {
  REPLAY_DECISION_HARNESS_CUTOVER_RECEIPT_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_CUTOVER_WORKER_PROTOCOL_VERSION,
  REPLAY_DECISION_HARNESS_BUILD_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_LOADER_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_REGISTRY_POLICY_VERSION,
  type ReplayDecisionHarnessReceiptV12,
  type ReplayDecisionOutput,
  type ReplaySupplementalValue,
  canonicalHash,
  canonicalJson,
} from "./replay-contracts"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityRequestFrame,
  assertReplayDecisionHarnessWorkerV10AuthorityResponseFrame,
  type ReplayDecisionHarnessWorkerV10AuthorityRequestFrame,
  type ReplayDecisionHarnessWorkerV10AuthorityResponseFrame,
} from "./replay-decision-harness-worker-v10-authority-frame-build-contract"
import {
  assertReplayDecisionHarnessWorkerV10ReproducibilityPairContract,
  type ReplayDecisionHarnessWorkerV10ReproducibilityPairContract,
} from "./replay-decision-harness-worker-v10-reproducibility-pair-contract"
import {
  assertReplaySpawnBoundaryRevalidationReceiptView,
  assertReplaySpawnBoundaryRevalidationRequestView,
  type ReplaySpawnBoundaryRevalidationReceiptView,
  type ReplaySpawnBoundaryRevalidationRequestView,
} from "./replay-decision-harness-worker-v10-authority-spawn-boundary-revalidation"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation,
  type ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation,
} from "./replay-decision-harness-worker-v10-successor-spawn-boundary-revalidation"

export const REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_RECEIPT_SCHEMA_VERSION =
  REPLAY_DECISION_HARNESS_CUTOVER_RECEIPT_SCHEMA_VERSION
export const REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_POLICY_VERSION =
  "rd-replay-harness-worker-v10-m3-g1-cutover-v1" as const

export interface ReplayDecisionHarnessWorkerV10CutoverReceipt extends ReplayDecisionHarnessReceiptV12 {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_RECEIPT_SCHEMA_VERSION
  receipt_id: string
  receipt_key: string
  receipt_hash: string
  cutover_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_POLICY_VERSION
  status: "admitted_two_fresh_process_pair_and_exact_schedule_effect"
  source_pair_contract_hash: string
  source_pair_contract: ReplayDecisionHarnessWorkerV10ReproducibilityPairContract
  source_successor_spawn_revalidation_hash: string
  source_successor_spawn_revalidation: ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation
  activated_process_artifact_hash: string
  cutover_transport_contract_hash: string
  cutover_execution_admission_command_hash: string
  cutover_process_launch_intent_hash: string
  cutover_authority_capsule_record_hash: string
  cutover_authority_capsule_hash: string
  cutover_spawn_revalidation_request: ReplaySpawnBoundaryRevalidationRequestView
  cutover_spawn_revalidation_receipt: ReplaySpawnBoundaryRevalidationReceiptView
  worker_request_hash: string
  first_process_instance_id: string
  first_observed_child_pid: number
  second_process_instance_id: string
  second_observed_child_pid: number
  second_request_frame_hash: string
  second_request_frame: ReplayDecisionHarnessWorkerV10AuthorityRequestFrame
  first_response_frame_hash: string
  second_response_frame_hash: string
  second_response_frame: ReplayDecisionHarnessWorkerV10AuthorityResponseFrame
  first_worker_response_hash: string
  second_worker_response_hash: string
  selected_schedule_entry_hash: string
  decision_output: ReplayDecisionOutput
  decision_output_hash: string
  trace: ReplaySupplementalValue
  trace_hash: string
  reproducibility_pair_hash: string
  response_instance_count: 2
  schedule_admission_count: 2
  reproducibility_pair_count: 1
  harness_receipt_count: 1
  process_independence: "distinct_pid_process_instance_and_authority_lineage"
  response_parity: "canonical_inner_worker_response_exact"
  schedule_admission: "both_members_match_exact_frozen_schedule"
  economic_authority: "granted_exact_frozen_schedule_effect"
  signal_authority: "derived_only_from_admitted_decision_output"
  order_authority: "derived_only_from_admitted_decision_output"
  trial_authority: "result_artifact_only_no_control_plane_mutation"
  blockers: []
}

export type ReplayDecisionHarnessWorkerV10CutoverReceiptBody = Omit<
  ReplayDecisionHarnessWorkerV10CutoverReceipt,
  "receipt_hash"
>

export function replayDecisionHarnessWorkerV10CutoverReceiptKey(input: {
  source_pair_contract_hash: string
  source_successor_spawn_revalidation_hash: string
  cutover_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_POLICY_VERSION
}): string {
  requireHash(input.source_pair_contract_hash, "cutover pair contract hash")
  requireHash(input.source_successor_spawn_revalidation_hash, "cutover successor revalidation hash")
  if (input.cutover_policy_version !== REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_POLICY_VERSION) {
    throw new Error("unsupported Worker v10 cutover policy")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10CutoverReceipt(
  body: ReplayDecisionHarnessWorkerV10CutoverReceiptBody,
): ReplayDecisionHarnessWorkerV10CutoverReceipt {
  const value = { ...structuredClone(body), receipt_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10CutoverReceipt(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10CutoverReceipt(
  value: ReplayDecisionHarnessWorkerV10CutoverReceipt,
): void {
  if (value.schema_version !== REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_RECEIPT_SCHEMA_VERSION
      || value.cutover_policy_version !== REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_POLICY_VERSION
      || value.registry_policy_version !== REPLAY_DECISION_HARNESS_REGISTRY_POLICY_VERSION
      || value.build_policy_version !== REPLAY_DECISION_HARNESS_BUILD_POLICY_VERSION
      || value.loader_policy_version !== REPLAY_DECISION_HARNESS_LOADER_POLICY_VERSION
      || value.worker_protocol_version !== REPLAY_DECISION_HARNESS_CUTOVER_WORKER_PROTOCOL_VERSION
      || value.execution_policy !== "two_fresh_authority_subprocesses_exact_schedule_cutover"
      || value.status !== "admitted_two_fresh_process_pair_and_exact_schedule_effect"
      || value.response_instance_count !== 2 || value.schedule_admission_count !== 2
      || value.reproducibility_pair_count !== 1 || value.harness_receipt_count !== 1
      || value.process_independence !== "distinct_pid_process_instance_and_authority_lineage"
      || value.response_parity !== "canonical_inner_worker_response_exact"
      || value.schedule_admission !== "both_members_match_exact_frozen_schedule"
      || value.economic_authority !== "granted_exact_frozen_schedule_effect"
      || value.signal_authority !== "derived_only_from_admitted_decision_output"
      || value.order_authority !== "derived_only_from_admitted_decision_output"
      || value.trial_authority !== "result_artifact_only_no_control_plane_mutation"
      || value.blockers.length !== 0) {
    throw new Error("unsupported Worker v10 cutover receipt authority")
  }
  for (const item of [value.harness_hash, value.source_bundle_hash, value.build_attestation_hash,
    value.build_artifact_hash, value.runtime_executable_hash, value.decision_input_snapshot_hash,
    value.decision_market_input_snapshot_hash, value.request_context_hash,
    value.worker_verification_response_hash,
    value.receipt_key, value.receipt_hash, value.source_pair_contract_hash,
    value.source_successor_spawn_revalidation_hash, value.worker_request_hash,
    value.activated_process_artifact_hash, value.cutover_transport_contract_hash,
    value.cutover_execution_admission_command_hash, value.cutover_process_launch_intent_hash,
    value.cutover_authority_capsule_record_hash, value.cutover_authority_capsule_hash,
    value.first_process_instance_id, value.second_process_instance_id, value.second_request_frame_hash,
    value.first_response_frame_hash, value.second_response_frame_hash, value.first_worker_response_hash,
    value.second_worker_response_hash, value.selected_schedule_entry_hash, value.decision_output_hash,
    value.trace_hash, value.reproducibility_pair_hash]) requireHash(item, "Worker v10 cutover hash")
  if (value.receipt_id.trim() === "") throw new Error("Worker v10 cutover receipt id is required")
  if (value.run_id.trim() === "" || value.source_bundle_ref.trim() === ""
      || value.harness_hash !== value.source_bundle_hash) {
    throw new Error("Worker v10 cutover source identity is invalid")
  }
  if (value.decision_state_snapshot_hash !== null) {
    requireHash(value.decision_state_snapshot_hash, "Worker v10 cutover state snapshot hash")
  }
  for (const pid of [value.first_observed_child_pid, value.second_observed_child_pid]) {
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("Worker v10 cutover PID is invalid")
  }
  assertReplayDecisionHarnessWorkerV10ReproducibilityPairContract(value.source_pair_contract)
  assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation(
    value.source_successor_spawn_revalidation,
  )
  assertReplaySpawnBoundaryRevalidationRequestView(value.cutover_spawn_revalidation_request)
  assertReplaySpawnBoundaryRevalidationReceiptView(value.cutover_spawn_revalidation_receipt)
  assertReplayDecisionHarnessWorkerV10AuthorityRequestFrame(value.second_request_frame)
  assertReplayDecisionHarnessWorkerV10AuthorityResponseFrame(
    value.second_response_frame,
    value.second_request_frame,
  )
  const pair = value.source_pair_contract
  const firstValidation = pair.source_schedule_admission.source_response_validation
  const firstFrame = firstValidation.response_frame
  if (!firstFrame) throw new Error("Worker v10 cutover first response frame is missing")
  const successor = value.source_successor_spawn_revalidation
  const firstResponse = firstFrame.worker_response
  const secondResponse = value.second_response_frame.worker_response
  const key = replayDecisionHarnessWorkerV10CutoverReceiptKey({
    source_pair_contract_hash: pair.contract_hash,
    source_successor_spawn_revalidation_hash: successor.binding_hash,
    cutover_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_POLICY_VERSION,
  })
  const expectedPairHash = canonicalHash({
    first_process_instance_id: value.first_process_instance_id,
    first_worker_response_hash: value.first_worker_response_hash,
    second_process_instance_id: value.second_process_instance_id,
    second_worker_response_hash: value.second_worker_response_hash,
    worker_request_hash: value.worker_request_hash,
  })
  if (value.receipt_key !== key
      || value.receipt_id !== `decision-harness-worker-v10-cutover-${key.slice(0, 24)}`
      || value.source_pair_contract_hash !== pair.contract_hash
      || value.source_successor_spawn_revalidation_hash !== successor.binding_hash
      || value.cutover_spawn_revalidation_receipt.source_request_hash
        !== value.cutover_spawn_revalidation_request.request_hash
      || canonicalJson(value.cutover_spawn_revalidation_receipt.source_request)
        !== canonicalJson(value.cutover_spawn_revalidation_request)
      || value.cutover_spawn_revalidation_request.source_authority_capsule_record_hash
        !== value.cutover_authority_capsule_record_hash
      || value.cutover_spawn_revalidation_request.authority_capsule_hash
        !== value.cutover_authority_capsule_hash
      || value.cutover_spawn_revalidation_request.source_authority_process_launch_intent_hash
        !== value.cutover_process_launch_intent_hash
      || value.cutover_spawn_revalidation_request.source_authority_execution_admission_command_hash
        !== value.cutover_execution_admission_command_hash
      || value.cutover_spawn_revalidation_request.source_authority_transport_contract_hash
        !== value.cutover_transport_contract_hash
      || value.cutover_spawn_revalidation_request.process_artifact_hash
        !== value.activated_process_artifact_hash
      || value.cutover_spawn_revalidation_request.worker_request_hash !== value.worker_request_hash
      || value.cutover_spawn_revalidation_receipt.current_attempt_lease_hash
        !== successor.current_attempt_lease_hash
      || value.cutover_spawn_revalidation_receipt.valid_before !== successor.valid_before
      || value.worker_request_hash !== pair.worker_request_hash
      || value.worker_request_hash !== value.second_request_frame.worker_request_hash
      || value.first_process_instance_id !== pair.source_process_instance_id
      || value.first_observed_child_pid !== pair.source_observed_child_pid
      || value.first_process_instance_id === value.second_process_instance_id
      || value.first_observed_child_pid === value.second_observed_child_pid
      || value.second_request_frame_hash !== value.second_request_frame.frame_hash
      || value.first_response_frame_hash !== firstFrame.frame_hash
      || value.second_response_frame_hash !== value.second_response_frame.frame_hash
      || value.first_response_frame_hash === value.second_response_frame_hash
      || value.first_worker_response_hash !== firstResponse.response_hash
      || value.second_worker_response_hash !== secondResponse.response_hash
      || value.worker_response_hash !== firstResponse.response_hash
      || value.worker_verification_response_hash !== secondResponse.response_hash
      || value.first_worker_response_hash !== value.second_worker_response_hash
      || canonicalJson(firstResponse) !== canonicalJson(secondResponse)
      || value.selected_schedule_entry_hash !== pair.selected_schedule_entry_hash
      || canonicalJson(value.decision_output) !== canonicalJson(pair.source_schedule_admission.expected_decision_output)
      || value.decision_output_hash !== canonicalHash(value.decision_output)
      || canonicalJson(value.trace) !== canonicalJson(secondResponse.trace)
      || value.trace_hash !== canonicalHash(value.trace)
      || value.reproducibility_pair_hash !== expectedPairHash
      || value.second_request_frame.transport_contract_hash !== value.cutover_transport_contract_hash
      || value.second_request_frame.execution_envelope_hash !== successor.source_execution_envelope_hash
      || value.second_request_frame.process_artifact_hash !== value.activated_process_artifact_hash
      || value.second_request_frame.execution_admission_command_hash
        !== value.cutover_execution_admission_command_hash
      || value.second_request_frame.process_launch_intent_hash
        !== value.cutover_process_launch_intent_hash
      || value.second_request_frame.logical_request_id !== successor.target_logical_request_id
      || value.second_request_frame.worker_request_hash !== successor.target_worker_request_hash) {
    throw new Error("Worker v10 cutover pair, schedule, or successor binding drift")
  }
  const { receipt_hash: receiptHash, ...body } = value
  if (receiptHash !== canonicalHash(body)) throw new Error("Worker v10 cutover receipt hash mismatch")
}

function requireHash(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${label} must be a sha256 hash`)
}
