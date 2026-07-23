import type { Database } from "bun:sqlite"
import {
  assertReplayAttemptLeaseSnapshot,
  hashReplayAttemptLeaseSnapshot,
  type ReplayAttemptLeaseSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"
import {
  claimRegisteredReplayAttempt,
  issueReplayRegisteredAttemptDispatchAuthority,
} from "../../../state-store/src/lib/replay-attempt-authority"
import {
  assertReplayAttemptAdmissionRequest,
  type ReplayAttemptAdmissionRequest,
} from "../../../contracts/src/lib/replay-attempt-admission"
import {
  assertReplayRegisteredAttemptDispatchAuthority,
  type ReplayRegisteredAttemptDispatchAuthority,
} from "../../../contracts/src/lib/replay-registered-attempt-dispatch-authority"
import {
  recoverReplayCancellationOutboxes,
  type ReplayCancellationRecoveryJobResult,
  withReplayCancellationAuthorityDatabase,
} from "./replay-cancellation-recovery-job"

export const REPLAY_ATTEMPT_ADMISSION_RESULT_SCHEMA_VERSION = "trade.rd-replay-attempt-admission-result.v3" as const

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
  recovery: ReplayCancellationRecoveryJobResult
  dispatch_authority: ReplayRegisteredAttemptDispatchAuthority
}

export interface ReplayAttemptAdmissionDependencies {
  claim: (db: Database, input: ReplayAttemptAdmissionRequest) => ReplayAttemptLeaseSnapshot
  issue_dispatch_authority: typeof issueReplayRegisteredAttemptDispatchAuthority
}

const DEFAULT_DEPENDENCIES: ReplayAttemptAdmissionDependencies = {
  claim: claimRegisteredReplayAttempt,
  issue_dispatch_authority: issueReplayRegisteredAttemptDispatchAuthority,
}

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
    const dispatchAuthority = dependencies.issue_dispatch_authority(db, {
      attempt_id: attemptLease.attempt_id,
      worker_id: attemptLease.worker_id,
      expected_lease_generation: attemptLease.lease_generation,
      issued_at: attemptLease.claimed_at,
    })
    assertAdmittedDispatchAuthority(input.claim, attemptLease, dispatchAuthority)
    return {
      schema_version: REPLAY_ATTEMPT_ADMISSION_RESULT_SCHEMA_VERSION,
      status: "admitted",
      recovered_at: input.recovered_at,
      claimed_at: attemptLease.claimed_at,
      recovery,
      dispatch_authority: dispatchAuthority,
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

function assertAdmittedDispatchAuthority(
  claim: ReplayAttemptAdmissionRequest,
  lease: ReplayAttemptLeaseSnapshot,
  authority: ReplayRegisteredAttemptDispatchAuthority,
): void {
  assertReplayRegisteredAttemptDispatchAuthority(authority)
  if (authority.request_registration_id !== claim.request_registration_id
      || authority.request_registration_hash !== claim.request_registration_hash
      || authority.attempt_id !== lease.attempt_id || authority.worker_id !== lease.worker_id
      || authority.lease_generation !== lease.lease_generation
      || authority.attempt_lease_hash !== hashReplayAttemptLeaseSnapshot(lease)) {
    throw new Error("Replay Attempt admission dispatch authority is outside the admitted claim")
  }
}

function requireRecoveryBeforeClaim(recoveredAt: string, claimedAt: string): void {
  const recovered = Date.parse(recoveredAt)
  const claimed = Date.parse(claimedAt)
  if (!Number.isFinite(recovered) || !Number.isFinite(claimed) || recovered > claimed) {
    throw new Error("Replay recovery must complete at or before Attempt claimed_at")
  }
}
