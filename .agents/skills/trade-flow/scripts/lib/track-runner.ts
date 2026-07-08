import { Database } from "bun:sqlite"
import { findActiveLaneConflicts, listActiveFlows } from "./flow-state"
import type { TrackMode } from "../commands/types"

export function buildTrackDryRunSummary(db: Database, track: Exclude<TrackMode, "">): Record<string, unknown> {
  const activeFlows = listActiveFlows(db)
  const laneConflicts = findActiveLaneConflicts(activeFlows)
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
