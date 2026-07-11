import { Database } from "bun:sqlite"
import {
  runOneFlowStep,
} from "../lib/execution-flow"
import { buildRecordedExecutionEvent } from "../../../../flow/execution-recorder/src/lib/execution-recorder"
import {
  runLiveSmall,
  runShadowFromTools,
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
  if (config.runShadowFromTools) {
    return successResponse(await runShadowFromTools(db, config.input))
  }
  if (config.runLiveSmall) {
    return successResponse(await runLiveSmall(db, config.input, config.yes))
  }
  return null
}
