import { join } from "node:path"

import { type CommandFailure, type CommandResult, runJsonCommand } from "./skill-runner"

type JSONRecord = Record<string, unknown>
type Runner = (command: string[], options?: { cwd?: string }) => Promise<CommandResult | CommandFailure>

interface ObserveAdapterInput {
  repoRoot: string
  symbol: string
  timeoutMs?: number
}

interface ObserveAdapterOutput {
  account_snapshot: JSONRecord
  market_snapshot: JSONRecord
  market_refs: string[]
}

async function fetchObserveProjections(
  input: ObserveAdapterInput,
  runner: Runner = runJsonCommand,
): Promise<ObserveAdapterOutput> {
  const accountSkillDir = join(input.repoRoot, ".agents/skills/binance-account-snapshot")
  const symbolSkillDir = join(input.repoRoot, ".agents/skills/binance-symbol-snapshot")
  const timeout = String(input.timeoutMs ?? 10_000)

  const [accountResult, marketResult] = await Promise.all([
    runner(["bun", "scripts/main.ts", "--symbol", input.symbol, "--timeout", timeout], { cwd: accountSkillDir }),
    runner(["bun", "scripts/main.ts", "--symbol", input.symbol, "--timeout", timeout], { cwd: symbolSkillDir }),
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

export {
  fetchObserveProjections,
  type ObserveAdapterInput,
  type ObserveAdapterOutput,
  type Runner,
}
