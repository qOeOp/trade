import { type JSONRecord } from "./json"
import { loadJsonFile, loadStrategies } from "../../../../../contracts/strategy-policy/src/strategy-policy"
import { loadRuntimePolicyFromOwner } from "./runtime-policy-client"

export function loadRuntime(accountConfigPath: string, strategiesDir: string): JSONRecord
export function loadRuntime(input: { tradingConfigPath?: string; accountConfigPath: string; strategiesDir: string }): JSONRecord
export function loadRuntime(input: string | { tradingConfigPath?: string; accountConfigPath: string; strategiesDir: string }, legacyStrategiesDir?: string): JSONRecord {
  const accountConfigPath = typeof input === "string" ? input : input.accountConfigPath
  const strategiesDir = typeof input === "string" ? legacyStrategiesDir || "" : input.strategiesDir
  const accountConfig = loadJsonFile(accountConfigPath)
  const strategies = loadStrategies(strategiesDir)
  const { trading_config, runtime_policy } = loadRuntimePolicyFromOwner({
    tradingConfigPath: typeof input === "string" ? undefined : input.tradingConfigPath,
    accountConfigPath,
  })
  return {
    trading_config,
    runtime_policy,
    account_config: accountConfig,
    strategies,
    loaded_at: new Date().toISOString(),
  }
}
