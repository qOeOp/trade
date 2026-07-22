import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { Database } from "bun:sqlite"
import {
  acquireOpsLock,
  ensureOpsRuntimeSchema,
  readCycleSummary,
  readOpsLock,
  releaseOpsLock,
} from "../../../../ops-runtime-store/src/lib/ops-runtime-store"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { assertProjectRuntimePath, resolveRepoPath } from "../../../../../contracts/runtime-core/src/paths"
import {
  runAutomationJobGraph,
  type CommandExecutor,
} from "./job-graph-runner"

const SHADOW_LOCK_KEY = "program-runtime-shadow"
const SHADOW_LEASE_MS = 5 * 60 * 1000
const SQLITE_BUSY_TIMEOUT_MS = 1_000
const TERMINAL_CYCLE_STATUSES = new Set(["completed", "failed", "blocked"])
const ALLOWED_INPUT_KEYS = new Set([
  "cycle_id",
  "now",
  "ops_runtime_db",
  "runtime_health",
])

export interface ProgramShadowInput {
  cycle_id?: string
  now?: string
  ops_runtime_db?: string
  runtime_health?: JSONRecord
}

export interface ProgramShadowDependencies {
  clock?: () => Date
  holderId?: () => string
}

export async function runProgramShadowWakeup(
  tradeDb: Database,
  tradeDbPath: string,
  rawInput: JSONRecord = {},
  executor?: CommandExecutor,
  dependencies: ProgramShadowDependencies = {},
): Promise<JSONRecord> {
  assertClosedWorldInput(rawInput)
  const input = rawInput as ProgramShadowInput
  const clock = dependencies.clock ?? (() => new Date())
  const lockNow = clock()
  const cycleNow = normalizeCycleNow(input.now, lockNow)
  const cycleId = normalizeCycleId(input.cycle_id, cycleNow)
  const configuredOpsRuntimeDbPath = stringField(input.ops_runtime_db) || "./data/ops_runtime.db"
  assertProjectRuntimePath(configuredOpsRuntimeDbPath)
  const opsRuntimeDbPath = resolveRepoPath(configuredOpsRuntimeDbPath)
  const holderId = dependencies.holderId?.() || `${cycleId}:${crypto.randomUUID()}`
  const expiresAt = new Date(lockNow.getTime() + SHADOW_LEASE_MS)
  mkdirSync(dirname(opsRuntimeDbPath), { recursive: true })

  const opsDb = new Database(opsRuntimeDbPath)
  let lockReleased = false
  let lockAcquired = false
  let fencingToken: number | undefined
  try {
    opsDb.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`)
    ensureOpsRuntimeSchema(opsDb)
    const lockResult = acquireOpsLock(opsDb, {
      lock_key: SHADOW_LOCK_KEY,
      holder_id: holderId,
      acquired_at: lockNow.toISOString(),
      expires_at: expiresAt.toISOString(),
    })
    if (!lockResult.acquired) {
      return shadowResult({
        cycleId,
        outcome: "skipped_lock",
        reason: "another program shadow wakeup owns the active lease",
        lockAcquired: false,
        lockReleased: false,
      })
    }
    lockAcquired = true
    fencingToken = lockResult.lock.fencing_token
    if (!Number.isInteger(fencingToken) || Number(fencingToken) < 1) {
      throw new Error("program shadow lease omitted a valid fencing token")
    }

    const existingSummary = readCycleSummary(opsDb, cycleId)
    const existingCycle = asRecord(existingSummary.cycle)
    const existingStatus = stringField(existingCycle.status)
    if (TERMINAL_CYCLE_STATUSES.has(existingStatus)) {
      lockReleased = releaseOpsLock(opsDb, SHADOW_LOCK_KEY, holderId, fencingToken)
      return shadowResult({
        cycleId,
        outcome: "skipped_terminal",
        reason: `cycle already reached terminal status ${existingStatus}`,
        lockAcquired: true,
        lockReleased,
        fencingToken,
        priorStatus: existingStatus,
        opsSummary: asRecord(existingSummary.ops_summary),
      })
    }

    const recoveredRunningCycle = existingStatus === "running"
    const graphInput = fixedShadowGraphInput(
      input,
      cycleId,
      cycleNow,
      opsRuntimeDbPath,
      holderId,
      lockNow.toISOString(),
    )
    const graph = await runAutomationJobGraph(
      tradeDb,
      tradeDbPath,
      graphInput,
      executor,
    )
    const activeLock = readOpsLock(opsDb, SHADOW_LOCK_KEY)
    if (activeLock?.holder_id !== holderId || activeLock.fencing_token !== fencingToken) {
      throw new Error("program shadow lost its fenced lease before cycle completion")
    }
    lockReleased = releaseOpsLock(opsDb, SHADOW_LOCK_KEY, holderId, fencingToken)
    return shadowResult({
      cycleId,
      outcome: recoveredRunningCycle ? "recovered_running" : "executed",
      reason: recoveredRunningCycle
        ? "recovered a non-terminal cycle after acquiring its expired or released lease"
        : "executed the fixed no-domain-job shadow profile",
      lockAcquired: true,
      lockReleased,
      fencingToken,
      graph,
    })
  } catch (error) {
    if (isSqliteBusy(error)) {
      return shadowResult({
        cycleId,
        outcome: "ops_store_busy",
        reason: `ops runtime store remained busy after ${SQLITE_BUSY_TIMEOUT_MS}ms`,
        lockAcquired,
        lockReleased: false,
        fencingToken,
      })
    }
    throw error
  } finally {
    if (!lockReleased && lockAcquired) {
      try {
        releaseOpsLock(opsDb, SHADOW_LOCK_KEY, holderId, fencingToken)
      } catch (error) {
        if (!isSqliteBusy(error)) throw error
      }
    }
    opsDb.close()
  }
}

function fixedShadowGraphInput(
  input: ProgramShadowInput,
  cycleId: string,
  now: string,
  opsRuntimeDbPath: string,
  holderId: string,
  attemptNow: string,
): JSONRecord {
  const attemptId = safeAttemptId(holderId)
  return {
    cycle_id: cycleId,
    now,
    ops_runtime_db: opsRuntimeDbPath,
    command_timeout_ms: 30_000,
    execute_jobs: true,
    allow_live_writes: false,
    include_runtime_health: true,
    include_account_reconcile: false,
    include_fast_track: false,
    include_slow_track: false,
    include_rd_strategy_supervisor: false,
    include_rd_trackers: false,
    include_closed_flow_review: false,
    include_catalog_hygiene: false,
    include_control_effectiveness_review: true,
    include_ops_notify: true,
    runtime_health: {
      ...asRecord(input.runtime_health),
      require_l2_ready: true,
      require_l2_watch_consumer_ready: true,
      health_id: `health-${cycleId}-${attemptId}`,
      observed_at: attemptNow,
    },
    control_effectiveness_review: {
      review_id: `control-review-${cycleId}-${attemptId}`,
      now: attemptNow,
    },
    ops_notify: {
      dry_run: true,
      notify_id: `notify-${cycleId}-${attemptId}`,
      attempted_at: attemptNow,
    },
  }
}

function shadowResult(input: {
  cycleId: string
  outcome: "executed" | "recovered_running" | "skipped_lock" | "skipped_terminal" | "ops_store_busy"
  reason: string
  lockAcquired: boolean
  lockReleased: boolean
  priorStatus?: string
  opsSummary?: JSONRecord
  graph?: JSONRecord
  fencingToken?: number
}): JSONRecord {
  return {
    schema_version: "trade-flow.program-shadow-wakeup-result.v1",
    runtime_profile: "shadow_program",
    cycle_id: input.cycleId,
    outcome: input.outcome,
    reason: input.reason,
    safety: {
      domain_jobs_enabled: false,
      live_writes_allowed: false,
      notify_dry_run: true,
      l2_owner_health_required: true,
      l2_consumer_health_required: true,
    },
    lease: {
      lock_key: SHADOW_LOCK_KEY,
      acquired: input.lockAcquired,
      released: input.lockReleased,
      ...(input.fencingToken ? { fencing_token: input.fencingToken } : {}),
    },
    ...(input.priorStatus ? { prior_status: input.priorStatus } : {}),
    ...(input.opsSummary ? { ops_summary: input.opsSummary } : {}),
    ...(input.graph ? { job_graph: input.graph } : {}),
  }
}

function assertClosedWorldInput(input: JSONRecord): void {
  const unsupported = Object.keys(input).filter((key) => !ALLOWED_INPUT_KEYS.has(key))
  if (unsupported.length > 0) {
    throw new Error(`program shadow input does not allow: ${unsupported.sort().join(", ")}`)
  }
  if (Object.hasOwn(input, "runtime_health") && !isRecord(input.runtime_health)) {
    throw new Error("runtime_health must be an object")
  }
}

function normalizeCycleNow(value: unknown, fallback: Date): string {
  const text = stringField(value)
  const parsed = text ? new Date(text) : fallback
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("now must be a valid timestamp")
  }
  return parsed.toISOString()
}

function normalizeCycleId(value: unknown, now: string): string {
  const explicit = stringField(value)
  if (explicit) {
    if (!/^[A-Za-z0-9._:-]+$/.test(explicit)) {
      throw new Error("cycle_id may contain only ASCII letters, digits, dot, underscore, colon, or hyphen")
    }
    return explicit
  }
  const slot = new Date(now)
  slot.setUTCSeconds(0, 0)
  return `program-shadow-${slot.toISOString().replace(/[:.]/g, "-")}`
}

function safeAttemptId(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_-]/g, "-").replace(/^-+|-+$/g, "")
  return normalized || crypto.randomUUID()
}

function isRecord(value: unknown): value is JSONRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function asRecord(value: unknown): JSONRecord {
  return isRecord(value) ? value : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function isSqliteBusy(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = stringField((error as Error & { code?: unknown }).code)
  return code === "SQLITE_BUSY" || /database is (?:locked|busy)/i.test(error.message)
}
