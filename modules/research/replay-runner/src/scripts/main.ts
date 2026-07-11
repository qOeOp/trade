#!/usr/bin/env bun

import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { replayRegisteredStrategy } from "../../../replay-engine/src/lib/strategy-replay"

type JSONRecord = Record<string, unknown>

interface Config {
  manifestPath: string
  strategyId: string
  timeframe: string
  maxHoldBars?: number
  rewardRisk?: number
  feeBps?: number
  slippageBps?: number
  fundingBpsPer8h?: number
  oosSplitRatio?: number
  trialCount?: number
  parameterCount?: number
  antiOverfitStage?: "selection_validation" | "external_validation" | "locked_holdout"
  input: JSONRecord
}

function main(argv: string[]): void {
  const result = run(argv)
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
}

export function run(argv: string[]): JSONRecord {
  const previousCwd = process.cwd()
  try {
    process.chdir(repoRoot())
    return successResponse(runConfig(parseArgs(argv)))
  } catch (error) {
    return errorResponse(error)
  } finally {
    process.chdir(previousCwd)
  }
}

function runConfig(config: Config): unknown {
  const input = config.input
  const manifestPath = stringField(input.manifest_path) || stringField(input.manifestPath) || config.manifestPath
  if (!manifestPath) throw new Error("replay-runner requires --manifest or input.manifest_path")
  return replayRegisteredStrategy({
    manifestPath,
    strategyId: stringField(input.strategy_id) || stringField(input.strategyId) || config.strategyId,
    timeframe: stringField(input.timeframe) || config.timeframe,
    maxHoldBars: numberField(input.max_hold_bars ?? input.maxHoldBars) ?? config.maxHoldBars,
    rewardRisk: numberField(input.reward_risk ?? input.rewardRisk) ?? config.rewardRisk,
    feeBps: numberField(input.fee_bps ?? input.feeBps) ?? config.feeBps,
    slippageBps: numberField(input.slippage_bps ?? input.slippageBps) ?? config.slippageBps,
    fundingBpsPer8h: numberField(input.funding_bps_per_8h ?? input.fundingBpsPer8h) ?? config.fundingBpsPer8h,
    oosSplitRatio: numberField(input.oos_split ?? input.oosSplitRatio) ?? config.oosSplitRatio,
    trialCount: numberField(input.trial_count ?? input.trialCount) ?? config.trialCount,
    parameterCount: numberField(input.parameter_count ?? input.parameterCount) ?? config.parameterCount,
    antiOverfitStage: readAntiOverfitStage(stringField(input.anti_overfit_stage) || stringField(input.antiOverfitStage)) ?? config.antiOverfitStage,
  })
}

function parseArgs(argv: string[]): Config {
  const config: Config = {
    manifestPath: "",
    strategyId: "S-BTC-4H-TREND-PULLBACK",
    timeframe: "",
    input: {},
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--manifest": config.manifestPath = readValue(argv, ++index, arg); break
      case "--strategy-id": config.strategyId = readValue(argv, ++index, arg); break
      case "--timeframe": config.timeframe = readValue(argv, ++index, arg); break
      case "--max-hold-bars": config.maxHoldBars = Number(readValue(argv, ++index, arg)); break
      case "--reward-risk": config.rewardRisk = Number(readValue(argv, ++index, arg)); break
      case "--fee-bps": config.feeBps = Number(readValue(argv, ++index, arg)); break
      case "--slippage-bps": config.slippageBps = Number(readValue(argv, ++index, arg)); break
      case "--funding-bps-per-8h": config.fundingBpsPer8h = Number(readValue(argv, ++index, arg)); break
      case "--oos-split": config.oosSplitRatio = Number(readValue(argv, ++index, arg)); break
      case "--trial-count": config.trialCount = Number(readValue(argv, ++index, arg)); break
      case "--parameter-count": config.parameterCount = Number(readValue(argv, ++index, arg)); break
      case "--anti-overfit-stage": config.antiOverfitStage = requiredAntiOverfitStage(readValue(argv, ++index, arg)); break
      case "--json": config.input = readJson(readValue(argv, ++index, arg)); break
      case "--help": printHelp(); process.exit(0)
      default: throw new Error(`unknown flag: ${arg}`)
    }
  }
  return config
}

function readValue(argv: string[], index: number, name: string): string {
  const value = argv[index]
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`)
  return value
}

function readJson(raw: string): JSONRecord {
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("input JSON must be an object")
  return parsed as JSONRecord
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function numberField(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function requiredAntiOverfitStage(value: string): Config["antiOverfitStage"] {
  const parsed = readAntiOverfitStage(value)
  if (!parsed) throw new Error("--anti-overfit-stage must be selection_validation, external_validation, or locked_holdout")
  return parsed
}

function readAntiOverfitStage(value: string): Config["antiOverfitStage"] | undefined {
  if (!value) return undefined
  if (value === "selection_validation" || value === "external_validation" || value === "locked_holdout") return value
  throw new Error("anti_overfit_stage must be selection_validation, external_validation, or locked_holdout")
}

function successResponse(data: unknown): JSONRecord {
  return { ok: true, schema_version: "replay-runner.script-response.v1", data }
}

function errorResponse(error: unknown): JSONRecord {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, schema_version: "replay-runner.script-response.v1", error: message }
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --manifest ./data/ohlcv/BTCUSDT/manifest.json --strategy-id S-BTC-4H-TREND-PULLBACK
  bun src/scripts/main.ts --json '{"manifest_path":"./data/ohlcv/BTCUSDT/manifest.json"}'
`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
