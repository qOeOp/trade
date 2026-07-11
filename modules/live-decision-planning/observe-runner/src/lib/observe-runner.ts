import { join } from "node:path"

type JSONRecord = Record<string, unknown>

interface CommandResult {
  ok: true
  data: unknown
  stdout: string
  stderr: string
}

interface CommandFailure {
  ok: false
  error: string
  stdout: string
  stderr: string
  exitCode: number | null
}

type Runner = (command: string[], options?: { cwd?: string }) => Promise<CommandResult | CommandFailure>

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

async function fetchObserveProjections(
  input: ObserveRunnerInput,
  runner: Runner = runJsonCommand,
): Promise<ObserveRunnerOutput> {
  const accountToolDir = join(input.repoRoot, "modules/exchange-gateway/binance-read/account-snapshot")
  const symbolToolDir = join(input.repoRoot, "modules/market-data-products/binance-read/symbol-snapshot")
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

async function runJsonCommand(command: string[], options: { cwd?: string } = {}): Promise<CommandResult | CommandFailure> {
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (exitCode !== 0) {
    return {
      ok: false,
      error: `command failed with exit code ${exitCode}`,
      stdout,
      stderr,
      exitCode,
    }
  }

  try {
    return {
      ok: true,
      data: JSON.parse(stdout) as unknown,
      stdout,
      stderr,
    }
  } catch (error) {
    return {
      ok: false,
      error: `command did not return JSON: ${error instanceof Error ? error.message : String(error)}`,
      stdout,
      stderr,
      exitCode,
    }
  }
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" ? value as JSONRecord : {}
}

export {
  fetchObserveProjections,
  runJsonCommand,
  type CommandFailure,
  type CommandResult,
  type ObserveRunnerInput,
  type ObserveRunnerOutput,
  type Runner,
}
