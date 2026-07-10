import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs"
import { join } from "node:path"
import type { TrackMode } from "../commands/types"
import { displayPath } from "./paths"
import { registerCatalogArtifact } from "./data-catalog"

export const CRON_LOG_TRACKS = ["slow", "fast"] as const
export const CRON_LOG_STATUSES = ["completed", "skipped_lock", "failed"] as const
export type CronLogStatus = typeof CRON_LOG_STATUSES[number]

export interface CronLock {
  run_id: string
  track: Exclude<TrackMode, "">
  pid: number
  start_time: string
}

export interface CronLockResult {
  acquired: boolean
  lock_path: string
  lock: CronLock
  active_lock?: CronLock
}

export interface CronLogEntry {
  run_id: string
  track: Exclude<TrackMode, "">
  triggered_at: string
  duration_ms: number
  status: CronLogStatus
  chains_processed: number
  actions_taken: string[]
  errors: string[]
  next_cron_at?: string
}

const DEFAULT_STALE_MS = 10 * 60 * 1000

export function acquireCronLock(input: {
  dataDir: string
  track: Exclude<TrackMode, "">
  now?: Date
  staleMs?: number
  runId?: string
}): CronLockResult {
  mkdirSync(input.dataDir, { recursive: true })
  const now = input.now ?? new Date()
  const lockPath = join(input.dataDir, ".trade-flow.lock")
  const lock: CronLock = {
    run_id: input.runId || crypto.randomUUID(),
    track: input.track,
    pid: process.pid,
    start_time: now.toISOString(),
  }

  try {
    writeFileSync(lockPath, JSON.stringify(lock, null, 2), { flag: "wx" })
    return { acquired: true, lock_path: lockPath, lock }
  } catch (error) {
    if (!existsSync(lockPath)) {
      throw error
    }
    const activeLock = readLock(lockPath)
    if (activeLock && isStaleLock(activeLock, now, input.staleMs ?? DEFAULT_STALE_MS)) {
      rmSync(lockPath, { force: true })
      writeFileSync(lockPath, JSON.stringify(lock, null, 2), { flag: "wx" })
      return { acquired: true, lock_path: lockPath, lock, active_lock: activeLock }
    }
    return {
      acquired: false,
      lock_path: lockPath,
      lock,
      ...(activeLock ? { active_lock: activeLock } : {}),
    }
  }
}

export function releaseCronLock(result: CronLockResult): void {
  if (!result.acquired) {
    return
  }
  const active = readLock(result.lock_path)
  if (active?.run_id === result.lock.run_id) {
    rmSync(result.lock_path, { force: true })
  }
}

export function appendCronLog(dataDir: string, entry: CronLogEntry): string {
  mkdirSync(dataDir, { recursive: true })
  const logPath = join(dataDir, "cron.log")
  appendFileSync(logPath, `${JSON.stringify(entry)}\n`)
  registerCatalogArtifact({
    catalogDbPath: join(dataDir, "data_catalog.db"),
    path: logPath,
    now: entry.triggered_at,
    referrerType: "run",
    referrerID: entry.run_id,
    role: "log",
  })
  return displayPath(logPath)
}

function readLock(path: string): CronLock | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CronLock
  } catch {
    return null
  }
}

function isStaleLock(lock: CronLock, now: Date, staleMs: number): boolean {
  const startedAt = Date.parse(lock.start_time)
  return Number.isFinite(startedAt) && now.getTime() - startedAt > staleMs
}
