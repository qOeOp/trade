import { expect } from "bun:test"
import { copyFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_POLICY_VERSION,
  REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_SCHEMA_VERSION,
  createReplaySpawnBoundaryRevalidationReceipt,
  replaySpawnBoundaryRevalidationReceiptIdentityHash,
  type ReplaySpawnBoundaryRevalidationRequest,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import type { ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-authority-capsule"
import type { ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-process-launch-intent"
import type { ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-lease-admission"
import {
  admitReplayWorkerV10SuccessorSpawnBoundaryRevalidation,
  readReplayWorkerV10SuccessorSpawnBoundaryRevalidation,
} from "./replay-worker-v10-successor-spawn-boundary-revalidation-registry"
import { expectSuccessorSpawnRevalidation } from "./replay-worker-v10-cutover-legacy-stage.assertions"

export interface ReplayWorkerV10SuccessorSpawnStageInput {
  registry_root: string
  capsule_file: string
  intent_file: string
  authority_capsule: ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord
  process_launch_intent: ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent
  successor_lease_admission: ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission
  profile(stage: string): void
}

export function runReplayWorkerV10SuccessorSpawnStage(input: ReplayWorkerV10SuccessorSpawnStageInput) {
  const root = input.registry_root
  const capsule = input.authority_capsule
  const intent = input.process_launch_intent
  const lease = input.successor_lease_admission
  const buildReceipt = (
    request: ReplaySpawnBoundaryRevalidationRequest,
    startedAt: string,
    completedAt: string,
    startedMonotonicNs: string,
    completedMonotonicNs: string,
  ) => {
    const identityHash = replaySpawnBoundaryRevalidationReceiptIdentityHash({
      source_request_hash: request.request_hash,
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
      source_request_id: request.request_id,
      source_request_ref: request.request_ref,
      source_request_hash: request.request_hash,
      source_request: structuredClone(request),
      clock_source: "control_plane_authority_process_clock_port",
      clock_independence: "authority_internal_sampling_without_caller_timestamp_input",
      caller_time_input: "forbidden",
      wall_clock_source: "javascript_date_now_utc",
      monotonic_clock_source: "process_hrtime_bigint",
      external_time_attestation: "not_provided",
      current_attempt_read:
        "single_control_plane_transaction_exact_attempt_worker_generation_and_lease_hash",
      registry_read_started_at: startedAt,
      registry_read_completed_at: completedAt,
      registry_read_started_monotonic_ns: startedMonotonicNs,
      registry_read_completed_monotonic_ns: completedMonotonicNs,
      current_attempt_status: lease.successor_attempt_lease.status,
      current_attempt_lease_hash: lease.successor_attempt_lease_hash,
      current_attempt_lease: structuredClone(lease.successor_attempt_lease),
      revalidated_at: completedAt,
      valid_before: lease.successor_attempt_lease.lease_expires_at,
      spawn_candidate_authority: "single_immediate_spawn_candidate_not_process_start_evidence",
      race_limit: "receipt_cannot_prove_absence_of_cancellation_or_fencing_after_completed_read",
      process_authority: "none",
    })
  }
  let authorityPortCalls = 0
  const spawnInput = {
    source_successor_authority_capsule: capsule,
    source_successor_process_launch_intent: intent,
    authority_port: {
      revalidate: (request: ReplaySpawnBoundaryRevalidationRequest) => {
        authorityPortCalls += 1
        return buildReceipt(
          request,
          "2026-07-14T00:04:08Z",
          "2026-07-14T00:04:09Z",
          "10000000",
          "10000100",
        )
      },
    },
  }
  const missingRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-successor-spawn-revalidation-missing-"))
  try {
    expect(() => admitReplayWorkerV10SuccessorSpawnBoundaryRevalidation({
      registry_root: missingRoot,
      ...spawnInput,
    })).toThrow("requires exact durable R4.150 Authority Capsule")
    expect(authorityPortCalls).toBe(0)
  } finally {
    rmSync(missingRoot, { recursive: true, force: true })
  }
  const staleRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-successor-spawn-revalidation-stale-"))
  try {
    copyFileSync(join(root, input.capsule_file), join(staleRoot, input.capsule_file))
    copyFileSync(join(root, input.intent_file), join(staleRoot, input.intent_file))
    expect(() => admitReplayWorkerV10SuccessorSpawnBoundaryRevalidation({
      registry_root: staleRoot,
      source_successor_authority_capsule: capsule,
      source_successor_process_launch_intent: intent,
      authority_port: {
        revalidate: (request) => buildReceipt(
          request,
          intent.intent_issued_at,
          "2026-07-14T00:04:08Z",
          "11000000",
          "11000100",
        ),
      },
    })).toThrow("Receipt binding or chronology drift")
  } finally {
    rmSync(staleRoot, { recursive: true, force: true })
  }
  const result = admitReplayWorkerV10SuccessorSpawnBoundaryRevalidation({
    registry_root: root,
    ...spawnInput,
  })
  input.profile("successor spawn revalidation")
  expect(authorityPortCalls).toBe(1)
  expectSuccessorSpawnRevalidation({ result, capsule, intent })
  expect(readReplayWorkerV10SuccessorSpawnBoundaryRevalidation({
    registry_root: root,
    source_successor_authority_capsule: capsule,
    source_successor_process_launch_intent: intent,
  })).toEqual(result)
  return {
    result,
    build_receipt: buildReceipt,
    authority_port_call_count: () => authorityPortCalls,
    record_authority_port_call: () => { authorityPortCalls += 1 },
  }
}
