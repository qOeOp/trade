import type { Database } from "bun:sqlite"
import {
  canonicalHash,
  canonicalJson,
} from "../../../../../contracts/runtime-core/src/canonical-json"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import {
  assertProjectRuntimePath,
  displayPath,
  repoRoot,
  resolveRepoPath,
} from "../../../../../contracts/runtime-core/src/paths"
import {
  createDeveloperDataSnapshotBinding,
  type DeveloperDataSnapshotBinding,
} from "../../../../../contracts/rd-agent-capability-contract/src/rd-agent-capability-contract"

export const FORMAL_REPLAY_QUEUE_WORK_SCHEMA =
  "trade.rd-formal-replay-queue-work.v1" as const

export type FormalReplayQueueStatus =
  | "accepted"
  | "leased"
  | "completed"
  | "dead_letter"

interface SourceRef {
  ref: string
  sha256: string
}

export interface FormalReplayQueueWork extends JSONRecord {
  schema_version: typeof FORMAL_REPLAY_QUEUE_WORK_SCHEMA
  job_id: string
  idempotency_key: string
  request_registration_id: string
  request_registration_hash: string
  data_snapshot_binding: DeveloperDataSnapshotBinding
  funding_events_source: SourceRef | null
  mark_events_source: SourceRef | null
  supplemental_facts_source: SourceRef | null
  data_bundle_ref: string
  artifact_root: string
  environment_id: string
  replay_worker_id: string
  replay_lease_duration_ms: number
  max_queue_attempts: number
  accepted_at: string
}

export interface FormalReplayQueueRecord {
  work: FormalReplayQueueWork
  work_hash: string
  status: FormalReplayQueueStatus
  lease_owner: string | null
  lease_generation: number
  lease_expires_at: string | null
  attempt_count: number
  updated_at: string
  result: JSONRecord | null
  failure_class: string | null
  last_error: string | null
}

export interface FormalReplayQueueLease extends FormalReplayQueueRecord {
  status: "leased"
  lease_owner: string
  lease_expires_at: string
  resumed: boolean
}

export function ensureFormalReplayJobQueueSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS rd_formal_replay_job (
      job_id            TEXT PRIMARY KEY,
      idempotency_key   TEXT NOT NULL UNIQUE,
      work_hash         TEXT NOT NULL UNIQUE,
      work_json         TEXT NOT NULL CHECK(json_valid(work_json)),
      status            TEXT NOT NULL CHECK(status IN (
        'accepted', 'leased', 'completed', 'dead_letter'
      )),
      active_slot       INTEGER UNIQUE CHECK(active_slot IS NULL OR active_slot=1),
      lease_owner       TEXT,
      lease_generation  INTEGER NOT NULL DEFAULT 0 CHECK(lease_generation >= 0),
      lease_expires_at  TEXT,
      attempt_count     INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
      accepted_at       TEXT NOT NULL,
      updated_at        TEXT NOT NULL,
      result_json       TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
      failure_class     TEXT,
      last_error        TEXT,
      CHECK(
        (status='leased' AND active_slot=1 AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR
        (status!='leased' AND active_slot IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL)
      )
    )
  `)
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_rd_formal_replay_job_status
    ON rd_formal_replay_job(status, accepted_at, job_id)
  `)
  db.run(`
    CREATE TRIGGER IF NOT EXISTS prevent_rd_formal_replay_job_identity_update
    BEFORE UPDATE OF job_id, idempotency_key, work_hash, work_json, accepted_at
    ON rd_formal_replay_job
    BEGIN SELECT RAISE(ABORT, 'formal Replay queue identity is immutable'); END
  `)
  db.run(`
    CREATE TRIGGER IF NOT EXISTS prevent_rd_formal_replay_job_delete
    BEFORE DELETE ON rd_formal_replay_job
    BEGIN SELECT RAISE(ABORT, 'formal Replay queue record is durable'); END
  `)
}

export function admitFormalReplayQueueWork(
  db: Database,
  value: JSONRecord,
): FormalReplayQueueRecord {
  const work = parseFormalReplayQueueWork(value)
  const workHash = canonicalHash(work)
  const existing = readFormalReplayQueueWork(db, work.job_id)
    ?? readByIdempotencyKey(db, work.idempotency_key)
  if (existing) {
    if (existing.work_hash !== workHash
        || canonicalJson(existing.work) !== canonicalJson(work)) {
      throw new Error("formal Replay queue idempotency identity drifted")
    }
    return existing
  }
  db.query(`
    INSERT INTO rd_formal_replay_job(
      job_id, idempotency_key, work_hash, work_json, status,
      accepted_at, updated_at
    ) VALUES (
      $job_id, $idempotency_key, $work_hash, $work_json, 'accepted',
      $accepted_at, $accepted_at
    )
  `).run({
    $job_id: work.job_id,
    $idempotency_key: work.idempotency_key,
    $work_hash: workHash,
    $work_json: canonicalJson(work),
    $accepted_at: work.accepted_at,
  })
  return requireWork(db, work.job_id)
}

export function claimFormalReplayQueueWork(
  db: Database,
  input: {
    worker_id: string
    claimed_at: string
    queue_lease_duration_ms: number
  },
): FormalReplayQueueLease | null {
  const workerId = identifier(input.worker_id, "worker_id")
  const claimedAt = canonicalTime(input.claimed_at, "claimed_at")
  const duration = integer(
    input.queue_lease_duration_ms,
    60_000,
    86_400_000,
    "queue_lease_duration_ms",
  )
  return db.transaction(() => {
    const owned = readOwnedLease(db, workerId)
    if (owned && Date.parse(owned.lease_expires_at!) > Date.parse(claimedAt)) {
      return { ...owned, resumed: true } as FormalReplayQueueLease
    }
    db.query(`
      UPDATE rd_formal_replay_job
      SET status='accepted', active_slot=NULL, lease_owner=NULL,
          lease_expires_at=NULL, updated_at=$claimed_at
      WHERE status='leased' AND lease_expires_at <= $claimed_at
    `).run({ $claimed_at: claimedAt })

    while (true) {
      const row = db.query(`
        SELECT job_id FROM rd_formal_replay_job
        WHERE status='accepted'
        ORDER BY accepted_at ASC, job_id ASC
        LIMIT 1
      `).get() as { job_id: string } | null
      if (!row) return null
      const current = requireWork(db, row.job_id)
      if (current.attempt_count >= current.work.max_queue_attempts) {
        db.query(`
          UPDATE rd_formal_replay_job
          SET status='dead_letter', failure_class='queue_attempts_exhausted',
              last_error=COALESCE(last_error, 'queue attempts exhausted'),
              updated_at=$claimed_at
          WHERE job_id=$job_id AND status='accepted'
        `).run({ $job_id: row.job_id, $claimed_at: claimedAt })
        continue
      }
      if (duration <= current.work.replay_lease_duration_ms) {
        throw new Error("formal Replay queue lease must exceed Replay Attempt lease")
      }
      const leaseExpiresAt = new Date(
        Date.parse(claimedAt) + duration,
      ).toISOString()
      const update = db.query(`
        UPDATE rd_formal_replay_job
        SET status='leased', active_slot=1, lease_owner=$worker_id,
            lease_generation=lease_generation + 1,
            lease_expires_at=$lease_expires_at,
            attempt_count=attempt_count + 1,
            updated_at=$claimed_at, failure_class=NULL
        WHERE job_id=$job_id AND status='accepted'
      `).run({
        $job_id: row.job_id,
        $worker_id: workerId,
        $lease_expires_at: leaseExpiresAt,
        $claimed_at: claimedAt,
      })
      if (update.changes !== 1) {
        throw new Error("formal Replay queue claim compare-and-set failed")
      }
      return {
        ...requireWork(db, row.job_id),
        resumed: false,
      } as FormalReplayQueueLease
    }
  }).immediate()
}

export function completeFormalReplayQueueWork(
  db: Database,
  input: {
    job_id: string
    worker_id: string
    lease_generation: number
    completed_at: string
    result: JSONRecord
  },
): FormalReplayQueueRecord {
  const current = assertCurrentLease(db, input)
  const completedAt = canonicalTime(input.completed_at, "completed_at")
  if (Date.parse(completedAt) > Date.parse(current.lease_expires_at)) {
    throw new Error("formal Replay queue lease expired before completion")
  }
  const result = record(input.result, "result")
  const update = db.query(`
    UPDATE rd_formal_replay_job
    SET status='completed', active_slot=NULL, lease_owner=NULL,
        lease_expires_at=NULL, updated_at=$completed_at,
        result_json=$result_json, failure_class=NULL, last_error=NULL
    WHERE job_id=$job_id AND status='leased'
      AND lease_owner=$worker_id AND lease_generation=$lease_generation
  `).run({
    $job_id: current.work.job_id,
    $worker_id: current.lease_owner,
    $lease_generation: current.lease_generation,
    $completed_at: completedAt,
    $result_json: canonicalJson(result),
  })
  if (update.changes !== 1) {
    throw new Error("formal Replay queue completion lost its fencing lease")
  }
  return requireWork(db, current.work.job_id)
}

export function recordFormalReplayQueueTransientFailure(
  db: Database,
  input: {
    job_id: string
    worker_id: string
    lease_generation: number
    observed_at: string
    failure_class: string
    error: string
  },
): FormalReplayQueueRecord {
  const current = assertCurrentLease(db, input)
  const observedAt = canonicalTime(input.observed_at, "observed_at")
  assertWithinLease(observedAt, current.lease_expires_at)
  db.query(`
    UPDATE rd_formal_replay_job
    SET updated_at=$observed_at, failure_class=$failure_class, last_error=$last_error
    WHERE job_id=$job_id AND status='leased'
      AND lease_owner=$worker_id AND lease_generation=$lease_generation
  `).run({
    $job_id: current.work.job_id,
    $worker_id: current.lease_owner,
    $lease_generation: current.lease_generation,
    $observed_at: observedAt,
    $failure_class: failureText(input.failure_class, "failure_class"),
    $last_error: boundedError(input.error),
  })
  return requireWork(db, current.work.job_id)
}

export function deadLetterFormalReplayQueueWork(
  db: Database,
  input: {
    job_id: string
    worker_id: string
    lease_generation: number
    failed_at: string
    failure_class: string
    error: string
  },
): FormalReplayQueueRecord {
  const current = assertCurrentLease(db, input)
  const failedAt = canonicalTime(input.failed_at, "failed_at")
  assertWithinLease(failedAt, current.lease_expires_at)
  db.query(`
    UPDATE rd_formal_replay_job
    SET status='dead_letter', active_slot=NULL, lease_owner=NULL,
        lease_expires_at=NULL, updated_at=$failed_at,
        failure_class=$failure_class, last_error=$last_error
    WHERE job_id=$job_id AND status='leased'
      AND lease_owner=$worker_id AND lease_generation=$lease_generation
  `).run({
    $job_id: current.work.job_id,
    $worker_id: current.lease_owner,
    $lease_generation: current.lease_generation,
    $failed_at: failedAt,
    $failure_class: failureText(input.failure_class, "failure_class"),
    $last_error: boundedError(input.error),
  })
  return requireWork(db, current.work.job_id)
}

export function readFormalReplayQueueWork(
  db: Database,
  jobIdValue: string,
): FormalReplayQueueRecord | null {
  const jobId = identifier(jobIdValue, "job_id")
  const row = db.query(`
    SELECT * FROM rd_formal_replay_job WHERE job_id=$job_id
  `).get({ $job_id: jobId }) as Record<string, unknown> | null
  return row ? decode(row) : null
}

export function parseFormalReplayQueueWork(
  value: JSONRecord,
): FormalReplayQueueWork {
  const expected = [
    "accepted_at",
    "artifact_root",
    "data_bundle_ref",
    "data_snapshot_binding",
    "environment_id",
    "funding_events_source",
    "idempotency_key",
    "job_id",
    "mark_events_source",
    "max_queue_attempts",
    "replay_lease_duration_ms",
    "replay_worker_id",
    "request_registration_hash",
    "request_registration_id",
    "schema_version",
    "supplemental_facts_source",
  ]
  if (value.schema_version !== FORMAL_REPLAY_QUEUE_WORK_SCHEMA
      || canonicalJson(Object.keys(value).sort()) !== canonicalJson(expected)) {
    throw new Error("formal Replay queue work contract is invalid")
  }
  const binding = createDeveloperDataSnapshotBinding(
    record(
      value.data_snapshot_binding,
      "data_snapshot_binding",
    ) as unknown as DeveloperDataSnapshotBinding,
  )
  if (binding.binding_hash
      !== record(value.data_snapshot_binding, "data_snapshot_binding").binding_hash) {
    throw new Error("formal Replay queue data snapshot binding hash drifted")
  }
  return {
    schema_version: FORMAL_REPLAY_QUEUE_WORK_SCHEMA,
    job_id: identifier(value.job_id, "job_id"),
    idempotency_key: identifier(value.idempotency_key, "idempotency_key"),
    request_registration_id: identifier(
      value.request_registration_id,
      "request_registration_id",
    ),
    request_registration_hash: digest(
      value.request_registration_hash,
      "request_registration_hash",
    ),
    data_snapshot_binding: binding,
    funding_events_source: optionalSource(
      value.funding_events_source,
      "funding_events_source",
    ),
    mark_events_source: optionalSource(
      value.mark_events_source,
      "mark_events_source",
    ),
    supplemental_facts_source: optionalSource(
      value.supplemental_facts_source,
      "supplemental_facts_source",
    ),
    data_bundle_ref: runtimeRef(value.data_bundle_ref, "data_bundle_ref"),
    artifact_root: runtimeRef(value.artifact_root, "artifact_root"),
    environment_id: identifier(value.environment_id, "environment_id"),
    replay_worker_id: identifier(value.replay_worker_id, "replay_worker_id"),
    replay_lease_duration_ms: integer(
      value.replay_lease_duration_ms,
      300_000,
      14_400_000,
      "replay_lease_duration_ms",
    ),
    max_queue_attempts: integer(
      value.max_queue_attempts,
      1,
      10,
      "max_queue_attempts",
    ),
    accepted_at: canonicalTime(value.accepted_at, "accepted_at"),
  }
}

function readOwnedLease(
  db: Database,
  workerId: string,
): FormalReplayQueueRecord | null {
  const row = db.query(`
    SELECT * FROM rd_formal_replay_job
    WHERE status='leased' AND lease_owner=$worker_id
  `).get({ $worker_id: workerId }) as Record<string, unknown> | null
  return row ? decode(row) : null
}

function readByIdempotencyKey(
  db: Database,
  key: string,
): FormalReplayQueueRecord | null {
  const row = db.query(`
    SELECT * FROM rd_formal_replay_job WHERE idempotency_key=$key
  `).get({ $key: key }) as Record<string, unknown> | null
  return row ? decode(row) : null
}

function assertCurrentLease(
  db: Database,
  input: {
    job_id: string
    worker_id: string
    lease_generation: number
  },
): FormalReplayQueueLease {
  const current = requireWork(db, identifier(input.job_id, "job_id"))
  if (current.status !== "leased"
      || current.lease_owner !== identifier(input.worker_id, "worker_id")
      || current.lease_generation !== integer(
        input.lease_generation,
        1,
        Number.MAX_SAFE_INTEGER,
        "lease_generation",
      )
      || !current.lease_expires_at) {
    throw new Error("formal Replay queue fencing lease mismatch")
  }
  return { ...current, resumed: true } as FormalReplayQueueLease
}

function requireWork(db: Database, jobId: string): FormalReplayQueueRecord {
  const value = readFormalReplayQueueWork(db, jobId)
  if (!value) throw new Error("formal Replay queue work is missing")
  return value
}

function decode(row: Record<string, unknown>): FormalReplayQueueRecord {
  return {
    work: parseFormalReplayQueueWork(
      JSON.parse(String(row.work_json)) as JSONRecord,
    ),
    work_hash: digest(row.work_hash, "work_hash"),
    status: queueStatus(row.status),
    lease_owner: row.lease_owner == null
      ? null
      : identifier(row.lease_owner, "lease_owner"),
    lease_generation: integer(
      row.lease_generation,
      0,
      Number.MAX_SAFE_INTEGER,
      "lease_generation",
    ),
    lease_expires_at: row.lease_expires_at == null
      ? null
      : canonicalTime(row.lease_expires_at, "lease_expires_at"),
    attempt_count: integer(
      row.attempt_count,
      0,
      Number.MAX_SAFE_INTEGER,
      "attempt_count",
    ),
    updated_at: canonicalTime(row.updated_at, "updated_at"),
    result: row.result_json == null
      ? null
      : record(JSON.parse(String(row.result_json)), "result_json"),
    failure_class: row.failure_class == null
      ? null
      : failureText(row.failure_class, "failure_class"),
    last_error: row.last_error == null ? null : String(row.last_error),
  }
}

function optionalSource(value: unknown, field: string): SourceRef | null {
  if (value === null) return null
  const source = record(value, field)
  if (canonicalJson(Object.keys(source).sort())
      !== canonicalJson(["ref", "sha256"])) {
    throw new Error(`${field} contract is invalid`)
  }
  return {
    ref: runtimeRef(source.ref, `${field}.ref`),
    sha256: digest(source.sha256, `${field}.sha256`),
  }
}

function runtimeRef(value: unknown, field: string): string {
  const ref = text(value, field)
  assertProjectRuntimePath(ref)
  return displayPath(resolveRepoPath(ref))
}

function queueStatus(value: unknown): FormalReplayQueueStatus {
  if (!["accepted", "leased", "completed", "dead_letter"].includes(String(value))) {
    throw new Error("formal Replay queue status is invalid")
  }
  return String(value) as FormalReplayQueueStatus
}

function record(value: unknown, field: string): JSONRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as JSONRecord
}

function identifier(value: unknown, field: string): string {
  const normalized = text(value, field)
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,191}$/.test(normalized)) {
    throw new Error(`${field} is invalid`)
  }
  return normalized
}

function digest(value: unknown, field: string): string {
  const normalized = text(value, field)
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`${field} must be a lowercase sha256 digest`)
  }
  return normalized
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`)
  }
  return value.trim()
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (!Number.isSafeInteger(value)
      || Number(value) < minimum
      || Number(value) > maximum) {
    throw new Error(`${field} is invalid`)
  }
  return Number(value)
}

function canonicalTime(value: unknown, field: string): string {
  const normalized = text(value, field)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(normalized)
      || !Number.isFinite(Date.parse(normalized))) {
    throw new Error(`${field} must be canonical UTC`)
  }
  return normalized
}

function failureText(value: unknown, field: string): string {
  const normalized = text(value, field)
  if (!/^[a-z][a-z0-9_]{0,95}$/.test(normalized)) {
    throw new Error(`${field} is invalid`)
  }
  return normalized
}

function boundedError(value: unknown): string {
  const normalized = text(value, "error")
  return normalized
    .replaceAll(repoRoot(), ".")
    .slice(0, 2_000)
}

function assertWithinLease(observedAt: string, expiresAt: string): void {
  if (Date.parse(observedAt) > Date.parse(expiresAt)) {
    throw new Error("formal Replay queue lease expired before state update")
  }
}
