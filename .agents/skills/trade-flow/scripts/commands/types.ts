import type { StrategyStatus } from "../lib/strategy-iteration"
import type { JSONRecord } from "../lib/json"
import type { RunMode } from "../lib/run-mode"

export type { StrategyStatus }
export type { JSONRecord }
export type { RunMode }
export type TrackMode = "" | "slow" | "fast"

export type ScriptResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string; data?: unknown }

export interface CommandConfig {
  dbPath: string
  init: boolean
  appendOrderFill: boolean
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
  appendStrategyEvidence: boolean
  strategyReview: boolean
  strategyPromote: boolean
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
  artifactRoot: string
  retentionHours?: number
  strategyPath: string
  ledgerPath: string
  promoteTo: StrategyStatus
  input: JSONRecord
}
