import { asRecord, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { runOwnerToolSync } from "../../../../contracts/runtime-core/src/owner-tool-client"

export function reduceFlow(dbPath: string, chainId: string): JSONRecord {
  return asRecord(runFlowProjector(["--reduce-flow", "--db", dbPath, "--chain-id", chainId]))
}

export function readLatestSlowObserve(dbPath: string, chainId: string): JSONRecord | null {
  const data = runFlowProjector(["--latest-slow-observe", "--db", dbPath, "--chain-id", chainId])
  return data && typeof data === "object" && !Array.isArray(data) ? data as JSONRecord : null
}

export function readPortfolioAccountProjection(
  dbPath: string,
  input: { account_ref: string; account_scope: string; symbol?: string; as_of?: string },
): JSONRecord {
  const args = [
    "--portfolio-account",
    "--db",
    dbPath,
    "--account-ref",
    input.account_ref,
    "--account-scope",
    input.account_scope,
  ]
  if (input.symbol) args.push("--symbol", input.symbol)
  if (input.as_of) args.push("--as-of", input.as_of)
  return asRecord(runFlowProjector(args))
}

function runFlowProjector(args: string[]): unknown {
  return runOwnerToolSync("state.flow-projector", args, "flow projector")
}
