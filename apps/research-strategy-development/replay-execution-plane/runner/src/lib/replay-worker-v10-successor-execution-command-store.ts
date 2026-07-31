import { join, resolve } from "node:path"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand,
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionCommandLineage,
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-command-admission"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-contract-admission"
import {
  persistReplayWorkerV10CanonicalRecord as persistCanonicalRecord,
  readReplayWorkerV10CanonicalRecord as readCanonicalRecord,
  requireSameReplayWorkerV10CanonicalRecord as requireSame,
} from "./replay-worker-v10-canonical-record-store"

export function readReplayWorkerV10SuccessorExecutionDispatchClaimRecord(
  root: string,
  key: string,
  expected?: ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim | null {
  const value = readCanonicalRecord(claimPath(root, key), "successor execution Dispatch Claim",
    assertReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim)
  return value && expected ? requireSame(value, expected,
    "successor execution Dispatch Claim natural key has different evidence") : value
}

export function persistReplayWorkerV10SuccessorExecutionDispatchClaim(
  root: string,
  expected: ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim {
  return persistCanonicalRecord(claimPath(root, expected.claim_key), expected,
    "successor execution Dispatch Claim",
    "successor execution Dispatch Claim natural key has different evidence",
    assertReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim)
}

export function readReplayWorkerV10SuccessorExecutionAdmissionCommandRecord(
  root: string,
  key: string,
  expected?: ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand | null {
  const value = readCanonicalRecord(commandPath(root, key), "successor Execution Admission Command",
    assertReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand)
  return value && expected ? requireSame(value, expected,
    "successor Execution Admission Command natural key has different evidence") : value
}

export function persistReplayWorkerV10SuccessorExecutionAdmissionCommand(
  root: string,
  expected: ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand {
  return persistCanonicalRecord(commandPath(root, expected.command_key), expected,
    "successor Execution Admission Command",
    "successor Execution Admission Command natural key has different evidence",
    assertReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand)
}

export function readReplayWorkerV10SuccessorExecutionCommandAdmissionRecord(
  root: string,
  key: string,
  parent: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
  expected?: ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission | null {
  const value = readCanonicalRecord<ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission>(
    admissionPath(root, key),
    "successor execution Command Admission",
    (candidate) => assertCommandAdmission(candidate, parent),
  )
  return value && expected ? requireSame(value, expected,
    "successor execution Command Admission natural key has different evidence") : value
}

export function persistReplayWorkerV10SuccessorExecutionCommandAdmission(
  root: string,
  expected: ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
  parent: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission {
  return persistCanonicalRecord(admissionPath(root, expected.admission_key), expected,
    "successor execution Command Admission",
    "successor execution Command Admission natural key has different evidence",
    (candidate) => assertCommandAdmission(candidate, parent))
}

function assertCommandAdmission(
  value: ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
  parent: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
): void {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission(value)
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionCommandLineage(value, parent)
}

function claimPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-execution-dispatch-claim-${key}.json`)
}

function commandPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-execution-command-${key}.json`)
}

function admissionPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-execution-command-admission-${key}.json`)
}
