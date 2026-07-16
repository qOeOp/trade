import type { Database } from "bun:sqlite"
import {
  assertReplayAttemptLeaseSnapshot,
  hashTrialReservationSnapshot,
  type ReplayAttemptLeaseSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"
import {
  claimReplayAttempt,
  type ClaimReplayAttemptInput,
} from "../../../state-store/src/lib/replay-attempt-authority"
import {
  recoverReplayCancellationOutboxes,
  type ReplayCancellationRecoveryJobResult,
  withReplayCancellationAuthorityDatabase,
} from "./replay-cancellation-recovery-job"

export const REPLAY_ATTEMPT_ADMISSION_RESULT_SCHEMA_VERSION = "trade.rd-replay-attempt-admission-result.v1" as const

export interface ReplayAttemptAdmissionInput {
  db_path: string
  artifact_root: string
  recovered_at: string
  claim: ClaimReplayAttemptInput
}

export interface ReplayAttemptAdmissionResult {
  schema_version: typeof REPLAY_ATTEMPT_ADMISSION_RESULT_SCHEMA_VERSION
  status: "admitted"
  recovered_at: string
  claimed_at: string
  recovery: ReplayCancellationRecoveryJobResult
  attempt_lease: ReplayAttemptLeaseSnapshot
}

export interface ReplayAttemptAdmissionDependencies {
  claim: (db: Database, input: ClaimReplayAttemptInput) => ReplayAttemptLeaseSnapshot
}

const DEFAULT_DEPENDENCIES: ReplayAttemptAdmissionDependencies = { claim: claimReplayAttempt }

export function admitReplayAttemptAfterCancellationRecovery(
  input: ReplayAttemptAdmissionInput,
  dependencies: ReplayAttemptAdmissionDependencies = DEFAULT_DEPENDENCIES,
): ReplayAttemptAdmissionResult {
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
      recovery,
      attempt_lease: attemptLease,
    }
  })
}

function assertAdmittedLease(claim: ClaimReplayAttemptInput, lease: ReplayAttemptLeaseSnapshot): void {
  assertReplayAttemptLeaseSnapshot(lease)
  if (lease.attempt_id !== claim.attempt_id || lease.worker_id !== claim.worker_id
      || lease.trial_id !== claim.trial_reservation.identity.trial_id
      || lease.run_id !== claim.trial_reservation.run_id
      || lease.reservation_ref !== claim.trial_reservation.reservation_ref
      || lease.reservation_hash !== hashTrialReservationSnapshot(claim.trial_reservation)
      || lease.request_hash !== claim.request_hash || lease.claimed_at !== claim.claimed_at
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
