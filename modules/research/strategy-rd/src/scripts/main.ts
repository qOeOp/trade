#!/usr/bin/env bun

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { assertProjectRuntimePath, repoRoot } from "../lib/paths"
import { defaultCatalogDbPathForGeneratedPath, registerCatalogArtifact } from "../lib/data-catalog"
import { fundingCarryGovernanceInputFromJson, runFundingCarryGovernance } from "../lib/funding-carry-governance"
import {
  createRdShadowTrackerFromForwardHoldout,
  manifestRefsFromJson,
  readJsonFile as readTrackerJsonFile,
  updateRdShadowTracker,
  type RdShadowTrackerOptions,
} from "../lib/rd-shadow-tracker"
import { runRdProgramStateCommand } from "../lib/rd-program-state"
import { runRdSupervisorLoop } from "../lib/rd-supervisor-runner"
import { candidateFromStrategyContract, compileStrategyContract, lintStrategyContract } from "../lib/strategy-contract"
import { runStrategyDataSplit, strategyDataSplitInputFromJson } from "../lib/strategy-data-split"
import { replayRegisteredStrategy } from "../lib/strategy-replay"
import { runStrategyPanelRnd, strategyPanelRndInputFromJson } from "../lib/strategy-panel-rnd"
import {
  runCalibrationSuite,
  runTrendBenchmark,
  strategyBenchmarkInputFromJson,
  strategyCalibrationInputFromJson,
} from "../lib/strategy-benchmark"
import {
  evaluateRndSignal,
  runStrategyRndBatch,
  runStrategyRndCampaign,
  runStrategyRndLoop,
  strategyRndBatchInputFromJson,
  strategyRndCampaignInputFromJson,
  strategyRndLoopInputFromJson,
  strategyRndSignalInputFromJson,
} from "../lib/strategy-rnd"

type JSONRecord = Record<string, unknown>

interface Config {
  replayStrategy: boolean
  strategyRndBatch: boolean
  strategyRndLoop: boolean
  strategyRndCampaign: boolean
  strategyPanelRnd: boolean
  strategyDataSplit: boolean
  rdProgramState: boolean
  rdSupervisorRun: boolean
  rdShadowTracker: boolean
  strategyBenchmark: boolean
  strategyCalibrationSuite: boolean
  fundingCarryGovernance: boolean
  strategySignal: boolean
  strategyCompile: boolean
  strategyLint: boolean
  forwardResultPath: string
  manifestMapPath: string
  outputPath: string
  now: string
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
  strategyPath: string
  statePath: string
  catalogDbPath: string
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
  if (config.replayStrategy) {
    if (!config.manifestPath) throw new Error("--replay-strategy requires --manifest")
    return replayRegisteredStrategy({
      manifestPath: config.manifestPath,
      strategyId: config.strategyId,
      timeframe: config.timeframe,
      maxHoldBars: config.maxHoldBars,
      rewardRisk: config.rewardRisk,
      feeBps: config.feeBps,
      slippageBps: config.slippageBps,
      fundingBpsPer8h: config.fundingBpsPer8h,
      oosSplitRatio: config.oosSplitRatio,
      trialCount: config.trialCount,
      parameterCount: config.parameterCount,
      antiOverfitStage: config.antiOverfitStage,
    })
  }
  if (config.strategyRndBatch) return runStrategyRndBatch(strategyRndBatchInputFromJson(config.input))
  if (config.strategyRndLoop) {
    const input = strategyRndLoopInputFromJson(config.input)
    assertRuntimeOutputPaths(input.artifactRoot, input.ledgerPath, input.catalogDbPath, input.rdProgramStatePath)
    return runStrategyRndLoop(input)
  }
  if (config.strategyRndCampaign) {
    const input = strategyRndCampaignInputFromJson(config.input)
    assertRuntimeOutputPaths(input.artifactRoot, input.ledgerPath, input.catalogDbPath, input.rdProgramStatePath)
    return runStrategyRndCampaign(input)
  }
  if (config.strategyPanelRnd) return runStrategyPanelRnd(strategyPanelRndInputFromJson(config.input))
  if (config.strategyDataSplit) {
    const input = strategyDataSplitInputFromJson(config.input)
    assertRuntimeOutputPaths(input.outputRoot)
    return runStrategyDataSplit(input)
  }
  if (config.rdProgramState) return runRdProgramStateCommand({ path: config.statePath, input: config.input, catalogDbPath: config.catalogDbPath })
  if (config.rdSupervisorRun) return runRdSupervisorLoop({ path: config.statePath, input: config.input, catalogDbPath: config.catalogDbPath })
  if (config.rdShadowTracker) return runRdShadowTracker(config)
  if (config.strategyBenchmark) return runTrendBenchmark(strategyBenchmarkInputFromJson(config.input))
  if (config.strategyCalibrationSuite) return runCalibrationSuite(strategyCalibrationInputFromJson(config.input))
  if (config.fundingCarryGovernance) return runFundingCarryGovernance(fundingCarryGovernanceInputFromJson(config.input))
  if (config.strategyCompile) {
    if (!config.strategyPath) throw new Error("--strategy-compile requires --strategy")
    return compileStrategyContract(config.strategyPath, asRecord(config.input.candidate_param_overrides))
  }
  if (config.strategyLint) {
    if (!config.strategyPath) throw new Error("--strategy-lint requires --strategy")
    return lintStrategyContract(config.strategyPath)
  }
  if (config.strategySignal) {
    const parsed = strategyRndSignalInputFromJson(config.input)
    const input = config.strategyPath && !config.input.candidate
      ? { ...parsed, candidate: candidateFromStrategyContract(config.strategyPath, signalCandidateOverrides(config.input)) }
      : parsed
    return evaluateRndSignal(input)
  }
  throw new Error("provide a strategy RD command flag")
}

function parseArgs(argv: string[]): Config {
  const config: Config = {
    replayStrategy: false,
    strategyRndBatch: false,
    strategyRndLoop: false,
    strategyRndCampaign: false,
    strategyPanelRnd: false,
    strategyDataSplit: false,
    rdProgramState: false,
    rdSupervisorRun: false,
    rdShadowTracker: false,
    strategyBenchmark: false,
    strategyCalibrationSuite: false,
    fundingCarryGovernance: false,
    strategySignal: false,
    strategyCompile: false,
    strategyLint: false,
    forwardResultPath: "",
    manifestMapPath: "",
    outputPath: "",
    now: "",
    manifestPath: "",
    strategyId: "S-BTC-4H-TREND-PULLBACK",
    timeframe: "",
    strategyPath: "",
    statePath: "",
    catalogDbPath: "./data/data_catalog.db",
    input: {},
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--replay-strategy": config.replayStrategy = true; break
      case "--strategy-rnd-batch": config.strategyRndBatch = true; break
      case "--strategy-rnd-loop": config.strategyRndLoop = true; break
      case "--strategy-rnd-campaign": config.strategyRndCampaign = true; break
      case "--strategy-panel-rnd": config.strategyPanelRnd = true; break
      case "--strategy-data-split": config.strategyDataSplit = true; break
      case "--rd-program-state": config.rdProgramState = true; break
      case "--rd-supervisor-run": config.rdSupervisorRun = true; break
      case "--rd-shadow-tracker": config.rdShadowTracker = true; break
      case "--strategy-benchmark": config.strategyBenchmark = true; break
      case "--strategy-calibration-suite": config.strategyCalibrationSuite = true; break
      case "--funding-carry-governance": config.fundingCarryGovernance = true; break
      case "--strategy-signal": config.strategySignal = true; break
      case "--strategy-compile": config.strategyCompile = true; break
      case "--strategy-lint": config.strategyLint = true; break
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
      case "--anti-overfit-stage": config.antiOverfitStage = readAntiOverfitStage(readValue(argv, ++index, arg)); break
      case "--strategy": config.strategyPath = readValue(argv, ++index, arg); break
      case "--state": config.statePath = readValue(argv, ++index, arg); break
      case "--forward-result": config.forwardResultPath = readValue(argv, ++index, arg); break
      case "--manifest-map": config.manifestMapPath = readValue(argv, ++index, arg); break
      case "--output": config.outputPath = readValue(argv, ++index, arg); break
      case "--catalog-db": config.catalogDbPath = readValue(argv, ++index, arg); break
      case "--now": config.now = readValue(argv, ++index, arg); break
      case "--db": ++index; break
      case "--input": config.input = readJsonFile(readValue(argv, ++index, arg)); break
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

function readJsonFile(path: string): JSONRecord {
  return readJson(readFileSync(path, "utf8"))
}

function readJson(raw: string): JSONRecord {
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("input JSON must be an object")
  return parsed as JSONRecord
}

function readAntiOverfitStage(value: string): Config["antiOverfitStage"] {
  if (value === "selection_validation" || value === "external_validation" || value === "locked_holdout") return value
  throw new Error("--anti-overfit-stage must be selection_validation, external_validation, or locked_holdout")
}

function assertRuntimeOutputPaths(...paths: Array<string | undefined>): void {
  for (const path of paths) {
    if (path) assertProjectRuntimePath(path)
  }
}

function runRdShadowTracker(config: Config): unknown {
  if (!config.forwardResultPath && !config.statePath) {
    throw new Error("--rd-shadow-tracker requires --forward-result or --state")
  }
  assertRuntimeOutputPaths(config.outputPath, config.catalogDbPath)
  const options: RdShadowTrackerOptions = {
    now: config.now || undefined,
    sourceRef: config.forwardResultPath || undefined,
    maxHoldBars: config.maxHoldBars,
    forwardReport: config.statePath && config.forwardResultPath ? readTrackerJsonFile(config.forwardResultPath) : undefined,
    manifestRefs: config.manifestMapPath ? manifestRefsFromJson(readTrackerJsonFile(config.manifestMapPath)) : undefined,
  }
  const state = config.statePath
    ? updateRdShadowTracker(readTrackerJsonFile(config.statePath), options)
    : createRdShadowTrackerFromForwardHoldout(readTrackerJsonFile(config.forwardResultPath), options)
  if (!config.outputPath) {
    return state
  }
  mkdirSync(dirname(config.outputPath), { recursive: true })
  writeFileSync(config.outputPath, `${JSON.stringify({ ok: true, data: state }, null, 2)}\n`)
  const catalogDbPath = config.catalogDbPath || defaultCatalogDbPathForGeneratedPath(config.outputPath)
  registerCatalogArtifact({
    catalogDbPath,
    path: config.outputPath,
    now: state.updated_at,
    referrerType: "run",
    referrerID: state.tracker_id,
    role: "output",
  })
  return {
    ...state,
    output_ref: config.outputPath,
    catalog_db_path: catalogDbPath,
  }
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function signalCandidateOverrides(input: JSONRecord): JSONRecord {
  const overrides = asRecord(input.candidate_param_overrides)
  for (const key of ["benchmark_manifest_path", "benchmark_timeframe"]) {
    const value = stringField(input[key])
    if (value) overrides[key] = value
  }
  return overrides
}

function successResponse(data: unknown): JSONRecord {
  return { ok: true, schema_version: "strategy-rd.script-response.v1", data }
}

function errorResponse(error: unknown): JSONRecord {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, schema_version: "strategy-rd.script-response.v1", error: message }
}

function printHelp(): void {
  console.log(`Usage:
  bun src/scripts/main.ts --strategy-rnd-batch --json '{"manifest_path":"...","candidates":[...]}'
  bun src/scripts/main.ts --strategy-rnd-loop --json '{"manifest_path":"...","candidates":[...]}'
  bun src/scripts/main.ts --strategy-rnd-campaign --json '{"campaign_id":"...","hypotheses":[...]}'
  bun src/scripts/main.ts --strategy-panel-rnd --json '{"datasets":[...],"candidates":[...]}'
  bun src/scripts/main.ts --rd-program-state --state ./data/rd/program.json --json '{"action":"plan_next"}'
  bun src/scripts/main.ts --rd-shadow-tracker --forward-result ./tmp/forward.json --output ./tmp/artifacts/strategy-rnd/shadow.json
`)
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.log(JSON.stringify(errorResponse(error), null, 2))
    process.exit(1)
  }
}
