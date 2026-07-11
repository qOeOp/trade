import { Database } from "bun:sqlite"
import {
  runOneFlowStep,
} from "../../../../../live-execution-control/execution-flow-runner/src/lib/execution-flow-runner"
import { buildRecordedExecutionEvent } from "../../../../../live-execution-control/execution-recorder/src/lib/execution-recorder"
import {
  runShadowFromTools,
} from "../lib/live-execution"
import { runLiveSmall } from "../../../../../live-execution-control/live-small-runner/src/lib/live-small-runner"
import { appendPlanEvent } from "../../../../../portfolio-execution-state/event-store/src/lib/event-store"
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
