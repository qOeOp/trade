import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-transport-admission"
import {
  readReplayDurableParentValidationReceipt,
  type ReplayDurableParentValidationReceipt,
} from "./replay-durable-parent-validation-receipt"
import type { RegisterReplayWorkerV10SuccessorExecutionStdioProbeInput } from "./replay-worker-v10-successor-execution-stdio-probe-types"

export function readReplayWorkerV10SuccessorExecutionStdioProbeParent(
  input: Omit<RegisterReplayWorkerV10SuccessorExecutionStdioProbeInput, "clock">,
): {
  admission: ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission
  receipt: ReplayDurableParentValidationReceipt
} {
  requireReferenceInput(input)
  const expected = input.source_successor_execution_transport_admission
  const path = join(resolve(input.registry_root),
    `worker-v10-successor-execution-transport-${expected.admission_key}.json`)
  if (!existsSync(path)) {
    throw new Error("successor execution Stdio Probe requires the exact durable R4.145 Transport Admission")
  }
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("successor execution Stdio Probe R4.145 parent must be a regular file")
  }
  const content = readFileSync(path, "utf8")
  const receipt = readReplayDurableParentValidationReceipt({
    registry_root: input.registry_root,
    parent_kind: "worker_v10_successor_execution_transport_admission",
    parent_key: expected.admission_key,
  })
  const contentHash = createHash("sha256").update(content, "utf8").digest("hex")
  if (!receipt || receipt.parent_self_hash !== expected.admission_hash
      || receipt.parent_canonical_file_sha256 !== contentHash) {
    throw new Error("successor execution Stdio Probe requires the exact durable R4.145 Transport Admission")
  }
  const durable = JSON.parse(content) as ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission
  if (durable.admission_key !== expected.admission_key || durable.admission_hash !== expected.admission_hash) {
    throw new Error("successor execution Stdio Probe R4.145 parent reference drift")
  }
  return { admission: durable, receipt }
}

function requireReferenceInput(
  input: Omit<RegisterReplayWorkerV10SuccessorExecutionStdioProbeInput, "clock">,
): void {
  if (input.registry_root.trim() === "") {
    throw new Error("successor execution Stdio Probe registry root is required")
  }
  const source = input.source_successor_execution_transport_admission
  if (typeof source?.admission_key !== "string" || !/^[a-f0-9]{64}$/.test(source.admission_key)
      || typeof source.admission_hash !== "string" || !/^[a-f0-9]{64}$/.test(source.admission_hash)) {
    throw new Error("successor execution Stdio Probe R4.145 parent reference is invalid")
  }
}
