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
  buildDatabaseIdentity,
  ensureDatabaseIdentity,
} from "../../../../../contracts/runtime-core/src/database-identity"
import {
  runAutomationJobGraph,
  type CommandExecutor,
} from "./job-graph-runner"

const SHADOW_LOCK_KEY = "program-runtime-shadow"
const SHADOW_LEASE_MS = 5 * 60 * 1000
const SQLITE_BUSY_TIMEOUT_MS = 1_000
const OPS_ONLY_COMMAND_TIMEOUT_MS = 30_000
const DOMAIN_COMMAND_TIMEOUT_MS = 90_000
const TERMINAL_CYCLE_STATUSES = new Set(["completed", "failed", "blocked"])
const ALLOWED_INPUT_KEYS = new Set([
  "cycle_id",
  "now",
  "ops_runtime_db",
  "runtime_profile",
  "runtime_health",
  "rd_state_db",
  "rd_program_id",
  "rd_trackers",
  "catalog_db",
  "catalog_roots",
  "governance_db",
])

export type ProgramRuntimeProfile =
  | "shadow_program"
  | "demand_driven_shadow"
  | "catalog_hygiene_canary"
  | "full_shadow"

export interface ProgramShadowInput {
  cycle_id?: string
  now?: string
  ops_runtime_db?: string
  runtime_profile?: ProgramRuntimeProfile
  runtime_health?: JSONRecord
  rd_state_db?: string
  rd_program_id?: string
  rd_trackers?: JSONRecord[]
  catalog_db?: string
  catalog_roots?: string[]
  governance_db?: string
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
  const runtimeProfile = normalizeRuntimeProfile(input.runtime_profile)
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
    ensureDatabaseIdentity(opsDb, buildDatabaseIdentity("local:local", "ops_runtime_store"))
    ensureOpsRuntimeSchema(opsDb)
    const lockResult = acquireOpsLock(opsDb, {
      lock_key: SHADOW_LOCK_KEY,
      holder_id: holderId,
      acquired_at: lockNow.toISOString(),
      expires_at: expiresAt.toISOString(),
    })
    if (!lockResult.acquired) {
      return shadowResult({
        runtimeProfile,
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
        runtimeProfile,
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
      runtimeProfile,
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
    const executionReason = runtimeProfile === "catalog_hygiene_canary"
      ? "executed the fixed J06 catalog hygiene canary profile"
      : runtimeProfile === "full_shadow"
        ? "executed the fixed J01-J07 no-live full shadow profile"
        : runtimeProfile === "demand_driven_shadow"
          ? "executed the demand-driven no-domain-job shadow profile"
        : "executed the fixed no-domain-job shadow profile"
    return shadowResult({
      runtimeProfile,
      cycleId,
      outcome: recoveredRunningCycle ? "recovered_running" : "executed",
      reason: recoveredRunningCycle
        ? "recovered a non-terminal cycle after acquiring its expired or released lease"
        : graph.ok === true ? executionReason : `${executionReason}; job graph completed with failures`,
      lockAcquired: true,
      lockReleased,
      fencingToken,
      graph,
    })
  } catch (error) {
    if (isSqliteBusy(error)) {
      return shadowResult({
        runtimeProfile,
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
  runtimeProfile: ProgramRuntimeProfile,
): JSONRecord {
  const attemptId = safeAttemptId(holderId)
  const catalogHygieneCanary = runtimeProfile === "catalog_hygiene_canary"
  const fullShadow = runtimeProfile === "full_shadow"
  const requiresFixedL2 = runtimeProfile !== "demand_driven_shadow"
  const forcedDomainJobs = [
    "account_reconcile_guard",
    "fast_track_guard",
    "slow_track_market_watch",
    "rd_strategy_supervisor",
    "rd_forward_shadow_trackers",
    "catalog_hygiene_scan",
    "closed_flow_review_sweep",
  ]
  return {
    cycle_id: cycleId,
    now,
    ops_runtime_db: opsRuntimeDbPath,
    command_timeout_ms: runtimeProfile === "shadow_program"
      ? OPS_ONLY_COMMAND_TIMEOUT_MS
      : DOMAIN_COMMAND_TIMEOUT_MS,
    execute_jobs: true,
    allow_live_writes: false,
    include_runtime_health: true,
    include_account_reconcile: fullShadow,
    include_fast_track: fullShadow,
    include_slow_track: fullShadow,
    include_rd_strategy_supervisor: fullShadow,
    include_rd_trackers: fullShadow,
    include_closed_flow_review: fullShadow,
    include_catalog_hygiene: catalogHygieneCanary || fullShadow,
    ...(catalogHygieneCanary ? { force_jobs: ["catalog_hygiene_scan"] } : {}),
    ...(fullShadow ? {
      force_jobs: forcedDomainJobs,
      ...(input.rd_state_db ? { rd_state_db: input.rd_state_db } : {}),
      ...(input.rd_program_id ? { rd_program_id: input.rd_program_id } : {}),
      ...(input.rd_trackers ? { rd_trackers: input.rd_trackers } : {}),
      ...(input.catalog_db ? { catalog_db: input.catalog_db } : {}),
      ...(input.catalog_roots ? { catalog_roots: input.catalog_roots } : {}),
      ...(input.governance_db ? { governance_db: input.governance_db } : {}),
    } : {}),
    include_control_effectiveness_review: true,
    include_ops_notify: true,
    runtime_health: {
      ...asRecord(input.runtime_health),
      require_l2_ready: requiresFixedL2,
      require_l2_watch_consumer_ready: requiresFixedL2,
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
  runtimeProfile: ProgramRuntimeProfile
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
  const businessStatus = input.graph
    ? input.graph.ok === true ? "completed" : "failed"
    : input.outcome === "skipped_terminal"
      ? input.priorStatus || "skipped"
      : input.outcome === "ops_store_busy"
        ? "blocked"
        : "skipped"
  return {
    schema_version: "trade-flow.program-shadow-wakeup-result.v1",
    runtime_profile: input.runtimeProfile,
    cycle_id: input.cycleId,
    outcome: input.outcome,
    business_status: businessStatus,
    reason: input.reason,
    safety: {
      domain_jobs_enabled: input.runtimeProfile === "catalog_hygiene_canary" || input.runtimeProfile === "full_shadow",
      enabled_domain_jobs: input.runtimeProfile === "full_shadow"
        ? ["account_reconcile_guard", "fast_track_guard", "slow_track_market_watch", "rd_strategy_supervisor", "rd_forward_shadow_trackers", "catalog_hygiene_scan", "closed_flow_review_sweep"]
        : input.runtimeProfile === "catalog_hygiene_canary" ? ["catalog_hygiene_scan"] : [],
      allowed_domain_writes: input.runtimeProfile === "full_shadow"
        ? ["trade_event_store", "research_state_store", "artifact_catalog", "governance_ledger"]
        : input.runtimeProfile === "catalog_hygiene_canary" ? ["artifact_catalog"] : [],
      live_writes_allowed: false,
      notify_dry_run: true,
      l2_owner_health_required: input.runtimeProfile !== "demand_driven_shadow",
      l2_consumer_health_required: input.runtimeProfile !== "demand_driven_shadow",
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

function normalizeRuntimeProfile(value: unknown): ProgramRuntimeProfile {
  const profile = stringField(value) || "shadow_program"
  if (!["shadow_program", "demand_driven_shadow", "catalog_hygiene_canary", "full_shadow"].includes(profile)) {
    throw new Error("runtime_profile must be shadow_program, demand_driven_shadow, catalog_hygiene_canary, or full_shadow")
  }
  return profile as ProgramRuntimeProfile
}

function assertClosedWorldInput(input: JSONRecord): void {
  const unsupported = Object.keys(input).filter((key) => !ALLOWED_INPUT_KEYS.has(key))
  if (unsupported.length > 0) {
    throw new Error(`program shadow input does not allow: ${unsupported.sort().join(", ")}`)
  }
  if (Object.hasOwn(input, "runtime_health") && !isRecord(input.runtime_health)) {
    throw new Error("runtime_health must be an object")
  }
  const profile = stringField(input.runtime_profile) || "shadow_program"
  const fullShadowKeys = ["rd_state_db", "rd_program_id", "rd_trackers", "catalog_db", "catalog_roots", "governance_db"]
  if (profile !== "full_shadow" && fullShadowKeys.some((key) => Object.hasOwn(input, key))) {
    throw new Error("domain job configuration is allowed only for runtime_profile=full_shadow")
  }
  for (const key of ["rd_state_db", "catalog_db", "governance_db"]) {
    const value = stringField(input[key])
    if (value) assertProjectRuntimePath(value)
  }
  if (Object.hasOwn(input, "rd_trackers") && !Array.isArray(input.rd_trackers)) {
    throw new Error("rd_trackers must be an array")
  }
  if (Object.hasOwn(input, "catalog_roots")) {
    if (!Array.isArray(input.catalog_roots)) throw new Error("catalog_roots must be an array")
    for (const root of input.catalog_roots) assertProjectRuntimePath(String(root))
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
