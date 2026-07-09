import type { StrategyStatus } from "../lib/strategy-iteration"
import type { JSONRecord } from "../lib/json"
import type { RunMode } from "../lib/run-mode"

export type { StrategyStatus }
export type { JSONRecord }
export type { RunMode }
export type TrackMode = "" | "slow" | "fast"
export type ScriptErrorCode = "INVALID_ARGUMENT" | "PRECONDITION_FAILED" | "EXTERNAL_FAILURE" | "INTERNAL_ERROR"
export type ScriptResponseSchemaVersion = "trade-flow.script-response.v1"

export type ScriptResponse =
  | { ok: true; schema_version: ScriptResponseSchemaVersion; data: unknown }
  | { ok: false; schema_version: ScriptResponseSchemaVersion; error: string; code: ScriptErrorCode; retriable: boolean; details?: JSONRecord; data?: unknown }

export interface CommandConfig {
  dbPath: string
  init: boolean
  appendOrderFill: boolean
  appendReview: boolean
  recordExecution: boolean
  run: boolean
  mode: RunMode
  loadRuntime: boolean
  buildObserve: boolean
  observeFromSkills: boolean
  replayStrategy: boolean
  strategyRndBatch: boolean
  strategyRndLoop: boolean
  strategyRndCampaign: boolean
  strategyPanelRnd: boolean
  strategyBenchmark: boolean
  strategyCalibrationSuite: boolean
  strategySignal: boolean
  artifactGc: boolean
  catalogInit: boolean
  catalogScan: boolean
  catalogQuery: boolean
  catalogStale: boolean
  catalogGc: boolean
  appendStrategyEvidence: boolean
  strategyReview: boolean
  strategyPromote: boolean
  strategyCycle: boolean
  promoteToExplicit: boolean
  runShadowFromSkills: boolean
  runLiveSmall: boolean
  recoverFlow: boolean
  reconcileFlow: boolean
  reconcileFromSkills: boolean
  applyReconcile: boolean
  cronRecoverFromSkills: boolean
  track: TrackMode
  yes: boolean
  chainId: string
  tradingConfigPath: string
  accountConfigPath: string
  strategiesDir: string
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
  artifactRoot: string
  catalogDbPath: string
  catalogRoots: string[]
  retentionHours?: number
  ephemeralRetentionHours?: number
  strategyPath: string
  ledgerPath: string
  promoteTo: StrategyStatus
  input: JSONRecord
}
