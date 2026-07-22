import { join, resolve } from "node:path"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-transport-admission"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { registerReplayDurableParentValidationReceipt } from "./replay-durable-parent-validation-receipt"
import {
  persistReplayWorkerV10CanonicalRecord,
  readReplayWorkerV10CanonicalRecord,
  requireSameReplayWorkerV10CanonicalRecord,
} from "./replay-worker-v10-canonical-record-store"

export function persistReplayWorkerV10SuccessorExecutionTransportAdmission(
  root: string,
  expected: ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission {
  const admission = persistReplayWorkerV10CanonicalRecord(
    admissionPath(root, expected.admission_key),
    expected,
    "successor execution Transport admission",
    "successor execution Transport admission natural key has different evidence",
    assertReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission,
  )
  return registerValidationReceipt(root, admission)
}

export function readReplayWorkerV10SuccessorExecutionTransportAdmissionRecord(
  root: string,
  expected: ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission | null {
  const value = readReplayWorkerV10CanonicalRecord(
    admissionPath(root, expected.admission_key),
    "successor execution Transport admission",
    assertReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission,
  )
  if (!value) return null
  return registerValidationReceipt(
    root,
    requireSameReplayWorkerV10CanonicalRecord(value, expected,
      "successor execution Transport admission natural key has different evidence"),
  )
}

function registerValidationReceipt(
  root: string,
  admission: ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission {
  registerReplayDurableParentValidationReceipt({
    registry_root: root,
    parent_kind: "worker_v10_successor_execution_transport_admission",
    parent_key: admission.admission_key,
    parent_self_hash: admission.admission_hash,
    parent_canonical_content: `${canonicalJson(admission)}\n`,
  })
  return admission
}

function admissionPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-execution-transport-${key}.json`)
}
