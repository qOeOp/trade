import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleLineage,
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord,
  type ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-authority-capsule"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
  type ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-process-launch-intent"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import type {
  ReplayWorkerV10SuccessorSpawnBoundaryRevalidationReadInput,
  ReplayWorkerV10SuccessorSpawnDurableParents,
} from "./replay-worker-v10-successor-spawn-revalidation-types"

export function readReplayWorkerV10SuccessorSpawnDurableParents(
  input: ReplayWorkerV10SuccessorSpawnBoundaryRevalidationReadInput,
): ReplayWorkerV10SuccessorSpawnDurableParents {
  if (input.registry_root.trim() === "") {
    throw new Error("successor Spawn Revalidation registry root is required")
  }
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord(
    input.source_successor_authority_capsule,
  )
  assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent(
    input.source_successor_process_launch_intent,
  )
  const capsule = readExactFile<ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord>(
    input.registry_root,
    `worker-v10-successor-authority-capsule-${input.source_successor_authority_capsule.capsule_key}.json`,
    "capsule_key", input.source_successor_authority_capsule.capsule_key,
    "record_hash", input.source_successor_authority_capsule.record_hash,
    "R4.150 Authority Capsule",
  )
  const intent = readExactFile<ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent>(
    input.registry_root,
    `worker-v10-successor-process-launch-intent-${input.source_successor_process_launch_intent.intent_key}.json`,
    "intent_key", input.source_successor_process_launch_intent.intent_key,
    "intent_hash", input.source_successor_process_launch_intent.intent_hash,
    "R4.149 Process Launch Intent",
  )
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord(capsule.value)
  assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent(intent.value)
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleLineage(capsule.value, intent.value)
  if (capsule.value.source_parent_canonical_file_sha256 !== intent.file_sha256) {
    throw new Error("successor Spawn Revalidation Capsule-to-Intent file seal drift")
  }
  return {
    capsule: capsule.value,
    capsule_file_sha256: capsule.file_sha256,
    intent: intent.value,
    intent_file_sha256: intent.file_sha256,
  }
}

function readExactFile<T extends object>(
  root: string,
  fileName: string,
  keyField: string,
  expectedKey: string,
  hashField: string,
  expectedHash: string,
  label: string,
): { value: T; file_sha256: string } {
  const path = join(resolve(root), fileName)
  if (!existsSync(path)) throw new Error(`successor Spawn Revalidation requires exact durable ${label}`)
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`successor Spawn Revalidation ${label} must be a regular file`)
  }
  const content = readFileSync(path, "utf8")
  const value = JSON.parse(content) as T
  const record = value as Record<string, unknown>
  if (record[keyField] !== expectedKey || record[hashField] !== expectedHash) {
    throw new Error(`successor Spawn Revalidation ${label} key or hash drift`)
  }
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error(`successor Spawn Revalidation ${label} is not canonical`)
  }
  return {
    value,
    file_sha256: createHash("sha256").update(content, "utf8").digest("hex"),
  }
}
