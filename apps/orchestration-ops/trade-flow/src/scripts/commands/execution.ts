import { Database } from "bun:sqlite"
import {
  runShadowFromTools,
} from "../lib/live-execution"
import { appendEvent } from "../lib/event-store-client"
import { resolveRegisteredOwnerTool } from "../../../../../contracts/runtime-core/src/owner-tool-registry"
import { runJsonCommand } from "../../../../../contracts/runtime-core/src/tool-runner"
import { successResponse } from "./response"
import type { CommandConfig, ScriptResponse } from "./types"

export async function handleExecutionCommand(_db: Database, config: CommandConfig): Promise<ScriptResponse | null> {
  if (config.recordExecution) {
    const event = await runExecutionOwnerTool({
      toolId: "execution.recorder",
      args: ["--record-execution", "--json", JSON.stringify(config.input)],
    })
    await appendEvent(config.dbPath, event)
    return successResponse(event)
  }
  if (config.run) {
    return successResponse(await runExecutionOwnerTool({
      toolId: "execution.flow-runner",
      args: ["--run", "--db", config.dbPath, "--mode", config.mode, "--json", JSON.stringify(config.input)],
    }))
  }
  if (config.runShadowFromTools) {
    return successResponse(await runShadowFromTools(config.input, config.dbPath))
  }
  if (config.runLiveSmall) {
    return successResponse(await runExecutionOwnerTool({
      toolId: "execution.live-small-runner",
      args: [
        "--run-live-small",
        "--db",
        config.dbPath,
        ...(config.yes ? ["--yes"] : []),
        "--json",
        JSON.stringify(config.input),
      ],
    }))
  }
  return null
}

async function runExecutionOwnerTool(input: { toolId: string; args: string[] }): Promise<Record<string, unknown>> {
  const command = resolveRegisteredOwnerTool(input.toolId, input.args)
  const result = await runJsonCommand(command.argv, { cwd: command.cwd })
  if (!result.ok) {
    throw new Error(`execution owner tool failed: ${result.error}${result.stderr ? `; ${result.stderr.trim()}` : ""}`)
  }
  const response = result.data && typeof result.data === "object" ? result.data as Record<string, unknown> : {}
  if (response.ok === false) {
    throw new Error(typeof response.error === "string" ? response.error : "execution owner tool returned ok=false")
  }
  const data = response.data && typeof response.data === "object" ? response.data as Record<string, unknown> : response
  return data
}
