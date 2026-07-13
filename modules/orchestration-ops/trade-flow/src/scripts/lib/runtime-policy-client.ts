import { resolveRegisteredOwnerTool } from "../../../../../contracts/runtime-core/src/owner-tool-registry"

type JSONRecord = Record<string, unknown>

export function loadRuntimePolicyFromOwner(input: {
  tradingConfigPath?: string
  accountConfigPath?: string
  notifyConfigPath?: string
}): JSONRecord {
  return runRuntimePolicyCompilerSync([
    ...(input.tradingConfigPath ? ["--trading-config", input.tradingConfigPath] : []),
    ...(input.accountConfigPath ? ["--account-config", input.accountConfigPath] : []),
    ...(input.notifyConfigPath ? ["--notify-config", input.notifyConfigPath] : []),
  ])
}

function runRuntimePolicyCompilerSync(args: string[]): JSONRecord {
  const command = resolveRegisteredOwnerTool("policy.runtime-policy-compiler", args)
  const proc = Bun.spawnSync(command.argv, {
    cwd: command.cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = new TextDecoder().decode(proc.stdout)
  const stderr = new TextDecoder().decode(proc.stderr)
  const response = parseJsonRecord(stdout)
  if (!proc.success) {
    if (response.ok === false && typeof response.error === "string") throw new Error(response.error)
    throw new Error(`runtime policy compiler owner tool failed: exit=${proc.exitCode}${stderr ? `; ${stderr.trim()}` : ""}`)
  }
  if (response.ok === false) throw new Error(typeof response.error === "string" ? response.error : "runtime policy compiler owner tool returned ok=false")
  return response.data && typeof response.data === "object" ? response.data as JSONRecord : response
}

function parseJsonRecord(raw: string): JSONRecord {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JSONRecord : {}
  } catch {
    return {}
  }
}
