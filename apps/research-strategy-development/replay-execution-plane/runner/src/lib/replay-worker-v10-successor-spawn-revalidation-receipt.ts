import type {
  ReplaySpawnBoundaryRevalidationReceipt,
  ReplaySpawnBoundaryRevalidationRequest,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { assertReplaySpawnBoundaryRevalidationReceipt } from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import { readReplayWorkerV10CanonicalRecord } from "./replay-worker-v10-canonical-record-store"
import type {
  ReplayWorkerV10SuccessorSpawnDurableParents,
  ReplayWorkerV10SuccessorSpawnRevalidationAuthorityPort,
} from "./replay-worker-v10-successor-spawn-revalidation-types"
import { replayWorkerV10SuccessorSpawnRevalidationReceiptPath } from "./replay-worker-v10-successor-spawn-revalidation-store"

export function admitReplayWorkerV10SuccessorSpawnRevalidationReceipt(
  root: string,
  parents: ReplayWorkerV10SuccessorSpawnDurableParents,
  request: ReplaySpawnBoundaryRevalidationRequest,
  authorityPort: ReplayWorkerV10SuccessorSpawnRevalidationAuthorityPort,
): ReplaySpawnBoundaryRevalidationReceipt {
  const existing = readReplayWorkerV10SuccessorSpawnRevalidationReceipt(root, request.request_key)
  if (existing) {
    validateReplayWorkerV10SuccessorSpawnRevalidationReceipt(existing, request, parents)
    return existing
  }
  const candidate = authorityPort.revalidate(structuredClone(request))
  validateReplayWorkerV10SuccessorSpawnRevalidationReceipt(candidate, request, parents)
  const path = replayWorkerV10SuccessorSpawnRevalidationReceiptPath(root, request.request_key)
  try {
    writeReplayImmutableCas(path, `${canonicalJson(candidate)}\n`)
  } catch (error) {
    const winner = readReplayWorkerV10SuccessorSpawnRevalidationReceipt(root, request.request_key)
    if (winner) {
      validateReplayWorkerV10SuccessorSpawnRevalidationReceipt(winner, request, parents)
      return winner
    }
    throw error
  }
  const durable = readReplayWorkerV10SuccessorSpawnRevalidationReceipt(root, request.request_key)
  if (!durable) throw new Error("successor Spawn Revalidation Receipt disappeared after commit")
  return durable
}

export function readReplayWorkerV10SuccessorSpawnRevalidationReceipt(
  root: string,
  key: string,
): ReplaySpawnBoundaryRevalidationReceipt | null {
  return readReplayWorkerV10CanonicalRecord(
    replayWorkerV10SuccessorSpawnRevalidationReceiptPath(root, key),
    "successor Spawn Revalidation Receipt",
    assertReplaySpawnBoundaryRevalidationReceipt,
  )
}

export function validateReplayWorkerV10SuccessorSpawnRevalidationReceipt(
  receipt: ReplaySpawnBoundaryRevalidationReceipt,
  request: ReplaySpawnBoundaryRevalidationRequest,
  parents: ReplayWorkerV10SuccessorSpawnDurableParents,
): void {
  assertReplaySpawnBoundaryRevalidationReceipt(receipt)
  if (canonicalJson(receipt.source_request) !== canonicalJson(request)
      || receipt.current_attempt_status !== "running"
      || receipt.current_attempt_lease_hash !== parents.capsule.current_attempt_lease_hash
      || Date.parse(receipt.registry_read_started_at) <= Date.parse(parents.intent.intent_issued_at)) {
    throw new Error("successor Spawn Revalidation Control Plane Receipt binding or chronology drift")
  }
}
