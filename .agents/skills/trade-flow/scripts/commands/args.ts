import { readFileSync } from "node:fs"
import type { CommandConfig, JSONRecord, RunMode, StrategyStatus, TrackMode } from "./types"

export function parseArgs(argv: string[]): CommandConfig {
  let dbPath = "./data/trade.db"
  let init = false
  let appendOrderFill = false
  let appendReview = false
  let recordExecution = false
  let runFlow = false
  let mode: RunMode = "dry-run"
  let loadRuntimeConfig = false
  let buildObserve = false
  let observeFromSkillsEnabled = false
  let replayStrategy = false
  let strategyRndBatch = false
  let strategyRndLoop = false
  let strategyRndCampaign = false
  let strategyPanelRnd = false
  let strategyDataSplit = false
  let rdProgramState = false
  let rdSupervisorRun = false
  let automationCycle = false
  let strategyBenchmark = false
  let strategyCalibrationSuite = false
  let fundingCarryGovernance = false
  let strategySignal = false
  let strategyCompile = false
  let strategyLint = false
  let artifactGc = false
  let catalogInit = false
  let catalogScan = false
  let catalogQuery = false
  let catalogStale = false
  let catalogGc = false
  let appendStrategyEvidenceEnabled = false
  let strategyReview = false
  let strategyPromote = false
  let strategyCycle = false
  let runShadowFromSkillsEnabled = false
  let runLiveSmallEnabled = false
  let recoverFlow = false
  let reconcileFlow = false
  let reconcileFromSkills = false
  let applyReconcile = false
  let cronRecoverFromSkills = false
  let track: TrackMode = ""
  let yes = false
  let chainId = ""
  let tradingConfigPath = ""
  let accountConfigPath = "./profile/account_config.json"
  let strategiesDir = "./strategies"
  let manifestPath = ""
  let strategyId = "S-BTC-4H-TREND-PULLBACK"
  let timeframe = ""
  let maxHoldBars: number | undefined
  let rewardRisk: number | undefined
  let feeBps: number | undefined
  let slippageBps: number | undefined
  let fundingBpsPer8h: number | undefined
  let oosSplitRatio: number | undefined
  let trialCount: number | undefined
  let parameterCount: number | undefined
  let antiOverfitStage: CommandConfig["antiOverfitStage"]
  let artifactRoot = ""
  let catalogDbPath = "./data/data_catalog.db"
  const catalogRoots: string[] = []
  let retentionHours: number | undefined
  let ephemeralRetentionHours: number | undefined
  let strategyPath = ""
  let ledgerPath = ""
  let statePath = ""
  let promoteTo: StrategyStatus = "shadow"
  let promoteToExplicit = false
  let raw = ""

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--db":
        dbPath = readFlagValue(argv, ++index, arg)
        break
      case "--init":
        init = true
        break
      case "--append-order-fill":
        appendOrderFill = true
        break
      case "--append-review":
        appendReview = true
        break
      case "--record-execution":
        recordExecution = true
        break
      case "--run":
        runFlow = true
        break
      case "--mode":
        mode = readRunMode(readFlagValue(argv, ++index, arg))
        break
      case "--load-runtime":
        loadRuntimeConfig = true
        break
      case "--build-observe":
        buildObserve = true
        break
      case "--observe-from-skills":
        observeFromSkillsEnabled = true
        break
      case "--replay-strategy":
        replayStrategy = true
        break
      case "--strategy-rnd-batch":
        strategyRndBatch = true
        break
      case "--strategy-rnd-loop":
        strategyRndLoop = true
        break
      case "--strategy-rnd-campaign":
        strategyRndCampaign = true
        break
      case "--strategy-panel-rnd":
        strategyPanelRnd = true
        break
      case "--strategy-data-split":
        strategyDataSplit = true
        break
      case "--rd-program-state":
        rdProgramState = true
        break
      case "--rd-supervisor-run":
        rdSupervisorRun = true
        break
      case "--automation-cycle":
        automationCycle = true
        break
      case "--strategy-benchmark":
        strategyBenchmark = true
        break
      case "--strategy-calibration-suite":
        strategyCalibrationSuite = true
        break
      case "--funding-carry-governance":
        fundingCarryGovernance = true
        break
      case "--strategy-signal":
        strategySignal = true
        break
      case "--strategy-compile":
        strategyCompile = true
        break
      case "--strategy-lint":
        strategyLint = true
        break
      case "--artifact-gc":
        artifactGc = true
        break
      case "--catalog-init":
        catalogInit = true
        break
      case "--catalog-scan":
        catalogScan = true
        break
      case "--catalog-query":
        catalogQuery = true
        break
      case "--catalog-stale":
        catalogStale = true
        break
      case "--catalog-gc":
        catalogGc = true
        break
      case "--append-strategy-evidence":
        appendStrategyEvidenceEnabled = true
        break
      case "--strategy-review":
        strategyReview = true
        break
      case "--strategy-promote":
        strategyPromote = true
        break
      case "--strategy-cycle":
        strategyCycle = true
        break
      case "--run-shadow-from-skills":
        runShadowFromSkillsEnabled = true
        break
      case "--run-live-small":
        runLiveSmallEnabled = true
        break
      case "--recover-flow":
        recoverFlow = true
        break
      case "--reconcile-flow":
        reconcileFlow = true
        break
      case "--reconcile-from-skills":
        reconcileFromSkills = true
        break
      case "--apply-reconcile":
        applyReconcile = true
        break
      case "--cron-recover-from-skills":
        cronRecoverFromSkills = true
        break
      case "--track":
        track = readTrackMode(readFlagValue(argv, ++index, arg))
        break
      case "--chain-id":
        chainId = readFlagValue(argv, ++index, arg)
        break
      case "--yes":
        yes = true
        break
      case "--account-config":
        accountConfigPath = readFlagValue(argv, ++index, arg)
        break
      case "--trading-config":
        tradingConfigPath = readFlagValue(argv, ++index, arg)
        break
      case "--strategies-dir":
        strategiesDir = readFlagValue(argv, ++index, arg)
        break
      case "--manifest":
        manifestPath = readFlagValue(argv, ++index, arg)
        break
      case "--strategy-id":
        strategyId = readFlagValue(argv, ++index, arg)
        break
      case "--timeframe":
        timeframe = readFlagValue(argv, ++index, arg)
        break
      case "--max-hold-bars":
        maxHoldBars = Number(readFlagValue(argv, ++index, arg))
        break
      case "--reward-risk":
        rewardRisk = Number(readFlagValue(argv, ++index, arg))
        break
      case "--fee-bps":
        feeBps = Number(readFlagValue(argv, ++index, arg))
        break
      case "--slippage-bps":
        slippageBps = Number(readFlagValue(argv, ++index, arg))
        break
      case "--funding-bps-per-8h":
        fundingBpsPer8h = Number(readFlagValue(argv, ++index, arg))
        break
      case "--oos-split":
        oosSplitRatio = Number(readFlagValue(argv, ++index, arg))
        break
      case "--trial-count":
        trialCount = Number(readFlagValue(argv, ++index, arg))
        break
      case "--parameter-count":
        parameterCount = Number(readFlagValue(argv, ++index, arg))
        break
      case "--anti-overfit-stage":
        antiOverfitStage = readAntiOverfitStage(readFlagValue(argv, ++index, arg))
        break
      case "--artifact-root":
        artifactRoot = readFlagValue(argv, ++index, arg)
        break
      case "--catalog-db":
        catalogDbPath = readFlagValue(argv, ++index, arg)
        break
      case "--catalog-root":
        catalogRoots.push(readFlagValue(argv, ++index, arg))
        break
      case "--retention-hours":
        retentionHours = Number(readFlagValue(argv, ++index, arg))
        break
      case "--ephemeral-retention-hours":
        ephemeralRetentionHours = Number(readFlagValue(argv, ++index, arg))
        break
      case "--strategy":
        strategyPath = readFlagValue(argv, ++index, arg)
        break
      case "--ledger":
        ledgerPath = readFlagValue(argv, ++index, arg)
        break
      case "--state":
        statePath = readFlagValue(argv, ++index, arg)
        break
      case "--to":
        promoteTo = readStrategyStatus(readFlagValue(argv, ++index, arg))
        promoteToExplicit = true
        break
      case "--input":
        raw = readFileSync(readFlagValue(argv, ++index, arg), "utf8")
        break
      case "--json":
        raw = readFlagValue(argv, ++index, arg)
        break
      default:
        throw new Error(`unknown flag: ${arg}`)
    }
  }

  return {
    dbPath,
    init,
    appendOrderFill,
    appendReview,
    recordExecution,
    run: runFlow,
    mode,
    loadRuntime: loadRuntimeConfig,
    buildObserve,
    observeFromSkills: observeFromSkillsEnabled,
    replayStrategy,
    strategyRndBatch,
    strategyRndLoop,
    strategyRndCampaign,
    strategyPanelRnd,
    strategyDataSplit,
    rdProgramState,
    rdSupervisorRun,
    automationCycle,
    strategyBenchmark,
    strategyCalibrationSuite,
    fundingCarryGovernance,
    strategySignal,
    strategyCompile,
    strategyLint,
    artifactGc,
    catalogInit,
    catalogScan,
    catalogQuery,
    catalogStale,
    catalogGc,
    appendStrategyEvidence: appendStrategyEvidenceEnabled,
    strategyReview,
    strategyPromote,
    strategyCycle,
    promoteToExplicit,
    runShadowFromSkills: runShadowFromSkillsEnabled,
    runLiveSmall: runLiveSmallEnabled,
    recoverFlow,
    reconcileFlow,
    reconcileFromSkills,
    applyReconcile,
    cronRecoverFromSkills,
    track,
    yes,
    chainId,
    tradingConfigPath,
    accountConfigPath,
    strategiesDir,
    manifestPath,
    strategyId,
    timeframe,
    maxHoldBars,
    rewardRisk,
    feeBps,
    slippageBps,
    fundingBpsPer8h,
    oosSplitRatio,
    trialCount,
    parameterCount,
    antiOverfitStage,
    artifactRoot,
    catalogDbPath,
    catalogRoots,
    retentionHours,
    ephemeralRetentionHours,
    strategyPath,
    ledgerPath,
    statePath,
    promoteTo,
    input: raw ? JSON.parse(raw) as JSONRecord : {},
  }
}

function readFlagValue(argv: string[], index: number, name: string): string {
  const value = argv[index]
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

function readStrategyStatus(value: string): StrategyStatus {
  if (value === "draft" || value === "shadow" || value === "live-small" || value === "paused") {
    return value
  }
  throw new Error("--to must be draft, shadow, live-small, or paused")
}

function readTrackMode(value: string): TrackMode {
  if (value === "slow" || value === "fast") {
    return value
  }
  throw new Error("--track must be slow or fast")
}

function readAntiOverfitStage(value: string): CommandConfig["antiOverfitStage"] {
  if (value === "selection_validation" || value === "external_validation" || value === "locked_holdout") {
    return value
  }
  throw new Error("--anti-overfit-stage must be selection_validation, external_validation, or locked_holdout")
}

function readRunMode(value: string): RunMode {
  if (value === "dry-run" || value === "shadow") {
    return value
  }
  throw new Error(`unsupported --mode ${value}`)
}
