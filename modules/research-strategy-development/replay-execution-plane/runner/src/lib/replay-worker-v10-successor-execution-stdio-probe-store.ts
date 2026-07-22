import { join, resolve } from "node:path"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-stdio-probe-admission"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { registerReplayDurableParentValidationReceipt } from "./replay-durable-parent-validation-receipt"
import {
  persistReplayWorkerV10CanonicalRecord,
  readReplayWorkerV10CanonicalRecord,
  requireSameReplayWorkerV10CanonicalRecord,
} from "./replay-worker-v10-canonical-record-store"

export function persistReplayWorkerV10SuccessorExecutionStdioProbeAdmission(
  root: string,
  expected: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission {
  const admission = persistReplayWorkerV10CanonicalRecord(
    admissionPath(root, expected.admission_key),
    expected,
    "successor execution Stdio Probe admission",
    "successor execution Stdio Probe admission natural key has different evidence",
    assertReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
  )
  registerReplayDurableParentValidationReceipt({
    registry_root: root,
    parent_kind: "worker_v10_successor_execution_stdio_probe_admission",
    parent_key: admission.admission_key,
    parent_self_hash: admission.admission_hash,
    parent_canonical_content: `${canonicalJson(admission)}\n`,
  })
  return admission
}

export function readReplayWorkerV10SuccessorExecutionStdioProbeAdmissionRecord(
  root: string,
  expected: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission | null {
  const value = readReplayWorkerV10CanonicalRecord(
    admissionPath(root, expected.admission_key),
    "successor execution Stdio Probe admission",
    assertReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
  )
  return value
    ? requireSameReplayWorkerV10CanonicalRecord(value, expected,
      "successor execution Stdio Probe admission natural key has different evidence")
    : null
}

function admissionPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-execution-stdio-probe-${key}.json`)
}
