import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_ATTEMPT_POLICY_VERSION,
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt,
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt,
  replayDecisionHarnessWorkerV10AuthorityProcessLaunchKey,
  type ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt,
  type ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-process-launch"
import {
  assertReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation,
  type ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-spawn-boundary-revalidation"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { writeReplayImmutableCas, writeReplayImmutableCasWithDisposition } from "./replay-local-artifact-store"
import { readReplayWorkerV10AuthorityCapsuleEntry } from "./replay-worker-v10-authority-capsule-registry"
import { readReplayWorkerV10AuthoritySpawnBoundaryRevalidation } from "./replay-worker-v10-authority-spawn-boundary-revalidation-registry"

interface LaunchParentInput {
  registry_root: string
  source_spawn_revalidation: ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation
}

export function requireReplayWorkerV10AuthorityProcessLaunchParent(input: LaunchParentInput): void {
  if (input.registry_root.trim() === "") {
    throw new Error("Authority Process Launch registry root is required")
  }
  assertReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation(
    input.source_spawn_revalidation,
  )
  const binding = input.source_spawn_revalidation
  const durableBinding = readReplayWorkerV10AuthoritySpawnBoundaryRevalidation({
    registry_root: input.registry_root,
    source_authority_capsule: binding.source_authority_capsule,
    source_revalidation_request: binding.source_revalidation_request,
    control_plane_revalidation_receipt: binding.control_plane_revalidation_receipt,
  })
  const durableCapsule = readReplayWorkerV10AuthorityCapsuleEntry({
    registry_root: input.registry_root,
    capsule_key: binding.source_authority_capsule_key,
  })
  if (!durableBinding || durableBinding.binding_hash !== binding.binding_hash) {
    throw new Error("Authority Process Launch requires the exact durable Spawn Boundary Revalidation")
  }
  if (!durableCapsule || durableCapsule.record_hash !== binding.source_authority_capsule_record_hash) {
    throw new Error("Authority Process Launch requires the exact durable Authority Capsule")
  }
}

export function readReplayWorkerV10AuthorityProcessLaunchAttempt(
  input: LaunchParentInput,
): ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt | null {
  requireReplayWorkerV10AuthorityProcessLaunchParent(input)
  const value = readAttempt(attemptPath(input.registry_root,
    authorityProcessLaunchKey(input.source_spawn_revalidation)))
  if (value
      && value.source_spawn_revalidation_hash !== input.source_spawn_revalidation.binding_hash) {
    throw new Error("Authority Process Launch Attempt parent mismatch")
  }
  return value
}

export function readReplayWorkerV10AuthorityProcessLaunchReceipt(
  input: LaunchParentInput,
): ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt | null {
  requireReplayWorkerV10AuthorityProcessLaunchParent(input)
  const key = authorityProcessLaunchKey(input.source_spawn_revalidation)
  const value = readReceipt(receiptPath(input.registry_root, key))
  if (!value) return null
  const attempt = readAttempt(attemptPath(input.registry_root, key))
  if (!attempt || attempt.launch_attempt_hash !== value.source_launch_attempt_hash) {
    throw new Error("Authority Process Launch Receipt lost its durable Launch Attempt")
  }
  return value
}

export function commitReplayWorkerV10AuthorityProcessLaunchAttempt(
  root: string,
  key: string,
  attempt: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt,
): boolean {
  return writeReplayImmutableCasWithDisposition(
    attemptPath(root, key),
    `${canonicalJson(attempt)}\n`,
  ).created
}

export function persistReplayWorkerV10AuthorityProcessLaunchReceipt(
  root: string,
  key: string,
  receipt: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt,
): ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt {
  const content = `${canonicalJson(receipt)}\n`
  writeReplayImmutableCas(receiptPath(root, key), content)
  return parseReceipt(content)
}

export function authorityProcessLaunchKey(
  binding: ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation,
): string {
  return replayDecisionHarnessWorkerV10AuthorityProcessLaunchKey({
    spawn_revalidation_hash: binding.binding_hash,
    launch_attempt_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_ATTEMPT_POLICY_VERSION,
  })
}

function readAttempt(path: string): ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt | null {
  if (!existsSync(path)) return null
  assertRegularFile(path, "Attempt")
  const content = readFileSync(path, "utf8")
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("Authority Process Launch Attempt is not canonical")
  }
  return value
}

function readReceipt(path: string): ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt | null {
  if (!existsSync(path)) return null
  assertRegularFile(path, "Receipt")
  return parseReceipt(readFileSync(path, "utf8"))
}

function parseReceipt(content: string): ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("Authority Process Launch Receipt is not canonical")
  }
  return value
}

function assertRegularFile(path: string, label: string): void {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Authority Process Launch ${label} must be a regular file`)
  }
}

function attemptPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-authority-process-launch-attempt-${key}.json`)
}

function receiptPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-authority-process-launch-receipt-${key}.json`)
}
