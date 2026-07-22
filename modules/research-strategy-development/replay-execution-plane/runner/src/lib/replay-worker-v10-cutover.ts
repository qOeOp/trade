import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION,
  createReplayDecisionHarnessWorkerV10AuthorityRequestFrame,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-frame-build-contract"
import type { ReplayDecisionHarnessWorkerV10CutoverReceipt } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-cutover-receipt"
import { assertReplayWorkerV10CutoverRevalidation, deriveReplayWorkerV10CutoverAdapter } from "./replay-worker-v10-cutover-adapter"
import { assertReplayWorkerV10CutoverParents, firstReplayWorkerV10ActivatedCapability, replayWorkerV10CutoverReceiptKey } from "./replay-worker-v10-cutover-lineage"
import { executeReplayWorkerV10CutoverProcess } from "./replay-worker-v10-cutover-process"
import { buildReplayWorkerV10CutoverReceipt } from "./replay-worker-v10-cutover-receipt"
import { commitReplayWorkerV10CutoverAttempt, persistReplayWorkerV10CutoverReceipt, readReplayWorkerV10CutoverReceiptRecord } from "./replay-worker-v10-cutover-store"
import type { ExecuteReplayWorkerV10CutoverInput, ReplayWorkerV10CutoverOutcome } from "./replay-worker-v10-cutover-types"

export type {
  ExecuteReplayWorkerV10CutoverInput,
  ReplayWorkerV10CutoverDisposition,
  ReplayWorkerV10CutoverOutcome,
} from "./replay-worker-v10-cutover-types"

export function executeReplayWorkerV10Cutover(
  input: ExecuteReplayWorkerV10CutoverInput,
): ReplayWorkerV10CutoverOutcome {
  assertReplayWorkerV10CutoverParents(input)
  const key = replayWorkerV10CutoverReceiptKey(input)
  const existing = readReplayWorkerV10CutoverReceipt(input)
  if (existing) return { receipt: existing, disposition: "existing_cutover_receipt" }
  const attemptCreated = commitReplayWorkerV10CutoverAttempt(
    input.registry_root,
    key,
    input.source_pair_contract.contract_hash,
    input.source_successor_spawn_revalidation.binding_hash,
  )
  if (!attemptCreated) {
    const winner = readReplayWorkerV10CutoverReceipt(input)
    if (winner) return { receipt: winner, disposition: "existing_cutover_receipt" }
    throw new Error("Worker v10 cutover attempt is pending or indeterminate; automatic respawn is forbidden")
  }

  const pair = input.source_pair_contract
  const firstFrame = pair.source_schedule_admission.source_response_validation.response_frame
  if (!firstFrame) throw new Error("Worker v10 cutover first response frame is missing")
  const workerRequest = pair.source_schedule_admission.source_response_validation
    .source_dispatch_receipt.source_dispatch_attempt.request_frame.worker_request
  const successor = input.source_successor_spawn_revalidation
  const activated = firstReplayWorkerV10ActivatedCapability(pair)
  const adapter = deriveReplayWorkerV10CutoverAdapter(input, activated.artifact.sha256)
  const revalidation = input.authority_port.revalidate(structuredClone(adapter.revalidation_request))
  assertReplayWorkerV10CutoverRevalidation(
    adapter.revalidation_request,
    revalidation,
    successor,
  )
  const requestFrame = createReplayDecisionHarnessWorkerV10AuthorityRequestFrame({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION,
    frame_kind: "worker_request",
    worker_protocol_version: workerRequest.worker_protocol_version,
    transport_contract_hash: adapter.transport_contract_hash,
    execution_envelope_hash: successor.source_execution_envelope_hash,
    process_artifact_hash: activated.artifact.sha256,
    execution_admission_command_hash: adapter.execution_admission_command_hash,
    process_launch_intent_hash: adapter.process_launch_intent_hash,
    logical_request_id: workerRequest.logical_request_id,
    worker_request_hash: workerRequest.request_hash,
    worker_request: structuredClone(workerRequest),
    authority_status: "authority_bound_candidate_not_admitted",
  })
  const intent = input.source_successor_process_launch_intent
  const processOutcome = executeReplayWorkerV10CutoverProcess({
    artifact: activated.artifact,
    adapter,
    request_frame: requestFrame,
    runtime_executable_hash: intent.runtime_executable_hash,
    runtime_version: intent.runtime_version,
    timeout_ms: intent.timeout_ms,
    max_response_frame_bytes: intent.max_response_frame_bytes,
    first_observed_child_pid: pair.source_observed_child_pid,
    successor_binding_hash: successor.binding_hash,
  })
  const receipt = buildReplayWorkerV10CutoverReceipt({
    key,
    input,
    adapter,
    revalidation_receipt: revalidation,
    request_frame: requestFrame,
    response_frame: processOutcome.response_frame,
    activated_artifact_hash: activated.artifact.sha256,
    observed_child_pid: processOutcome.observed_child_pid,
    process_instance_id: processOutcome.process_instance_id,
  })
  return {
    receipt: persistReplayWorkerV10CutoverReceipt(input.registry_root, receipt),
    disposition: "new_cutover_receipt",
  }
}

export function readReplayWorkerV10CutoverReceipt(
  input: ExecuteReplayWorkerV10CutoverInput,
): ReplayDecisionHarnessWorkerV10CutoverReceipt | null {
  assertReplayWorkerV10CutoverParents(input)
  return readReplayWorkerV10CutoverReceiptRecord(
    input.registry_root,
    replayWorkerV10CutoverReceiptKey(input),
  )
}
