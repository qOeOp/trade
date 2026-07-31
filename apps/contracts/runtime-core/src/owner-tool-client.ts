import { resolveRegisteredOwnerTool } from "./owner-tool-registry"
import { asRecord, type JSONRecord } from "./json"

export function runOwnerToolSync(toolId: string, args: string[], label: string = toolId): unknown {
  const command = resolveRegisteredOwnerTool(toolId, args)
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
    throw new Error(`${label} owner tool failed: exit=${proc.exitCode}${stderr ? `; ${stderr.trim()}` : ""}`)
  }
  if (response.ok === false) {
    throw new Error(typeof response.error === "string" ? response.error : `${label} owner tool returned ok=false`)
  }
  return Object.hasOwn(response, "data") ? response.data : response
}

export function runOwnerToolRecordSync(toolId: string, args: string[], label: string = toolId): JSONRecord {
  return asRecord(runOwnerToolSync(toolId, args, label))
}

function parseJsonRecord(raw: string): JSONRecord {
  try {
    return asRecord(JSON.parse(raw))
  } catch {
    return {}
  }
}
