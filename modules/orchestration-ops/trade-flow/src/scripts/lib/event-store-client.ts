import { buildEventWriteEnvelope } from "../../../../../contracts/protocol-fabric/src/protocol-fabric"
import { resolveRegisteredOwnerTool } from "../../../../../contracts/runtime-core/src/owner-tool-registry"
import { runJsonCommand } from "../../../../../contracts/runtime-core/src/tool-runner"

type JSONRecord = Record<string, unknown>
type EventWritePlanEvent = {
  event_key: string
  chain_id: string
  kind: string
  body_json?: JSONRecord
  created_at: string
}

export async function initEventStore(dbPath: string): Promise<JSONRecord> {
  return runEventStore(["--init", "--db", dbPath])
}

export async function appendEvent(dbPath: string, event: JSONRecord): Promise<JSONRecord> {
  const envelope = buildEventWriteEnvelope({ event: event as EventWritePlanEvent })
  return runEventStore(["--append-event-envelope", "--db", dbPath, "--json", JSON.stringify(envelope)])
}

export async function appendOrderFill(dbPath: string, input: JSONRecord): Promise<JSONRecord> {
  return runEventStore(["--append-order-fill", "--db", dbPath, "--json", JSON.stringify(input)])
}

export async function appendReview(dbPath: string, input: JSONRecord): Promise<JSONRecord> {
  return runEventStore(["--append-review", "--db", dbPath, "--json", JSON.stringify(input)])
}

async function runEventStore(args: string[]): Promise<JSONRecord> {
  const command = resolveRegisteredOwnerTool("state.event-store", args)
  const result = await runJsonCommand(command.argv, { cwd: command.cwd })
  if (!result.ok) {
    const response = parseJsonRecord(result.stdout)
    if (response.ok === false && typeof response.error === "string") {
      throw new Error(response.error)
    }
    throw new Error(`event store owner tool failed: ${result.error}${result.stderr ? `; ${result.stderr.trim()}` : ""}`)
  }
  const response = result.data && typeof result.data === "object" ? result.data as JSONRecord : {}
  if (response.ok === false) {
    throw new Error(typeof response.error === "string" ? response.error : "event store owner tool returned ok=false")
  }
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
