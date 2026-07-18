import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_POLICY_VERSION,
  assertReplaySpawnBoundaryRevalidationRequest,
  replaySpawnBoundaryRevalidationRequestKey,
  type ReplaySpawnBoundaryRevalidationRequest,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord,
  type ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-capsule"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import { readReplayWorkerV10AuthorityCapsuleEntry } from "./replay-worker-v10-authority-capsule-registry"
import { buildReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequest } from "./replay-worker-v10-authority-spawn-boundary-revalidation-request"

export interface ReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequestRegistryInput {
  registry_root: string
  source_authority_capsule: ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord
}

export function issueReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequest(
  input: ReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequestRegistryInput,
): ReplaySpawnBoundaryRevalidationRequest {
  requireDurableParent(input)
  const expected = buildReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequest(input)
  const path = requestPath(input.registry_root, expected.request_key)
  const existing = readRequest(path)
  if (existing) return sameRequest(existing, expected)
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readRequest(path)
    if (winner) return sameRequest(winner, expected)
    throw error
  }
  return parseRequest(content)
}

export function readReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequest(
  input: ReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequestRegistryInput,
): ReplaySpawnBoundaryRevalidationRequest | null {
  requireInput(input)
  const key = requestKey(input.source_authority_capsule)
  const value = readRequest(requestPath(input.registry_root, key))
  if (!value) return null
  requireDurableParent(input)
  return sameRequest(value, buildReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequest(input))
}

export function readReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequestEntry(input: {
  registry_root: string
  request_key: string
}): ReplaySpawnBoundaryRevalidationRequest | null {
  if (input.registry_root.trim() === "") throw new Error("spawn revalidation Request registry root is required")
  if (!/^[a-f0-9]{64}$/.test(input.request_key)) {
    throw new Error("spawn revalidation Request key must be a canonical hash")
  }
  const value = readRequest(requestPath(input.registry_root, input.request_key))
  if (value && value.request_key !== input.request_key) throw new Error("spawn revalidation Request key mismatch")
  return value
}

function requireDurableParent(
  input: ReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequestRegistryInput,
): void {
  requireInput(input)
  const capsule = input.source_authority_capsule
  const durable = readReplayWorkerV10AuthorityCapsuleEntry({
    registry_root: input.registry_root,
    capsule_key: capsule.capsule_key,
  })
  if (!durable || durable.record_hash !== capsule.record_hash) {
    throw new Error("spawn revalidation Request requires the exact durable Authority Capsule")
  }
}

function requireInput(input: ReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequestRegistryInput): void {
  if (input.registry_root.trim() === "") throw new Error("spawn revalidation Request registry root is required")
  assertReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord(input.source_authority_capsule)
}

function sameRequest(
  existing: ReplaySpawnBoundaryRevalidationRequest,
  expected: ReplaySpawnBoundaryRevalidationRequest,
): ReplaySpawnBoundaryRevalidationRequest {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("spawn revalidation Request natural key has different evidence")
  }
  return existing
}

function readRequest(path: string): ReplaySpawnBoundaryRevalidationRequest | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("spawn revalidation Request must be a regular file")
  return parseRequest(readFileSync(path, "utf8"))
}

function parseRequest(content: string): ReplaySpawnBoundaryRevalidationRequest {
  const value = JSON.parse(content) as ReplaySpawnBoundaryRevalidationRequest
  assertReplaySpawnBoundaryRevalidationRequest(value)
  if (content !== `${canonicalJson(value)}\n`) throw new Error("spawn revalidation Request is not canonical")
  return value
}

function requestKey(capsule: ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord): string {
  return replaySpawnBoundaryRevalidationRequestKey({
    source_authority_capsule_record_hash: capsule.record_hash,
    attempt_id: capsule.attempt_id,
    worker_id: capsule.worker_id,
    lease_generation: capsule.lease_generation,
    request_policy_version: REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_POLICY_VERSION,
  })
}

function requestPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-authority-spawn-revalidation-request-${key}.json`)
}
