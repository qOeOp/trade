import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-transport-admission"
import { readReplayWorkerV10TransportContract, registerReplayWorkerV10TransportContract } from "./replay-worker-v10-transport-contract-registry"
import { extractReplayWorkerV10PredecessorTransportContract, requireReplayWorkerV10SuccessorExecutionTransportParent } from "./replay-worker-v10-successor-execution-transport-parent"
import { buildReplayWorkerV10SuccessorExecutionTransportAdmission } from "./replay-worker-v10-successor-execution-transport-record"
import { persistReplayWorkerV10SuccessorExecutionTransportAdmission, readReplayWorkerV10SuccessorExecutionTransportAdmissionRecord } from "./replay-worker-v10-successor-execution-transport-store"
import type { RegisterReplayWorkerV10SuccessorExecutionTransportInput } from "./replay-worker-v10-successor-execution-transport-types"

export type { RegisterReplayWorkerV10SuccessorExecutionTransportInput } from "./replay-worker-v10-successor-execution-transport-types"

export function registerReplayWorkerV10SuccessorExecutionTransport(
  input: RegisterReplayWorkerV10SuccessorExecutionTransportInput,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission {
  const envelope = requireReplayWorkerV10SuccessorExecutionTransportParent(input)
  const predecessor = extractReplayWorkerV10PredecessorTransportContract(envelope)
  const successor = registerReplayWorkerV10TransportContract({
    registry_root: input.registry_root,
    source_worker_v10_build_capability: predecessor.source_worker_v10_build_capability,
    source_execution_envelope: envelope.successor_execution_envelope,
    source_successor_execution_envelope_admission: envelope,
  })
  return persistReplayWorkerV10SuccessorExecutionTransportAdmission(
    input.registry_root,
    buildReplayWorkerV10SuccessorExecutionTransportAdmission(envelope, predecessor, successor),
  )
}

export function readReplayWorkerV10SuccessorExecutionTransport(
  input: RegisterReplayWorkerV10SuccessorExecutionTransportInput,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission | null {
  const envelope = requireReplayWorkerV10SuccessorExecutionTransportParent(input)
  const predecessor = extractReplayWorkerV10PredecessorTransportContract(envelope)
  const successor = readReplayWorkerV10TransportContract({
    registry_root: input.registry_root,
    source_worker_v10_build_capability: predecessor.source_worker_v10_build_capability,
    source_execution_envelope: envelope.successor_execution_envelope,
    source_successor_execution_envelope_admission: envelope,
  })
  if (!successor) return null
  return readReplayWorkerV10SuccessorExecutionTransportAdmissionRecord(
    input.registry_root,
    buildReplayWorkerV10SuccessorExecutionTransportAdmission(envelope, predecessor, successor),
  )
}
