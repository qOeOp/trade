import { Database } from "bun:sqlite"
import { buildTrackDryRunSummary } from "../lib/track-runner"
import { appendPlanEvent, buildOrderFillEvent } from "../lib/plan-events"
import type { CommandConfig, ScriptResponse } from "./types"

export function handleRuntimeCommand(db: Database, config: CommandConfig): ScriptResponse | null {
  if (config.track) {
    return { ok: true, data: buildTrackDryRunSummary(db, config.track) }
  }
  if (config.init) {
    return { ok: true, data: { initialized: true, dbPath: config.dbPath } }
  }
  if (config.appendOrderFill) {
    const event = buildOrderFillEvent(config.input)
    appendPlanEvent(db, event)
    return { ok: true, data: event }
  }
  return null
}
