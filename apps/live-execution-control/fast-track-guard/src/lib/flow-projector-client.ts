import { asRecord, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { runOwnerToolRecordSync } from "../../../../contracts/runtime-core/src/owner-tool-client"

export function activeFlows(dbPath: string): JSONRecord[] {
  const projection = runFlowProjectorSync(["--active-flows", "--db", dbPath])
  return Array.isArray(projection.active_flows) ? projection.active_flows.map(asRecord) : []
}

export function reduceFlow(dbPath: string, chainId: string): JSONRecord {
  return runFlowProjectorSync(["--reduce-flow", "--db", dbPath, "--chain-id", chainId])
}

function runFlowProjectorSync(args: string[]): JSONRecord {
  return runOwnerToolRecordSync("state.flow-projector", args, "flow projector")
}
