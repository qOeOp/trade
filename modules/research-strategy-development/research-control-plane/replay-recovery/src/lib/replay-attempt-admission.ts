import type { Database } from "bun:sqlite"
import {
  assertReplayAttemptLeaseSnapshot,
  type ReplayAttemptLeaseSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"
import {
  claimRegisteredReplayAttempt,
} from "../../../state-store/src/lib/replay-attempt-authority"
import {
  assertReplayAttemptAdmissionRequest,
  type ReplayAttemptAdmissionRequest,
} from "../../../contracts/src/lib/replay-attempt-admission"
import {
  recoverReplayCancellationOutboxes,
  type ReplayCancellationRecoveryJobResult,
  withReplayCancellationAuthorityDatabase,
} from "./replay-cancellation-recovery-job"

export const REPLAY_ATTEMPT_ADMISSION_RESULT_SCHEMA_VERSION = "trade.rd-replay-attempt-admission-result.v2" as const

export interface ReplayAttemptAdmissionInput {
  db_path: string
  artifact_root: string
  recovered_at: string
  claim: ReplayAttemptAdmissionRequest
}

export interface ReplayAttemptAdmissionResult {
  schema_version: typeof REPLAY_ATTEMPT_ADMISSION_RESULT_SCHEMA_VERSION
  status: "admitted"
  recovered_at: string
  claimed_at: string
  request_registration_id: string
  request_registration_hash: string
  recovery: ReplayCancellationRecoveryJobResult
  attempt_lease: ReplayAttemptLeaseSnapshot
}

export interface ReplayAttemptAdmissionDependencies {
  claim: (db: Database, input: ReplayAttemptAdmissionRequest) => ReplayAttemptLeaseSnapshot
}

const DEFAULT_DEPENDENCIES: ReplayAttemptAdmissionDependencies = { claim: claimRegisteredReplayAttempt }

export function admitReplayAttemptAfterCancellationRecovery(
  input: ReplayAttemptAdmissionInput,
  dependencies: ReplayAttemptAdmissionDependencies = DEFAULT_DEPENDENCIES,
): ReplayAttemptAdmissionResult {
  assertReplayAttemptAdmissionRequest(input.claim)
  requireRecoveryBeforeClaim(input.recovered_at, input.claim.claimed_at)
  return withReplayCancellationAuthorityDatabase(input.db_path, (db) => {
    const recovery = recoverReplayCancellationOutboxes(db, input.artifact_root, input.recovered_at)
    const attemptLease = dependencies.claim(db, input.claim)
    assertAdmittedLease(input.claim, attemptLease)
    return {
      schema_version: REPLAY_ATTEMPT_ADMISSION_RESULT_SCHEMA_VERSION,
      status: "admitted",
      recovered_at: input.recovered_at,
      claimed_at: attemptLease.claimed_at,
      request_registration_id: input.claim.request_registration_id,
      request_registration_hash: input.claim.request_registration_hash,
      recovery,
      attempt_lease: attemptLease,
    }
  })
}

function assertAdmittedLease(claim: ReplayAttemptAdmissionRequest, lease: ReplayAttemptLeaseSnapshot): void {
  assertReplayAttemptLeaseSnapshot(lease)
  if (lease.attempt_id !== claim.attempt_id || lease.worker_id !== claim.worker_id
      || lease.claimed_at !== claim.claimed_at
      || lease.lease_expires_at !== claim.lease_expires_at) {
    throw new Error("Replay Attempt admission returned a lease outside the requested authority")
  }
}

function requireRecoveryBeforeClaim(recoveredAt: string, claimedAt: string): void {
  const recovered = Date.parse(recoveredAt)
  const claimed = Date.parse(claimedAt)
  if (!Number.isFinite(recovered) || !Number.isFinite(claimed) || recovered > claimed) {
    throw new Error("Replay recovery must complete at or before Attempt claimed_at")
  }
}
