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

export function readFlowEvents(dbPath: string, chainId: string): JSONRecord[] {
  const data = runEventStoreSync(["--read-flow-events", "--db", dbPath, "--chain-id", chainId])
  return Array.isArray(data) ? data.map(asRecord) : []
}

export function readLatestOrderFill(dbPath: string, chainId: string): JSONRecord | null {
  const data = runEventStoreSync(["--read-latest-order-fill", "--db", dbPath, "--chain-id", chainId])
  return data && typeof data === "object" && !Array.isArray(data) ? data as JSONRecord : null
}

export function appendEvent(dbPath: string, event: JSONRecord): JSONRecord {
  const envelope = buildEventWriteEnvelope({ event: event as EventWritePlanEvent })
  return asRecord(runEventStoreSync(["--append-event-envelope", "--db", dbPath, "--json", JSON.stringify(envelope)]))
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
