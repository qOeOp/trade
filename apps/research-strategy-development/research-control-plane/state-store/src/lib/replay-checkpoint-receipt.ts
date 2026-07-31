import type { Database } from "bun:sqlite"
import {
  REPLAY_CHECKPOINT_RECEIPT_SCHEMA_VERSION,
  REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION,
  assertReplayAttemptLeaseSnapshot,
  createReplayCheckpointReceiptSnapshot,
  hashReplayAttemptLeaseSnapshot,
  hashReplayCheckpointReceiptSnapshot,
  type ReplayAttemptLeaseSnapshot,
  type ReplayCheckpointReceiptSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"

export interface ReplayDiagnosticCheckpointDescriptor {
  ref: string
  sha256: string
  checkpoint_ref: string
  checkpoint_sha256: string
  checkpoint_hash: string
  producer_attempt_id: string
  producer_lease_generation: number
  storage_policy_version: typeof REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION
  next_source_offset: number
}

export interface RecordReplayCheckpointReceiptInput {
  receipt_id: string
  receipt_ref: string
  recorded_at: string
  attempt_lease: ReplayAttemptLeaseSnapshot
  diagnostic_checkpoint_commit: ReplayDiagnosticCheckpointDescriptor
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
}

interface ReceiptRow {
  receipt_id: string
  receipt_ref: string
  receipt_hash: string
  recorded_at: string
  trial_id: string
  run_id: string
  request_hash: string
  reservation_ref: string
  reservation_hash: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  attempt_lease_hash: string
  diagnostic_checkpoint_ref: string
  diagnostic_checkpoint_hash: string
  engine_checkpoint_ref: string
  engine_checkpoint_payload_hash: string
  engine_checkpoint_hash: string
  storage_policy_version: typeof REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION
  next_source_offset: number
}

export function recordReplayCheckpointReceipt(
  db: Database,
  input: RecordReplayCheckpointReceiptInput,
): ReplayCheckpointReceiptSnapshot {
  assertReplayAttemptLeaseSnapshot(input.attempt_lease)
  requireText(input.receipt_id, "receipt_id")
  requireText(input.receipt_ref, "receipt_ref")
  requireUtc(input.recorded_at, "recorded_at")
  validateDescriptor(input.diagnostic_checkpoint_commit)
  const lease = input.attempt_lease
  const commit = input.diagnostic_checkpoint_commit
  const recordedAt = Date.parse(input.recorded_at)
  if (recordedAt < Date.parse(lease.heartbeat_at) || recordedAt >= Date.parse(lease.lease_expires_at)) {
    throw new Error("Replay Checkpoint Receipt must be recorded inside the active lease window")
  }
  if (commit.producer_attempt_id !== lease.attempt_id
      || commit.producer_lease_generation !== lease.lease_generation) {
    throw new Error("Replay diagnostic checkpoint producer does not match the fenced Attempt lease")
  }
  const snapshot = createReplayCheckpointReceiptSnapshot({
    schema_version: REPLAY_CHECKPOINT_RECEIPT_SCHEMA_VERSION,
    receipt_id: input.receipt_id,
    receipt_ref: input.receipt_ref,
    recorded_at: input.recorded_at,
    status: "recorded",
    trial_id: lease.trial_id,
    run_id: lease.run_id,
    request_hash: lease.request_hash,
    reservation_ref: lease.reservation_ref,
    reservation_hash: lease.reservation_hash,
    attempt_id: lease.attempt_id,
    attempt_ordinal: lease.attempt_ordinal,
    worker_id: lease.worker_id,
    lease_generation: lease.lease_generation,
    attempt_lease_hash: hashReplayAttemptLeaseSnapshot(lease),
    diagnostic_checkpoint_ref: commit.ref,
    diagnostic_checkpoint_hash: commit.sha256,
    engine_checkpoint_ref: commit.checkpoint_ref,
    engine_checkpoint_payload_hash: commit.checkpoint_sha256,
    engine_checkpoint_hash: commit.checkpoint_hash,
    storage_policy_version: commit.storage_policy_version,
    next_source_offset: commit.next_source_offset,
  })

  const record = db.transaction(() => {
    const existing = db.query(`
      SELECT * FROM rd_replay_checkpoint_receipt
      WHERE receipt_id=$receipt_id OR receipt_ref=$receipt_ref
         OR (attempt_id=$attempt_id AND next_source_offset=$next_source_offset)
    `).get({
      $receipt_id: input.receipt_id,
      $receipt_ref: input.receipt_ref,
      $attempt_id: lease.attempt_id,
      $next_source_offset: commit.next_source_offset,
    }) as ReceiptRow | null
    if (existing) {
      const recorded = toSnapshot(existing)
      if (hashReplayCheckpointReceiptSnapshot(recorded) !== snapshot.receipt_hash) {
        throw new Error("Replay Checkpoint Receipt identity or progress was reused with different evidence")
      }
      return recorded
    }
    const attempt = readAttempt(db, lease.attempt_id)
    if (attempt.status !== "claimed" && attempt.status !== "running") {
      throw new Error("Replay Checkpoint Receipt requires an active Attempt")
    }
    if (attempt.attempt_id !== lease.attempt_id || attempt.attempt_ordinal !== lease.attempt_ordinal
        || attempt.worker_id !== lease.worker_id || attempt.trial_id !== lease.trial_id
        || attempt.run_id !== lease.run_id || attempt.reservation_ref !== lease.reservation_ref
        || attempt.reservation_hash !== lease.reservation_hash || attempt.request_hash !== lease.request_hash
        || attempt.status !== lease.status || attempt.lease_generation !== lease.lease_generation
        || attempt.claimed_at !== lease.claimed_at || attempt.heartbeat_at !== lease.heartbeat_at
        || attempt.lease_expires_at !== lease.lease_expires_at) {
      throw new Error("Replay Checkpoint Receipt lease does not match Control Plane state")
    }
    const latestOffset = (db.query(`
      SELECT COALESCE(MAX(next_source_offset), 0) AS value
      FROM rd_replay_checkpoint_receipt WHERE attempt_id=$attempt_id
    `).get({ $attempt_id: lease.attempt_id }) as { value: number }).value
    if (commit.next_source_offset <= latestOffset) {
      throw new Error("Replay Checkpoint Receipt progress must advance monotonically")
    }
    db.query(`
      INSERT INTO rd_replay_checkpoint_receipt(
        receipt_id, receipt_ref, receipt_hash, recorded_at,
        trial_id, run_id, request_hash, reservation_ref, reservation_hash,
        attempt_id, attempt_ordinal, worker_id, lease_generation, attempt_lease_hash,
        diagnostic_checkpoint_ref, diagnostic_checkpoint_hash,
        engine_checkpoint_ref, engine_checkpoint_payload_hash, engine_checkpoint_hash, storage_policy_version,
        next_source_offset
      ) VALUES (
        $receipt_id, $receipt_ref, $receipt_hash, $recorded_at,
        $trial_id, $run_id, $request_hash, $reservation_ref, $reservation_hash,
        $attempt_id, $attempt_ordinal, $worker_id, $lease_generation, $attempt_lease_hash,
        $diagnostic_checkpoint_ref, $diagnostic_checkpoint_hash,
        $engine_checkpoint_ref, $engine_checkpoint_payload_hash, $engine_checkpoint_hash, $storage_policy_version,
        $next_source_offset
      )
    `).run({
      $receipt_id: snapshot.receipt_id, $receipt_ref: snapshot.receipt_ref,
      $receipt_hash: snapshot.receipt_hash, $recorded_at: snapshot.recorded_at,
      $trial_id: snapshot.trial_id, $run_id: snapshot.run_id,
      $request_hash: snapshot.request_hash, $reservation_ref: snapshot.reservation_ref,
      $reservation_hash: snapshot.reservation_hash, $attempt_id: snapshot.attempt_id,
      $attempt_ordinal: snapshot.attempt_ordinal, $worker_id: snapshot.worker_id,
      $lease_generation: snapshot.lease_generation, $attempt_lease_hash: snapshot.attempt_lease_hash,
      $diagnostic_checkpoint_ref: snapshot.diagnostic_checkpoint_ref,
      $diagnostic_checkpoint_hash: snapshot.diagnostic_checkpoint_hash,
      $engine_checkpoint_ref: snapshot.engine_checkpoint_ref,
      $engine_checkpoint_payload_hash: snapshot.engine_checkpoint_payload_hash,
      $engine_checkpoint_hash: snapshot.engine_checkpoint_hash,
      $storage_policy_version: snapshot.storage_policy_version,
      $next_source_offset: snapshot.next_source_offset,
    })
    return snapshot
  })
  return record()
}

function validateDescriptor(value: ReplayDiagnosticCheckpointDescriptor): void {
  requireText(value.ref, "diagnostic_checkpoint_commit.ref")
  requireHash(value.sha256, "diagnostic_checkpoint_commit.sha256")
  requireText(value.checkpoint_ref, "diagnostic_checkpoint_commit.checkpoint_ref")
  requireHash(value.checkpoint_sha256, "diagnostic_checkpoint_commit.checkpoint_sha256")
  requireHash(value.checkpoint_hash, "diagnostic_checkpoint_commit.checkpoint_hash")
  requireText(value.producer_attempt_id, "diagnostic_checkpoint_commit.producer_attempt_id")
  if (value.storage_policy_version !== REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION) {
    throw new Error("diagnostic_checkpoint_commit.storage_policy_version is not supported")
  }
  if (!Number.isSafeInteger(value.producer_lease_generation) || value.producer_lease_generation < 1) {
    throw new Error("diagnostic_checkpoint_commit.producer_lease_generation must be positive")
  }
  if (!Number.isSafeInteger(value.next_source_offset) || value.next_source_offset < 1) {
    throw new Error("diagnostic_checkpoint_commit.next_source_offset must be positive")
  }
}

function readAttempt(db: Database, attemptId: string): AttemptRow {
  const row = db.query(`
    SELECT attempt_id, trial_id, run_id, attempt_ordinal, worker_id,
           reservation_ref, reservation_hash, request_hash, status,
           lease_generation, claimed_at, heartbeat_at, lease_expires_at
    FROM rd_replay_attempt WHERE attempt_id=$attempt_id
  `).get({ $attempt_id: attemptId }) as AttemptRow | null
  if (!row) throw new Error("Replay Checkpoint Receipt references a missing Attempt")
  return row
}

function toSnapshot(row: ReceiptRow): ReplayCheckpointReceiptSnapshot {
  return {
    schema_version: REPLAY_CHECKPOINT_RECEIPT_SCHEMA_VERSION,
    receipt_id: row.receipt_id, receipt_ref: row.receipt_ref,
    receipt_hash: row.receipt_hash, recorded_at: row.recorded_at, status: "recorded",
    trial_id: row.trial_id, run_id: row.run_id, request_hash: row.request_hash,
    reservation_ref: row.reservation_ref, reservation_hash: row.reservation_hash,
    attempt_id: row.attempt_id, attempt_ordinal: row.attempt_ordinal,
    worker_id: row.worker_id, lease_generation: row.lease_generation,
    attempt_lease_hash: row.attempt_lease_hash,
    diagnostic_checkpoint_ref: row.diagnostic_checkpoint_ref,
    diagnostic_checkpoint_hash: row.diagnostic_checkpoint_hash,
    engine_checkpoint_ref: row.engine_checkpoint_ref,
    engine_checkpoint_payload_hash: row.engine_checkpoint_payload_hash,
    engine_checkpoint_hash: row.engine_checkpoint_hash,
    storage_policy_version: row.storage_policy_version,
    next_source_offset: row.next_source_offset,
  }
}

function requireHash(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${field} must be a lowercase sha256 hex digest`)
  }
}

function requireText(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`)
}

function requireUtc(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be an RFC 3339 UTC timestamp`)
  }
}
