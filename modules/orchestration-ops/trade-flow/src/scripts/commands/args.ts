import { readFileSync } from "node:fs"
import type { CommandConfig, JSONRecord, RunMode, TrackMode } from "./types"

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
  let observeFromToolsEnabled = false
  let automationCycle = false
  let runShadowFromToolsEnabled = false
  let runLiveSmallEnabled = false
  let recoverFlow = false
  let reconcileFlow = false
  let reconcileFromTools = false
  let applyReconcile = false
  let cronRecoverFromTools = false
  let track: TrackMode = ""
  let yes = false
  let chainId = ""
  let tradingConfigPath = ""
  let accountConfigPath = "./profile/account_config.json"
  let strategiesDir = "./strategies"
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
      case "--observe-from-tools":
        observeFromToolsEnabled = true
        break
      case "--automation-cycle":
        automationCycle = true
        break
      case "--run-shadow-from-tools":
        runShadowFromToolsEnabled = true
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
      case "--reconcile-from-tools":
        reconcileFromTools = true
        break
      case "--apply-reconcile":
        applyReconcile = true
        break
      case "--cron-recover-from-tools":
        cronRecoverFromTools = true
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
    observeFromTools: observeFromToolsEnabled,
    automationCycle,
    runShadowFromTools: runShadowFromToolsEnabled,
    runLiveSmall: runLiveSmallEnabled,
    recoverFlow,
    reconcileFlow,
    reconcileFromTools,
    applyReconcile,
    cronRecoverFromTools,
    track,
    yes,
    chainId,
    tradingConfigPath,
    accountConfigPath,
    strategiesDir,
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

function readTrackMode(value: string): TrackMode {
  if (value === "slow" || value === "fast") {
    return value
  }
  throw new Error("--track must be slow or fast")
}

function readRunMode(value: string): RunMode {
  if (value === "dry-run" || value === "shadow") {
    return value
  }
  throw new Error(`unsupported --mode ${value}`)
}
