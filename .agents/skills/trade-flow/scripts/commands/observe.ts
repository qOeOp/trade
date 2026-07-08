import { buildObserveEvent, type ObserveInput } from "../lib/observe-builder"
import { loadRuntime, observeFromSkills } from "../lib/observe-flow"
import type { CommandConfig, ScriptResponse } from "./types"

export async function handleObserveCommand(config: CommandConfig): Promise<ScriptResponse | null> {
  if (config.loadRuntime) {
    return { ok: true, data: loadRuntime(config.accountConfigPath, config.strategiesDir) }
  }
  if (config.buildObserve) {
    return { ok: true, data: buildObserveEvent(config.input as unknown as ObserveInput) }
  }
  if (config.observeFromSkills) {
    return {
      ok: true,
      data: await observeFromSkills(config.input),
    }
  }
  return null
}
