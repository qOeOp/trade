import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { Database } from "bun:sqlite"
import {
  acquireOpsLock,
  ensureOpsRuntimeSchema,
  releaseOpsLock,
  renewOpsLock,
  type OpsLockAcquisition,
} from "../../../../ops-runtime-store/src/lib/ops-runtime-store"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { assertProjectRuntimePath, resolveRepoPath } from "../../../../../contracts/runtime-core/src/paths"
import { executeCommand, type CommandExecutor } from "./job-graph-runner"
import { runProgramShadowWakeup } from "./program-shadow"
import type { ProgramRuntimeProfile } from "./program-shadow"
import { createParityCommandRecorder, observeProgramShadowParity } from "./program-shadow-parity"

const SUPERVISOR_LOCK_KEY = "program-runtime-shadow-supervisor"
const SUPERVISOR_LEASE_MS = 20_000
const SUPERVISOR_HEARTBEAT_MS = 5_000
const SQLITE_BUSY_TIMEOUT_MS = 1_000
const DEFAULT_INTERVAL_SECONDS = 60
const ALLOWED_INPUT_KEYS = new Set([
  "ops_runtime_db",
  "runtime_health",
  "interval_seconds",
  "max_cycles",
  "duration_seconds",
  "observe_agent_parity",
  "runtime_profile",
  "rd_state_db",
  "rd_program_id",
  "rd_trackers",
  "catalog_db",
  "catalog_roots",
  "governance_db",
])

export interface ProgramShadowSupervisorInput {
  ops_runtime_db?: string
  runtime_health?: JSONRecord
  interval_seconds?: number
  max_cycles?: number
  duration_seconds?: number
  observe_agent_parity?: boolean
  runtime_profile?: ProgramRuntimeProfile
  rd_state_db?: string
  rd_program_id?: string
  rd_trackers?: JSONRecord[]
  catalog_db?: string
  catalog_roots?: string[]
  governance_db?: string
}

export interface ProgramShadowSupervisorDependencies {
  clock?: () => Date
  holderId?: () => string
  signal?: AbortSignal
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<"elapsed" | "aborted">
}

export async function runProgramShadowSupervisor(
  tradeDb: Database,
  tradeDbPath: string,
  rawInput: JSONRecord = {},
  executor?: CommandExecutor,
  dependencies: ProgramShadowSupervisorDependencies = {},
): Promise<JSONRecord> {
  assertClosedWorldInput(rawInput)
  const input = normalizeInput(rawInput as ProgramShadowSupervisorInput)
  const clock = dependencies.clock ?? (() => new Date())
  const sleeper = dependencies.sleep ?? sleep
  const signal = dependencies.signal
  const startedAt = clock()
  const supervisorId = dependencies.holderId?.() || `program-shadow-supervisor:${crypto.randomUUID()}`
  const configuredOpsRuntimeDbPath = input.ops_runtime_db || "./data/ops_runtime.db"
  assertProjectRuntimePath(configuredOpsRuntimeDbPath)
  const opsRuntimeDbPath = resolveRepoPath(configuredOpsRuntimeDbPath)
  mkdirSync(dirname(opsRuntimeDbPath), { recursive: true })

  const opsDb = new Database(opsRuntimeDbPath)
  let fencingToken: number | undefined
  let leaseReleased = false
  let leaseLost = false
  let opsStoreBusy = false
  let recoveredStaleLease = false
  let heartbeat: ReturnType<typeof setInterval> | undefined
  const counts = {
    attempted: 0,
    executed: 0,
    recovered_running: 0,
    skipped_terminal: 0,
    skipped_lock: 0,
    ops_store_busy: 0,
    failed: 0,
  }
  const parityCounts = {
    attempted: 0,
    matched: 0,
    mismatched: 0,
  }
  let lastCycleId = ""
  let lastWakeup: JSONRecord | undefined
  let lastParityObservation: JSONRecord | undefined
  let stopReason = ""

  try {
    let acquired: OpsLockAcquisition
    try {
      opsDb.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`)
      ensureOpsRuntimeSchema(opsDb)
      acquired = acquireOpsLock(opsDb, {
        lock_key: SUPERVISOR_LOCK_KEY,
        holder_id: supervisorId,
        acquired_at: startedAt.toISOString(),
        expires_at: new Date(startedAt.getTime() + SUPERVISOR_LEASE_MS).toISOString(),
      })
    } catch (error) {
      if (!isSqliteBusy(error)) throw error
      return supervisorResult({
        supervisorId,
        outcome: "ops_store_busy",
        stopReason: "ops_store_busy",
        startedAt: startedAt.toISOString(),
        finishedAt: clock().toISOString(),
        input,
        counts,
        parityCounts,
        leaseAcquired: false,
        leaseReleased: false,
      })
    }
    if (!acquired.acquired) {
      return supervisorResult({
        supervisorId,
        outcome: "skipped_lock",
        stopReason: "active_supervisor",
        startedAt: startedAt.toISOString(),
        finishedAt: clock().toISOString(),
        input,
        counts,
        parityCounts,
        leaseAcquired: false,
        leaseReleased: false,
      })
    }
    recoveredStaleLease = acquired.recovered_stale
    fencingToken = acquired.lock.fencing_token
    if (!Number.isInteger(fencingToken) || Number(fencingToken) < 1) {
      throw new Error("program shadow supervisor lease omitted a valid fencing token")
    }

    const renewLease = (): boolean => {
      if (!fencingToken || leaseLost) return false
      const now = clock()
      try {
        const renewed = renewOpsLock(opsDb, {
          lock_key: SUPERVISOR_LOCK_KEY,
          holder_id: supervisorId,
          fencing_token: fencingToken,
          renewed_at: now.toISOString(),
          expires_at: new Date(now.getTime() + SUPERVISOR_LEASE_MS).toISOString(),
        })
        leaseLost = !renewed.renewed
      } catch (error) {
        opsStoreBusy = isSqliteBusy(error)
        leaseLost = true
      }
      return !leaseLost
    }
    heartbeat = setInterval(renewLease, SUPERVISOR_HEARTBEAT_MS)

    const intervalMs = input.interval_seconds * 1_000
    let slotAt = floorToSlot(startedAt, intervalMs)
    while (true) {
      if (signal?.aborted) {
        stopReason = "signal"
        break
      }
      if (input.duration_seconds > 0 && clock().getTime() - startedAt.getTime() >= input.duration_seconds * 1_000) {
        stopReason = "duration"
        break
      }
      if (!renewLease()) {
        stopReason = opsStoreBusy ? "ops_store_busy" : "lease_lost"
        break
      }

      const cycleId = cycleIdForSlot(slotAt)
      const parityRecorder = input.observe_agent_parity
        ? createParityCommandRecorder(executor ?? executeCommand)
        : undefined
      const wakeup = await runProgramShadowWakeup(
        tradeDb,
        tradeDbPath,
        {
          cycle_id: cycleId,
          now: slotAt.toISOString(),
          ops_runtime_db: opsRuntimeDbPath,
          runtime_profile: input.runtime_profile,
          ...(input.runtime_health ? { runtime_health: input.runtime_health } : {}),
          ...(input.rd_state_db ? { rd_state_db: input.rd_state_db } : {}),
          ...(input.rd_program_id ? { rd_program_id: input.rd_program_id } : {}),
          ...(input.rd_trackers ? { rd_trackers: input.rd_trackers } : {}),
          ...(input.catalog_db ? { catalog_db: input.catalog_db } : {}),
          ...(input.catalog_roots ? { catalog_roots: input.catalog_roots } : {}),
          ...(input.governance_db ? { governance_db: input.governance_db } : {}),
        },
        parityRecorder?.record ?? executor,
        {
          clock,
          holderId: () => `${supervisorId}:${cycleId}`,
        },
      )
      counts.attempted += 1
      lastCycleId = cycleId
      lastWakeup = wakeup
      const wakeupOutcome = stringField(wakeup.outcome)
      if (Object.hasOwn(counts, wakeupOutcome)) {
        counts[wakeupOutcome as keyof typeof counts] += 1
      }
      const graph = asRecord(wakeup.job_graph)
      if ((wakeupOutcome === "executed" || wakeupOutcome === "recovered_running") && graph.ok === false) {
        counts.failed += 1
      }
      if (wakeupOutcome === "ops_store_busy") {
        opsStoreBusy = true
        stopReason = "ops_store_busy"
        break
      }
      if (input.observe_agent_parity && (wakeupOutcome === "executed" || wakeupOutcome === "recovered_running")) {
        try {
          parityCounts.attempted += 1
          const observedAt = clock().toISOString()
          lastParityObservation = await observeProgramShadowParity(
            tradeDb,
            tradeDbPath,
            {
              program_cycle_id: cycleId,
              agent_cycle_id: agentCycleIdForSlot(slotAt),
              now: slotAt.toISOString(),
              observed_at: observedAt,
              ops_runtime_db: opsRuntimeDbPath,
              program_graph: graph,
              runtime_profile: input.runtime_profile,
              ...(input.runtime_health ? { runtime_health: input.runtime_health } : {}),
              ...(input.rd_state_db ? { rd_state_db: input.rd_state_db } : {}),
              ...(input.rd_program_id ? { rd_program_id: input.rd_program_id } : {}),
              ...(input.rd_trackers ? { rd_trackers: input.rd_trackers } : {}),
              ...(input.catalog_db ? { catalog_db: input.catalog_db } : {}),
              ...(input.catalog_roots ? { catalog_roots: input.catalog_roots } : {}),
              ...(input.governance_db ? { governance_db: input.governance_db } : {}),
            },
            parityRecorder?.replay,
          )
          if (lastParityObservation.status === "match") parityCounts.matched += 1
          else parityCounts.mismatched += 1
        } catch (error) {
          if (!isSqliteBusy(error)) throw error
          opsStoreBusy = true
          stopReason = "ops_store_busy"
          break
        }
      }

      if (!renewLease()) {
        stopReason = opsStoreBusy ? "ops_store_busy" : "lease_lost"
        break
      }
      if (signal?.aborted) {
        stopReason = "signal"
        break
      }
      if (input.max_cycles > 0 && counts.attempted >= input.max_cycles) {
        stopReason = "max_cycles"
        break
      }
      slotAt = nextFutureSlot(slotAt, intervalMs, clock())
      const currentTime = clock().getTime()
      const slotWaitMs = Math.max(0, slotAt.getTime() - currentTime)
      const durationWaitMs = input.duration_seconds > 0
        ? Math.max(0, startedAt.getTime() + input.duration_seconds * 1_000 - currentTime)
        : slotWaitMs
      const waitMs = Math.min(slotWaitMs, durationWaitMs)
      if (await sleeper(waitMs, signal) === "aborted") {
        stopReason = "signal"
        break
      }
    }

    if (heartbeat) clearInterval(heartbeat)
    try {
      leaseReleased = releaseOpsLock(opsDb, SUPERVISOR_LOCK_KEY, supervisorId, fencingToken)
    } catch (error) {
      if (!isSqliteBusy(error)) throw error
      opsStoreBusy = true
      leaseLost = true
      stopReason = "ops_store_busy"
    }
    return supervisorResult({
      supervisorId,
      outcome: opsStoreBusy ? "ops_store_busy" : leaseLost ? "lease_lost" : "completed",
      stopReason: stopReason || "signal",
      startedAt: startedAt.toISOString(),
      finishedAt: clock().toISOString(),
      input,
      counts,
      parityCounts,
      leaseAcquired: true,
      leaseReleased,
      fencingToken,
      recoveredStaleLease,
      lastCycleId,
      lastWakeup,
      lastParityObservation,
    })
  } finally {
    if (heartbeat) clearInterval(heartbeat)
    if (!leaseReleased && fencingToken) {
      try {
        leaseReleased = releaseOpsLock(opsDb, SUPERVISOR_LOCK_KEY, supervisorId, fencingToken)
      } catch (error) {
        if (!isSqliteBusy(error)) throw error
      }
    }
    opsDb.close()
  }
}

function supervisorResult(input: {
  supervisorId: string
  outcome: "completed" | "lease_lost" | "skipped_lock" | "ops_store_busy"
  stopReason: string
  startedAt: string
  finishedAt: string
  input: Required<Pick<ProgramShadowSupervisorInput, "interval_seconds" | "max_cycles" | "duration_seconds">> & ProgramShadowSupervisorInput
  counts: Record<string, number>
  parityCounts: Record<string, number>
  leaseAcquired: boolean
  leaseReleased: boolean
  fencingToken?: number
  recoveredStaleLease?: boolean
  lastCycleId?: string
  lastWakeup?: JSONRecord
  lastParityObservation?: JSONRecord
}): JSONRecord {
  return {
    schema_version: "trade-flow.program-shadow-supervisor-result.v1",
    runtime_profile: input.input.runtime_profile || "shadow_program",
    supervisor_id: input.supervisorId,
    outcome: input.outcome,
    stop_reason: input.stopReason,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    cadence: {
      interval_seconds: input.input.interval_seconds,
      max_cycles: input.input.max_cycles,
      duration_seconds: input.input.duration_seconds,
    },
    cycles: {
      ...input.counts,
      ...(input.lastCycleId ? { last_cycle_id: input.lastCycleId } : {}),
    },
    parity_observation: {
      enabled: input.input.observe_agent_parity === true,
      ...input.parityCounts,
      ...(input.lastParityObservation ? { last: input.lastParityObservation } : {}),
    },
    safety: {
      foreground_process: true,
      external_process_manager_required: true,
      domain_jobs_enabled: input.input.runtime_profile === "full_shadow",
      live_writes_allowed: false,
      notify_dry_run: true,
      drain_in_flight_cycle_on_signal: true,
    },
    lease: {
      lock_key: SUPERVISOR_LOCK_KEY,
      acquired: input.leaseAcquired,
      released: input.leaseReleased,
      recovered_stale: input.recoveredStaleLease === true,
      ...(input.fencingToken ? { fencing_token: input.fencingToken } : {}),
    },
    ...(input.lastWakeup ? { last_wakeup: input.lastWakeup } : {}),
  }
}

function normalizeInput(input: ProgramShadowSupervisorInput): Required<Pick<ProgramShadowSupervisorInput, "interval_seconds" | "max_cycles" | "duration_seconds">> & ProgramShadowSupervisorInput {
  return {
    ...input,
    interval_seconds: boundedInteger(input.interval_seconds, DEFAULT_INTERVAL_SECONDS, 1, 3_600, "interval_seconds"),
    max_cycles: boundedInteger(input.max_cycles, 0, 0, 100_000, "max_cycles"),
    duration_seconds: boundedInteger(input.duration_seconds, 0, 0, 86_400, "duration_seconds"),
    observe_agent_parity: input.observe_agent_parity === true,
    runtime_profile: normalizeRuntimeProfile(input.runtime_profile),
  }
}

function assertClosedWorldInput(input: JSONRecord): void {
  const unsupported = Object.keys(input).filter((key) => !ALLOWED_INPUT_KEYS.has(key))
  if (unsupported.length > 0) {
    throw new Error(`program shadow supervisor input does not allow: ${unsupported.sort().join(", ")}`)
  }
  if (Object.hasOwn(input, "runtime_health") && !isRecord(input.runtime_health)) {
    throw new Error("runtime_health must be an object")
  }
  if (Object.hasOwn(input, "observe_agent_parity") && typeof input.observe_agent_parity !== "boolean") {
    throw new Error("observe_agent_parity must be a boolean")
  }
  normalizeRuntimeProfile(input.runtime_profile)
  if (input.runtime_profile !== "full_shadow" && ["rd_state_db", "rd_program_id", "rd_trackers", "catalog_db", "catalog_roots", "governance_db"].some((key) => Object.hasOwn(input, key))) {
    throw new Error("domain job configuration is allowed only for runtime_profile=full_shadow")
  }
  if (Object.hasOwn(input, "rd_trackers") && !Array.isArray(input.rd_trackers)) throw new Error("rd_trackers must be an array")
  if (Object.hasOwn(input, "catalog_roots") && !Array.isArray(input.catalog_roots)) throw new Error("catalog_roots must be an array")
}

function normalizeRuntimeProfile(value: unknown): ProgramRuntimeProfile {
  const profile = stringField(value) || "shadow_program"
  if (profile !== "shadow_program" && profile !== "full_shadow") {
    throw new Error("supervisor runtime_profile must be shadow_program or full_shadow")
  }
  return profile
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return Number(value)
}

function floorToSlot(now: Date, intervalMs: number): Date {
  return new Date(Math.floor(now.getTime() / intervalMs) * intervalMs)
}

function nextFutureSlot(previous: Date, intervalMs: number, now: Date): Date {
  let next = previous.getTime() + intervalMs
  while (next <= now.getTime()) next += intervalMs
  return new Date(next)
}

function cycleIdForSlot(slot: Date): string {
  return `program-shadow-${slot.toISOString().replace(/[:.]/g, "-")}`
}

function agentCycleIdForSlot(slot: Date): string {
  return `agent-shadow-${slot.toISOString().replace(/[:.]/g, "-")}`
}

async function sleep(milliseconds: number, signal?: AbortSignal): Promise<"elapsed" | "aborted"> {
  if (signal?.aborted) return "aborted"
  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      resolve("aborted")
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve("elapsed")
    }, milliseconds)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
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
