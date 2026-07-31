import { asRecord, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { runOwnerToolSync } from "../../../../contracts/runtime-core/src/owner-tool-client"

export function reduceFlow(dbPath: string, chainId: string): JSONRecord {
  return asRecord(runOwnerToolSync("state.flow-projector", ["--reduce-flow", "--db", dbPath, "--chain-id", chainId], "flow projector"))
}
