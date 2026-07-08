import { Database } from "bun:sqlite"
import { dirname } from "node:path"
import { runTrackDryRun } from "../lib/track-runner"
import { appendPlanEvent, buildOrderFillEvent } from "../lib/plan-events"
import { successResponse } from "./response"
import type { CommandConfig, ScriptResponse } from "./types"

export function handleRuntimeCommand(db: Database, config: CommandConfig): ScriptResponse | null {
  if (config.track) {
    return successResponse(runTrackDryRun(db, config.track, dirname(config.dbPath)))
  }
  if (config.init) {
    return successResponse({ initialized: true, dbPath: config.dbPath })
  }
  if (config.appendOrderFill) {
    const event = buildOrderFillEvent(config.input)
    appendPlanEvent(db, event)
    return successResponse(event)
  }
  return null
}
