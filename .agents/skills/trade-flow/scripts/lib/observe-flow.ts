import { asRecord, stringField, type JSONRecord } from "./json"
import { fetchObserveProjections, type Runner } from "./observe-adapter"
import { loadJsonFile, loadStrategies } from "./loaders"
import { buildObserveEvent, type ObserveEvent } from "./observe-builder"

export function loadRuntime(accountConfigPath: string, strategiesDir: string): JSONRecord {
  const accountConfig = loadJsonFile(accountConfigPath)
  const strategies = loadStrategies(strategiesDir)
  return {
    account_config: accountConfig,
    strategies,
    loaded_at: new Date().toISOString(),
  }
}

export async function observeFromSkills(input: JSONRecord): Promise<ObserveEvent> {
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
    created_at: stringField(input.created_at) || undefined,
  })
}

export async function observeFromSkillsWithRunner(input: JSONRecord, runner?: Runner): Promise<ObserveEvent> {
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
