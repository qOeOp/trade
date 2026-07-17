import type { Database } from "bun:sqlite"
import {
  REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
  REPLAY_ATTEMPT_LEASE_OBSERVATION_POLICY_VERSION,
  REPLAY_ATTEMPT_LEASE_OBSERVATION_SCHEMA_VERSION,
  assertReplayAttemptLeaseSnapshot,
  assertTrialReservationSnapshot,
  createReplayAttemptLeaseObservationSnapshot,
  hashReplayAttemptLeaseSnapshot,
  hashTrialReservationSnapshot,
  type ReplayAttemptLeaseObservationSnapshot,
  type ReplayAttemptLeaseSnapshot,
  type TrialReservationSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"
import { assertReplayReservationClaimNotCancelled } from "./replay-cancellation-authority"

export type ReplayAttemptFailureClass = "input_invalid" | "unsupported_contract" | "data_integrity" | "deterministic_engine" | "resource" | "external_io"

export interface ClaimReplayAttemptInput {
  attempt_id: string
  worker_id: string
  idempotency_key: string
  request_hash: string
  claimed_at: string
  lease_expires_at: string
  trial_reservation: TrialReservationSnapshot
}

export interface RenewReplayAttemptLeaseInput {
  attempt_id: string
  worker_id: string
  expected_lease_generation: number
  heartbeat_at: string
  lease_expires_at: string
}

export interface ObserveCurrentReplayAttemptLeaseInput {
  trial_id: string
  observed_at: string
}

export interface FinalizeReplayAttemptInput {
  attempt_id: string
  worker_id: string
  expected_lease_generation: number
  status: "completed" | "failed" | "cancelled"
  finalized_at: string
  result_hash?: string
  artifact_ref?: string
  artifact_hash?: string
  terminal_checkpoint_hash?: string
  diagnostic_checkpoint_ref?: string
  diagnostic_checkpoint_hash?: string
  failure_class?: ReplayAttemptFailureClass
}

interface AttemptRow {
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
  heartbeat_at: string
  lease_expires_at: string
  finalized_at: string | null
  result_hash: string | null
  artifact_ref: string | null
  artifact_hash: string | null
  terminal_checkpoint_hash: string | null
  diagnostic_checkpoint_ref: string | null
  diagnostic_checkpoint_hash: string | null
  failure_class: ReplayAttemptFailureClass | null
  idempotency_key: string
}

export function claimReplayAttempt(db: Database, input: ClaimReplayAttemptInput): ReplayAttemptLeaseSnapshot {
  requireText(input.attempt_id, "attempt_id")
  requireText(input.worker_id, "worker_id")
  requireText(input.idempotency_key, "idempotency_key")
  requireHash(input.request_hash, "request_hash")
  requireUtc(input.claimed_at, "claimed_at")
  requireUtc(input.lease_expires_at, "lease_expires_at")
  if (Date.parse(input.lease_expires_at) <= Date.parse(input.claimed_at)) throw new Error("Replay Attempt lease must expire after claim")
  assertTrialReservationSnapshot(input.trial_reservation)
  const reservationHash = hashTrialReservationSnapshot(input.trial_reservation)
  const reservation = input.trial_reservation
  const claimedAt = Date.parse(input.claimed_at)
  if (claimedAt < Date.parse(reservation.issued_at) || claimedAt >= Date.parse(reservation.expires_at)) {
    throw new Error("Replay Attempt claim must satisfy reservation issued_at <= claimed_at < expires_at")
  }

  const claim = db.transaction(() => {
    const replay = readAttemptByIdempotencyKey(db, input.idempotency_key)
    if (replay) {
      if (replay.status !== "claimed" && replay.status !== "running") throw new Error("Replay Attempt idempotency key already reached a terminal state")
      if (replay.attempt_id !== input.attempt_id || replay.worker_id !== input.worker_id
          || replay.request_hash !== input.request_hash || replay.reservation_hash !== reservationHash
          || replay.lease_expires_at !== input.lease_expires_at) {
        throw new Error("Replay Attempt idempotency key was reused with different authority")
      }
      return toLeaseSnapshot(replay)
    }

    assertReplayReservationClaimNotCancelled(db, reservationHash, input.claimed_at)

    const trial = db.query(`
      SELECT trial_id, run_id, status, experiment_id, trial_group_id, candidate_id,
             candidate_identity_hash, identity_hash_policy_version
      FROM rd_trial WHERE trial_id=$trial_id
    `).get({ $trial_id: reservation.identity.trial_id }) as {
      trial_id: string; run_id: string; status: string; experiment_id: string; trial_group_id: string
      candidate_id: string; candidate_identity_hash: string; identity_hash_policy_version: string
    } | null
    if (!trial || trial.status !== "reserved") throw new Error("Replay Attempt requires a reserved Trial")
    if (trial.run_id !== reservation.run_id || trial.experiment_id !== reservation.identity.experiment_id
        || trial.trial_group_id !== reservation.identity.trial_group_id || trial.candidate_id !== reservation.identity.candidate_id
        || trial.candidate_identity_hash !== reservation.identity.candidate_hash
        || trial.identity_hash_policy_version !== reservation.identity.identity_hash_policy_version) {
      throw new Error("Replay Attempt reservation does not match authoritative Trial")
    }

    db.query(`
      UPDATE rd_replay_attempt
      SET status='expired', finalized_at=$now, failure_class='resource'
      WHERE trial_id=$trial_id AND status IN ('claimed', 'running') AND lease_expires_at <= $now
    `).run({ $trial_id: trial.trial_id, $now: input.claimed_at })
    const active = db.query(`
      SELECT attempt_id FROM rd_replay_attempt
      WHERE trial_id=$trial_id AND status IN ('claimed', 'running')
    `).get({ $trial_id: trial.trial_id }) as { attempt_id: string } | null
    if (active) throw new Error(`Replay Trial already has active attempt ${active.attempt_id}`)
    const completed = db.query(`
      SELECT attempt_id FROM rd_replay_attempt WHERE trial_id=$trial_id AND status='completed'
    `).get({ $trial_id: trial.trial_id }) as { attempt_id: string } | null
    if (completed) throw new Error(`Replay Trial already has completed attempt ${completed.attempt_id}`)
    const ordinal = (db.query(`
      SELECT COALESCE(MAX(attempt_ordinal), 0) + 1 AS ordinal FROM rd_replay_attempt WHERE trial_id=$trial_id
    `).get({ $trial_id: trial.trial_id }) as { ordinal: number }).ordinal
    db.query(`
      INSERT INTO rd_replay_attempt(
        attempt_id, trial_id, run_id, attempt_ordinal, worker_id,
        reservation_ref, reservation_hash, request_hash, status,
        lease_generation, claimed_at, heartbeat_at, lease_expires_at, idempotency_key
      ) VALUES (
        $attempt_id, $trial_id, $run_id, $attempt_ordinal, $worker_id,
        $reservation_ref, $reservation_hash, $request_hash, 'claimed',
        1, $claimed_at, $claimed_at, $lease_expires_at, $idempotency_key
      )
    `).run({
      $attempt_id: input.attempt_id, $trial_id: trial.trial_id, $run_id: trial.run_id,
      $attempt_ordinal: ordinal, $worker_id: input.worker_id,
      $reservation_ref: reservation.reservation_ref, $reservation_hash: reservationHash,
      $request_hash: input.request_hash, $claimed_at: input.claimed_at,
      $lease_expires_at: input.lease_expires_at, $idempotency_key: input.idempotency_key,
    })
    return toLeaseSnapshot(readAttempt(db, input.attempt_id))
  })
  return claim()
}

export function renewReplayAttemptLease(db: Database, input: RenewReplayAttemptLeaseInput): ReplayAttemptLeaseSnapshot {
  requireText(input.attempt_id, "attempt_id")
  requireText(input.worker_id, "worker_id")
  requireUtc(input.heartbeat_at, "heartbeat_at")
  requireUtc(input.lease_expires_at, "lease_expires_at")
  const current = readAttempt(db, input.attempt_id)
  if (current.worker_id !== input.worker_id || current.lease_generation !== input.expected_lease_generation) {
    throw new Error("Replay Attempt lease fencing token mismatch")
  }
  if (current.status !== "claimed" && current.status !== "running") throw new Error("Replay Attempt is terminal")
  if (Date.parse(input.heartbeat_at) >= Date.parse(current.lease_expires_at)) throw new Error("Replay Attempt lease already expired")
  if (Date.parse(input.lease_expires_at) <= Date.parse(current.lease_expires_at)) throw new Error("Replay Attempt renewal must extend expiry")
  const result = db.query(`
    UPDATE rd_replay_attempt
    SET status='running', lease_generation=lease_generation+1,
        heartbeat_at=$heartbeat_at, lease_expires_at=$lease_expires_at
    WHERE attempt_id=$attempt_id AND worker_id=$worker_id
      AND lease_generation=$generation AND status IN ('claimed', 'running')
  `).run({
    $attempt_id: input.attempt_id, $worker_id: input.worker_id,
    $generation: input.expected_lease_generation, $heartbeat_at: input.heartbeat_at,
    $lease_expires_at: input.lease_expires_at,
  })
  if (result.changes !== 1) throw new Error("Replay Attempt lease lost during renewal")
  return toLeaseSnapshot(readAttempt(db, input.attempt_id))
}

export function observeCurrentReplayAttemptLease(
  db: Database,
  input: ObserveCurrentReplayAttemptLeaseInput,
): ReplayAttemptLeaseObservationSnapshot {
  requireText(input.trial_id, "trial_id")
  requireUtc(input.observed_at, "observed_at")
  const observe = db.transaction(() => {
    const row = db.query(`
      SELECT * FROM rd_replay_attempt
      WHERE trial_id=$trial_id AND status IN ('claimed', 'running')
    `).get({ $trial_id: input.trial_id }) as AttemptRow | null
    if (!row) throw new Error("Replay Trial has no active Attempt Lease to observe")
    const lease = toLeaseSnapshot(row)
    const observed = Date.parse(input.observed_at)
    if (observed < Date.parse(lease.heartbeat_at) || observed >= Date.parse(lease.lease_expires_at)) {
      throw new Error("Replay Attempt Lease observation must satisfy heartbeat_at <= observed_at < lease_expires_at")
    }
    const leaseHash = hashReplayAttemptLeaseSnapshot(lease)
    const discriminator = `${leaseHash.slice(0, 16)}-${observed}`
    return createReplayAttemptLeaseObservationSnapshot({
      schema_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_SCHEMA_VERSION,
      observation_id: `replay-attempt-lease-observation-${discriminator}`,
      observation_ref: `observation://replay-attempt-lease/${discriminator}`,
      observation_policy_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_POLICY_VERSION,
      status: "active_lease_observed",
      observed_at: input.observed_at,
      authority_owner: "research_control_plane",
      authority_source: "research_control_plane_state_store",
      read_consistency: "single_control_plane_transaction",
      clock_evidence: "caller_supplied_utc_not_external_time_attestation",
      trial_id: lease.trial_id,
      run_id: lease.run_id,
      attempt_id: lease.attempt_id,
      attempt_ordinal: lease.attempt_ordinal,
      worker_id: lease.worker_id,
      lease_generation: lease.lease_generation,
      attempt_lease_hash: leaseHash,
      attempt_lease: lease,
    })
  })
  return observe()
}

export function finalizeReplayAttempt(db: Database, input: FinalizeReplayAttemptInput): void {
  requireText(input.attempt_id, "attempt_id")
  requireText(input.worker_id, "worker_id")
  requireUtc(input.finalized_at, "finalized_at")
  const current = readAttempt(db, input.attempt_id)
  if (current.status === input.status && current.finalized_at === input.finalized_at
      && current.result_hash === (input.result_hash ?? null) && current.artifact_ref === (input.artifact_ref ?? null)
      && current.artifact_hash === (input.artifact_hash ?? null)
      && current.terminal_checkpoint_hash === (input.terminal_checkpoint_hash ?? null)
      && current.diagnostic_checkpoint_ref === (input.diagnostic_checkpoint_ref ?? null)
      && current.diagnostic_checkpoint_hash === (input.diagnostic_checkpoint_hash ?? null)
      && current.failure_class === (input.failure_class ?? null)) return
  if (current.worker_id !== input.worker_id || current.lease_generation !== input.expected_lease_generation) {
    throw new Error("Replay Attempt finalization fencing token mismatch")
  }
  if (current.status !== "claimed" && current.status !== "running") throw new Error("Replay Attempt is already terminal")
  if (Date.parse(input.finalized_at) > Date.parse(current.lease_expires_at)) throw new Error("Replay Attempt lease expired before finalization")
  validateTerminal(input)
  const result = db.query(`
    UPDATE rd_replay_attempt SET
      status=$status, finalized_at=$finalized_at,
      result_hash=$result_hash, artifact_ref=$artifact_ref, artifact_hash=$artifact_hash,
      terminal_checkpoint_hash=$terminal_checkpoint_hash,
      diagnostic_checkpoint_ref=$diagnostic_checkpoint_ref,
      diagnostic_checkpoint_hash=$diagnostic_checkpoint_hash,
      failure_class=$failure_class
    WHERE attempt_id=$attempt_id AND worker_id=$worker_id
      AND lease_generation=$generation AND status IN ('claimed', 'running')
  `).run({
    $status: input.status, $finalized_at: input.finalized_at,
    $result_hash: input.result_hash ?? null, $artifact_ref: input.artifact_ref ?? null,
    $artifact_hash: input.artifact_hash ?? null, $terminal_checkpoint_hash: input.terminal_checkpoint_hash ?? null,
    $diagnostic_checkpoint_ref: input.diagnostic_checkpoint_ref ?? null,
    $diagnostic_checkpoint_hash: input.diagnostic_checkpoint_hash ?? null,
    $failure_class: input.failure_class ?? null, $attempt_id: input.attempt_id,
    $worker_id: input.worker_id, $generation: input.expected_lease_generation,
  })
  if (result.changes !== 1) throw new Error("Replay Attempt lease lost during finalization")
}

function validateTerminal(input: FinalizeReplayAttemptInput): void {
  const checkpointPair = (input.diagnostic_checkpoint_ref == null) === (input.diagnostic_checkpoint_hash == null)
  if (!checkpointPair) throw new Error("diagnostic checkpoint ref/hash must be supplied together")
  if (input.diagnostic_checkpoint_hash) {
    requireText(input.diagnostic_checkpoint_ref, "diagnostic_checkpoint_ref")
    requireHash(input.diagnostic_checkpoint_hash, "diagnostic_checkpoint_hash")
  }
  if (input.status === "completed") {
    requireHash(input.result_hash, "result_hash")
    requireText(input.artifact_ref, "artifact_ref")
    requireHash(input.artifact_hash, "artifact_hash")
    requireHash(input.terminal_checkpoint_hash, "terminal_checkpoint_hash")
    if (input.failure_class || input.diagnostic_checkpoint_ref) throw new Error("completed Replay Attempt cannot carry failure evidence")
  } else {
    if (!input.failure_class) throw new Error("failed or cancelled Replay Attempt requires failure_class")
    if (input.result_hash || input.artifact_ref || input.artifact_hash || input.terminal_checkpoint_hash) {
      throw new Error("non-completed Replay Attempt cannot publish authoritative Result artifacts")
    }
  }
}

function readAttempt(db: Database, attemptId: string): AttemptRow {
  const row = db.query("SELECT * FROM rd_replay_attempt WHERE attempt_id=$attempt_id").get({ $attempt_id: attemptId }) as AttemptRow | null
  if (!row) throw new Error("Replay Attempt does not exist")
  return row
}

function readAttemptByIdempotencyKey(db: Database, key: string): AttemptRow | null {
  return db.query("SELECT * FROM rd_replay_attempt WHERE idempotency_key=$key").get({ $key: key }) as AttemptRow | null
}

function toLeaseSnapshot(row: AttemptRow): ReplayAttemptLeaseSnapshot {
  if (row.status !== "claimed" && row.status !== "running") throw new Error("terminal Replay Attempt has no active lease snapshot")
  const snapshot: ReplayAttemptLeaseSnapshot = {
    schema_version: REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
    attempt_id: row.attempt_id, attempt_ordinal: row.attempt_ordinal, worker_id: row.worker_id,
    trial_id: row.trial_id, run_id: row.run_id, reservation_ref: row.reservation_ref,
    reservation_hash: row.reservation_hash, request_hash: row.request_hash,
    status: row.status, lease_generation: row.lease_generation,
    claimed_at: row.claimed_at, heartbeat_at: row.heartbeat_at, lease_expires_at: row.lease_expires_at,
  }
  assertReplayAttemptLeaseSnapshot(snapshot)
  return snapshot
}

function requireHash(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${field} must be a lowercase sha256 hex digest`)
}

function requireText(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`)
}

function requireUtc(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be an RFC 3339 UTC timestamp`)
  }
}
