import { asRecord, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { runOwnerToolSync } from "../../../../contracts/runtime-core/src/owner-tool-client"

export function reduceFlow(dbPath: string, chainId: string): JSONRecord {
  return asRecord(runFlowProjector(["--reduce-flow", "--db", dbPath, "--chain-id", chainId]))
}

export function readLatestSlowObserve(dbPath: string, chainId: string): JSONRecord | null {
  const data = runFlowProjector(["--latest-slow-observe", "--db", dbPath, "--chain-id", chainId])
  return data && typeof data === "object" && !Array.isArray(data) ? data as JSONRecord : null
}

function runFlowProjector(args: string[]): unknown {
  return runOwnerToolSync("state.flow-projector", args, "flow projector")
}
