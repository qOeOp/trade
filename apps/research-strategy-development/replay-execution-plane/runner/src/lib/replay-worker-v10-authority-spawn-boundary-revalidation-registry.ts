import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SPAWN_REVALIDATION_POLICY_VERSION,
  assertReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation,
  assertReplaySpawnBoundaryRevalidationReceiptView,
  assertReplaySpawnBoundaryRevalidationRequestView,
  replayDecisionHarnessWorkerV10AuthoritySpawnRevalidationKey,
  type ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation,
  type ReplaySpawnBoundaryRevalidationReceiptView,
  type ReplaySpawnBoundaryRevalidationRequestView,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-spawn-boundary-revalidation"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord,
  type ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-capsule"
import { buildReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation } from "./replay-decision-harness-worker-v10-authority-spawn-boundary-revalidation"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import { readReplayWorkerV10AuthorityCapsuleEntry } from "./replay-worker-v10-authority-capsule-registry"
import { readReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequestEntry } from "./replay-worker-v10-authority-spawn-boundary-revalidation-request-registry"

export interface ReplayWorkerV10AuthoritySpawnBoundaryRevalidationRegistryInput {
  registry_root: string
  source_authority_capsule: ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord
  source_revalidation_request: ReplaySpawnBoundaryRevalidationRequestView
  control_plane_revalidation_receipt: ReplaySpawnBoundaryRevalidationReceiptView
}

export function registerReplayWorkerV10AuthoritySpawnBoundaryRevalidation(
  input: ReplayWorkerV10AuthoritySpawnBoundaryRevalidationRegistryInput,
): ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation {
  requireDurableParents(input)
  const expected = buildReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation(input)
  const path = bindingPath(input.registry_root, expected.binding_key)
  const existing = readBinding(path)
  if (existing) return sameBinding(existing, expected)
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readBinding(path)
    if (winner) return sameBinding(winner, expected)
    throw error
  }
  return parseBinding(content)
}

export function readReplayWorkerV10AuthoritySpawnBoundaryRevalidation(
  input: ReplayWorkerV10AuthoritySpawnBoundaryRevalidationRegistryInput,
): ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation | null {
  requireInput(input)
  const key = replayDecisionHarnessWorkerV10AuthoritySpawnRevalidationKey({
    source_revalidation_request_hash: input.source_revalidation_request.request_hash,
    binding_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_SPAWN_REVALIDATION_POLICY_VERSION,
  })
  const value = readBinding(bindingPath(input.registry_root, key))
  if (!value) return null
  requireDurableParents(input)
  return sameBinding(value, buildReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation(input))
}

function requireDurableParents(input: ReplayWorkerV10AuthoritySpawnBoundaryRevalidationRegistryInput): void {
  requireInput(input)
  const capsule = readReplayWorkerV10AuthorityCapsuleEntry({
    registry_root: input.registry_root,
    capsule_key: input.source_authority_capsule.capsule_key,
  })
  const request = readReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequestEntry({
    registry_root: input.registry_root,
    request_key: input.source_revalidation_request.request_key,
  })
  if (!capsule || capsule.record_hash !== input.source_authority_capsule.record_hash) {
    throw new Error("Authority Spawn Revalidation requires the exact durable Authority Capsule")
  }
  if (!request || request.request_hash !== input.source_revalidation_request.request_hash) {
    throw new Error("Authority Spawn Revalidation requires the exact durable capsule-bound Request")
  }
}

function requireInput(input: ReplayWorkerV10AuthoritySpawnBoundaryRevalidationRegistryInput): void {
  if (input.registry_root.trim() === "") throw new Error("Authority Spawn Revalidation registry root is required")
  assertReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord(input.source_authority_capsule)
  assertReplaySpawnBoundaryRevalidationRequestView(input.source_revalidation_request)
  assertReplaySpawnBoundaryRevalidationReceiptView(input.control_plane_revalidation_receipt)
}

function sameBinding(
  existing: ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation,
  expected: ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation,
): ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("Authority Spawn Revalidation natural key has different evidence")
  }
  return existing
}

function readBinding(path: string): ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Authority Spawn Revalidation must be a regular file")
  return parseBinding(readFileSync(path, "utf8"))
}

function parseBinding(content: string): ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation
  assertReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation(value)
  if (content !== `${canonicalJson(value)}\n`) throw new Error("Authority Spawn Revalidation is not canonical")
  return value
}

function bindingPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-authority-spawn-revalidation-${key}.json`)
}
