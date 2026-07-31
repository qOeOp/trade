import {
  REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_POLICY_VERSION,
  replayDecisionHarnessWorkerV10CutoverReceiptKey,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-cutover-receipt"
import {
  assertReplayDecisionHarnessWorkerV10ReproducibilityPairContract,
  type ReplayDecisionHarnessWorkerV10ReproducibilityPairContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-reproducibility-pair-contract"
import { assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleLineage } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-authority-capsule"
import { assertReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-stdio-probe-admission"
import { assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidationLineage } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-spawn-boundary-revalidation"
import type { ExecuteReplayWorkerV10CutoverInput } from "./replay-worker-v10-cutover-types"

export function assertReplayWorkerV10CutoverParents(
  input: ExecuteReplayWorkerV10CutoverInput,
): void {
  if (input.registry_root.trim() === "") throw new Error("Worker v10 cutover registry root is required")
  assertReplayDecisionHarnessWorkerV10ReproducibilityPairContract(input.source_pair_contract)
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleLineage(
    input.source_successor_authority_capsule,
    input.source_successor_process_launch_intent,
  )
  assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidationLineage(
    input.source_successor_spawn_revalidation,
    input.source_successor_authority_capsule,
    input.source_successor_process_launch_intent,
  )
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission(
    input.source_successor_stdio_probe_admission,
  )
  const pair = input.source_pair_contract
  const successor = input.source_successor_spawn_revalidation
  const stdio = input.source_successor_stdio_probe_admission
  if (successor.target_logical_request_id !== pair.logical_request_id
      || successor.target_worker_request_hash !== pair.worker_request_hash
      || successor.process_artifact_hash !== stdio.successor_stdio_artifact_evidence.artifact.sha256
      || input.source_successor_authority_capsule.source_successor_stdio_probe_admission_hash
        !== stdio.admission_hash) {
    throw new Error("Worker v10 cutover direct parent closure mismatch")
  }
}

export function replayWorkerV10CutoverReceiptKey(
  input: ExecuteReplayWorkerV10CutoverInput,
): string {
  return replayDecisionHarnessWorkerV10CutoverReceiptKey({
    source_pair_contract_hash: input.source_pair_contract.contract_hash,
    source_successor_spawn_revalidation_hash: input.source_successor_spawn_revalidation.binding_hash,
    cutover_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_CUTOVER_POLICY_VERSION,
  })
}

export function firstReplayWorkerV10ActivatedCapability(
  pair: ReplayDecisionHarnessWorkerV10ReproducibilityPairContract,
) {
  return pair.source_schedule_admission.source_response_validation.source_dispatch_receipt
    .source_dispatch_attempt.source_process_launch_receipt.source_launch_attempt
    .source_spawn_revalidation.source_authority_capsule.source_authority_process_launch_intent
    .source_authority_execution_admission_command.source_authority_transport_contract
    .source_activated_stdio_capability
}

export function firstReplayWorkerV10Registration(
  pair: ReplayDecisionHarnessWorkerV10ReproducibilityPairContract,
) {
  const activated = firstReplayWorkerV10ActivatedCapability(pair)
  const command = activated.source_authority_frame_build_contract.source_launch_readiness_gate
    .source_process_launch_intent.source_execution_admission_command
  return command.source_clock_binding.source_registry_provenance.source_pre_issue_bundle
    .source_execution_admission_contract.source_successor_transport_contract
    .source_negative_probe_receipt.source_stdio_capability.source_transport_contract
    .source_worker_v10_build_capability.source_code_admission.registry_entry
}
