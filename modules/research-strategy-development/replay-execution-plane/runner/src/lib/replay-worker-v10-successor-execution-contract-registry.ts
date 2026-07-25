import type {
  ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract,
  ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
  ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-contract-admission"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-stdio-probe-admission"
import { buildReplayWorkerV10SuccessorArtifactTransport } from "./replay-worker-v10-successor-artifact-transport-record"
import { buildReplayWorkerV10SuccessorExecutionAdmission, buildReplayWorkerV10SuccessorExecutionContractAdmission } from "./replay-worker-v10-successor-execution-contract-records"
import { assertReplayWorkerV10SuccessorExecutionParentStillAuthoritative, readReplayWorkerV10SuccessorExecutionParent } from "./replay-worker-v10-successor-execution-contract-parent"
import { persistReplayWorkerV10SuccessorArtifactTransport, persistReplayWorkerV10SuccessorExecutionAdmission, persistReplayWorkerV10SuccessorExecutionContractAdmission, readReplayWorkerV10SuccessorArtifactTransportRecord, readReplayWorkerV10SuccessorExecutionAdmissionRecord, readReplayWorkerV10SuccessorExecutionContractAdmissionRecord, requireSameReplayWorkerV10SuccessorExecutionContractAdmission } from "./replay-worker-v10-successor-execution-contract-store"
import type { ReplayWorkerV10SuccessorExecutionContractRegistryInput } from "./replay-worker-v10-successor-execution-contract-types"

export type { ReplayWorkerV10SuccessorExecutionContractRegistryInput } from "./replay-worker-v10-successor-execution-contract-types"

export function readReplayWorkerV10SuccessorExecutionArtifactTransport(
  input: ReplayWorkerV10SuccessorExecutionContractRegistryInput,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract | null {
  const parent = readReplayWorkerV10SuccessorExecutionParent(input)
  const transport = readArtifactTransport(input.registry_root, parent.source, parent.file_sha256)
  if (transport) assertReplayWorkerV10SuccessorExecutionParentStillAuthoritative(parent)
  return transport
}

export function readReplayWorkerV10SuccessorExecutionAdmission(
  input: ReplayWorkerV10SuccessorExecutionContractRegistryInput,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract | null {
  const parent = readReplayWorkerV10SuccessorExecutionParent(input)
  const transport = readArtifactTransport(input.registry_root, parent.source, parent.file_sha256)
  const execution = transport
    ? readExecutionAdmission(input.registry_root, parent.source, parent.file_sha256, transport)
    : null
  if (execution) assertReplayWorkerV10SuccessorExecutionParentStillAuthoritative(parent)
  return execution
}

export function registerReplayWorkerV10SuccessorExecutionContract(
  input: ReplayWorkerV10SuccessorExecutionContractRegistryInput,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission {
  const parent = readReplayWorkerV10SuccessorExecutionParent(input)
  const source = parent.source
  const expectedTransport = buildReplayWorkerV10SuccessorArtifactTransport(
    source,
    parent.file_sha256,
  )
  const expectedExecution = buildReplayWorkerV10SuccessorExecutionAdmission(
    source,
    parent.file_sha256,
    expectedTransport,
  )
  const expectedAdmission = buildReplayWorkerV10SuccessorExecutionContractAdmission(
    source,
    parent.file_sha256,
    expectedTransport,
    expectedExecution,
  )
  const existing = readReplayWorkerV10SuccessorExecutionContractAdmissionRecord(
    input.registry_root,
    expectedAdmission.admission_key,
  )
  if (existing) {
    const transport = readArtifactTransport(input.registry_root, source, parent.file_sha256)
    const execution = transport
      ? readExecutionAdmission(input.registry_root, source, parent.file_sha256, transport)
      : null
    if (!transport || !execution) {
      throw new Error("successor execution Contract retry lost its exact durable child contracts")
    }
    const admission = requireSameReplayWorkerV10SuccessorExecutionContractAdmission(
      existing,
      buildReplayWorkerV10SuccessorExecutionContractAdmission(
        source,
        parent.file_sha256,
        transport,
        execution,
      ),
    )
    assertReplayWorkerV10SuccessorExecutionParentStillAuthoritative(parent)
    return admission
  }
  assertReplayWorkerV10SuccessorExecutionParentStillAuthoritative(parent)
  const transport = registerArtifactTransport(input.registry_root, source, parent.file_sha256)
  const execution = registerExecutionAdmission(
    input.registry_root,
    source,
    parent.file_sha256,
    transport,
  )
  return persistReplayWorkerV10SuccessorExecutionContractAdmission(
    input.registry_root,
    buildReplayWorkerV10SuccessorExecutionContractAdmission(
      source,
      parent.file_sha256,
      transport,
      execution,
    ),
  )
}

export function readReplayWorkerV10SuccessorExecutionContract(
  input: ReplayWorkerV10SuccessorExecutionContractRegistryInput,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission | null {
  const parent = readReplayWorkerV10SuccessorExecutionParent(input)
  const source = parent.source
  const transport = readArtifactTransport(input.registry_root, source, parent.file_sha256)
  if (!transport) return null
  const execution = readExecutionAdmission(
    input.registry_root,
    source,
    parent.file_sha256,
    transport,
  )
  if (!execution) return null
  const expected = buildReplayWorkerV10SuccessorExecutionContractAdmission(
    source,
    parent.file_sha256,
    transport,
    execution,
  )
  const value = readReplayWorkerV10SuccessorExecutionContractAdmissionRecord(
    input.registry_root,
    expected.admission_key,
  )
  if (!value) return null
  const admission = requireSameReplayWorkerV10SuccessorExecutionContractAdmission(value, expected)
  assertReplayWorkerV10SuccessorExecutionParentStillAuthoritative(parent)
  return admission
}

function registerArtifactTransport(
  root: string,
  source: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
  parentSha: string,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract {
  return persistReplayWorkerV10SuccessorArtifactTransport(
    root,
    buildReplayWorkerV10SuccessorArtifactTransport(source, parentSha),
  )
}

function readArtifactTransport(
  root: string,
  source: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
  parentSha: string,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract | null {
  const expected = buildReplayWorkerV10SuccessorArtifactTransport(source, parentSha)
  return readReplayWorkerV10SuccessorArtifactTransportRecord(
    root,
    expected.contract_key,
    expected,
  )
}

function registerExecutionAdmission(
  root: string,
  source: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
  parentSha: string,
  transport: ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract {
  return persistReplayWorkerV10SuccessorExecutionAdmission(
    root,
    buildReplayWorkerV10SuccessorExecutionAdmission(source, parentSha, transport),
  )
}

function readExecutionAdmission(
  root: string,
  source: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
  parentSha: string,
  transport: ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract | null {
  const expected = buildReplayWorkerV10SuccessorExecutionAdmission(source, parentSha, transport)
  return readReplayWorkerV10SuccessorExecutionAdmissionRecord(
    root,
    expected.contract_key,
    expected,
  )
}
