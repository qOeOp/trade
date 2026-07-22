import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract,
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionContract,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionArtifactTransportContract,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-contract-admission"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"

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

function persistCanonicalRecord<T>(
  path: string,
  expected: T,
  label: string,
  driftMessage: string,
  assertValue: (value: T) => void,
): T {
  const existing = readCanonicalRecord(path, label, assertValue)
  if (existing) return requireSame(existing, expected, driftMessage)
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readCanonicalRecord(path, label, assertValue)
    if (winner) return requireSame(winner, expected, driftMessage)
    throw error
  }
  return parseCanonicalRecord(content, label, assertValue)
}

function readCanonicalRecord<T>(
  path: string,
  label: string,
  assertValue: (value: T) => void,
): T | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file`)
  }
  return parseCanonicalRecord(readFileSync(path, "utf8"), label, assertValue)
}

function parseCanonicalRecord<T>(
  content: string,
  label: string,
  assertValue: (value: T) => void,
): T {
  const value = JSON.parse(content) as T
  assertValue(value)
  if (content !== `${canonicalJson(value)}\n`) throw new Error(`${label} is not canonical`)
  return value
}

function requireSame<T>(existing: T, expected: T, message: string): T {
  if (canonicalJson(existing) !== canonicalJson(expected)) throw new Error(message)
  return existing
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
