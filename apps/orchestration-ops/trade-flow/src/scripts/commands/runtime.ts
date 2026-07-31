import type { Database } from "bun:sqlite"
import { dirname } from "node:path"
import { runTrackDryRun } from "../lib/track-runner"
import { appendOrderFill, appendReview } from "../lib/event-store-client"
import { successResponse } from "./response"
import type { CommandConfig, ScriptResponse } from "./types"

export async function handleRuntimeCommand(_db: Database, config: CommandConfig): Promise<ScriptResponse | null> {
  if (config.track) {
    return successResponse(runTrackDryRun(config.dbPath, config.track, dirname(config.dbPath)))
  }
  if (config.init) {
    return successResponse({ initialized: true, dbPath: config.dbPath })
  }
  if (config.appendOrderFill) {
    return successResponse(await appendOrderFill(config.dbPath, config.input))
  }
  if (config.appendReview) {
    return successResponse(await appendReview(config.dbPath, config.input))
  }
  return null
}
