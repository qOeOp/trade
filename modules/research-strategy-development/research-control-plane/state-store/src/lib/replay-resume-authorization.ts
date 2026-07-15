import type { Database } from "bun:sqlite"
import {
  REPLAY_RESUME_AUTHORIZATION_SCHEMA_VERSION,
  assertReplayAttemptLeaseSnapshot,
  createReplayResumeAuthorizationSnapshot,
  hashReplayAttemptLeaseSnapshot,
  hashReplayResumeAuthorizationSnapshot,
  type ReplayAttemptLeaseSnapshot,
  type ReplayResumeAuthorizationSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"

export interface IssueReplayResumeAuthorizationInput {
  authorization_id: string
  authorization_ref: string
  issued_at: string
  source_attempt_id: string
  target_attempt_lease: ReplayAttemptLeaseSnapshot
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
  diagnostic_checkpoint_ref: string | null
  diagnostic_checkpoint_hash: string | null
}

interface AuthorizationRow {
  authorization_id: string
  authorization_ref: string
  authorization_hash: string
  issued_at: string
  trial_id: string
  run_id: string
  request_hash: string
  reservation_ref: string
  reservation_hash: string
  source_attempt_id: string
  source_attempt_ordinal: number
  source_attempt_status: "cancelled" | "expired"
  diagnostic_checkpoint_ref: string
  diagnostic_checkpoint_hash: string
  target_attempt_id: string
  target_attempt_ordinal: number
  target_worker_id: string
  target_claimed_at: string
  target_lease_generation_floor: number
  target_attempt_lease_hash: string
}

export function issueReplayResumeAuthorization(
  db: Database,
  input: IssueReplayResumeAuthorizationInput,
): ReplayResumeAuthorizationSnapshot {
  assertReplayAttemptLeaseSnapshot(input.target_attempt_lease)
  requireUtc(input.issued_at, "issued_at")
  const source = readAttempt(db, input.source_attempt_id)
  const target = readAttempt(db, input.target_attempt_lease.attempt_id)
  if (source.status !== "cancelled" && source.status !== "expired") {
    throw new Error("Replay resume source Attempt must be cancelled or expired")
  }
  if (!source.diagnostic_checkpoint_ref || !source.diagnostic_checkpoint_hash) {
    throw new Error("Replay resume source Attempt has no committed diagnostic checkpoint")
  }
  if (target.status !== "claimed" && target.status !== "running") {
    throw new Error("Replay resume target Attempt must be active")
  }
  if (source.trial_id !== target.trial_id || source.run_id !== target.run_id
      || source.request_hash !== target.request_hash
      || source.reservation_ref !== target.reservation_ref
      || source.reservation_hash !== target.reservation_hash) {
    throw new Error("Replay resume Attempts do not share immutable execution authority")
  }
  if (target.attempt_ordinal <= source.attempt_ordinal) {
    throw new Error("Replay resume target Attempt must follow the source Attempt")
  }
  const lease = input.target_attempt_lease
  if (target.worker_id !== lease.worker_id || target.trial_id !== lease.trial_id
      || target.run_id !== lease.run_id || target.attempt_ordinal !== lease.attempt_ordinal
      || target.reservation_ref !== lease.reservation_ref || target.reservation_hash !== lease.reservation_hash
      || target.request_hash !== lease.request_hash || target.lease_generation !== lease.lease_generation
      || target.claimed_at !== lease.claimed_at || target.status !== lease.status) {
    throw new Error("Replay resume target lease does not match Control Plane state")
  }
  const issuedAt = Date.parse(input.issued_at)
  if (issuedAt < Date.parse(lease.claimed_at) || issuedAt >= Date.parse(lease.lease_expires_at)) {
    throw new Error("Replay Resume Authorization must be issued inside the target lease window")
  }
  const snapshot = createReplayResumeAuthorizationSnapshot({
    schema_version: REPLAY_RESUME_AUTHORIZATION_SCHEMA_VERSION,
    authorization_id: input.authorization_id,
    authorization_ref: input.authorization_ref,
    issued_at: input.issued_at,
    status: "authorized",
    trial_id: target.trial_id,
    run_id: target.run_id,
    request_hash: target.request_hash,
    reservation_ref: target.reservation_ref,
    reservation_hash: target.reservation_hash,
    source_attempt_id: source.attempt_id,
    source_attempt_ordinal: source.attempt_ordinal,
    source_attempt_status: source.status,
    diagnostic_checkpoint_ref: source.diagnostic_checkpoint_ref,
    diagnostic_checkpoint_hash: source.diagnostic_checkpoint_hash,
    target_attempt_id: target.attempt_id,
    target_attempt_ordinal: target.attempt_ordinal,
    target_worker_id: target.worker_id,
    target_claimed_at: target.claimed_at,
    target_lease_generation_floor: target.lease_generation,
    target_attempt_lease_hash: hashReplayAttemptLeaseSnapshot(lease),
  })

  const existing = db.query(`
    SELECT * FROM rd_replay_resume_authorization
    WHERE authorization_id=$authorization_id OR authorization_ref=$authorization_ref OR target_attempt_id=$target_attempt_id
  `).get({
    $authorization_id: input.authorization_id,
    $authorization_ref: input.authorization_ref,
    $target_attempt_id: target.attempt_id,
  }) as AuthorizationRow | null
  if (existing) {
    const recorded = toSnapshot(existing)
    if (hashReplayResumeAuthorizationSnapshot(recorded) !== snapshot.authorization_hash) {
      throw new Error("Replay Resume Authorization identity was reused with different authority")
    }
    return recorded
  }

  db.query(`
    INSERT INTO rd_replay_resume_authorization(
      authorization_id, authorization_ref, authorization_hash, issued_at,
      trial_id, run_id, request_hash, reservation_ref, reservation_hash,
      source_attempt_id, source_attempt_ordinal, source_attempt_status,
      diagnostic_checkpoint_ref, diagnostic_checkpoint_hash,
      target_attempt_id, target_attempt_ordinal, target_worker_id, target_claimed_at,
      target_lease_generation_floor, target_attempt_lease_hash
    ) VALUES (
      $authorization_id, $authorization_ref, $authorization_hash, $issued_at,
      $trial_id, $run_id, $request_hash, $reservation_ref, $reservation_hash,
      $source_attempt_id, $source_attempt_ordinal, $source_attempt_status,
      $diagnostic_checkpoint_ref, $diagnostic_checkpoint_hash,
      $target_attempt_id, $target_attempt_ordinal, $target_worker_id, $target_claimed_at,
      $target_lease_generation_floor, $target_attempt_lease_hash
    )
  `).run({
    $authorization_id: snapshot.authorization_id, $authorization_ref: snapshot.authorization_ref,
    $authorization_hash: snapshot.authorization_hash, $issued_at: snapshot.issued_at,
    $trial_id: snapshot.trial_id, $run_id: snapshot.run_id, $request_hash: snapshot.request_hash,
    $reservation_ref: snapshot.reservation_ref, $reservation_hash: snapshot.reservation_hash,
    $source_attempt_id: snapshot.source_attempt_id, $source_attempt_ordinal: snapshot.source_attempt_ordinal,
    $source_attempt_status: snapshot.source_attempt_status,
    $diagnostic_checkpoint_ref: snapshot.diagnostic_checkpoint_ref,
    $diagnostic_checkpoint_hash: snapshot.diagnostic_checkpoint_hash,
    $target_attempt_id: snapshot.target_attempt_id, $target_attempt_ordinal: snapshot.target_attempt_ordinal,
    $target_worker_id: snapshot.target_worker_id, $target_claimed_at: snapshot.target_claimed_at,
    $target_lease_generation_floor: snapshot.target_lease_generation_floor,
    $target_attempt_lease_hash: snapshot.target_attempt_lease_hash,
  })
  return snapshot
}

function readAttempt(db: Database, attemptId: string): AttemptAuthorityRow {
  const row = db.query(`
    SELECT attempt_id, trial_id, run_id, attempt_ordinal, worker_id,
           reservation_ref, reservation_hash, request_hash, status,
           lease_generation, claimed_at, diagnostic_checkpoint_ref, diagnostic_checkpoint_hash
    FROM rd_replay_attempt WHERE attempt_id=$attempt_id
  `).get({ $attempt_id: attemptId }) as AttemptAuthorityRow | null
  if (!row) throw new Error("Replay Resume Authorization references a missing Attempt")
  return row
}

function toSnapshot(row: AuthorizationRow): ReplayResumeAuthorizationSnapshot {
  return {
    schema_version: REPLAY_RESUME_AUTHORIZATION_SCHEMA_VERSION,
    authorization_id: row.authorization_id, authorization_ref: row.authorization_ref,
    authorization_hash: row.authorization_hash, issued_at: row.issued_at, status: "authorized",
    trial_id: row.trial_id, run_id: row.run_id, request_hash: row.request_hash,
    reservation_ref: row.reservation_ref, reservation_hash: row.reservation_hash,
    source_attempt_id: row.source_attempt_id, source_attempt_ordinal: row.source_attempt_ordinal,
    source_attempt_status: row.source_attempt_status,
    diagnostic_checkpoint_ref: row.diagnostic_checkpoint_ref,
    diagnostic_checkpoint_hash: row.diagnostic_checkpoint_hash,
    target_attempt_id: row.target_attempt_id, target_attempt_ordinal: row.target_attempt_ordinal,
    target_worker_id: row.target_worker_id, target_claimed_at: row.target_claimed_at,
    target_lease_generation_floor: row.target_lease_generation_floor,
    target_attempt_lease_hash: row.target_attempt_lease_hash,
  }
}

function requireUtc(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be an RFC 3339 UTC timestamp`)
  }
}
