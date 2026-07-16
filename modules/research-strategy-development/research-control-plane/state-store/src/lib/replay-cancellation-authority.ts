import type { Database } from "bun:sqlite"
import {
  assertReplayAttemptLeaseSnapshot,
  assertReplayAttemptCancellationSnapshot,
  assertReplayAttemptCancellationObservationSnapshot,
  assertReplayReservationCancellationSnapshot,
  assertTrialReservationSnapshot,
  hashTrialReservationSnapshot,
  type ReplayAttemptCancellationSnapshot,
  type ReplayAttemptCancellationObservationSnapshot,
  type ReplayAttemptLeaseSnapshot,
  type ReplayReservationCancellationSnapshot,
  type TrialReservationSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"

interface CancellationRow {
  cancellation_hash: string
  cancellation_json: string
}

interface CancellationObservationRow {
  observation_hash: string
  observation_json: string
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

export interface ReplayAttemptCancellationDirective {
  command: "cancel"
  attempt_lease: ReplayAttemptLeaseSnapshot
  observed_at: string
  attempt_cancellation: ReplayAttemptCancellationSnapshot
}

export interface ReplayCancellationCoordinationPortAdapter {
  poll(input: {
    attempt_lease: ReplayAttemptLeaseSnapshot
    observed_at: string
  }): ReplayAttemptCancellationDirective | null
  acknowledge(input: {
    observation: ReplayAttemptCancellationObservationSnapshot
    registered_at: string
  }): void
}

export interface ReplayAttemptCancellationLatencyProjection {
  cancellation_recorded_at: string
  worker_observed_at: string
  control_plane_registered_at: string
  authority_to_observation_ms: number
  observation_to_registration_ms: number
  authority_to_registration_ms: number
}

export function createSqliteReplayCancellationCoordinationPort(
  db: Database,
): ReplayCancellationCoordinationPortAdapter {
  return {
    poll: ({ attempt_lease: attemptLease, observed_at: observedAt }) => (
      resolveReplayAttemptCancellationDirective(db, attemptLease, observedAt)
    ),
    acknowledge: ({ observation, registered_at: registeredAt }) => {
      recordReplayAttemptCancellationObservation(db, observation, registeredAt)
    },
  }
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

export function resolveReplayAttemptCancellationDirective(
  db: Database,
  attemptLease: ReplayAttemptLeaseSnapshot,
  observedAt: string,
): ReplayAttemptCancellationDirective | null {
  assertReplayAttemptLeaseSnapshot(attemptLease)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(observedAt)
      || !Number.isFinite(Date.parse(observedAt))) {
    throw new Error("Replay Attempt cancellation observation time must be RFC 3339 UTC")
  }
  const cancellation = readReplayAttemptCancellation(db, attemptLease.attempt_id)
  if (!cancellation) return null
  if (cancellation.trial_id !== attemptLease.trial_id
      || cancellation.run_id !== attemptLease.run_id
      || cancellation.reservation_ref !== attemptLease.reservation_ref
      || cancellation.reservation_hash !== attemptLease.reservation_hash
      || cancellation.request_hash !== attemptLease.request_hash
      || cancellation.attempt_ordinal !== attemptLease.attempt_ordinal
      || cancellation.worker_id !== attemptLease.worker_id
      || cancellation.target_lease_generation !== attemptLease.lease_generation) {
    throw new Error("Replay Attempt cancellation does not match the worker lease")
  }
  if (Date.parse(observedAt) < Date.parse(cancellation.recorded_at)) {
    throw new Error("Replay Attempt cancellation cannot be delivered before it is recorded")
  }
  if (Date.parse(observedAt) >= Date.parse(attemptLease.lease_expires_at)) {
    throw new Error("Replay Attempt cancellation delivery missed the worker lease window")
  }
  return {
    command: "cancel",
    attempt_lease: structuredClone(attemptLease),
    observed_at: observedAt,
    attempt_cancellation: cancellation,
  }
}

export function recordReplayAttemptCancellationObservation(
  db: Database,
  observation: ReplayAttemptCancellationObservationSnapshot,
  registeredAt: string,
): ReplayAttemptCancellationObservationSnapshot {
  assertReplayAttemptCancellationObservationSnapshot(observation)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(registeredAt)
      || !Number.isFinite(Date.parse(registeredAt))) {
    throw new Error("Replay Attempt cancellation registration time must be RFC 3339 UTC")
  }
  if (Date.parse(registeredAt) < Date.parse(observation.observed_at)) {
    throw new Error("Replay Attempt cancellation cannot be registered before worker observation")
  }
  const write = db.transaction(() => {
    const existing = db.query(`
      SELECT observation_hash, observation_json
      FROM rd_replay_attempt_cancellation_observation
      WHERE observation_id = $observation_id
        OR observation_ref = $observation_ref
        OR cancellation_hash = $cancellation_hash
        OR attempt_id = $attempt_id
    `).get({
      $observation_id: observation.observation_id,
      $observation_ref: observation.observation_ref,
      $cancellation_hash: observation.cancellation_hash,
      $attempt_id: observation.attempt_id,
    }) as CancellationObservationRow | null
    if (existing) {
      if (existing.observation_hash !== observation.observation_hash) {
        throw new Error("Replay Attempt cancellation already has a different observation")
      }
      return parseAttemptCancellationObservation(existing)
    }

    const cancellation = readReplayAttemptCancellation(db, observation.attempt_id)
    if (!cancellation
        || cancellation.cancellation_id !== observation.cancellation_id
        || cancellation.cancellation_ref !== observation.cancellation_ref
        || cancellation.cancellation_hash !== observation.cancellation_hash
        || cancellation.trial_id !== observation.trial_id
        || cancellation.run_id !== observation.run_id
        || cancellation.reservation_ref !== observation.reservation_ref
        || cancellation.reservation_hash !== observation.reservation_hash
        || cancellation.request_hash !== observation.request_hash
        || cancellation.attempt_ordinal !== observation.attempt_ordinal
        || cancellation.worker_id !== observation.worker_id
        || cancellation.target_lease_generation !== observation.target_lease_generation) {
      throw new Error("Replay Attempt cancellation observation does not match authority cancellation")
    }
    if (Date.parse(observation.observed_at) < Date.parse(cancellation.recorded_at)) {
      throw new Error("Replay Attempt cancellation cannot be observed before it is recorded")
    }
    const attempt = db.query(`
      SELECT attempt_id, trial_id, run_id, attempt_ordinal, worker_id,
             reservation_ref, reservation_hash, request_hash, status,
             lease_generation, claimed_at, lease_expires_at
      FROM rd_replay_attempt WHERE attempt_id = $attempt_id
    `).get({ $attempt_id: observation.attempt_id }) as AttemptAuthorityRow | null
    if (!attempt || attempt.status !== "cancelled"
        || attempt.lease_generation !== observation.target_lease_generation
        || attempt.worker_id !== observation.worker_id) {
      throw new Error("Replay Attempt cancellation observation requires the matching terminal Attempt")
    }

    db.query(`
      INSERT INTO rd_replay_attempt_cancellation_observation(
        observation_id, observation_ref, observation_hash, status, observed_at, registered_at,
        cancellation_id, cancellation_ref, cancellation_hash,
        trial_id, run_id, reservation_ref, reservation_hash, request_hash,
        attempt_id, attempt_ordinal, worker_id, target_lease_generation,
        outcome_schema_version, outcome_status, outcome_failure_code,
        partial_result_published, observation_json
      ) VALUES (
        $observation_id, $observation_ref, $observation_hash, $status, $observed_at, $registered_at,
        $cancellation_id, $cancellation_ref, $cancellation_hash,
        $trial_id, $run_id, $reservation_ref, $reservation_hash, $request_hash,
        $attempt_id, $attempt_ordinal, $worker_id, $target_lease_generation,
        $outcome_schema_version, $outcome_status, $outcome_failure_code,
        0, $observation_json
      )
    `).run({
      $observation_id: observation.observation_id,
      $observation_ref: observation.observation_ref,
      $observation_hash: observation.observation_hash,
      $status: observation.status,
      $observed_at: observation.observed_at,
      $registered_at: registeredAt,
      $cancellation_id: observation.cancellation_id,
      $cancellation_ref: observation.cancellation_ref,
      $cancellation_hash: observation.cancellation_hash,
      $trial_id: observation.trial_id,
      $run_id: observation.run_id,
      $reservation_ref: observation.reservation_ref,
      $reservation_hash: observation.reservation_hash,
      $request_hash: observation.request_hash,
      $attempt_id: observation.attempt_id,
      $attempt_ordinal: observation.attempt_ordinal,
      $worker_id: observation.worker_id,
      $target_lease_generation: observation.target_lease_generation,
      $outcome_schema_version: observation.outcome_schema_version,
      $outcome_status: observation.outcome_status,
      $outcome_failure_code: observation.outcome_failure_code,
      $observation_json: JSON.stringify(observation),
    })
    return structuredClone(observation)
  })
  return write.immediate()
}

export function readReplayAttemptCancellationObservation(
  db: Database,
  attemptId: string,
): ReplayAttemptCancellationObservationSnapshot | null {
  const row = db.query(`
    SELECT observation_hash, observation_json
    FROM rd_replay_attempt_cancellation_observation
    WHERE attempt_id = $attempt_id
  `).get({ $attempt_id: attemptId }) as CancellationObservationRow | null
  return row ? parseAttemptCancellationObservation(row) : null
}

export function readReplayAttemptCancellationLatency(
  db: Database,
  attemptId: string,
): ReplayAttemptCancellationLatencyProjection | null {
  const row = db.query(`
    SELECT cancellation.recorded_at AS cancellation_recorded_at,
           observation.observed_at AS worker_observed_at,
           observation.registered_at AS control_plane_registered_at
    FROM rd_replay_attempt_cancellation AS cancellation
    JOIN rd_replay_attempt_cancellation_observation AS observation
      ON observation.cancellation_hash = cancellation.cancellation_hash
    WHERE cancellation.attempt_id = $attempt_id
  `).get({ $attempt_id: attemptId }) as {
    cancellation_recorded_at: string
    worker_observed_at: string
    control_plane_registered_at: string
  } | null
  if (!row) return null
  const recorded = Date.parse(row.cancellation_recorded_at)
  const observed = Date.parse(row.worker_observed_at)
  const registered = Date.parse(row.control_plane_registered_at)
  if (![recorded, observed, registered].every(Number.isFinite)
      || recorded > observed || observed > registered) {
    throw new Error("Replay Attempt cancellation latency projection is inconsistent")
  }
  return {
    ...row,
    authority_to_observation_ms: observed - recorded,
    observation_to_registration_ms: registered - observed,
    authority_to_registration_ms: registered - recorded,
  }
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

function parseAttemptCancellationObservation(
  row: CancellationObservationRow,
): ReplayAttemptCancellationObservationSnapshot {
  const observation = JSON.parse(row.observation_json) as ReplayAttemptCancellationObservationSnapshot
  assertReplayAttemptCancellationObservationSnapshot(observation)
  if (observation.observation_hash !== row.observation_hash) {
    throw new Error("Replay Attempt cancellation observation registry row is inconsistent")
  }
  return observation
}
