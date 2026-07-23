import { type JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { loadJsonFile, loadStrategies } from "../../../../../contracts/strategy-policy/src/strategy-policy"
import { loadRuntimePolicyFromOwner } from "./runtime-policy-client"

interface RuntimeLoadInput {
  tradingConfigPath?: string
  accountConfigPath: string
  strategiesDir: string
}

export function loadRuntime(input: RuntimeLoadInput): JSONRecord {
  const accountConfigPath = input.accountConfigPath
  const strategiesDir = input.strategiesDir
  const accountConfig = loadJsonFile(accountConfigPath)
  const strategies = loadStrategies(strategiesDir)
  const { trading_config, runtime_policy, runtime_authorization } = loadRuntimePolicyFromOwner({
    tradingConfigPath: input.tradingConfigPath,
  })
  return {
    trading_config,
    runtime_policy,
    runtime_authorization,
    account_config: accountConfig,
    strategies,
    loaded_at: new Date().toISOString(),
  }
}
