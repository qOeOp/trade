import type { Database } from "bun:sqlite"
import { applyReconcile, reduceFlow } from "../lib/flow-projector-client"
import { resolveRegisteredOwnerTool } from "../../../../../contracts/runtime-core/src/owner-tool-registry"
import { runJsonCommand } from "../../../../../contracts/runtime-core/src/tool-runner"
import { successResponse } from "./response"
import type { CommandConfig, ScriptResponse } from "./types"

export async function handleRecoveryCommand(_db: Database, config: CommandConfig): Promise<ScriptResponse | null> {
  if (config.recoverFlow) {
    return successResponse(reduceFlow(config.dbPath, config.chainId))
  }
  if (config.reconcileFlow) {
    return successResponse(await runRecoveryOwnerTool({
      dbPath: config.dbPath,
      chainId: config.chainId,
      mode: "--reconcile-flow",
      input: config.input,
      yes: false,
    }))
  }
  if (config.reconcileFromTools) {
    return successResponse(await runRecoveryOwnerTool({
      dbPath: config.dbPath,
      chainId: config.chainId,
      mode: "--reconcile-from-tools",
      input: config.input,
      yes: false,
    }))
  }
  if (config.applyReconcile) {
    return successResponse(applyReconcile(config.dbPath, config.input, config.yes))
  }
  if (config.cronRecoverFromTools) {
    return successResponse(await runRecoveryOwnerTool({
      dbPath: config.dbPath,
      chainId: config.chainId,
      mode: "--cron-recover-from-tools",
      input: config.input,
      yes: config.yes,
    }))
  }
  return null
}

async function runRecoveryOwnerTool(input: { dbPath: string; chainId: string; mode: string; input: Record<string, unknown>; yes: boolean }): Promise<Record<string, unknown>> {
  const command = resolveRegisteredOwnerTool("execution.recovery-runner", [
    input.mode,
    "--db",
    input.dbPath,
    "--chain-id",
    input.chainId,
    ...(input.yes ? ["--yes"] : []),
    "--json",
    JSON.stringify(input.input),
  ])
  const result = await runJsonCommand(command.argv, { cwd: command.cwd })
  if (!result.ok) {
    throw new Error(`recovery owner tool failed: ${result.error}${result.stderr ? `; ${result.stderr.trim()}` : ""}`)
  }
  const response = result.data && typeof result.data === "object" ? result.data as Record<string, unknown> : {}
  if (response.ok === false) {
    throw new Error(typeof response.error === "string" ? response.error : "recovery owner tool returned ok=false")
  }
  const data = response.data && typeof response.data === "object" ? response.data as Record<string, unknown> : response
  return data
}
