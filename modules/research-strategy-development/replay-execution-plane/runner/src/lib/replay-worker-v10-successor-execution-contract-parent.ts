import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-stdio-probe-admission"
import { readReplayDurableParentValidationReceipt } from "./replay-durable-parent-validation-receipt"
import type { ReplayWorkerV10SuccessorExecutionContractRegistryInput, ReplayWorkerV10SuccessorExecutionParentSnapshot } from "./replay-worker-v10-successor-execution-contract-types"

const validatedParentCache = new Map<
  string,
  ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission
>()

export function readReplayWorkerV10SuccessorExecutionParent(
  input: ReplayWorkerV10SuccessorExecutionContractRegistryInput,
): ReplayWorkerV10SuccessorExecutionParentSnapshot {
  requireReferenceInput(input)
  const expected = input.source_successor_execution_stdio_probe_admission
  const path = join(resolve(input.registry_root),
    `worker-v10-successor-execution-stdio-probe-${expected.admission_key}.json`)
  if (!existsSync(path)) {
    throw new Error("successor execution Contract requires its durable R4.146 parent reference")
  }
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("successor execution Contract R4.146 parent reference must be a regular file")
  }
  const content = readFileSync(path, "utf8")
  const fileSha256 = createHash("sha256").update(content, "utf8").digest("hex")
  const receipt = readReplayDurableParentValidationReceipt({
    registry_root: input.registry_root,
    parent_kind: "worker_v10_successor_execution_stdio_probe_admission",
    parent_key: expected.admission_key,
  })
  if (!receipt || receipt.parent_self_hash !== expected.admission_hash
      || receipt.parent_canonical_file_sha256 !== fileSha256) {
    throw new Error("successor execution Contract requires an exact durable parent validation receipt")
  }
  const cacheKey = `${path}\u0000${fileSha256}`
  const cached = validatedParentCache.get(cacheKey)
  if (cached) {
    if (cached.admission_key !== expected.admission_key
        || cached.admission_hash !== expected.admission_hash) {
      throw new Error("successor execution Contract R4.146 cached parent key or hash drift")
    }
    return { source: cached, file_sha256: fileSha256, cache_key: cacheKey }
  }
  const durable = JSON.parse(content) as ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission
  if (durable.admission_key !== expected.admission_key
      || durable.admission_hash !== expected.admission_hash) {
    throw new Error("successor execution Contract R4.146 direct parent key or hash drift")
  }
  return { source: durable, file_sha256: fileSha256, cache_key: cacheKey }
}

export function rememberReplayWorkerV10SuccessorExecutionParent(
  parent: ReplayWorkerV10SuccessorExecutionParentSnapshot,
): void {
  validatedParentCache.clear()
  validatedParentCache.set(parent.cache_key, parent.source)
}

function requireReferenceInput(input: ReplayWorkerV10SuccessorExecutionContractRegistryInput): void {
  if (input.registry_root.trim() === "") {
    throw new Error("successor execution Contract registry root is required")
  }
  const source = input.source_successor_execution_stdio_probe_admission
  if (typeof source?.admission_key !== "string" || !/^[a-f0-9]{64}$/.test(source.admission_key)
      || typeof source.admission_hash !== "string"
      || !/^[a-f0-9]{64}$/.test(source.admission_hash)) {
    throw new Error("successor execution Contract R4.146 parent reference is invalid")
  }
}
