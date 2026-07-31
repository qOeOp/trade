import { join, resolve } from "node:path"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract,
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-contract-admission"
import {
  persistReplayWorkerV10CanonicalRecord as persistCanonicalRecord,
  readReplayWorkerV10CanonicalRecord as readCanonicalRecord,
  requireSameReplayWorkerV10CanonicalRecord as requireSame,
} from "./replay-worker-v10-canonical-record-store"

export function readReplayWorkerV10SuccessorArtifactTransportRecord(
  root: string,
  key: string,
  expected?: ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract | null {
  const value = readCanonicalRecord(
    artifactPath(root, key),
    "successor execution artifact Transport",
    assertReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
  )
  return value && expected ? requireSame(value, expected,
    "successor execution artifact Transport natural key has different evidence") : value
}

export function persistReplayWorkerV10SuccessorArtifactTransport(
  root: string,
  expected: ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract {
  return persistCanonicalRecord(
    artifactPath(root, expected.contract_key),
    expected,
    "successor execution artifact Transport",
    "successor execution artifact Transport natural key has different evidence",
    assertReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
  )
}

export function readReplayWorkerV10SuccessorExecutionAdmissionRecord(
  root: string,
  key: string,
  expected?: ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract | null {
  const value = readCanonicalRecord(
    executionPath(root, key),
    "successor Execution Admission",
    assertReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract,
  )
  return value && expected ? requireSame(value, expected,
    "successor Execution Admission natural key has different evidence") : value
}

export function persistReplayWorkerV10SuccessorExecutionAdmission(
  root: string,
  expected: ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract {
  return persistCanonicalRecord(
    executionPath(root, expected.contract_key),
    expected,
    "successor Execution Admission",
    "successor Execution Admission natural key has different evidence",
    assertReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract,
  )
}

export function readReplayWorkerV10SuccessorExecutionContractAdmissionRecord(
  root: string,
  key: string,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission | null {
  return readCanonicalRecord(
    admissionPath(root, key),
    "successor execution Contract admission",
    assertReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
  )
}

export function persistReplayWorkerV10SuccessorExecutionContractAdmission(
  root: string,
  expected: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission {
  return persistCanonicalRecord(
    admissionPath(root, expected.admission_key),
    expected,
    "successor execution Contract admission",
    "successor execution Contract admission natural key has different evidence",
    assertReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
  )
}

export function requireSameReplayWorkerV10SuccessorExecutionContractAdmission(
  existing: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
  expected: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission {
  return requireSame(existing, expected,
    "successor execution Contract admission natural key has different evidence")
}

function admissionPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-execution-contract-${key}.json`)
}

function artifactPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-execution-artifact-transport-${key}.json`)
}

function executionPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-execution-admission-${key}.json`)
}
