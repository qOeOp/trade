import type { Database } from "bun:sqlite"
import {
  assertReplayAttemptCancellationSnapshot,
  assertReplayReservationCancellationSnapshot,
  assertTrialReservationSnapshot,
  hashTrialReservationSnapshot,
  type ReplayAttemptCancellationSnapshot,
  type ReplayReservationCancellationSnapshot,
  type TrialReservationSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"

interface CancellationRow {
  cancellation_hash: string
  cancellation_json: string
}

interface AttemptAuthorityRow {
  attempt_id: string
  trial_id: string
  run_id: string
  attempt_ordinal: number
  worker_id: string
  reservation_ref: string
  reservation_hash: string
  request_hash: string
  status: "claimed" | "running" | "completed" | "failed" | "cancelled" | "expired"
  lease_generation: number
  claimed_at: string
  lease_expires_at: string
}

export function registerReplayReservationCancellation(
  db: Database,
  cancellation: ReplayReservationCancellationSnapshot,
  reservation: TrialReservationSnapshot,
): ReplayReservationCancellationSnapshot {
  assertReplayReservationCancellationSnapshot(cancellation)
  assertTrialReservationSnapshot(reservation)
  const reservationHash = hashTrialReservationSnapshot(reservation)
  if (cancellation.trial_id !== reservation.identity.trial_id
      || cancellation.run_id !== reservation.run_id
      || cancellation.reservation_ref !== reservation.reservation_ref
      || cancellation.reservation_hash !== reservationHash) {
    throw new Error("Replay Reservation cancellation does not match its frozen Reservation")
  }
  const recordedAt = Date.parse(cancellation.recorded_at)
  const effectiveAt = Date.parse(cancellation.effective_at)
  if (recordedAt < Date.parse(reservation.issued_at) || effectiveAt >= Date.parse(reservation.expires_at)) {
    throw new Error("Replay Reservation cancellation must be recorded and effective inside the Reservation window")
  }

  const write = db.transaction(() => {
    const existing = db.query(`
      SELECT cancellation_hash, cancellation_json
      FROM rd_replay_reservation_cancellation
      WHERE cancellation_id = $cancellation_id
        OR cancellation_ref = $cancellation_ref
        OR reservation_hash = $reservation_hash
    `).get({
      $cancellation_id: cancellation.cancellation_id,
      $cancellation_ref: cancellation.cancellation_ref,
      $reservation_hash: cancellation.reservation_hash,
    }) as CancellationRow | null
    if (existing) {
      if (existing.cancellation_hash !== cancellation.cancellation_hash) {
        throw new Error("Replay Reservation already has a different cancellation")
      }
      return parseReservationCancellation(existing)
    }
    const trial = db.query(`
      SELECT trial_id, run_id, status
      FROM rd_trial
      WHERE trial_id = $trial_id
    `).get({ $trial_id: cancellation.trial_id }) as { trial_id: string; run_id: string; status: string } | null
    if (!trial || trial.run_id !== cancellation.run_id || trial.status !== "reserved") {
      throw new Error("Replay Reservation cancellation requires the authoritative reserved Trial")
    }
    db.query(`
      INSERT INTO rd_replay_reservation_cancellation(
        cancellation_id, cancellation_ref, cancellation_hash, status,
        recorded_at, effective_at, authority_id, cancellation_policy_version,
        reason_code, trial_id, run_id, reservation_ref, reservation_hash,
        scope, cancellation_json
      ) VALUES (
        $cancellation_id, $cancellation_ref, $cancellation_hash, $status,
        $recorded_at, $effective_at, $authority_id, $cancellation_policy_version,
        $reason_code, $trial_id, $run_id, $reservation_ref, $reservation_hash,
        $scope, $cancellation_json
      )
    `).run({
      $cancellation_id: cancellation.cancellation_id,
      $cancellation_ref: cancellation.cancellation_ref,
      $cancellation_hash: cancellation.cancellation_hash,
      $status: cancellation.status,
      $recorded_at: cancellation.recorded_at,
      $effective_at: cancellation.effective_at,
      $authority_id: cancellation.authority_id,
      $cancellation_policy_version: cancellation.cancellation_policy_version,
      $reason_code: cancellation.reason_code,
      $trial_id: cancellation.trial_id,
      $run_id: cancellation.run_id,
      $reservation_ref: cancellation.reservation_ref,
      $reservation_hash: cancellation.reservation_hash,
      $scope: cancellation.scope,
      $cancellation_json: JSON.stringify(cancellation),
    })
    return structuredClone(cancellation)
  })
  return write.immediate()
}

export function assertReplayReservationClaimNotCancelled(
  db: Database,
  reservationHash: string,
  claimedAt: string,
): void {
  const cancellation = readReplayReservationCancellation(db, reservationHash)
  if (cancellation && Date.parse(claimedAt) >= Date.parse(cancellation.effective_at)) {
    throw new Error("Replay Reservation was cancelled before this Attempt claim")
  }
}

export function readReplayReservationCancellation(
  db: Database,
  reservationHash: string,
): ReplayReservationCancellationSnapshot | null {
  const row = db.query(`
    SELECT cancellation_hash, cancellation_json
    FROM rd_replay_reservation_cancellation
    WHERE reservation_hash = $reservation_hash
  `).get({ $reservation_hash: reservationHash }) as CancellationRow | null
  return row ? parseReservationCancellation(row) : null
}

export function cancelReplayAttemptByAuthority(
  db: Database,
  cancellation: ReplayAttemptCancellationSnapshot,
): ReplayAttemptCancellationSnapshot {
  assertReplayAttemptCancellationSnapshot(cancellation)
  const write = db.transaction(() => {
    const existing = db.query(`
      SELECT cancellation_hash, cancellation_json
      FROM rd_replay_attempt_cancellation
      WHERE cancellation_id = $cancellation_id
        OR cancellation_ref = $cancellation_ref
        OR attempt_id = $attempt_id
    `).get({
      $cancellation_id: cancellation.cancellation_id,
      $cancellation_ref: cancellation.cancellation_ref,
      $attempt_id: cancellation.attempt_id,
    }) as CancellationRow | null
    if (existing) {
      if (existing.cancellation_hash !== cancellation.cancellation_hash) {
        throw new Error("Replay Attempt already has a different authority cancellation")
      }
      return parseAttemptCancellation(existing)
    }

    const attempt = db.query(`
      SELECT attempt_id, trial_id, run_id, attempt_ordinal, worker_id,
             reservation_ref, reservation_hash, request_hash, status,
             lease_generation, claimed_at, lease_expires_at
      FROM rd_replay_attempt
      WHERE attempt_id = $attempt_id
    `).get({ $attempt_id: cancellation.attempt_id }) as AttemptAuthorityRow | null
    if (!attempt || attempt.status === "completed" || attempt.status === "failed"
        || attempt.status === "cancelled" || attempt.status === "expired") {
      throw new Error("Replay Attempt cancellation requires an active Attempt")
    }
    if (attempt.trial_id !== cancellation.trial_id
        || attempt.run_id !== cancellation.run_id
        || attempt.attempt_ordinal !== cancellation.attempt_ordinal
        || attempt.worker_id !== cancellation.worker_id
        || attempt.reservation_ref !== cancellation.reservation_ref
        || attempt.reservation_hash !== cancellation.reservation_hash
        || attempt.request_hash !== cancellation.request_hash) {
      throw new Error("Replay Attempt cancellation does not match active Attempt authority")
    }
    if (attempt.lease_generation !== cancellation.target_lease_generation) {
      throw new Error("Replay Attempt cancellation lease generation is stale")
    }
    const recordedAt = Date.parse(cancellation.recorded_at)
    if (recordedAt < Date.parse(attempt.claimed_at) || recordedAt >= Date.parse(attempt.lease_expires_at)) {
      throw new Error("Replay Attempt cancellation must occur inside the active lease")
    }

    db.query(`
      INSERT INTO rd_replay_attempt_cancellation(
        cancellation_id, cancellation_ref, cancellation_hash, status,
        recorded_at, authority_id, cancellation_policy_version, reason_code,
        trial_id, run_id, reservation_ref, reservation_hash, request_hash,
        attempt_id, attempt_ordinal, worker_id, target_lease_generation,
        scope, cancellation_json
      ) VALUES (
        $cancellation_id, $cancellation_ref, $cancellation_hash, $status,
        $recorded_at, $authority_id, $cancellation_policy_version, $reason_code,
        $trial_id, $run_id, $reservation_ref, $reservation_hash, $request_hash,
        $attempt_id, $attempt_ordinal, $worker_id, $target_lease_generation,
        $scope, $cancellation_json
      )
    `).run({
      $cancellation_id: cancellation.cancellation_id,
      $cancellation_ref: cancellation.cancellation_ref,
      $cancellation_hash: cancellation.cancellation_hash,
      $status: cancellation.status,
      $recorded_at: cancellation.recorded_at,
      $authority_id: cancellation.authority_id,
      $cancellation_policy_version: cancellation.cancellation_policy_version,
      $reason_code: cancellation.reason_code,
      $trial_id: cancellation.trial_id,
      $run_id: cancellation.run_id,
      $reservation_ref: cancellation.reservation_ref,
      $reservation_hash: cancellation.reservation_hash,
      $request_hash: cancellation.request_hash,
      $attempt_id: cancellation.attempt_id,
      $attempt_ordinal: cancellation.attempt_ordinal,
      $worker_id: cancellation.worker_id,
      $target_lease_generation: cancellation.target_lease_generation,
      $scope: cancellation.scope,
      $cancellation_json: JSON.stringify(cancellation),
    })
    const result = db.query(`
      UPDATE rd_replay_attempt
      SET status = 'cancelled', finalized_at = $recorded_at, failure_class = 'resource'
      WHERE attempt_id = $attempt_id
        AND lease_generation = $target_lease_generation
        AND status IN ('claimed', 'running')
    `).run({
      $recorded_at: cancellation.recorded_at,
      $attempt_id: cancellation.attempt_id,
      $target_lease_generation: cancellation.target_lease_generation,
    })
    if (result.changes !== 1) throw new Error("Replay Attempt cancellation lost lease authority")
    return structuredClone(cancellation)
  })
  return write.immediate()
}

export function readReplayAttemptCancellation(
  db: Database,
  attemptId: string,
): ReplayAttemptCancellationSnapshot | null {
  const row = db.query(`
    SELECT cancellation_hash, cancellation_json
    FROM rd_replay_attempt_cancellation
    WHERE attempt_id = $attempt_id
  `).get({ $attempt_id: attemptId }) as CancellationRow | null
  return row ? parseAttemptCancellation(row) : null
}

function parseReservationCancellation(row: CancellationRow): ReplayReservationCancellationSnapshot {
  const cancellation = JSON.parse(row.cancellation_json) as ReplayReservationCancellationSnapshot
  assertReplayReservationCancellationSnapshot(cancellation)
  if (cancellation.cancellation_hash !== row.cancellation_hash) {
    throw new Error("Replay Reservation cancellation registry row is inconsistent")
  }
  return cancellation
}

function parseAttemptCancellation(row: CancellationRow): ReplayAttemptCancellationSnapshot {
  const cancellation = JSON.parse(row.cancellation_json) as ReplayAttemptCancellationSnapshot
  assertReplayAttemptCancellationSnapshot(cancellation)
  if (cancellation.cancellation_hash !== row.cancellation_hash) {
    throw new Error("Replay Attempt cancellation registry row is inconsistent")
  }
  return cancellation
}
