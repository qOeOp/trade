import { resolveRegisteredOwnerTool } from "../../../../contracts/runtime-core/src/owner-tool-registry"

type JSONRecord = Record<string, unknown>

export function reduceFlow(dbPath: string, chainId: string): JSONRecord {
  return runFlowProjectorSync(["--reduce-flow", "--db", dbPath, "--chain-id", chainId])
}

export function applyReconcile(dbPath: string, input: JSONRecord, yes: boolean): JSONRecord {
  return runFlowProjectorSync([
    "--apply-reconcile",
    "--db",
    dbPath,
    ...(yes ? ["--yes"] : []),
    "--json",
    JSON.stringify(input),
  ])
}

function runFlowProjectorSync(args: string[]): JSONRecord {
  const command = resolveRegisteredOwnerTool("state.flow-projector", args)
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
    throw new Error(`flow projector owner tool failed: exit=${proc.exitCode}${stderr ? `; ${stderr.trim()}` : ""}`)
  }
  if (response.ok === false) throw new Error(typeof response.error === "string" ? response.error : "flow projector owner tool returned ok=false")
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
