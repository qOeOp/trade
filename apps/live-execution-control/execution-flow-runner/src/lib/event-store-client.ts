import { buildEventWriteEnvelope } from "../../../../contracts/protocol-fabric/src/protocol-fabric"
import { asRecord, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { runOwnerToolSync } from "../../../../contracts/runtime-core/src/owner-tool-client"

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
  return runOwnerToolSync("state.event-store", args, "event store")
}
