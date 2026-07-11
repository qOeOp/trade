import { Database } from "bun:sqlite"
import { applyReconcileDrafts, reduceFlowState } from "../../../../../portfolio-execution-state/flow-projector/src/lib/flow-projector"
import { readFlowEvents } from "../../../../../portfolio-execution-state/event-store/src/lib/event-store"
import { buildReconcileDrafts } from "../../../../../live-execution-control/reconcile-drafts/src/lib/reconcile-drafts"
import {
  cronRecoverFromTools,
  reconcileFromTools,
} from "../../../../../live-execution-control/recovery-runner/src/lib/recovery-runner"
import { successResponse } from "./response"
import type { CommandConfig, ScriptResponse } from "./types"

export async function handleRecoveryCommand(db: Database, config: CommandConfig): Promise<ScriptResponse | null> {
  if (config.recoverFlow) {
    return successResponse(reduceFlowState(db, config.chainId))
  }
  if (config.reconcileFlow) {
    const localEvents = readFlowEvents(db, config.chainId)
    return successResponse(buildReconcileDrafts({
        chain_id: config.chainId,
        local_events: localEvents,
        local_state: reduceFlowState(db, config.chainId),
        account_snapshot: config.input,
      }))
  }
  if (config.reconcileFromTools) {
    return successResponse(await reconcileFromTools(db, config.chainId, config.input))
  }
  if (config.applyReconcile) {
    return successResponse(applyReconcileDrafts(db, config.input, config.yes))
  }
  if (config.cronRecoverFromTools) {
    return successResponse(await cronRecoverFromTools(db, config.chainId, config.input, config.yes))
  }
  return null
}
