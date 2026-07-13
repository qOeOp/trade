import { loadRuntime } from "../lib/observe-flow"
import { resolveRegisteredOwnerTool } from "../../../../../contracts/runtime-core/src/owner-tool-registry"
import { runJsonCommand } from "../lib/tool-runner"
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
    return successResponse(await runObserveBuilder(config.input))
  }
  if (config.observeFromTools) {
    return successResponse(await runObserveFromTools(config.input))
  }
  return null
}

async function runObserveFromTools(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const command = resolveRegisteredOwnerTool("decision.observe-runner", [
    "--observe-from-tools",
    "--json",
    JSON.stringify(input),
  ])
  const result = await runJsonCommand(command.argv, { cwd: command.cwd })
  if (!result.ok) {
    throw new Error(`observe runner owner tool failed: ${result.error}${result.stderr ? `; ${result.stderr.trim()}` : ""}`)
  }
  const response = result.data && typeof result.data === "object" ? result.data as Record<string, unknown> : {}
  if (response.ok === false) {
    throw new Error(typeof response.error === "string" ? response.error : "observe runner owner tool returned ok=false")
  }
  const data = response.data && typeof response.data === "object" ? response.data as Record<string, unknown> : response
  return data
}

async function runObserveBuilder(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const command = resolveRegisteredOwnerTool("decision.observe-builder", [
    "--build-observe",
    "--json",
    JSON.stringify(input),
  ])
  const result = await runJsonCommand(command.argv, { cwd: command.cwd })
  if (!result.ok) {
    throw new Error(`observe builder owner tool failed: ${result.error}${result.stderr ? `; ${result.stderr.trim()}` : ""}`)
  }
  const response = result.data && typeof result.data === "object" ? result.data as Record<string, unknown> : {}
  if (response.ok === false) {
    throw new Error(typeof response.error === "string" ? response.error : "observe builder owner tool returned ok=false")
  }
  const data = response.data && typeof response.data === "object" ? response.data as Record<string, unknown> : response
  return data
}
