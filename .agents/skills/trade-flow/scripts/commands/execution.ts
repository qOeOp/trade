import { Database } from "bun:sqlite"
import {
  buildRecordedExecutionEvent,
  runOneFlowStep,
} from "../lib/execution-flow"
import {
  runLiveSmall,
  runShadowFromSkills,
} from "../lib/live-execution"
import { appendPlanEvent } from "../lib/plan-events"
import { successResponse } from "./response"
import type { CommandConfig, ScriptResponse } from "./types"

export async function handleExecutionCommand(db: Database, config: CommandConfig): Promise<ScriptResponse | null> {
  if (config.recordExecution) {
    const event = buildRecordedExecutionEvent(config.input)
    appendPlanEvent(db, event)
    return successResponse(event)
  }
  if (config.run) {
    return successResponse(runOneFlowStep(db, config.input, config.mode))
  }
  if (config.runShadowFromSkills) {
    return successResponse(await runShadowFromSkills(db, config.input))
  }
  if (config.runLiveSmall) {
    return successResponse(await runLiveSmall(db, config.input, config.yes))
  }
  return null
}
