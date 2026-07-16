import { Database } from "bun:sqlite"
import { existsSync, lstatSync } from "node:fs"
import {
  recoverDiscoveredReplayCancellationAcknowledgements,
  type ReplayCancellationDiscoveryRecoveryResult,
} from "../../../../replay-execution-plane/runner/src/lib/replay-cancellation-coordinator"
import { createReplayLocalArtifactStore } from "../../../../replay-execution-plane/runner/src/lib/replay-local-artifact-store"
import { createSqliteReplayCancellationCoordinationPort } from "../../../state-store/src/lib/replay-cancellation-authority"

export const REPLAY_CANCELLATION_RECOVERY_JOB_RESULT_SCHEMA_VERSION = "trade.rd-replay-cancellation-recovery-job-result.v1" as const

export interface ReplayCancellationRecoveryJobInput {
  db_path: string
  artifact_root: string
  registered_at: string
}

export interface ReplayCancellationRecoveryJobResult {
  schema_version: typeof REPLAY_CANCELLATION_RECOVERY_JOB_RESULT_SCHEMA_VERSION
  status: "no_outbox" | "reconciled"
  recovered_at: string
  discovered_count: number
  registered_count: number
  already_registered_count: number
  recovery: ReplayCancellationDiscoveryRecoveryResult
}

export function runReplayCancellationRecoveryJob(
  input: ReplayCancellationRecoveryJobInput,
): ReplayCancellationRecoveryJobResult {
  return withReplayCancellationAuthorityDatabase(input.db_path, (db) =>
    recoverReplayCancellationOutboxes(db, input.artifact_root, input.registered_at))
}

export function recoverReplayCancellationOutboxes(
  db: Database,
  artifactRoot: string,
  registeredAt: string,
): ReplayCancellationRecoveryJobResult {
  requireUtc(registeredAt)
  requireExistingDirectory(artifactRoot, "Replay Artifact Store root")
  assertCancellationAuthoritySchema(db)
  const recovery = recoverDiscoveredReplayCancellationAcknowledgements(
    createReplayLocalArtifactStore(artifactRoot),
    createSqliteReplayCancellationCoordinationPort(db),
    { now: () => registeredAt },
  )
  const registeredCount = recovery.deliveries.filter((item) => item.delivery_status === "registered").length
  const alreadyRegisteredCount = recovery.deliveries.length - registeredCount
  return {
    schema_version: REPLAY_CANCELLATION_RECOVERY_JOB_RESULT_SCHEMA_VERSION,
    status: recovery.discovered_count === 0 ? "no_outbox" : "reconciled",
    recovered_at: registeredAt,
    discovered_count: recovery.discovered_count,
    registered_count: registeredCount,
    already_registered_count: alreadyRegisteredCount,
    recovery,
  }
}

export function withReplayCancellationAuthorityDatabase<T>(
  dbPath: string,
  operation: (db: Database) => T,
): T {
  requireExistingFile(dbPath, "Research Control Plane DB")
  const db = new Database(dbPath)
  try {
    assertCancellationAuthoritySchema(db)
    return operation(db)
  } finally {
    db.close()
  }
}

function assertCancellationAuthoritySchema(db: Database): void {
  const required = [
    "rd_replay_attempt",
    "rd_replay_attempt_cancellation",
    "rd_replay_attempt_cancellation_observation",
  ]
  const rows = db.query(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name IN ($attempt, $cancellation, $observation)
  `).all({
    $attempt: required[0],
    $cancellation: required[1],
    $observation: required[2],
  }) as Array<{ name: string }>
  if (new Set(rows.map((row) => row.name)).size !== required.length) {
    throw new Error("Replay cancellation recovery requires the existing Control Plane authority schema")
  }
}

function requireExistingFile(path: string, label: string): void {
  if (!path || !existsSync(path)) throw new Error(`${label} does not exist`)
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file`)
}

function requireExistingDirectory(path: string, label: string): void {
  if (!path || !existsSync(path)) throw new Error(`${label} does not exist`)
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular directory`)
}

function requireUtc(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
      || !Number.isFinite(Date.parse(value))) {
    throw new Error("Replay cancellation recovery registered_at must be RFC 3339 UTC")
  }
}
