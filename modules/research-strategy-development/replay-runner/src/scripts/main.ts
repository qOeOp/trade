#!/usr/bin/env bun

import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { errorResponse, printScriptResult, readFlagValue, readJsonObject, successResponse } from "../../../../contracts/runtime-core/src/script-json"
import type { JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { hashCanonical, replayDataHash, replayHarnessHash } from "../../../replay-engine/src/lib/replay-core"
import { replayRegisteredStrategy } from "../../../replay-engine/src/lib/strategy-replay"

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
  fingerprint: boolean
  input: JSONRecord
}

const SCHEMA_VERSION = "replay-runner.script-response.v1"

function main(argv: string[]): void {
  printScriptResult(run(argv))
}

export function run(argv: string[]): JSONRecord {
  const previousCwd = process.cwd()
  try {
    process.chdir(repoRoot())
    return successResponse(SCHEMA_VERSION, runConfig(parseArgs(argv)))
  } catch (error) {
    return errorResponse(SCHEMA_VERSION, error)
  } finally {
    process.chdir(previousCwd)
  }
}

function runConfig(config: Config): unknown {
  if (config.fingerprint) {
    return buildReplayFingerprint(config)
  }
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
    fingerprint: false,
    input: {},
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--manifest": config.manifestPath = readFlagValue(argv, ++index, arg); break
      case "--strategy-id": config.strategyId = readFlagValue(argv, ++index, arg); break
      case "--timeframe": config.timeframe = readFlagValue(argv, ++index, arg); break
      case "--max-hold-bars": config.maxHoldBars = Number(readFlagValue(argv, ++index, arg)); break
      case "--reward-risk": config.rewardRisk = Number(readFlagValue(argv, ++index, arg)); break
      case "--fee-bps": config.feeBps = Number(readFlagValue(argv, ++index, arg)); break
      case "--slippage-bps": config.slippageBps = Number(readFlagValue(argv, ++index, arg)); break
      case "--funding-bps-per-8h": config.fundingBpsPer8h = Number(readFlagValue(argv, ++index, arg)); break
      case "--oos-split": config.oosSplitRatio = Number(readFlagValue(argv, ++index, arg)); break
      case "--trial-count": config.trialCount = Number(readFlagValue(argv, ++index, arg)); break
      case "--parameter-count": config.parameterCount = Number(readFlagValue(argv, ++index, arg)); break
      case "--anti-overfit-stage": config.antiOverfitStage = requiredAntiOverfitStage(readFlagValue(argv, ++index, arg)); break
      case "--fingerprint": config.fingerprint = true; break
      case "--json": config.input = readJsonObject(readFlagValue(argv, ++index, arg)); break
      case "--help": printHelp(); return process.exit(0)
      default: throw new Error(`unknown flag: ${arg}`)
    }
  }
  return config
}

function buildReplayFingerprint(config: Config): JSONRecord {
  const input = config.input
  const manifestPath = stringField(input.manifest_path) || stringField(input.manifestPath) || config.manifestPath
  const timeframe = stringField(input.timeframe) || config.timeframe
  const supplementalDataRefs = stringArray(input.supplemental_data_refs ?? input.supplementalDataRefs)
  const assumptions = asRecord(input.assumptions)
  const result: JSONRecord = {
    harness_hash: replayHarnessHash(),
  }
  if (manifestPath && timeframe) {
    result.data_hash = replayDataHash(manifestPath, timeframe, supplementalDataRefs)
  }
  if (Object.keys(assumptions).length > 0) {
    result.assumptions_hash = hashCanonical(assumptions)
  }
  return result
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function numberField(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringField).filter(Boolean) : []
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
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

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --manifest ./data/ohlcv/BTCUSDT/manifest.json --strategy-id S-BTC-4H-TREND-PULLBACK
  bun src/scripts/main.ts --fingerprint --json '{"manifest_path":"./data/ohlcv/BTCUSDT/manifest.json","timeframe":"4h"}'
  bun src/scripts/main.ts --json '{"manifest_path":"./data/ohlcv/BTCUSDT/manifest.json"}'
`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
