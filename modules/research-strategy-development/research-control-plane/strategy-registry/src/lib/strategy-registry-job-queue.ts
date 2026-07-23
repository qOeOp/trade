import type { Database } from "bun:sqlite"

export interface StrategyRegistryJobLease {
  job_id: string
  decision_id: string
  lease_generation: number
}

export function ensureStrategyRegistryJobQueueSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rd_strategy_registry_job (
      job_id TEXT PRIMARY KEY,
      decision_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK(status IN (
        'pending', 'processing', 'completed', 'dead_letter'
      )),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
      lease_owner TEXT,
      lease_generation INTEGER NOT NULL DEFAULT 0 CHECK(lease_generation >= 0),
      lease_expires_at TEXT,
      draft_id TEXT,
      strategy_ref TEXT,
      strategy_policy_hash TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (decision_id) REFERENCES rd_review_decision(decision_id),
      CHECK(
        (status = 'processing' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR
        (status != 'processing' AND lease_owner IS NULL AND lease_expires_at IS NULL)
      )
    );
    CREATE INDEX IF NOT EXISTS idx_rd_strategy_registry_job_claim
      ON rd_strategy_registry_job(status, created_at, job_id);
  `)
}

export function reconcileAcceptedDraftJobs(
  db: Database,
  observedAt: string,
): number {
  ensureStrategyRegistryJobQueueSchema(db)
  return db.query(`
    INSERT INTO rd_strategy_registry_job(
      job_id, decision_id, status, created_at, updated_at
    )
    SELECT 'registry:' || decision.decision_id, decision.decision_id,
           'pending', decision.created_at, $observed_at
    FROM rd_review_decision AS decision
    WHERE decision.decision='accept_for_draft'
    ON CONFLICT(decision_id) DO NOTHING
  `).run({ $observed_at: observedAt }).changes
}

export function claimStrategyRegistryJob(
  db: Database,
  input: {
    worker_id: string
    claimed_at: string
    lease_duration_ms: number
    max_attempts: number
  },
): StrategyRegistryJobLease | null {
  const claimedAt = instant(input.claimed_at, "claimed_at")
  const expiresAt = new Date(
    Date.parse(claimedAt) + boundedInteger(
      input.lease_duration_ms,
      1_000,
      3_600_000,
      "lease_duration_ms",
    ),
  ).toISOString()
  const workerId = identifier(input.worker_id, "worker_id")
  const maxAttempts = boundedInteger(
    input.max_attempts,
    1,
    100,
    "max_attempts",
  )
  return db.transaction(() => {
    db.query(`
      UPDATE rd_strategy_registry_job
      SET status=CASE WHEN attempt_count >= $max_attempts
             THEN 'dead_letter' ELSE 'pending' END,
          lease_owner=NULL, lease_expires_at=NULL,
          last_error=COALESCE(last_error, 'lease expired before completion'),
          updated_at=$claimed_at
      WHERE status='processing' AND lease_expires_at <= $claimed_at
    `).run({
      $max_attempts: maxAttempts,
      $claimed_at: claimedAt,
    })
    const row = db.query(`
      SELECT job_id, decision_id
      FROM rd_strategy_registry_job
      WHERE status='pending' AND attempt_count < $max_attempts
      ORDER BY created_at, job_id
      LIMIT 1
    `).get({ $max_attempts: maxAttempts }) as {
      job_id: string
      decision_id: string
    } | null
    if (!row) return null
    const update = db.query(`
      UPDATE rd_strategy_registry_job
      SET status='processing', attempt_count=attempt_count + 1,
          lease_owner=$worker_id, lease_generation=lease_generation + 1,
          lease_expires_at=$expires_at, updated_at=$claimed_at
      WHERE job_id=$job_id AND status='pending'
    `).run({
      $worker_id: workerId,
      $expires_at: expiresAt,
      $claimed_at: claimedAt,
      $job_id: row.job_id,
    })
    if (update.changes !== 1) return null
    return db.query(`
      SELECT job_id, decision_id, lease_generation
      FROM rd_strategy_registry_job WHERE job_id=$job_id
    `).get({ $job_id: row.job_id }) as StrategyRegistryJobLease
  }).immediate()
}

export function completeStrategyRegistryJob(
  db: Database,
  input: {
    lease: StrategyRegistryJobLease
    worker_id: string
    completed_at: string
    draft_id: string
    strategy_ref: string
    strategy_policy_hash: string
  },
): void {
  const update = db.query(`
    UPDATE rd_strategy_registry_job
    SET status='completed', lease_owner=NULL, lease_expires_at=NULL,
        draft_id=$draft_id, strategy_ref=$strategy_ref,
        strategy_policy_hash=$strategy_policy_hash, last_error=NULL,
        updated_at=$completed_at, completed_at=$completed_at
    WHERE job_id=$job_id AND status='processing'
      AND lease_owner=$worker_id AND lease_generation=$lease_generation
  `).run({
    $draft_id: input.draft_id,
    $strategy_ref: input.strategy_ref,
    $strategy_policy_hash: input.strategy_policy_hash,
    $completed_at: instant(input.completed_at, "completed_at"),
    $job_id: input.lease.job_id,
    $worker_id: identifier(input.worker_id, "worker_id"),
    $lease_generation: input.lease.lease_generation,
  })
  if (update.changes !== 1) throw new Error("Strategy Registry lease expired")
}

export function failStrategyRegistryJob(
  db: Database,
  input: {
    lease: StrategyRegistryJobLease
    worker_id: string
    observed_at: string
    error: string
    permanent: boolean
    max_attempts: number
  },
): "pending" | "dead_letter" {
  const row = db.query(`
    SELECT attempt_count FROM rd_strategy_registry_job
    WHERE job_id=$job_id AND status='processing'
      AND lease_owner=$worker_id AND lease_generation=$lease_generation
  `).get({
    $job_id: input.lease.job_id,
    $worker_id: identifier(input.worker_id, "worker_id"),
    $lease_generation: input.lease.lease_generation,
  }) as { attempt_count: number } | null
  if (!row) throw new Error("Strategy Registry lease expired")
  const status = input.permanent || row.attempt_count >= input.max_attempts
    ? "dead_letter"
    : "pending"
  const update = db.query(`
    UPDATE rd_strategy_registry_job
    SET status=$status, lease_owner=NULL, lease_expires_at=NULL,
        last_error=$error, updated_at=$observed_at
    WHERE job_id=$job_id AND status='processing'
      AND lease_owner=$worker_id AND lease_generation=$lease_generation
  `).run({
    $status: status,
    $error: boundedText(input.error, "error", 8_000),
    $observed_at: instant(input.observed_at, "observed_at"),
    $job_id: input.lease.job_id,
    $worker_id: input.worker_id,
    $lease_generation: input.lease.lease_generation,
  })
  if (update.changes !== 1) throw new Error("Strategy Registry lease expired")
  return status
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function instant(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} is invalid`)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC`)
  }
  return value
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function boundedText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new Error(`${field} is invalid`)
  }
  return value
}
