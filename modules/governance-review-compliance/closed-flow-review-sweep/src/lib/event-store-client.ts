import { asRecord, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { runOwnerToolSync } from "../../../../contracts/runtime-core/src/owner-tool-client"

export function listChainIds(dbPath: string): string[] {
  const data = runEventStoreSync(["--list-chain-ids", "--db", dbPath])
  return Array.isArray(data) ? data.map(String).filter(Boolean) : []
}

export function readFlowEvents(dbPath: string, chainId: string): JSONRecord[] {
  const data = runEventStoreSync(["--read-flow-events", "--db", dbPath, "--chain-id", chainId])
  return Array.isArray(data) ? data.map(asRecord) : []
}

function runEventStoreSync(args: string[]): unknown {
  return runOwnerToolSync("state.event-store", args, "event store")
}
