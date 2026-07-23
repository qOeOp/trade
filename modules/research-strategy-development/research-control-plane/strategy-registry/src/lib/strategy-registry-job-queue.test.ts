import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import {
  claimStrategyRegistryJob,
  completeStrategyRegistryJob,
  ensureStrategyRegistryJobQueueSchema,
  failStrategyRegistryJob,
  reconcileAcceptedDraftJobs,
} from "./strategy-registry-job-queue"

test("Registry queue reconciles, fences, retries, and completes one accepted decision", () => {
  const db = fixture()
  reconcileAcceptedDraftJobs(db, "2026-07-23T01:00:01.000Z")
  const first = claimStrategyRegistryJob(db, {
    worker_id: "worker-1",
    claimed_at: "2026-07-23T01:00:02.000Z",
    lease_duration_ms: 1_000,
    max_attempts: 3,
  })
  expect(first?.decision_id).toBe("decision-1")
  expect(claimStrategyRegistryJob(db, {
    worker_id: "worker-2",
    claimed_at: "2026-07-23T01:00:02.500Z",
    lease_duration_ms: 1_000,
    max_attempts: 3,
  })).toBeNull()
  const second = claimStrategyRegistryJob(db, {
    worker_id: "worker-2",
    claimed_at: "2026-07-23T01:00:03.001Z",
    lease_duration_ms: 1_000,
    max_attempts: 3,
  })
  expect(second?.lease_generation).toBe(2)
  expect(() => completeStrategyRegistryJob(db, {
    lease: first!,
    worker_id: "worker-1",
    completed_at: "2026-07-23T01:00:04.000Z",
    draft_id: "draft-old",
    strategy_ref: "old",
    strategy_policy_hash: "a".repeat(64),
    candidate_manifest_ref: "data/release-candidates/old.json",
    candidate_manifest_hash: "c".repeat(64),
  })).toThrow("lease expired")
  completeStrategyRegistryJob(db, {
    lease: second!,
    worker_id: "worker-2",
    completed_at: "2026-07-23T01:00:04.000Z",
    draft_id: "draft-1",
    strategy_ref: "data/release-candidates/strategy.md",
    strategy_policy_hash: "b".repeat(64),
    candidate_manifest_ref: "data/release-candidates/candidate.json",
    candidate_manifest_hash: "d".repeat(64),
  })
  expect(db.query(`
    SELECT candidate_manifest_ref, candidate_manifest_hash
    FROM rd_strategy_registry_job WHERE decision_id='decision-1'
  `).get()).toEqual({
    candidate_manifest_ref: "data/release-candidates/candidate.json",
    candidate_manifest_hash: "d".repeat(64),
  })
  expect(claimStrategyRegistryJob(db, {
    worker_id: "worker-3",
    claimed_at: "2026-07-23T01:00:05.000Z",
    lease_duration_ms: 1_000,
    max_attempts: 3,
  })).toBeNull()
  db.close()
})

test("Registry queue dead-letters permanent owner drift without blocking later work", () => {
  const db = fixture()
  db.query(`
    INSERT INTO rd_review_decision VALUES (
      'decision-2', 'accept_for_draft', '2026-07-23T01:00:01.000Z'
    )
  `).run()
  reconcileAcceptedDraftJobs(db, "2026-07-23T01:00:02.000Z")
  const first = claimStrategyRegistryJob(db, {
    worker_id: "worker-1",
    claimed_at: "2026-07-23T01:00:03.000Z",
    lease_duration_ms: 1_000,
    max_attempts: 3,
  })!
  expect(failStrategyRegistryJob(db, {
    lease: first,
    worker_id: "worker-1",
    observed_at: "2026-07-23T01:00:03.500Z",
    error: "owner contract drifted",
    permanent: true,
    max_attempts: 3,
  })).toBe("dead_letter")
  expect(claimStrategyRegistryJob(db, {
    worker_id: "worker-1",
    claimed_at: "2026-07-23T01:00:04.000Z",
    lease_duration_ms: 1_000,
    max_attempts: 3,
  })?.decision_id).toBe("decision-2")
  db.close()
})

function fixture(): Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE rd_review_decision(
      decision_id TEXT PRIMARY KEY,
      decision TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO rd_review_decision VALUES (
      'decision-1', 'accept_for_draft', '2026-07-23T01:00:00.000Z'
    );
  `)
  ensureStrategyRegistryJobQueueSchema(db)
  return db
}
