import { join, resolve } from "node:path"
import { assertReplaySpawnBoundaryRevalidationRequest, type ReplaySpawnBoundaryRevalidationRequest } from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation,
  assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidationLineage,
  type ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-spawn-boundary-revalidation"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { persistReplayWorkerV10CanonicalRecord, readReplayWorkerV10CanonicalRecord } from "./replay-worker-v10-canonical-record-store"
import type { ReplayWorkerV10SuccessorSpawnDurableParents } from "./replay-worker-v10-successor-spawn-revalidation-types"

export function readReplayWorkerV10SuccessorSpawnRevalidationRequestRecord(
  root: string,
  expected: ReplaySpawnBoundaryRevalidationRequest,
): ReplaySpawnBoundaryRevalidationRequest | null {
  const value = readReplayWorkerV10CanonicalRecord(
    requestPath(root, expected.request_key),
    "successor Spawn Revalidation Request",
    assertReplaySpawnBoundaryRevalidationRequest,
  )
  return value ? requireSame(value, expected,
    "successor Spawn Revalidation Request natural key has different evidence") : null
}

export function persistReplayWorkerV10SuccessorSpawnRevalidationRequest(
  root: string,
  expected: ReplaySpawnBoundaryRevalidationRequest,
): ReplaySpawnBoundaryRevalidationRequest {
  return persistReplayWorkerV10CanonicalRecord(
    requestPath(root, expected.request_key),
    expected,
    "successor Spawn Revalidation Request",
    "successor Spawn Revalidation Request natural key has different evidence",
    assertReplaySpawnBoundaryRevalidationRequest,
  )
}

export function readReplayWorkerV10SuccessorSpawnRevalidationBindingRecord(
  root: string,
  expected: ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation,
  parents: ReplayWorkerV10SuccessorSpawnDurableParents,
): ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation | null {
  const value = readReplayWorkerV10CanonicalRecord<ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation>(
    bindingPath(root, expected.binding_key),
    "successor Spawn Revalidation Binding",
    (candidate) => assertBinding(candidate, parents),
  )
  return value ? requireSame(value, expected,
    "successor Spawn Revalidation natural key has different evidence") : null
}

export function persistReplayWorkerV10SuccessorSpawnRevalidationBinding(
  root: string,
  expected: ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation,
  parents: ReplayWorkerV10SuccessorSpawnDurableParents,
): ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation {
  return persistReplayWorkerV10CanonicalRecord(
    bindingPath(root, expected.binding_key),
    expected,
    "successor Spawn Revalidation Binding",
    "successor Spawn Revalidation natural key has different evidence",
    (candidate) => assertBinding(candidate, parents),
  )
}

export function replayWorkerV10SuccessorSpawnRevalidationReceiptPath(
  root: string,
  key: string,
): string {
  return join(resolve(root), `worker-v10-successor-spawn-revalidation-receipt-${key}.json`)
}

function assertBinding(
  value: ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation,
  parents: ReplayWorkerV10SuccessorSpawnDurableParents,
): void {
  assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation(value)
  assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidationLineage(
    value,
    parents.capsule,
    parents.intent,
  )
}

function requireSame<T>(existing: T, expected: T, message: string): T {
  if (canonicalJson(existing) !== canonicalJson(expected)) throw new Error(message)
  return existing
}

function requestPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-spawn-revalidation-request-${key}.json`)
}

function bindingPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-spawn-revalidation-${key}.json`)
}
