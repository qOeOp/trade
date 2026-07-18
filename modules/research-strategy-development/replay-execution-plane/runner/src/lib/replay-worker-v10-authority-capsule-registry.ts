import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_POLICY_VERSION,
  assertReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord,
  replayDecisionHarnessWorkerV10AuthorityCapsuleKey,
  type ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-capsule"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent,
  type ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-process-launch-intent"
import {
  buildReplayDecisionHarnessWorkerV10AuthorityCapsule,
} from "./replay-decision-harness-worker-v10-authority-capsule"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import {
  readReplayWorkerV10AuthorityProcessLaunchIntentEntry,
} from "./replay-worker-v10-authority-process-launch-intent-registry"

export interface ReplayWorkerV10AuthorityCapsuleRegistryInput {
  registry_root: string
  source_authority_process_launch_intent: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent
}

export interface ReplayWorkerV10AuthorityCapsuleEntryInput {
  registry_root: string
  capsule_key: string
}

export function materializeReplayWorkerV10AuthorityCapsule(
  input: ReplayWorkerV10AuthorityCapsuleRegistryInput,
): ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord {
  requireDurableParent(input)
  const expected = buildReplayDecisionHarnessWorkerV10AuthorityCapsule(input)
  const path = capsulePath(input.registry_root, expected.capsule_key)
  const existing = readCapsule(path)
  if (existing) return sameCapsule(existing, expected)
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readCapsule(path)
    if (winner) return sameCapsule(winner, expected)
    throw error
  }
  return parseCapsule(content)
}

export function readReplayWorkerV10AuthorityCapsule(
  input: ReplayWorkerV10AuthorityCapsuleRegistryInput,
): ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord | null {
  requireInput(input)
  const value = readCapsule(capsulePath(input.registry_root, capsuleKey(input.source_authority_process_launch_intent)))
  if (!value) return null
  requireDurableParent(input)
  return sameCapsule(value, buildReplayDecisionHarnessWorkerV10AuthorityCapsule(input))
}

export function readReplayWorkerV10AuthorityCapsuleEntry(
  input: ReplayWorkerV10AuthorityCapsuleEntryInput,
): ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord | null {
  if (input.registry_root.trim() === "") throw new Error("Authority Capsule registry root is required")
  if (!/^[a-f0-9]{64}$/.test(input.capsule_key)) {
    throw new Error("Authority Capsule key must be a canonical hash")
  }
  const value = readCapsule(capsulePath(input.registry_root, input.capsule_key))
  if (value && value.capsule_key !== input.capsule_key) {
    throw new Error("Authority Capsule entry key mismatch")
  }
  return value
}

function requireDurableParent(input: ReplayWorkerV10AuthorityCapsuleRegistryInput): void {
  requireInput(input)
  const intent = input.source_authority_process_launch_intent
  const durable = readReplayWorkerV10AuthorityProcessLaunchIntentEntry({
    registry_root: input.registry_root,
    intent_key: intent.intent_key,
  })
  if (!durable || durable.intent_hash !== intent.intent_hash) {
    throw new Error("Authority Capsule requires the exact durable Authority Process Launch Intent")
  }
}

function requireInput(input: ReplayWorkerV10AuthorityCapsuleRegistryInput): void {
  if (input.registry_root.trim() === "") throw new Error("Authority Capsule registry root is required")
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent(
    input.source_authority_process_launch_intent,
  )
}

function sameCapsule(
  existing: ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord,
  expected: ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord,
): ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("Authority Capsule natural key has different evidence")
  }
  return existing
}

function readCapsule(path: string): ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Authority Capsule entry must be a regular file")
  }
  return parseCapsule(readFileSync(path, "utf8"))
}

function parseCapsule(content: string): ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord
  assertReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord(value)
  if (content !== `${canonicalJson(value)}\n`) throw new Error("Authority Capsule entry is not canonical")
  return value
}

function capsuleKey(intent: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent): string {
  return replayDecisionHarnessWorkerV10AuthorityCapsuleKey({
    authority_process_launch_intent_hash: intent.intent_hash,
    capsule_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_POLICY_VERSION,
  })
}

function capsulePath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-authority-capsule-${key}.json`)
}
