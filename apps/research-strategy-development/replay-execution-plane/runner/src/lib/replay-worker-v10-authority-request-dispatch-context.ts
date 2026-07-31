import type { ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-request-dispatch"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION,
  createReplayDecisionHarnessWorkerV10AuthorityRequestFrame,
  type ReplayDecisionHarnessWorkerV10AuthorityRequestFrame,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-frame-build-contract"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt,
  type ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-process-launch"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { readReplayWorkerV10AuthorityProcessLaunchReceipt } from "./replay-worker-v10-authority-process-launch-registry"
import type {
  DispatchReplayWorkerV10AuthorityRequestInput,
  ReplayWorkerV10AuthorityRequestDispatchReadInput,
} from "./replay-worker-v10-authority-request-dispatch-types"

export function requireReplayWorkerV10DurableAuthorityLaunch(
  input: ReplayWorkerV10AuthorityRequestDispatchReadInput,
): void {
  if (input.registry_root.trim() === "") throw new Error("Authority Request Dispatch registry root is required")
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt(input.source_process_launch_receipt)
  const launch = input.source_process_launch_receipt
  const durable = readReplayWorkerV10AuthorityProcessLaunchReceipt({
    registry_root: input.registry_root,
    source_spawn_revalidation: launch.source_launch_attempt.source_spawn_revalidation,
  })
  if (!durable || durable.receipt_hash !== launch.receipt_hash) {
    throw new Error("Authority Request Dispatch requires the exact durable Process Launch Receipt")
  }
  if (launch.receipt_status !== "started_process_frame_not_written"
      || launch.process_instance_id === null || launch.observed_child_pid === null) {
    throw new Error("Authority Request Dispatch requires a started Process Launch Receipt")
  }
}

export function assertReplayWorkerV10AuthorityDispatchLiveSession(
  input: DispatchReplayWorkerV10AuthorityRequestInput,
): asserts input is DispatchReplayWorkerV10AuthorityRequestInput & { session: NonNullable<typeof input.session> } {
  const launch = input.source_process_launch_receipt
  if (!input.session
      || input.session.process_instance_id !== launch.process_instance_id
      || input.session.observed_child_pid !== launch.observed_child_pid) {
    throw new Error("Authority Request Dispatch requires the exact live Process session")
  }
}

export function buildReplayWorkerV10AuthorityRequestFrame(
  launch: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt,
): ReplayDecisionHarnessWorkerV10AuthorityRequestFrame {
  const capsule = launch.source_launch_attempt.source_spawn_revalidation.source_authority_capsule
  const intent = capsule.source_authority_process_launch_intent
  const command = intent.source_authority_execution_admission_command
  const transport = command.source_authority_transport_contract
  const oldCommand = transport.source_activated_stdio_capability.source_authority_frame_build_contract
    .source_launch_readiness_gate.source_process_launch_intent.source_execution_admission_command
  const predecessor = oldCommand.source_clock_binding.source_registry_provenance.source_pre_issue_bundle
    .source_execution_admission_contract.source_successor_transport_contract
  const request = predecessor.source_negative_probe_receipt.source_stdio_capability.source_transport_contract
    .target_worker_request
  return createReplayDecisionHarnessWorkerV10AuthorityRequestFrame({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION,
    frame_kind: "worker_request",
    worker_protocol_version: request.worker_protocol_version,
    transport_contract_hash: transport.contract_hash,
    execution_envelope_hash: transport.source_execution_envelope_hash,
    process_artifact_hash: transport.activated_process_artifact_hash,
    execution_admission_command_hash: command.command_hash,
    process_launch_intent_hash: intent.intent_hash,
    logical_request_id: request.logical_request_id,
    worker_request_hash: request.request_hash,
    worker_request: structuredClone(request),
    authority_status: "authority_bound_candidate_not_admitted",
  })
}

export function replayWorkerV10AuthorityRequestBytes(
  launch: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt,
  frame: ReplayDecisionHarnessWorkerV10AuthorityRequestFrame,
): Buffer {
  const transport = launch.source_launch_attempt.source_spawn_revalidation.source_authority_capsule
    .source_authority_process_launch_intent.source_authority_execution_admission_command
    .source_authority_transport_contract
  const bytes = Buffer.from(`${canonicalJson(frame)}\n`, "utf8")
  if (bytes.byteLength > transport.max_request_frame_bytes) {
    throw new Error("Authority Request Frame exceeds the frozen transport bound")
  }
  return bytes
}

export function assertReplayWorkerV10AuthorityDispatchReceiptAttempt(
  receiptHash: string,
  attempt: ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchAttempt | null,
): void {
  if (!attempt || attempt.dispatch_attempt_hash !== receiptHash) {
    throw new Error("Authority Request Dispatch Receipt lost its durable Dispatch Attempt")
  }
}
