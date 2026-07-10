import { Database } from "bun:sqlite"
import { applyReconcileDrafts, reduceFlowState } from "../lib/flow-state"
import { readFlowEvents } from "../lib/plan-events"
import { buildReconcileDrafts } from "../lib/reconcile"
import {
  cronRecoverFromTools,
  reconcileFromTools,
} from "../lib/recovery-flow"
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
