import { buildReplayWorkerV10SuccessorSpawnRevalidationBinding } from "./replay-worker-v10-successor-spawn-revalidation-binding"
import { readReplayWorkerV10SuccessorSpawnDurableParents } from "./replay-worker-v10-successor-spawn-revalidation-parents"
import {
  admitReplayWorkerV10SuccessorSpawnRevalidationReceipt,
  readReplayWorkerV10SuccessorSpawnRevalidationReceipt,
  validateReplayWorkerV10SuccessorSpawnRevalidationReceipt,
} from "./replay-worker-v10-successor-spawn-revalidation-receipt"
import { buildReplayWorkerV10SuccessorSpawnRevalidationRequest } from "./replay-worker-v10-successor-spawn-revalidation-request"
import {
  persistReplayWorkerV10SuccessorSpawnRevalidationBinding,
  persistReplayWorkerV10SuccessorSpawnRevalidationRequest,
  readReplayWorkerV10SuccessorSpawnRevalidationBindingRecord,
  readReplayWorkerV10SuccessorSpawnRevalidationRequestRecord,
} from "./replay-worker-v10-successor-spawn-revalidation-store"
import type {
  ReplayWorkerV10SuccessorSpawnBoundaryRevalidationInput,
  ReplayWorkerV10SuccessorSpawnBoundaryRevalidationReadInput,
  ReplayWorkerV10SuccessorSpawnBoundaryRevalidationResult,
} from "./replay-worker-v10-successor-spawn-revalidation-types"

export type {
  ReplayWorkerV10SuccessorSpawnBoundaryRevalidationInput,
  ReplayWorkerV10SuccessorSpawnBoundaryRevalidationReadInput,
  ReplayWorkerV10SuccessorSpawnBoundaryRevalidationResult,
  ReplayWorkerV10SuccessorSpawnRevalidationAuthorityPort,
} from "./replay-worker-v10-successor-spawn-revalidation-types"

export function admitReplayWorkerV10SuccessorSpawnBoundaryRevalidation(
  input: ReplayWorkerV10SuccessorSpawnBoundaryRevalidationInput,
): ReplayWorkerV10SuccessorSpawnBoundaryRevalidationResult {
  const parents = readReplayWorkerV10SuccessorSpawnDurableParents(input)
  const request = persistReplayWorkerV10SuccessorSpawnRevalidationRequest(
    input.registry_root,
    buildReplayWorkerV10SuccessorSpawnRevalidationRequest(parents.capsule),
  )
  const receipt = admitReplayWorkerV10SuccessorSpawnRevalidationReceipt(
    input.registry_root,
    parents,
    request,
    input.authority_port,
  )
  const binding = persistReplayWorkerV10SuccessorSpawnRevalidationBinding(
    input.registry_root,
    buildReplayWorkerV10SuccessorSpawnRevalidationBinding(parents, request, receipt),
    parents,
  )
  return result(request, receipt, binding)
}

export function readReplayWorkerV10SuccessorSpawnBoundaryRevalidation(
  input: ReplayWorkerV10SuccessorSpawnBoundaryRevalidationReadInput,
): ReplayWorkerV10SuccessorSpawnBoundaryRevalidationResult | null {
  const parents = readReplayWorkerV10SuccessorSpawnDurableParents(input)
  const expectedRequest = buildReplayWorkerV10SuccessorSpawnRevalidationRequest(parents.capsule)
  const request = readReplayWorkerV10SuccessorSpawnRevalidationRequestRecord(
    input.registry_root,
    expectedRequest,
  )
  if (!request) return null
  const receipt = readReplayWorkerV10SuccessorSpawnRevalidationReceipt(
    input.registry_root,
    request.request_key,
  )
  if (!receipt) return null
  validateReplayWorkerV10SuccessorSpawnRevalidationReceipt(receipt, request, parents)
  const expectedBinding = buildReplayWorkerV10SuccessorSpawnRevalidationBinding(
    parents,
    request,
    receipt,
  )
  const binding = readReplayWorkerV10SuccessorSpawnRevalidationBindingRecord(
    input.registry_root,
    expectedBinding,
    parents,
  )
  return binding ? result(request, receipt, binding) : null
}

function result(
  revalidationRequest: ReplayWorkerV10SuccessorSpawnBoundaryRevalidationResult["revalidation_request"],
  receipt: ReplayWorkerV10SuccessorSpawnBoundaryRevalidationResult["control_plane_revalidation_receipt"],
  binding: ReplayWorkerV10SuccessorSpawnBoundaryRevalidationResult["spawn_boundary_revalidation"],
): ReplayWorkerV10SuccessorSpawnBoundaryRevalidationResult {
  return {
    revalidation_request: revalidationRequest,
    control_plane_revalidation_receipt: receipt,
    spawn_boundary_revalidation: binding,
  }
}
