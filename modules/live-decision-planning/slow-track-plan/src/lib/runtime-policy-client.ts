import { runOwnerToolRecordSync } from "../../../../contracts/runtime-core/src/owner-tool-client"

type JSONRecord = Record<string, unknown>

export function loadRuntimePolicyFromOwner(input: { tradingConfigPath: string }): JSONRecord {
  return runOwnerToolRecordSync("policy.runtime-policy-compiler", ["--trading-config", input.tradingConfigPath], "runtime policy compiler")
}
