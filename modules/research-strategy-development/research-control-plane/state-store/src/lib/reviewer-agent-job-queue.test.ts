import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import {
  admitFormalReplayQueueWork,
  claimFormalReplayQueueWork,
  completeFormalReplayQueueWork,
  ensureFormalReplayJobQueueSchema,
} from "./formal-replay-job-queue"
import { formalReplayQueueWorkFixture } from "./formal-replay-job-queue-test-fixture"
import {
  claimReviewerAgentJob,
  completeReviewerAgentJob,
  ensureReviewerAgentJobQueueSchema,
  readReviewerAgentJob,
  reconcileCompletedReplayReviewerJobs,
  recordReviewerAgentJobFailure,
  retryReviewerAgentJobWithNewRun,
} from "./reviewer-agent-job-queue"

test("completed formal Replay reconciles into one fenced restart-resumable Reviewer Agent job", () => {
  const db = fixture()
  try {
    const reconciled = reconcileCompletedReplayReviewerJobs(
      db,
      "2026-07-23T00:00:05.000Z",
    )
    expect(reconciled).toHaveLength(1)
    expect(reconciled[0]!.status).toBe("accepted")
    expect(reconcileCompletedReplayReviewerJobs(
      db,
      "2026-07-23T00:00:06.000Z",
    )).toHaveLength(0)

    const first = claimReviewerAgentJob(db, {
      worker_id: "reviewer-worker-1",
      claimed_at: "2026-07-23T00:00:07.000Z",
      lease_duration_ms: 1_200_000,
      run_duration_ms: 900_000,
      max_attempts: 3,
    })!
    expect(first.lease_generation).toBe(1)
    expect(first.resumed).toBe(false)
    expect(first.run_requested_at).toBe("2026-07-23T00:00:07.000Z")
    const resumed = claimReviewerAgentJob(db, {
      worker_id: "reviewer-worker-1",
      claimed_at: "2026-07-23T00:00:08.000Z",
      lease_duration_ms: 1_200_000,
      run_duration_ms: 900_000,
      max_attempts: 3,
    })!
    expect(resumed.resumed).toBe(true)
    expect(resumed.lease_generation).toBe(1)
    expect(resumed.run_requested_at).toBe(first.run_requested_at)
    expect(claimReviewerAgentJob(db, {
      worker_id: "reviewer-worker-2",
      claimed_at: "2026-07-23T00:00:08.000Z",
      lease_duration_ms: 1_200_000,
      run_duration_ms: 900_000,
      max_attempts: 3,
    })).toBeNull()

    recordReviewerAgentJobFailure(db, {
      job_id: first.job_id,
      worker_id: "reviewer-worker-1",
      lease_generation: 1,
      observed_at: "2026-07-23T00:00:09.000Z",
      failure_class: "agent_host_unavailable",
      error: "temporary",
      permanent: false,
    })
    expect(() => completeReviewerAgentJob(db, {
      job_id: first.job_id,
      worker_id: "reviewer-worker-2",
      lease_generation: 1,
      completed_at: "2026-07-23T00:00:10.000Z",
      completion: { decision: "reject" },
    })).toThrow("fencing lease")
    const completed = completeReviewerAgentJob(db, {
      job_id: first.job_id,
      worker_id: "reviewer-worker-1",
      lease_generation: 1,
      completed_at: "2026-07-23T00:00:10.000Z",
      completion: {
        schema_version: "trade.rd-reviewer-agent-job-completion.v1",
        decision: "reject",
      },
    })
    expect(completed.status).toBe("completed")
  } finally {
    db.close()
  }
})

test("expired Reviewer lease rotates run identity and permanent failures dead-letter", () => {
  const db = fixture("job-2", "result-2")
  try {
    const job = reconcileCompletedReplayReviewerJobs(
      db,
      "2026-07-23T00:00:05.000Z",
    )[0]!
    claimReviewerAgentJob(db, {
      worker_id: "reviewer-worker-1",
      claimed_at: "2026-07-23T00:00:07.000Z",
      lease_duration_ms: 1_200_000,
      run_duration_ms: 900_000,
      max_attempts: 3,
    })
    const successor = claimReviewerAgentJob(db, {
      worker_id: "reviewer-worker-2",
      claimed_at: "2026-07-23T00:20:08.000Z",
      lease_duration_ms: 1_200_000,
      run_duration_ms: 900_000,
      max_attempts: 3,
    })!
    expect(successor.lease_generation).toBe(2)
    expect(successor.run_requested_at).toBe("2026-07-23T00:20:08.000Z")
    const dead = recordReviewerAgentJobFailure(db, {
      job_id: job.job_id,
      worker_id: "reviewer-worker-2",
      lease_generation: 2,
      observed_at: "2026-07-23T00:20:09.000Z",
      failure_class: "owner_contract_drift",
      error: "context drifted",
      permanent: true,
    })
    expect(dead.status).toBe("dead_letter")
    expect(readReviewerAgentJob(db, job.job_id)?.failure_class).toBe(
      "owner_contract_drift",
    )
  } finally {
    db.close()
  }
})

test("rejected terminal Agent output releases the lease for a successor run", () => {
  const db = fixture("job-3", "result-3")
  try {
    const job = reconcileCompletedReplayReviewerJobs(
      db,
      "2026-07-23T00:00:05.000Z",
    )[0]!
    claimReviewerAgentJob(db, {
      worker_id: "reviewer-worker-1",
      claimed_at: "2026-07-23T00:00:07.000Z",
      lease_duration_ms: 1_200_000,
      run_duration_ms: 900_000,
      max_attempts: 3,
    })
    const released = retryReviewerAgentJobWithNewRun(db, {
      job_id: job.job_id,
      worker_id: "reviewer-worker-1",
      lease_generation: 1,
      observed_at: "2026-07-23T00:00:08.000Z",
      failure_class: "agent_output_rejected",
      error: "submission was invalid",
    })
    expect(released.status).toBe("accepted")
    const successor = claimReviewerAgentJob(db, {
      worker_id: "reviewer-worker-1",
      claimed_at: "2026-07-23T00:00:09.000Z",
      lease_duration_ms: 1_200_000,
      run_duration_ms: 900_000,
      max_attempts: 3,
    })!
    expect(successor.lease_generation).toBe(2)
    expect(successor.run_requested_at).toBe("2026-07-23T00:00:09.000Z")
  } finally {
    db.close()
  }
})

function fixture(jobId = "job-1", resultId = "result-1"): Database {
  const db = new Database(":memory:")
  db.run("PRAGMA foreign_keys=ON")
  db.run(`
    CREATE TABLE rd_experiment_result(
      result_id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL,
      stage_id TEXT NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE rd_evaluation_evidence_classification(
      result_id TEXT PRIMARY KEY,
      evidence_kind TEXT NOT NULL,
      producer TEXT NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE rd_review_decision(
      decision_id TEXT PRIMARY KEY,
      decision TEXT NOT NULL,
      reviewer_run_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE rd_review_decision_result(
      decision_id TEXT NOT NULL,
      result_id TEXT NOT NULL
    )
  `)
  ensureFormalReplayJobQueueSchema(db)
  ensureReviewerAgentJobQueueSchema(db)
  const work = formalReplayQueueWorkFixture(
    jobId,
    "test:reviewer-agent-resident",
  )
  admitFormalReplayQueueWork(db, work)
  claimFormalReplayQueueWork(db, {
    worker_id: "replay-worker",
    claimed_at: "2026-07-23T00:00:01.000Z",
    queue_lease_duration_ms: 600_000,
  })
  db.query(`
    INSERT INTO rd_experiment_result(result_id, experiment_id, stage_id)
    VALUES ($result_id, 'experiment-1', 'historical_validation')
  `).run({ $result_id: resultId })
  db.query(`
    INSERT INTO rd_evaluation_evidence_classification(
      result_id, evidence_kind, producer
    ) VALUES ($result_id, 'mechanical_replay', 'replay_owner')
  `).run({ $result_id: resultId })
  completeFormalReplayQueueWork(db, {
    job_id: jobId,
    worker_id: "replay-worker",
    lease_generation: 1,
    completed_at: "2026-07-23T00:00:04.000Z",
    result: {
      schema_version: "trade.rd-formal-replay-job-result.v1",
      status: "completed",
      result_id: resultId,
      review_authority: "classified_result_only",
      trading_authority: false,
    },
  })
  return db
}
