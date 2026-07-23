import type { Database } from "bun:sqlite"
import { canonicalHash, canonicalJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"

export const REVIEWER_AGENT_JOB_SCHEMA =
  "trade.rd-reviewer-agent-job.v1" as const

export type ReviewerAgentJobStatus =
  | "accepted"
  | "leased"
  | "completed"
  | "dead_letter"

export interface ReviewerAgentJob {
  schema_version: typeof REVIEWER_AGENT_JOB_SCHEMA
  job_id: string
  source_replay_job_id: string
  source_replay_work_hash: string
  result_id: string
  experiment_id: string
  stage_id: string
  status: ReviewerAgentJobStatus
  lease_owner: string | null
  lease_generation: number
  lease_expires_at: string | null
  run_requested_at: string | null
  run_deadline_at: string | null
  attempt_count: number
  accepted_at: string
  updated_at: string
  completion: JSONRecord | null
  failure_class: string | null
  last_error: string | null
}

export interface ReviewerAgentJobLease extends ReviewerAgentJob {
  status: "leased"
  lease_owner: string
  lease_expires_at: string
  run_requested_at: string
  run_deadline_at: string
  resumed: boolean
}

export function ensureReviewerAgentJobQueueSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS rd_reviewer_agent_job (
      job_id                  TEXT PRIMARY KEY,
      source_replay_job_id    TEXT NOT NULL UNIQUE,
      source_replay_work_hash TEXT NOT NULL,
      result_id               TEXT NOT NULL UNIQUE,
      experiment_id           TEXT NOT NULL,
      stage_id                TEXT NOT NULL,
      status                  TEXT NOT NULL CHECK(status IN (
        'accepted', 'leased', 'completed', 'dead_letter'
      )),
      active_slot             INTEGER UNIQUE CHECK(active_slot IS NULL OR active_slot=1),
      lease_owner             TEXT,
      lease_generation        INTEGER NOT NULL DEFAULT 0 CHECK(lease_generation >= 0),
      lease_expires_at        TEXT,
      run_requested_at        TEXT,
      run_deadline_at         TEXT,
      attempt_count           INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
      accepted_at             TEXT NOT NULL,
      updated_at              TEXT NOT NULL,
      completion_json         TEXT CHECK(completion_json IS NULL OR json_valid(completion_json)),
      failure_class           TEXT,
      last_error              TEXT,
      FOREIGN KEY (source_replay_job_id) REFERENCES rd_formal_replay_job(job_id),
      FOREIGN KEY (result_id) REFERENCES rd_experiment_result(result_id),
      CHECK(
        (status='leased' AND active_slot=1 AND lease_owner IS NOT NULL
          AND lease_expires_at IS NOT NULL AND run_requested_at IS NOT NULL
          AND run_deadline_at IS NOT NULL)
        OR
        (status!='leased' AND active_slot IS NULL AND lease_owner IS NULL
          AND lease_expires_at IS NULL AND run_requested_at IS NULL
          AND run_deadline_at IS NULL)
      )
    )
  `)
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_rd_reviewer_agent_job_status
    ON rd_reviewer_agent_job(status, accepted_at, job_id)
  `)
  db.run(`
    CREATE TRIGGER IF NOT EXISTS prevent_rd_reviewer_agent_job_identity_update
    BEFORE UPDATE OF job_id, source_replay_job_id, source_replay_work_hash,
      result_id, experiment_id, stage_id, accepted_at
    ON rd_reviewer_agent_job
    BEGIN SELECT RAISE(ABORT, 'Reviewer Agent job identity is immutable'); END
  `)
  db.run(`
    CREATE TRIGGER IF NOT EXISTS prevent_rd_reviewer_agent_job_delete
    BEFORE DELETE ON rd_reviewer_agent_job
    BEGIN SELECT RAISE(ABORT, 'Reviewer Agent job is durable'); END
  `)
}

export function reconcileCompletedReplayReviewerJobs(
  db: Database,
  observedAtValue: string,
): ReviewerAgentJob[] {
  const observedAt = canonicalTime(observedAtValue, "observed_at")
  return db.transaction(() => {
    const sources = db.query(`
      SELECT queue.job_id AS source_replay_job_id,
             queue.work_hash AS source_replay_work_hash,
             json_extract(queue.result_json, '$.result_id') AS result_id,
             result.experiment_id, result.stage_id
      FROM rd_formal_replay_job AS queue
      JOIN rd_experiment_result AS result
        ON result.result_id=json_extract(queue.result_json, '$.result_id')
      JOIN rd_evaluation_evidence_classification AS classification
        ON classification.result_id=result.result_id
      LEFT JOIN rd_reviewer_agent_job AS reviewer
        ON reviewer.source_replay_job_id=queue.job_id
      WHERE queue.status='completed'
        AND json_extract(queue.result_json, '$.status')='completed'
        AND json_extract(queue.result_json, '$.review_authority')='classified_result_only'
        AND classification.evidence_kind='mechanical_replay'
        AND classification.producer='replay_owner'
        AND reviewer.job_id IS NULL
      ORDER BY queue.accepted_at, queue.job_id
    `).all() as Array<{
      source_replay_job_id: string
      source_replay_work_hash: string
      result_id: string
      experiment_id: string
      stage_id: string
    }>
    for (const source of sources) {
      const jobId = `reviewer-job:${canonicalHash({
        schema_version: REVIEWER_AGENT_JOB_SCHEMA,
        source_replay_job_id: source.source_replay_job_id,
        source_replay_work_hash: source.source_replay_work_hash,
        result_id: source.result_id,
      }).slice(0, 32)}`
      const priorDecision = db.query(`
        SELECT decision.decision_id, decision.decision, decision.reviewer_run_id
        FROM rd_review_decision_result AS binding
        JOIN rd_review_decision AS decision
          ON decision.decision_id=binding.decision_id
        WHERE binding.result_id=$result_id
        ORDER BY decision.created_at, decision.decision_id
        LIMIT 1
      `).get({ $result_id: source.result_id }) as {
        decision_id: string
        decision: string
        reviewer_run_id: string
      } | null
      const completion = priorDecision
        ? {
            schema_version: "trade.rd-reviewer-agent-job-completion.v1",
            disposition: "already_reviewed",
            decision_id: priorDecision.decision_id,
            decision: priorDecision.decision,
            reviewer_run_id: priorDecision.reviewer_run_id,
          }
        : null
      db.query(`
        INSERT INTO rd_reviewer_agent_job(
          job_id, source_replay_job_id, source_replay_work_hash,
          result_id, experiment_id, stage_id, status,
          accepted_at, updated_at, completion_json
        ) VALUES (
          $job_id, $source_replay_job_id, $source_replay_work_hash,
          $result_id, $experiment_id, $stage_id, $status,
          $accepted_at, $accepted_at, $completion_json
        )
      `).run({
        $job_id: jobId,
        $source_replay_job_id: source.source_replay_job_id,
        $source_replay_work_hash: source.source_replay_work_hash,
        $result_id: source.result_id,
        $experiment_id: source.experiment_id,
        $stage_id: source.stage_id,
        $status: priorDecision ? "completed" : "accepted",
        $accepted_at: observedAt,
        $completion_json: completion ? canonicalJson(completion) : null,
      })
    }
    return sources.map((source) => requireJobByReplay(db, source.source_replay_job_id))
  }).immediate()
}

export function claimReviewerAgentJob(
  db: Database,
  input: {
    worker_id: string
    claimed_at: string
    lease_duration_ms: number
    run_duration_ms: number
    max_attempts: number
  },
): ReviewerAgentJobLease | null {
  const workerId = identifier(input.worker_id, "worker_id")
  const claimedAt = canonicalTime(input.claimed_at, "claimed_at")
  const leaseDuration = integer(input.lease_duration_ms, 60_000, 86_400_000, "lease_duration_ms")
  const runDuration = integer(input.run_duration_ms, 60_000, 3_600_000, "run_duration_ms")
  const maxAttempts = integer(input.max_attempts, 1, 100, "max_attempts")
  if (leaseDuration <= runDuration) {
    throw new Error("Reviewer Agent job lease must exceed Agent Run duration")
  }
  return db.transaction(() => {
    const owned = readOwnedLease(db, workerId)
    if (owned && Date.parse(owned.lease_expires_at!) > Date.parse(claimedAt)) {
      return { ...owned, resumed: true } as ReviewerAgentJobLease
    }
    db.query(`
      UPDATE rd_reviewer_agent_job
      SET status='accepted', active_slot=NULL, lease_owner=NULL,
          lease_expires_at=NULL, run_requested_at=NULL, run_deadline_at=NULL,
          updated_at=$claimed_at
      WHERE status='leased' AND lease_expires_at <= $claimed_at
    `).run({ $claimed_at: claimedAt })
    while (true) {
      const row = db.query(`
        SELECT job_id FROM rd_reviewer_agent_job
        WHERE status='accepted'
        ORDER BY accepted_at, job_id
        LIMIT 1
      `).get() as { job_id: string } | null
      if (!row) return null
      const current = requireReviewerAgentJob(db, row.job_id)
      if (current.attempt_count >= maxAttempts) {
        db.query(`
          UPDATE rd_reviewer_agent_job
          SET status='dead_letter', failure_class='agent_attempts_exhausted',
              last_error=COALESCE(last_error, 'Reviewer Agent attempts exhausted'),
              updated_at=$claimed_at
          WHERE job_id=$job_id AND status='accepted'
        `).run({ $job_id: row.job_id, $claimed_at: claimedAt })
        continue
      }
      const leaseExpiresAt = addMilliseconds(claimedAt, leaseDuration)
      const runDeadlineAt = addMilliseconds(claimedAt, runDuration)
      const update = db.query(`
        UPDATE rd_reviewer_agent_job
        SET status='leased', active_slot=1, lease_owner=$worker_id,
            lease_generation=lease_generation + 1,
            lease_expires_at=$lease_expires_at,
            run_requested_at=$claimed_at, run_deadline_at=$run_deadline_at,
            attempt_count=attempt_count + 1, updated_at=$claimed_at,
            failure_class=NULL
        WHERE job_id=$job_id AND status='accepted'
      `).run({
        $job_id: row.job_id,
        $worker_id: workerId,
        $lease_expires_at: leaseExpiresAt,
        $run_deadline_at: runDeadlineAt,
        $claimed_at: claimedAt,
      })
      if (update.changes !== 1) {
        throw new Error("Reviewer Agent job claim compare-and-set failed")
      }
      return {
        ...requireReviewerAgentJob(db, row.job_id),
        resumed: false,
      } as ReviewerAgentJobLease
    }
  }).immediate()
}

export function completeReviewerAgentJob(
  db: Database,
  input: {
    job_id: string
    worker_id: string
    lease_generation: number
    completed_at: string
    completion: JSONRecord
  },
): ReviewerAgentJob {
  const current = assertCurrentLease(db, input)
  const completedAt = canonicalTime(input.completed_at, "completed_at")
  assertWithinLease(completedAt, current.lease_expires_at)
  const completion = record(input.completion, "completion")
  const update = db.query(`
    UPDATE rd_reviewer_agent_job
    SET status='completed', active_slot=NULL, lease_owner=NULL,
        lease_expires_at=NULL, run_requested_at=NULL, run_deadline_at=NULL,
        updated_at=$completed_at, completion_json=$completion_json,
        failure_class=NULL, last_error=NULL
    WHERE job_id=$job_id AND status='leased'
      AND lease_owner=$worker_id AND lease_generation=$lease_generation
  `).run({
    $job_id: current.job_id,
    $worker_id: current.lease_owner,
    $lease_generation: current.lease_generation,
    $completed_at: completedAt,
    $completion_json: canonicalJson(completion),
  })
  if (update.changes !== 1) throw new Error("Reviewer Agent job completion lost its fencing lease")
  return requireReviewerAgentJob(db, current.job_id)
}

export function recordReviewerAgentJobFailure(
  db: Database,
  input: {
    job_id: string
    worker_id: string
    lease_generation: number
    observed_at: string
    failure_class: string
    error: string
    permanent: boolean
  },
): ReviewerAgentJob {
  const current = assertCurrentLease(db, input)
  const observedAt = canonicalTime(input.observed_at, "observed_at")
  assertWithinLease(observedAt, current.lease_expires_at)
  db.query(input.permanent ? `
    UPDATE rd_reviewer_agent_job
    SET status='dead_letter', active_slot=NULL, lease_owner=NULL,
        lease_expires_at=NULL, run_requested_at=NULL, run_deadline_at=NULL,
        updated_at=$observed_at, failure_class=$failure_class, last_error=$last_error
    WHERE job_id=$job_id AND status='leased'
      AND lease_owner=$worker_id AND lease_generation=$lease_generation
  ` : `
    UPDATE rd_reviewer_agent_job
    SET updated_at=$observed_at, failure_class=$failure_class, last_error=$last_error
    WHERE job_id=$job_id AND status='leased'
      AND lease_owner=$worker_id AND lease_generation=$lease_generation
  `).run({
    $job_id: current.job_id,
    $worker_id: current.lease_owner,
    $lease_generation: current.lease_generation,
    $observed_at: observedAt,
    $failure_class: boundedText(input.failure_class, "failure_class", 100),
    $last_error: boundedError(input.error),
  })
  return requireReviewerAgentJob(db, current.job_id)
}

export function retryReviewerAgentJobWithNewRun(
  db: Database,
  input: {
    job_id: string
    worker_id: string
    lease_generation: number
    observed_at: string
    failure_class: string
    error: string
  },
): ReviewerAgentJob {
  const current = assertCurrentLease(db, input)
  const observedAt = canonicalTime(input.observed_at, "observed_at")
  assertWithinLease(observedAt, current.lease_expires_at)
  const update = db.query(`
    UPDATE rd_reviewer_agent_job
    SET status='accepted', active_slot=NULL, lease_owner=NULL,
        lease_expires_at=NULL, run_requested_at=NULL, run_deadline_at=NULL,
        updated_at=$observed_at, failure_class=$failure_class, last_error=$last_error
    WHERE job_id=$job_id AND status='leased'
      AND lease_owner=$worker_id AND lease_generation=$lease_generation
  `).run({
    $job_id: current.job_id,
    $worker_id: current.lease_owner,
    $lease_generation: current.lease_generation,
    $observed_at: observedAt,
    $failure_class: boundedText(input.failure_class, "failure_class", 100),
    $last_error: boundedError(input.error),
  })
  if (update.changes !== 1) throw new Error("Reviewer Agent job retry lost its fencing lease")
  return requireReviewerAgentJob(db, current.job_id)
}

export function readReviewerAgentJob(
  db: Database,
  jobIdValue: string,
): ReviewerAgentJob | null {
  const jobId = identifier(jobIdValue, "job_id")
  const row = db.query(`
    SELECT * FROM rd_reviewer_agent_job WHERE job_id=$job_id
  `).get({ $job_id: jobId }) as Record<string, unknown> | null
  return row ? decode(row) : null
}

function readOwnedLease(db: Database, workerId: string): ReviewerAgentJob | null {
  const row = db.query(`
    SELECT * FROM rd_reviewer_agent_job
    WHERE status='leased' AND lease_owner=$worker_id
  `).get({ $worker_id: workerId }) as Record<string, unknown> | null
  return row ? decode(row) : null
}

function requireJobByReplay(db: Database, sourceReplayJobId: string): ReviewerAgentJob {
  const row = db.query(`
    SELECT * FROM rd_reviewer_agent_job
    WHERE source_replay_job_id=$source_replay_job_id
  `).get({ $source_replay_job_id: sourceReplayJobId }) as Record<string, unknown> | null
  if (!row) throw new Error("Reviewer Agent job reconciliation failed")
  return decode(row)
}

function requireReviewerAgentJob(db: Database, jobId: string): ReviewerAgentJob {
  const job = readReviewerAgentJob(db, jobId)
  if (!job) throw new Error("Reviewer Agent job is missing")
  return job
}

function assertCurrentLease(
  db: Database,
  input: { job_id: string; worker_id: string; lease_generation: number },
): ReviewerAgentJobLease {
  const job = requireReviewerAgentJob(db, input.job_id)
  if (job.status !== "leased"
      || job.lease_owner !== identifier(input.worker_id, "worker_id")
      || job.lease_generation !== integer(input.lease_generation, 1, Number.MAX_SAFE_INTEGER, "lease_generation")
      || !job.lease_expires_at
      || !job.run_requested_at
      || !job.run_deadline_at) {
    throw new Error("Reviewer Agent job fencing lease is not current")
  }
  return { ...job, resumed: false } as ReviewerAgentJobLease
}

function decode(row: Record<string, unknown>): ReviewerAgentJob {
  return {
    schema_version: REVIEWER_AGENT_JOB_SCHEMA,
    job_id: String(row.job_id),
    source_replay_job_id: String(row.source_replay_job_id),
    source_replay_work_hash: String(row.source_replay_work_hash),
    result_id: String(row.result_id),
    experiment_id: String(row.experiment_id),
    stage_id: String(row.stage_id),
    status: String(row.status) as ReviewerAgentJobStatus,
    lease_owner: row.lease_owner == null ? null : String(row.lease_owner),
    lease_generation: Number(row.lease_generation),
    lease_expires_at: row.lease_expires_at == null ? null : String(row.lease_expires_at),
    run_requested_at: row.run_requested_at == null ? null : String(row.run_requested_at),
    run_deadline_at: row.run_deadline_at == null ? null : String(row.run_deadline_at),
    attempt_count: Number(row.attempt_count),
    accepted_at: String(row.accepted_at),
    updated_at: String(row.updated_at),
    completion: row.completion_json == null
      ? null
      : JSON.parse(String(row.completion_json)) as JSONRecord,
    failure_class: row.failure_class == null ? null : String(row.failure_class),
    last_error: row.last_error == null ? null : String(row.last_error),
  }
}

function addMilliseconds(value: string, milliseconds: number): string {
  return new Date(Date.parse(value) + milliseconds).toISOString()
}

function assertWithinLease(observedAt: string, leaseExpiresAt: string): void {
  if (Date.parse(observedAt) > Date.parse(leaseExpiresAt)) {
    throw new Error("Reviewer Agent job lease expired")
  }
}

function record(value: unknown, field: string): JSONRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as JSONRecord
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function integer(value: unknown, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${field} is invalid`)
  }
  return Number(value)
}

function canonicalTime(value: string, field: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC`)
  }
  return value
}

function boundedText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function boundedError(value: string): string {
  const clean = value.replaceAll(process.cwd(), "<repo>")
  return clean.length <= 4_000 ? clean : `${clean.slice(0, 4_000)}…`
}
