import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import {
  admitFormalReplayQueueWork,
  claimFormalReplayQueueWork,
  completeFormalReplayQueueWork,
  deadLetterFormalReplayQueueWork,
  ensureFormalReplayJobQueueSchema,
  recordFormalReplayQueueTransientFailure,
} from "./formal-replay-job-queue"
import {
  formalReplayQueueWorkFixture,
} from "./formal-replay-job-queue-test-fixture"

test("formal Replay queue is idempotent, fenced, and restart resumable", () => {
  const db = new Database(":memory:")
  ensureFormalReplayJobQueueSchema(db)
  try {
    const work = formalReplayQueueWorkFixture(
      "job-1",
      "test:formal-replay-resident",
    )
    const admitted = admitFormalReplayQueueWork(db, work)
    expect(admitFormalReplayQueueWork(db, work).work_hash).toBe(
      admitted.work_hash,
    )
    expect(() => admitFormalReplayQueueWork(db, {
      ...work,
      artifact_root: "tmp/formal-replay/other",
    })).toThrow("identity drifted")

    const first = claimFormalReplayQueueWork(db, {
      worker_id: "replay-worker-1",
      claimed_at: "2026-07-23T00:00:01.000Z",
      queue_lease_duration_ms: 600_000,
    })!
    expect(first.lease_generation).toBe(1)
    expect(first.resumed).toBe(false)
    const resumed = claimFormalReplayQueueWork(db, {
      worker_id: "replay-worker-1",
      claimed_at: "2026-07-23T00:00:02.000Z",
      queue_lease_duration_ms: 600_000,
    })!
    expect(resumed.lease_generation).toBe(1)
    expect(resumed.resumed).toBe(true)
    expect(claimFormalReplayQueueWork(db, {
      worker_id: "replay-worker-2",
      claimed_at: "2026-07-23T00:00:02.000Z",
      queue_lease_duration_ms: 600_000,
    })).toBeNull()

    recordFormalReplayQueueTransientFailure(db, {
      job_id: work.job_id,
      worker_id: "replay-worker-1",
      lease_generation: 1,
      observed_at: "2026-07-23T00:00:03.000Z",
      failure_class: "compute_owner_unavailable",
      error: "temporary owner failure",
    })
    expect(() => completeFormalReplayQueueWork(db, {
      job_id: work.job_id,
      worker_id: "replay-worker-2",
      lease_generation: 1,
      completed_at: "2026-07-23T00:00:04.000Z",
      result: { ok: true },
    })).toThrow("fencing lease mismatch")

    const completed = completeFormalReplayQueueWork(db, {
      job_id: work.job_id,
      worker_id: "replay-worker-1",
      lease_generation: 1,
      completed_at: "2026-07-23T00:00:04.000Z",
      result: { status: "completed", trading_authority: false },
    })
    expect(completed.status).toBe("completed")
    expect(completed.result?.trading_authority).toBe(false)
  } finally {
    db.close()
  }
})

test("formal Replay queue rotates generation only after lease expiry", () => {
  const db = new Database(":memory:")
  ensureFormalReplayJobQueueSchema(db)
  try {
    const work = formalReplayQueueWorkFixture(
      "job-2",
      "test:formal-replay-resident",
    )
    admitFormalReplayQueueWork(db, work)
    claimFormalReplayQueueWork(db, {
      worker_id: "replay-worker-1",
      claimed_at: "2026-07-23T00:00:01.000Z",
      queue_lease_duration_ms: 600_000,
    })
    const successor = claimFormalReplayQueueWork(db, {
      worker_id: "replay-worker-2",
      claimed_at: "2026-07-23T00:10:02.000Z",
      queue_lease_duration_ms: 600_000,
    })!
    expect(successor.lease_generation).toBe(2)
    expect(successor.attempt_count).toBe(2)
    const failed = deadLetterFormalReplayQueueWork(db, {
      job_id: work.job_id,
      worker_id: "replay-worker-2",
      lease_generation: 2,
      failed_at: "2026-07-23T00:10:03.000Z",
      failure_class: "owner_contract_drift",
      error: "hash drifted",
    })
    expect(failed.status).toBe("dead_letter")
  } finally {
    db.close()
  }
})
