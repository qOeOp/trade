#!/usr/bin/env bun

import { assertProjectRuntimePath, repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { errorResponse, printScriptResult, readFlagValue, readJsonObject, successResponse } from "../../../../contracts/runtime-core/src/script-json"
import { cronRecoverFromTools, reconcileFromTools, reconcileLocalFlow } from "../lib/recovery-runner"

type JSONRecord = Record<string, unknown>

interface Config {
  dbPath: string
  chainId: string
  yes: boolean
  mode: "reconcile-flow" | "reconcile-from-tools" | "cron-recover-from-tools" | ""
  input: JSONRecord
}

function main(argv: string[]): void {
  run(argv).then((result) => {
    printScriptResult(result)
  })
}

export async function run(argv: string[]): Promise<JSONRecord> {
  const previousCwd = process.cwd()
  try {
    process.chdir(repoRoot())
    const config = parseArgs(argv)
    assertProjectRuntimePath(config.dbPath)
    if (!config.chainId) throw new Error("--chain-id is required")
    if (config.mode === "reconcile-flow") {
      return successResponse("recovery-runner.script-response.v1", reconcileLocalFlow(config.dbPath, config.chainId, config.input))
    }
    if (config.mode === "reconcile-from-tools") {
      return successResponse("recovery-runner.script-response.v1", await reconcileFromTools(config.dbPath, config.chainId, config.input))
    }
    if (config.mode === "cron-recover-from-tools") {
      return successResponse("recovery-runner.script-response.v1", await cronRecoverFromTools(config.dbPath, config.chainId, config.input, config.yes))
    }
    throw new Error("provide --reconcile-flow, --reconcile-from-tools, or --cron-recover-from-tools")
  } catch (error) {
    return errorResponse("recovery-runner.script-response.v1", error)
  } finally {
    process.chdir(previousCwd)
  }
}

function parseArgs(argv: string[]): Config {
  const config: Config = { dbPath: "./data/trade.db", chainId: "", yes: false, mode: "", input: {} }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--reconcile-from-tools": config.mode = "reconcile-from-tools"; break
      case "--reconcile-flow": config.mode = "reconcile-flow"; break
      case "--cron-recover-from-tools": config.mode = "cron-recover-from-tools"; break
      case "--db": config.dbPath = readFlagValue(argv, ++index, arg); break
      case "--chain-id": config.chainId = readFlagValue(argv, ++index, arg); break
      case "--yes": config.yes = true; break
      case "--json": config.input = readJsonObject(readFlagValue(argv, ++index, arg)); break
      case "--help": printHelp(); return process.exit(0)
      default: throw new Error(`unknown flag: ${arg}`)
    }
  }
  return config
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --reconcile-from-tools --db ./data/trade.db --chain-id flow-1 --json '{"symbol":"BTCUSDT"}'
  bun src/scripts/main.ts --reconcile-flow --db ./data/trade.db --chain-id flow-1 --json '{"openOrders":{"regular":[],"protective":[]},"positions":[]}'
  bun src/scripts/main.ts --cron-recover-from-tools --db ./data/trade.db --chain-id flow-1 --json '{"symbol":"BTCUSDT"}'
`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
