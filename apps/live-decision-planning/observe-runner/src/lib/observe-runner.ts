import { join } from "node:path"
import { buildObserveEvent } from "../../../observe-builder/src/lib/observe-builder"
import {
  runJsonCommand,
  type Runner,
} from "../../../../contracts/runtime-core/src/tool-runner"

type JSONRecord = Record<string, unknown>

interface ObserveRunnerInput {
  repoRoot: string
  symbol: string
  timeoutMs?: number
}

interface ObserveRunnerOutput {
  account_snapshot: JSONRecord
  market_snapshot: JSONRecord
  market_refs: string[]
}

async function observeFromTools(input: JSONRecord, runner: Runner = runJsonCommand): Promise<JSONRecord> {
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
    plan_seed: asRecord(input.plan_seed ?? input.plan),
    policy_snapshot: asRecord(input.policy_snapshot),
    created_at: stringField(input.created_at) || undefined,
  }) as unknown as JSONRecord
}

async function fetchObserveProjections(
  input: ObserveRunnerInput,
  runner: Runner = runJsonCommand,
): Promise<ObserveRunnerOutput> {
  const accountToolDir = join(input.repoRoot, "apps/exchange-gateway/binance-read/account-snapshot")
  const symbolToolDir = join(input.repoRoot, "apps/market-data-products/binance-read/symbol-snapshot")
  const timeout = String(input.timeoutMs ?? 10_000)

  const [accountResult, marketResult] = await Promise.all([
    runner(["bun", "src/scripts/main.ts", "--symbol", input.symbol, "--timeout", timeout], { cwd: accountToolDir }),
    runner(["bun", "src/scripts/main.ts", "--symbol", input.symbol, "--timeout", timeout], { cwd: symbolToolDir }),
  ])

  if (!accountResult.ok) {
    throw new Error(`account snapshot failed: ${accountResult.error}`)
  }
  if (!marketResult.ok) {
    throw new Error(`symbol snapshot failed: ${marketResult.error}`)
  }

  return {
    account_snapshot: asRecord(accountResult.data),
    market_snapshot: asRecord(marketResult.data),
    market_refs: [
      `binance-account-snapshot:${input.symbol}`,
      `binance-symbol-snapshot:${input.symbol}`,
    ],
  }
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  if (typeof value === "string") {
    return value.trim()
  }
  if (typeof value === "number") {
    return String(value)
  }
  return ""
}

function readSide(value: unknown): "long" | "short" {
  const side = stringField(value)
  if (side === "long" || side === "short") {
    return side
  }
  throw new Error("side must be long or short")
}

export {
  fetchObserveProjections,
  observeFromTools,
  type ObserveRunnerInput,
  type ObserveRunnerOutput,
}
