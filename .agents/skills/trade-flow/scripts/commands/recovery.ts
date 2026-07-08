import { Database } from "bun:sqlite"
import { applyReconcileDrafts, reduceFlowState } from "../lib/flow-state"
import { readFlowEvents } from "../lib/plan-events"
import { buildReconcileDrafts } from "../lib/reconcile"
import {
  cronRecoverFromSkills,
  reconcileFromSkills,
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
  if (config.reconcileFromSkills) {
    return successResponse(await reconcileFromSkills(db, config.chainId, config.input))
  }
  if (config.applyReconcile) {
    return successResponse(applyReconcileDrafts(db, config.input, config.yes))
  }
  if (config.cronRecoverFromSkills) {
    return successResponse(await cronRecoverFromSkills(db, config.chainId, config.input, config.yes))
  }
  return null
}
