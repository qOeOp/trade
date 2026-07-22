import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-stdio-probe-admission"
import { runReplayWorkerV10NegativeProbeSuite, readReplayWorkerV10NegativeProbeReceipt } from "./replay-worker-v10-negative-probe-registry"
import { registerReplayWorkerV10StdioCapability, readReplayWorkerV10StdioCapability } from "./replay-worker-v10-stdio-capability-registry"
import { readReplayWorkerV10SuccessorExecutionStdioProbeParent } from "./replay-worker-v10-successor-execution-stdio-probe-parent"
import { extractReplayWorkerV10SuccessorExecutionPredecessorEvidence } from "./replay-worker-v10-successor-execution-stdio-probe-predecessor"
import { buildReplayWorkerV10SuccessorExecutionStdioProbeAdmission } from "./replay-worker-v10-successor-execution-stdio-probe-record"
import { persistReplayWorkerV10SuccessorExecutionStdioProbeAdmission, readReplayWorkerV10SuccessorExecutionStdioProbeAdmissionRecord } from "./replay-worker-v10-successor-execution-stdio-probe-store"
import type { RegisterReplayWorkerV10SuccessorExecutionStdioProbeInput } from "./replay-worker-v10-successor-execution-stdio-probe-types"

export type { RegisterReplayWorkerV10SuccessorExecutionStdioProbeInput } from "./replay-worker-v10-successor-execution-stdio-probe-types"

export function registerReplayWorkerV10SuccessorExecutionStdioProbe(
  input: RegisterReplayWorkerV10SuccessorExecutionStdioProbeInput,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission {
  const parent = readReplayWorkerV10SuccessorExecutionStdioProbeParent(input)
  const transport = parent.admission
  const successor = registerReplayWorkerV10StdioCapability({
    registry_root: input.registry_root,
    source_transport_contract: transport.successor_base_transport_contract,
    source_successor_execution_transport_admission: transport,
    source_successor_execution_transport_validation_receipt: parent.receipt,
  })
  const probe = runReplayWorkerV10NegativeProbeSuite({
    registry_root: input.registry_root,
    source_stdio_capability: successor,
    source_successor_execution_transport_admission: transport,
    source_successor_execution_transport_validation_receipt: parent.receipt,
    clock: input.clock,
  })
  return persistReplayWorkerV10SuccessorExecutionStdioProbeAdmission(
    input.registry_root,
    buildReplayWorkerV10SuccessorExecutionStdioProbeAdmission(
      transport,
      extractReplayWorkerV10SuccessorExecutionPredecessorEvidence(transport),
      successor,
      probe,
    ),
  )
}

export function readReplayWorkerV10SuccessorExecutionStdioProbe(
  input: Omit<RegisterReplayWorkerV10SuccessorExecutionStdioProbeInput, "clock">,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission | null {
  const parent = readReplayWorkerV10SuccessorExecutionStdioProbeParent(input)
  const transport = parent.admission
  const successor = readReplayWorkerV10StdioCapability({
    registry_root: input.registry_root,
    source_transport_contract: transport.successor_base_transport_contract,
    source_successor_execution_transport_admission: transport,
    source_successor_execution_transport_validation_receipt: parent.receipt,
  })
  if (!successor) return null
  const probe = readReplayWorkerV10NegativeProbeReceipt({
    registry_root: input.registry_root,
    source_stdio_capability: successor,
    source_successor_execution_transport_admission: transport,
    source_successor_execution_transport_validation_receipt: parent.receipt,
  })
  if (!probe) return null
  const expected = buildReplayWorkerV10SuccessorExecutionStdioProbeAdmission(
    transport,
    extractReplayWorkerV10SuccessorExecutionPredecessorEvidence(transport),
    successor,
    probe,
  )
  return readReplayWorkerV10SuccessorExecutionStdioProbeAdmissionRecord(
    input.registry_root,
    expected,
  )
}
