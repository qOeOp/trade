import { runOwnerToolRecordSync } from "../../../../../contracts/runtime-core/src/owner-tool-client"

type JSONRecord = Record<string, unknown>

export function loadRuntimePolicyFromOwner(input: {
  tradingConfigPath?: string
  policyRegistryDbPath?: string
}): JSONRecord {
  const compiled = runOwnerToolRecordSync("policy.runtime-policy-compiler", [
    ...(input.tradingConfigPath ? ["--trading-config", input.tradingConfigPath] : []),
  ], "runtime policy compiler")
  const registered = runOwnerToolRecordSync("policy.registry", [
    ...(input.policyRegistryDbPath ? ["--db", input.policyRegistryDbPath] : []),
    "--action",
    "authorize_runtime_policy",
    "--json",
    JSON.stringify(compiled),
  ], "runtime policy authorization")
  const authorization = asRecord(registered.authorization)
  return {
    ...compiled,
    runtime_policy: asRecord(authorization.runtime_policy),
    runtime_authorization: authorization,
  }
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}
