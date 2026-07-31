import { expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_POLICY_VERSION,
  REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_SCHEMA_VERSION,
  assertReplaySpawnBoundaryRevalidationReceipt,
  createReplaySpawnBoundaryRevalidationReceipt,
  replaySpawnBoundaryRevalidationReceiptIdentityHash,
  type ReplayAttemptLeaseObservationRegistryReadReceipt,
} from "../../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import type {
  ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord,
} from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-capsule"
import {
  buildReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequest,
} from "../../lib/replay-worker-v10-authority-spawn-boundary-revalidation-request"
import {
  issueReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequest,
  readReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequest,
} from "../../lib/replay-worker-v10-authority-spawn-boundary-revalidation-request-registry"
import {
  buildReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation,
} from "../../lib/replay-decision-harness-worker-v10-authority-spawn-boundary-revalidation"
import {
  readReplayWorkerV10AuthoritySpawnBoundaryRevalidation,
  registerReplayWorkerV10AuthoritySpawnBoundaryRevalidation,
} from "../../lib/replay-worker-v10-authority-spawn-boundary-revalidation-registry"
import { expectAuthoritySpawnBoundary } from "./replay-worker-v10-authority-stage.assertions"

export interface ReplayWorkerV10AuthoritySpawnStageInput {
  registry_root: string
  authority_capsule: ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord
  intent_registry_receipt: ReplayAttemptLeaseObservationRegistryReadReceipt
  profile(stage: string): void
}

export function runReplayWorkerV10AuthoritySpawnStage(
  input: ReplayWorkerV10AuthoritySpawnStageInput,
) {
  const dispatchEvidenceRegistryRoot = input.registry_root
  const authorityCapsule = input.authority_capsule
  const authorityIntentRegistryReceipt = input.intent_registry_receipt
  const replayProfile = input.profile

  const spawnRevalidationRequestInput = { source_authority_capsule: authorityCapsule }
  const spawnRevalidationRequest = buildReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequest(
    spawnRevalidationRequestInput,
  )
  expect(spawnRevalidationRequest.status).toBe("capsule_bound_current_attempt_revalidation_requested")
  expect(spawnRevalidationRequest.source_authority_capsule_record_hash).toBe(authorityCapsule.record_hash)
  expect(spawnRevalidationRequest.authority_capsule_hash).toBe(authorityCapsule.capsule_hash)
  expect(spawnRevalidationRequest.expected_current_attempt_lease_hash)
    .toBe(authorityCapsule.current_attempt_lease_hash)
  expect(spawnRevalidationRequest.process_authority).toBe("none")
  const missingSpawnRequestRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-spawn-request-missing-"))
  try {
    expect(() => issueReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequest({
      registry_root: missingSpawnRequestRoot,
      ...spawnRevalidationRequestInput,
    })).toThrow("requires the exact durable Authority Capsule")
  } finally {
    rmSync(missingSpawnRequestRoot, { recursive: true, force: true })
  }
  expect(issueReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequest({
    registry_root: dispatchEvidenceRegistryRoot,
    ...spawnRevalidationRequestInput,
  })).toEqual(spawnRevalidationRequest)
  expect(readReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequest({
    registry_root: dispatchEvidenceRegistryRoot,
    ...spawnRevalidationRequestInput,
  })).toEqual(spawnRevalidationRequest)

  const buildSpawnRevalidationReceipt = (
    completedAt: string,
    completedMonotonicNs: string,
  ) => {
    const startedAt = "2026-07-14T00:00:53Z"
    const startedMonotonicNs = "7000000"
    const identityHash = replaySpawnBoundaryRevalidationReceiptIdentityHash({
      source_request_hash: spawnRevalidationRequest.request_hash,
      registry_read_started_at: startedAt,
      registry_read_completed_at: completedAt,
      registry_read_started_monotonic_ns: startedMonotonicNs,
      registry_read_completed_monotonic_ns: completedMonotonicNs,
      receipt_policy_version: REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_POLICY_VERSION,
    })
    return createReplaySpawnBoundaryRevalidationReceipt({
      schema_version: REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_SCHEMA_VERSION,
      receipt_id: `replay-spawn-boundary-revalidation-receipt-${identityHash.slice(0, 24)}`,
      receipt_ref: `receipt://replay-spawn-boundary-revalidation/${identityHash.slice(0, 24)}`,
      receipt_policy_version: REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_POLICY_VERSION,
      status: "capsule_bound_current_attempt_revalidated",
      authority_owner: "research_control_plane",
      authority_source: "research_control_plane_state_store",
      source_request_id: spawnRevalidationRequest.request_id,
      source_request_ref: spawnRevalidationRequest.request_ref,
      source_request_hash: spawnRevalidationRequest.request_hash,
      source_request: spawnRevalidationRequest,
      clock_source: "control_plane_authority_process_clock_port",
      clock_independence: "authority_internal_sampling_without_caller_timestamp_input",
      caller_time_input: "forbidden",
      wall_clock_source: "javascript_date_now_utc",
      monotonic_clock_source: "process_hrtime_bigint",
      external_time_attestation: "not_provided",
      current_attempt_read: "single_control_plane_transaction_exact_attempt_worker_generation_and_lease_hash",
      registry_read_started_at: startedAt,
      registry_read_completed_at: completedAt,
      registry_read_started_monotonic_ns: startedMonotonicNs,
      registry_read_completed_monotonic_ns: completedMonotonicNs,
      current_attempt_status: authorityIntentRegistryReceipt.current_attempt_status,
      current_attempt_lease_hash: authorityIntentRegistryReceipt.current_attempt_lease_hash,
      current_attempt_lease: authorityIntentRegistryReceipt.current_attempt_lease,
      revalidated_at: completedAt,
      valid_before: authorityIntentRegistryReceipt.current_attempt_lease.lease_expires_at,
      spawn_candidate_authority: "single_immediate_spawn_candidate_not_process_start_evidence",
      race_limit: "receipt_cannot_prove_absence_of_cancellation_or_fencing_after_completed_read",
      process_authority: "none",
    })
  }
  const spawnRevalidationReceipt = buildSpawnRevalidationReceipt("2026-07-14T00:00:54Z", "7000100")
  expect(() => assertReplaySpawnBoundaryRevalidationReceipt(spawnRevalidationReceipt)).not.toThrow()
  const spawnRevalidationInput = {
    source_authority_capsule: authorityCapsule,
    source_revalidation_request: spawnRevalidationRequest,
    control_plane_revalidation_receipt: spawnRevalidationReceipt,
  }
  const spawnRevalidation = buildReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation(
    spawnRevalidationInput,
  )
  replayProfile("authority spawn chain")
  expectAuthoritySpawnBoundary({
    revalidation: spawnRevalidation,
    lineage: spawnRevalidationInput,
  })
  const missingSpawnBindingRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-spawn-binding-missing-"))
  try {
    expect(() => registerReplayWorkerV10AuthoritySpawnBoundaryRevalidation({
      registry_root: missingSpawnBindingRoot,
      ...spawnRevalidationInput,
    })).toThrow("requires the exact durable Authority Capsule")
  } finally {
    rmSync(missingSpawnBindingRoot, { recursive: true, force: true })
  }
  expect(registerReplayWorkerV10AuthoritySpawnBoundaryRevalidation({
    registry_root: dispatchEvidenceRegistryRoot,
    ...spawnRevalidationInput,
  })).toEqual(spawnRevalidation)
  expect(readReplayWorkerV10AuthoritySpawnBoundaryRevalidation({
    registry_root: dispatchEvidenceRegistryRoot,
    ...spawnRevalidationInput,
  })).toEqual(spawnRevalidation)
  expect(() => registerReplayWorkerV10AuthoritySpawnBoundaryRevalidation({
    registry_root: dispatchEvidenceRegistryRoot,
    ...spawnRevalidationInput,
    control_plane_revalidation_receipt: buildSpawnRevalidationReceipt("2026-07-14T00:00:55Z", "7000200"),
  })).toThrow("natural key has different evidence")

  return {
    request_input: spawnRevalidationRequestInput,
    request: spawnRevalidationRequest,
    receipt: spawnRevalidationReceipt,
    revalidation_input: spawnRevalidationInput,
    revalidation: spawnRevalidation,
  }
}
