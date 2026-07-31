import { runOwnerToolRecordSync } from "../../../../contracts/runtime-core/src/owner-tool-client"

type JSONRecord = Record<string, unknown>

export function activeFlows(dbPath: string): JSONRecord {
  return runOwnerToolRecordSync("state.flow-projector", ["--active-flows", "--db", dbPath], "flow projector")
}
