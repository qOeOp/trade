import { resolveRegisteredOwnerTool } from "../../../../contracts/runtime-core/src/owner-tool-registry"

type JSONRecord = Record<string, unknown>

export function listChainIds(dbPath: string): string[] {
  const data = runEventStoreSync(["--list-chain-ids", "--db", dbPath])
  return Array.isArray(data) ? data.map(String).filter(Boolean) : []
}

export function readFlowEvents(dbPath: string, chainId: string): JSONRecord[] {
  const data = runEventStoreSync(["--read-flow-events", "--db", dbPath, "--chain-id", chainId])
  return Array.isArray(data) ? data.map(asRecord) : []
}

function runEventStoreSync(args: string[]): unknown {
  const command = resolveRegisteredOwnerTool("state.event-store", args)
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
    throw new Error(`event store owner tool failed: exit=${proc.exitCode}${stderr ? `; ${stderr.trim()}` : ""}`)
  }
  if (response.ok === false) throw new Error(typeof response.error === "string" ? response.error : "event store owner tool returned ok=false")
  return Object.hasOwn(response, "data") ? response.data : response
}

function parseJsonRecord(raw: string): JSONRecord {
  try {
    const parsed = JSON.parse(raw)
    return asRecord(parsed)
  } catch {
    return {}
  }
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}
