import { buildEventWriteEnvelope } from "../../../../contracts/protocol-fabric/src/protocol-fabric"
import { resolveRegisteredOwnerTool } from "../../../../contracts/runtime-core/src/owner-tool-registry"

type JSONRecord = Record<string, unknown>
type EventWritePlanEvent = {
  event_key: string
  chain_id: string
  kind: string
  body_json?: JSONRecord
  created_at: string
}

export function appendEvent(dbPath: string, event: JSONRecord): JSONRecord {
  const envelope = buildEventWriteEnvelope({ event: event as EventWritePlanEvent })
  return runEventStoreSync(["--append-event-envelope", "--db", dbPath, "--json", JSON.stringify(envelope)])
}

function runEventStoreSync(args: string[]): JSONRecord {
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
