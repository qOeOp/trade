import { asRecord, stringField, type JSONRecord } from "./json"
import { fetchObserveProjections, type Runner } from "./observe-adapter"
import { loadJsonFile, loadStrategies } from "./loaders"
import { buildObserveEvent, type ObserveEvent } from "./observe-builder"
import { loadRuntimePolicy } from "./runtime-policy"

export function loadRuntime(accountConfigPath: string, strategiesDir: string): JSONRecord
export function loadRuntime(input: { tradingConfigPath?: string; accountConfigPath: string; strategiesDir: string }): JSONRecord
export function loadRuntime(input: string | { tradingConfigPath?: string; accountConfigPath: string; strategiesDir: string }, legacyStrategiesDir?: string): JSONRecord {
  const accountConfigPath = typeof input === "string" ? input : input.accountConfigPath
  const strategiesDir = typeof input === "string" ? legacyStrategiesDir || "" : input.strategiesDir
  const accountConfig = loadJsonFile(accountConfigPath)
  const strategies = loadStrategies(strategiesDir)
  const { trading_config, runtime_policy } = loadRuntimePolicy({
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

export async function observeFromTools(input: JSONRecord): Promise<ObserveEvent> {
  const symbol = stringField(input.symbol)
  const repoRoot = stringField(input.repoRoot) || process.cwd()
  if (!symbol) {
    throw new Error("symbol is required")
  }
  const projections = await fetchObserveProjections({
    repoRoot,
    symbol,
    timeoutMs: Number(input.timeoutMs) || undefined,
  })
  return buildObserveEvent({
    chain_id: stringField(input.chain_id),
    symbol,
    side: readSide(input.side),
    strategy_ref: stringField(input.strategy_ref),
    setup_id: stringField(input.setup_id) || undefined,
    account_snapshot: projections.account_snapshot,
    market_snapshot: projections.market_snapshot,
    market_refs: projections.market_refs,
    plan_seed: asRecord(input.plan_seed),
    policy_snapshot: asRecord(input.policy_snapshot),
    created_at: stringField(input.created_at) || undefined,
  })
}

export async function observeFromToolsWithRunner(input: JSONRecord, runner?: Runner): Promise<ObserveEvent> {
  const symbol = stringField(input.symbol)
  const repoRoot = stringField(input.repoRoot) || process.cwd()
  if (!symbol) {
    throw new Error("symbol is required")
  }
  const projections = await fetchObserveProjections({
    repoRoot,
    symbol,
    timeoutMs: Number(input.timeoutMs) || undefined,
  }, runner)
  return buildObserveEvent({
    chain_id: stringField(input.chain_id),
    symbol,
    side: readSide(input.side),
    strategy_ref: stringField(input.strategy_ref),
    setup_id: stringField(input.setup_id) || undefined,
    account_snapshot: projections.account_snapshot,
    market_snapshot: projections.market_snapshot,
    market_refs: projections.market_refs,
    plan_seed: asRecord(input.plan),
    policy_snapshot: asRecord(input.policy_snapshot),
    created_at: stringField(input.created_at) || undefined,
  })
}

function readSide(value: unknown): "long" | "short" {
  const side = stringField(value)
  if (side === "long" || side === "short") {
    return side
  }
  throw new Error("side must be long or short")
}
