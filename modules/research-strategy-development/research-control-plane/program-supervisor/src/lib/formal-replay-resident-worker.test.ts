import { mkdirSync, rmSync } from "node:fs"
import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import {
  buildDatabaseIdentity,
  ensureDatabaseIdentity,
} from "../../../../../contracts/runtime-core/src/database-identity"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { resolveRepoPath } from "../../../../../contracts/runtime-core/src/paths"
import {
  admitFormalReplayQueueWork,
  readFormalReplayQueueWork,
} from "../../../state-store/src/lib/formal-replay-job-queue"
import {
  formalReplayQueueWorkFixture,
} from "../../../state-store/src/lib/formal-replay-job-queue-test-fixture"
import {
  ensureResearchStateSchema,
} from "../../../state-store/src/lib/research-state-store"
import {
  runFormalReplayResidentCycle,
} from "./formal-replay-resident-worker"

test("formal Replay resident cycle resumes one fenced execution after transient failure", () => {
  const root = `tmp/formal-replay-resident-${process.pid}-${Date.now()}`
  const dbPath = `${root}/rd.db`
  const environmentId = "test:formal-replay-resident"
  mkdirSync(resolveRepoPath(root), { recursive: true })
  seed(dbPath, environmentId, formalReplayQueueWorkFixture())
  const times = [
    "2026-07-23T00:00:01.000Z",
    "2026-07-23T00:00:02.000Z",
    "2026-07-23T00:00:03.000Z",
    "2026-07-23T00:00:04.000Z",
    "2026-07-23T00:00:05.000Z",
  ]
  const executionIds: string[] = []
  let calls = 0
  try {
    const dependencies = {
      now: () => new Date(times.shift()!),
      prepare: () => prepared(),
      run: (_db: string, request: JSONRecord) => {
        executionIds.push(String(request.execution_id))
        calls += 1
        if (calls === 1) throw new Error("owner temporarily unavailable")
        return replayResult(request)
      },
    }
    const input = {
      environment_id: environmentId,
      queue_worker_id: "resident-worker-1",
      queue_lease_duration_ms: 600_000,
    }
    const first = runFormalReplayResidentCycle(dbPath, input, dependencies)
    expect(first.status).toBe("retrying")
    expect(first.resumed).toBe(false)
    const second = runFormalReplayResidentCycle(dbPath, input, dependencies)
    expect(second.status).toBe("completed")
    expect(second.resumed).toBe(true)
    expect(executionIds[1]).toBe(executionIds[0])
    expect(read(dbPath, "job-1")?.status).toBe("completed")
  } finally {
    rmSync(resolveRepoPath(root), { recursive: true, force: true })
  }
})

test("formal Replay resident cycle dead-letters immutable contract drift", () => {
  const root = `tmp/formal-replay-resident-dead-${process.pid}-${Date.now()}`
  const dbPath = `${root}/rd.db`
  const environmentId = "test:formal-replay-resident-dead"
  mkdirSync(resolveRepoPath(root), { recursive: true })
  seed(
    dbPath,
    environmentId,
    formalReplayQueueWorkFixture("job-2", environmentId),
  )
  const times = [
    "2026-07-23T00:00:01.000Z",
    "2026-07-23T00:00:02.000Z",
  ]
  try {
    const result = runFormalReplayResidentCycle(dbPath, {
      environment_id: environmentId,
      queue_worker_id: "resident-worker-1",
      queue_lease_duration_ms: 600_000,
    }, {
      now: () => new Date(times.shift()!),
      prepare: () => {
        throw new Error("data bundle hash drifted")
      },
      run: () => {
        throw new Error("unreachable")
      },
    })
    expect(result.status).toBe("dead_letter")
    expect(read(dbPath, "job-2")?.status).toBe("dead_letter")
  } finally {
    rmSync(resolveRepoPath(root), { recursive: true, force: true })
  }
})

function seed(
  path: string,
  environmentId: string,
  work: JSONRecord,
): void {
  const db = new Database(resolveRepoPath(path), { create: true })
  try {
    ensureDatabaseIdentity(
      db,
      buildDatabaseIdentity(environmentId, "research_state_store"),
    )
    ensureResearchStateSchema(db)
    admitFormalReplayQueueWork(db, work)
  } finally {
    db.close()
  }
}

function read(path: string, jobId: string) {
  const db = new Database(resolveRepoPath(path))
  try {
    return readFormalReplayQueueWork(db, jobId)
  } finally {
    db.close()
  }
}

function prepared() {
  return {
    schema_version: "trade.rd-formal-replay-data-prepare-result.v1" as const,
    request_registration_id: "registration-1",
    request_registration_hash: "a".repeat(64),
    data_snapshot_binding_hash: "b".repeat(64),
    bundle_ref: "tmp/formal-replay/job-1/bundle.json",
    bundle_sha256: "c".repeat(64),
    dataset_manifest_hash: "d".repeat(64),
    dataset_hash: "e".repeat(64),
    row_count: 2,
    recovered: false,
    replay_authority: "none_until_registered_attempt" as const,
    review_authority: "none" as const,
    deployment_authority: "none" as const,
    trading_authority: false as const,
  }
}

function replayResult(request: JSONRecord) {
  return {
    schema_version: "trade.rd-formal-replay-job-result.v1" as const,
    status: "completed" as const,
    execution_id: String(request.execution_id),
    request_registration_id: "registration-1",
    attempt_id: `formal-replay-attempt:${request.execution_id}`,
    result_id: "formal-replay-result:fixture",
    artifact_ref: "tmp/formal-replay/result.json",
    dispatch_ref: "tmp/formal-replay/dispatch.json",
    dispatch_sha256: "f".repeat(64),
    recovered_result: false,
    formal_evidence_kind: "mechanical_replay" as const,
    review_authority: "classified_result_only" as const,
    deployment_authority: "none" as const,
    trading_authority: false as const,
  }
}
