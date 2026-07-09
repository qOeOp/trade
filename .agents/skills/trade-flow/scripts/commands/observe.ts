import { buildObserveEvent, type ObserveInput } from "../lib/observe-builder"
import { loadRuntime, observeFromSkills } from "../lib/observe-flow"
import { successResponse } from "./response"
import type { CommandConfig, ScriptResponse } from "./types"

export async function handleObserveCommand(config: CommandConfig): Promise<ScriptResponse | null> {
  if (config.loadRuntime) {
    return successResponse(loadRuntime({
      tradingConfigPath: config.tradingConfigPath || undefined,
      accountConfigPath: config.accountConfigPath,
      strategiesDir: config.strategiesDir,
    }))
  }
  if (config.buildObserve) {
    return successResponse(buildObserveEvent(config.input as unknown as ObserveInput))
  }
  if (config.observeFromSkills) {
    return successResponse(await observeFromSkills(config.input))
  }
  return null
}
