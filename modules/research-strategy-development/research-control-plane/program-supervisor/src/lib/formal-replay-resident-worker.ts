import { createHash } from "node:crypto"
import { Database } from "bun:sqlite"
import {
  buildDatabaseIdentity,
  ensureDatabaseIdentity,
} from "../../../../../contracts/runtime-core/src/database-identity"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import {
  classifyResidentWorkerFailure,
} from "../../../../../contracts/runtime-core/src/resident-worker"
import {
  assertProjectRuntimePath,
  resolveRepoPath,
} from "../../../../../contracts/runtime-core/src/paths"
import {
  claimFormalReplayQueueWork,
  completeFormalReplayQueueWork,
  deadLetterFormalReplayQueueWork,
  ensureFormalReplayJobQueueSchema,
  recordFormalReplayQueueTransientFailure,
  type FormalReplayQueueLease,
} from "../../../state-store/src/lib/formal-replay-job-queue"
import {
  ensureResearchStateSchema,
} from "../../../state-store/src/lib/research-state-store"
import {
  FORMAL_REPLAY_DATA_PREPARE_REQUEST_SCHEMA,
  prepareFormalReplayData,
  type FormalReplayDataPrepareResult,
} from "./formal-replay-data-preparer"
import {
  FORMAL_REPLAY_JOB_REQUEST_SCHEMA,
  runFormalReplayJob,
  type FormalReplayJobResult,
} from "./formal-replay-runner"

export const FORMAL_REPLAY_RESIDENT_CYCLE_SCHEMA =
  "trade.rd-formal-replay-resident-cycle.v1" as const

export interface FormalReplayResidentCycleInput {
  environment_id: string
  queue_worker_id: string
  queue_lease_duration_ms: number
}

export interface FormalReplayResidentCycleResult {
  schema_version: typeof FORMAL_REPLAY_RESIDENT_CYCLE_SCHEMA
  status: "idle" | "completed" | "retrying" | "dead_letter"
  job_id: string | null
  lease_generation: number | null
  resumed: boolean
  replay_status: FormalReplayJobResult["status"] | null
  result_id: string | null
  failure_class: string | null
  review_authority: "classified_result_only" | "none"
  deployment_authority: "none"
  trading_authority: false
}

interface Dependencies {
  now(): Date
  prepare(dbPath: string, request: JSONRecord): FormalReplayDataPrepareResult
  run(dbPath: string, request: JSONRecord): FormalReplayJobResult
}

const DEFAULT_DEPENDENCIES: Dependencies = {
  now: () => new Date(),
  prepare: prepareFormalReplayData,
  run: runFormalReplayJob,
}

export function runFormalReplayResidentCycle(
  dbPath: string,
  input: FormalReplayResidentCycleInput,
  dependencies: Dependencies = DEFAULT_DEPENDENCIES,
): FormalReplayResidentCycleResult {
  assertProjectRuntimePath(dbPath)
  const environmentId = identifier(input.environment_id, "environment_id")
  const queueWorkerId = identifier(
    input.queue_worker_id,
    "queue_worker_id",
  )
  const claimedAt = canonicalTime(dependencies.now())
  const db = new Database(resolveRepoPath(dbPath))
  let lease: FormalReplayQueueLease | null = null
  try {
    ensureDatabaseIdentity(
      db,
      buildDatabaseIdentity(environmentId, "research_state_store"),
    )
    ensureResearchStateSchema(db)
    ensureFormalReplayJobQueueSchema(db)
    lease = claimFormalReplayQueueWork(db, {
      worker_id: queueWorkerId,
      claimed_at: claimedAt,
      queue_lease_duration_ms: input.queue_lease_duration_ms,
    })
    if (!lease) return idle()
    if (lease.work.environment_id !== environmentId) {
      throw new PermanentQueueError(
        "formal Replay queued environment identity drifted",
      )
    }
    const prepared = dependencies.prepare(dbPath, {
      schema_version: FORMAL_REPLAY_DATA_PREPARE_REQUEST_SCHEMA,
      request_registration_id: lease.work.request_registration_id,
      request_registration_hash: lease.work.request_registration_hash,
      data_snapshot_binding: lease.work.data_snapshot_binding,
      funding_events_source: lease.work.funding_events_source,
      mark_events_source: lease.work.mark_events_source,
      supplemental_facts_source: lease.work.supplemental_facts_source,
      output_ref: lease.work.data_bundle_ref,
      environment_id: environmentId,
    })
    const replay = dependencies.run(dbPath, {
      schema_version: FORMAL_REPLAY_JOB_REQUEST_SCHEMA,
      execution_id: executionId(lease),
      request_registration_id: lease.work.request_registration_id,
      request_registration_hash: lease.work.request_registration_hash,
      data_bundle_ref: prepared.bundle_ref,
      data_bundle_sha256: prepared.bundle_sha256,
      artifact_root: lease.work.artifact_root,
      environment_id: environmentId,
      worker_id: lease.work.replay_worker_id,
      lease_duration_ms: lease.work.replay_lease_duration_ms,
    })
    completeFormalReplayQueueWork(db, {
      job_id: lease.work.job_id,
      worker_id: queueWorkerId,
      lease_generation: lease.lease_generation,
      completed_at: canonicalTime(dependencies.now()),
      result: replay as unknown as JSONRecord,
    })
    return {
      schema_version: FORMAL_REPLAY_RESIDENT_CYCLE_SCHEMA,
      status: "completed",
      job_id: lease.work.job_id,
      lease_generation: lease.lease_generation,
      resumed: lease.resumed,
      replay_status: replay.status,
      result_id: replay.result_id,
      failure_class: replay.failure_class ?? null,
      review_authority: replay.review_authority,
      deployment_authority: "none",
      trading_authority: false,
    }
  } catch (error) {
    if (!lease) throw error
    const observedAt = canonicalTime(dependencies.now())
    const message = error instanceof Error ? error.message : String(error)
    const permanent = error instanceof PermanentQueueError
      || isPermanentFailure(message)
    const failureClass = permanent
      ? "owner_contract_drift"
      : classifyResidentWorkerFailure(error, "compute")
    try {
      if (permanent) {
        deadLetterFormalReplayQueueWork(db, {
          job_id: lease.work.job_id,
          worker_id: queueWorkerId,
          lease_generation: lease.lease_generation,
          failed_at: observedAt,
          failure_class: failureClass,
          error: message,
        })
      } else {
        recordFormalReplayQueueTransientFailure(db, {
          job_id: lease.work.job_id,
          worker_id: queueWorkerId,
          lease_generation: lease.lease_generation,
          observed_at: observedAt,
          failure_class: failureClass,
          error: message,
        })
      }
    } catch (stateError) {
      if (!/queue lease expired/i.test(
        stateError instanceof Error ? stateError.message : String(stateError),
      )) {
        throw stateError
      }
      return retryingAfterLeaseExpiry(lease)
    }
    return {
      schema_version: FORMAL_REPLAY_RESIDENT_CYCLE_SCHEMA,
      status: permanent ? "dead_letter" : "retrying",
      job_id: lease.work.job_id,
      lease_generation: lease.lease_generation,
      resumed: lease.resumed,
      replay_status: null,
      result_id: null,
      failure_class: failureClass,
      review_authority: "none",
      deployment_authority: "none",
      trading_authority: false,
    }
  } finally {
    db.close()
  }
}

function retryingAfterLeaseExpiry(
  lease: FormalReplayQueueLease,
): FormalReplayResidentCycleResult {
  return {
    schema_version: FORMAL_REPLAY_RESIDENT_CYCLE_SCHEMA,
    status: "retrying",
    job_id: lease.work.job_id,
    lease_generation: lease.lease_generation,
    resumed: lease.resumed,
    replay_status: null,
    result_id: null,
    failure_class: "queue_lease_expired",
    review_authority: "none",
    deployment_authority: "none",
    trading_authority: false,
  }
}

function executionId(lease: FormalReplayQueueLease): string {
  const suffix = createHash("sha256")
    .update(`${lease.work_hash}:${lease.lease_generation}`)
    .digest("hex")
    .slice(0, 32)
  return `formal-replay:${suffix}`
}

function idle(): FormalReplayResidentCycleResult {
  return {
    schema_version: FORMAL_REPLAY_RESIDENT_CYCLE_SCHEMA,
    status: "idle",
    job_id: null,
    lease_generation: null,
    resumed: false,
    replay_status: null,
    result_id: null,
    failure_class: null,
    review_authority: "none",
    deployment_authority: "none",
    trading_authority: false,
  }
}

function isPermanentFailure(message: string): boolean {
  return /(?:contract|identity|hash|drift|collision|unsupported|invalid|symlink|escaped repository)/i
    .test(message)
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function canonicalTime(value: Date): string {
  if (!Number.isFinite(value.getTime())) {
    throw new Error("formal Replay resident clock is invalid")
  }
  return value.toISOString()
}

class PermanentQueueError extends Error {}
