import { runOwnerToolRecordSync } from "../../../../contracts/runtime-core/src/owner-tool-client"

type JSONRecord = Record<string, unknown>

export function reduceFlow(dbPath: string, chainId: string): JSONRecord {
  return runFlowProjectorSync(["--reduce-flow", "--db", dbPath, "--chain-id", chainId])
}

export function applyReconcile(dbPath: string, input: JSONRecord, yes: boolean): JSONRecord {
  return runFlowProjectorSync([
    "--apply-reconcile",
    "--db",
    dbPath,
    ...(yes ? ["--yes"] : []),
    "--json",
    JSON.stringify(input),
  ])
}

function runFlowProjectorSync(args: string[]): JSONRecord {
  return runOwnerToolRecordSync("state.flow-projector", args, "flow projector")
}
