import { dirname } from "node:path"
import { appendCronLog, acquireCronLock, releaseCronLock } from "./cron-runtime"
import { activeFlows as readActiveFlows } from "./flow-projector-client"
import { resolveRegisteredOwnerTool } from "../../../../../contracts/runtime-core/src/owner-tool-registry"
import { runJsonCommand } from "../../../../../contracts/runtime-core/src/tool-runner"
import type { TrackMode } from "../commands/types"

export const TRACK_DRY_RUN_TRACKS = ["slow", "fast"] as const
export const TRACK_DRY_RUN_MODES = ["dry-run", "analysis-only", "workflow-dry-run"] as const

export function buildTrackDryRunSummary(dbPath: string, track: Exclude<TrackMode, "">): Record<string, unknown> {
  const projection = readActiveFlows(dbPath)
  const activeFlows = Array.isArray(projection.active_flows) ? projection.active_flows : []
  const laneConflicts = Array.isArray(projection.lane_conflicts) ? projection.lane_conflicts : []
  return {
    track,
    mode: "dry-run",
    executable: false,
    active_flow_count: activeFlows.length,
    lane_conflicts: laneConflicts,
    active_flows: activeFlows,
    planned_steps: track === "slow" ? slowTrackSteps() : fastTrackSteps(),
  }
}

export function runTrackDryRun(dbPath: string, track: Exclude<TrackMode, "">, dataDir: string): Record<string, unknown> {
  return runTrackDryRunWithLock(track, dataDir, (lock) => ({
    ...buildTrackDryRunSummary(dbPath, track),
    run_id: lock.lock.run_id,
  }))
}

export async function runTrackDryRunAtPath(dbPath: string, track: Exclude<TrackMode, "">): Promise<Record<string, unknown>> {
  const dataDir = dirname(dbPath)
  return runTrackDryRunWithLockAsync(track, dataDir, async (lock) => {
    if (track === "slow" || track === "fast") {
      return await runOwnerTrackTool(track, dbPath, lock.lock.run_id)
    }
    return {
      ...buildTrackDryRunSummary(dbPath, track),
      run_id: lock.lock.run_id,
    }
  })
}

async function runOwnerTrackTool(track: "slow" | "fast", dbPath: string, runId: string): Promise<Record<string, unknown>> {
  const toolId = track === "slow" ? "decision.slow-track-plan" : "execution.fast-track-guard"
  const command = resolveRegisteredOwnerTool(toolId, ["--db", dbPath, "--json", JSON.stringify({ run_id: runId })])
  const result = await runJsonCommand(command.argv, { cwd: command.cwd })
  if (!result.ok) {
    throw new Error(`${track} track owner tool failed: ${result.error}${result.stderr ? `; ${result.stderr.trim()}` : ""}`)
  }
  const response = result.data && typeof result.data === "object" ? result.data as Record<string, unknown> : {}
  if (response.ok === false) {
    throw new Error(`${track} track owner tool returned ok=false: ${typeof response.error === "string" ? response.error : "unknown error"}`)
  }
  const data = response.data && typeof response.data === "object" ? response.data as Record<string, unknown> : response
  return data
}

async function runTrackDryRunWithLockAsync(
  track: Exclude<TrackMode, "">,
  dataDir: string,
  runLocked: (lock: ReturnType<typeof acquireCronLock>) => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const triggeredAt = new Date()
  const lock = acquireCronLock({ dataDir, track, now: triggeredAt })
  if (!lock.acquired) {
    const logPath = appendCronLog(dataDir, {
      run_id: lock.lock.run_id,
      track,
      triggered_at: triggeredAt.toISOString(),
      duration_ms: 0,
      status: "skipped_lock",
      chains_processed: 0,
      actions_taken: [],
      errors: [`active_lock:${lock.active_lock?.track ?? "unknown"}`],
    })
    return {
      track,
      mode: "dry-run",
      executable: false,
      skipped: true,
      skip_reason: "active_lock",
      run_id: lock.lock.run_id,
      active_lock: lock.active_lock ?? null,
      cron_log_path: logPath,
    }
  }

  try {
    const summary = await runLocked(lock)
    const activeFlowCount = Number(summary.active_flow_count) || 0
    const logPath = appendCronLog(dataDir, {
      run_id: lock.lock.run_id,
      track,
      triggered_at: triggeredAt.toISOString(),
      duration_ms: Date.now() - triggeredAt.getTime(),
      status: "completed",
      chains_processed: activeFlowCount,
      actions_taken: readActions(summary),
      errors: readErrors(summary),
    })
    return {
      ...summary,
      cron_log_path: logPath,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    appendCronLog(dataDir, {
      run_id: lock.lock.run_id,
      track,
      triggered_at: triggeredAt.toISOString(),
      duration_ms: Date.now() - triggeredAt.getTime(),
      status: "failed",
      chains_processed: 0,
      actions_taken: [],
      errors: [message],
    })
    throw error
  } finally {
    releaseCronLock(lock)
  }
}

function runTrackDryRunWithLock(
  track: Exclude<TrackMode, "">,
  dataDir: string,
  runLocked: (lock: ReturnType<typeof acquireCronLock>) => Record<string, unknown>,
): Record<string, unknown> {
  const triggeredAt = new Date()
  const lock = acquireCronLock({ dataDir, track, now: triggeredAt })
  if (!lock.acquired) {
    const logPath = appendCronLog(dataDir, {
      run_id: lock.lock.run_id,
      track,
      triggered_at: triggeredAt.toISOString(),
      duration_ms: 0,
      status: "skipped_lock",
      chains_processed: 0,
      actions_taken: [],
      errors: [`active_lock:${lock.active_lock?.track ?? "unknown"}`],
    })
    return {
      track,
      mode: "dry-run",
      executable: false,
      skipped: true,
      skip_reason: "active_lock",
      run_id: lock.lock.run_id,
      active_lock: lock.active_lock ?? null,
      cron_log_path: logPath,
    }
  }

  try {
    const summary = runLocked(lock)
    const activeFlowCount = Number(summary.active_flow_count) || 0
    const logPath = appendCronLog(dataDir, {
      run_id: lock.lock.run_id,
      track,
      triggered_at: triggeredAt.toISOString(),
      duration_ms: Date.now() - triggeredAt.getTime(),
      status: "completed",
      chains_processed: activeFlowCount,
      actions_taken: [],
      errors: [],
    })
    return {
      ...summary,
      cron_log_path: logPath,
    }
  } finally {
    releaseCronLock(lock)
  }
}

function slowTrackSteps(): string[] {
  return [
    "recover_or_abort",
    "observe_full",
    "plan_and_preflight",
    "executor_trigger_check",
    "execute_or_append_blocked_observe",
    "review_if_closed",
    "cron_log",
  ]
}

function fastTrackSteps(): string[] {
  return [
    "reduce_active_flows",
    "observe_light_reconcile",
    "trigger_condition_check",
    "deterministic_execution_gates",
    "fast_preflight_subset",
    "execute_or_append_light_observe",
    "cron_log",
  ]
}

function readActions(summary: Record<string, unknown>): string[] {
  const decision = summary.trade_decision && typeof summary.trade_decision === "object"
    ? summary.trade_decision as Record<string, unknown>
    : {}
  const action = typeof decision.target_action === "string" ? decision.target_action : ""
  return action ? [action] : []
}

function readErrors(summary: Record<string, unknown>): string[] {
  const errors: string[] = []
  const account = summary.account_state && typeof summary.account_state === "object"
    ? summary.account_state as Record<string, unknown>
    : {}
  if (account.ok === false && typeof account.error === "string") {
    errors.push(`account_snapshot:${account.error}`)
  }
  const market = summary.market_scan && typeof summary.market_scan === "object"
    ? summary.market_scan as Record<string, unknown>
    : {}
  if (market.ok === false && typeof market.error === "string") {
    errors.push(`market_scan:${market.error}`)
  }
  return errors
}
