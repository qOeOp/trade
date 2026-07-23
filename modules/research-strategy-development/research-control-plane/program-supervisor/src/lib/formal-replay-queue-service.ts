import { Database } from "bun:sqlite"
import {
  buildDatabaseIdentity,
  ensureDatabaseIdentity,
} from "../../../../../contracts/runtime-core/src/database-identity"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import {
  assertProjectRuntimePath,
  resolveRepoPath,
} from "../../../../../contracts/runtime-core/src/paths"
import {
  admitFormalReplayQueueWork,
  readFormalReplayQueueWork,
} from "../../../state-store/src/lib/formal-replay-job-queue"
import {
  ensureResearchStateSchema,
} from "../../../state-store/src/lib/research-state-store"

export function enqueueFormalReplayWork(
  dbPath: string,
  work: JSONRecord,
): JSONRecord {
  return withStore(dbPath, environmentId(work), (db) => {
    const record = admitFormalReplayQueueWork(db, work)
    return {
      schema_version: "trade.rd-formal-replay-queue-admission-result.v1",
      job_id: record.work.job_id,
      work_hash: record.work_hash,
      status: record.status,
      attempt_count: record.attempt_count,
      replay_authority: "none_until_resident_attempt",
      review_authority: "none",
      deployment_authority: "none",
      trading_authority: false,
    }
  })
}

export function readFormalReplayWorkStatus(
  dbPath: string,
  input: JSONRecord,
): JSONRecord {
  const environment = environmentId(input)
  const jobId = text(input.job_id, "job_id")
  return withStore(dbPath, environment, (db) => {
    const record = readFormalReplayQueueWork(db, jobId)
    if (!record) throw new Error("formal Replay queue work is missing")
    return {
      schema_version: "trade.rd-formal-replay-queue-status-result.v1",
      job_id: record.work.job_id,
      work_hash: record.work_hash,
      status: record.status,
      lease_generation: record.lease_generation,
      attempt_count: record.attempt_count,
      updated_at: record.updated_at,
      result: record.result,
      failure_class: record.failure_class,
      last_error: record.last_error,
      review_authority: record.result?.review_authority
        === "classified_result_only"
        ? "classified_result_only"
        : "none",
      deployment_authority: "none",
      trading_authority: false,
    }
  })
}

function withStore<T>(
  dbPath: string,
  environmentIdValue: string,
  execute: (db: Database) => T,
): T {
  assertProjectRuntimePath(dbPath)
  const db = new Database(resolveRepoPath(dbPath), { create: true })
  try {
    ensureDatabaseIdentity(
      db,
      buildDatabaseIdentity(environmentIdValue, "research_state_store"),
    )
    ensureResearchStateSchema(db)
    return execute(db)
  } finally {
    db.close()
  }
}

function environmentId(value: JSONRecord): string {
  const environment = text(value.environment_id, "environment_id")
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(environment)) {
    throw new Error("environment_id is invalid")
  }
  return environment
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`)
  }
  return value.trim()
}
