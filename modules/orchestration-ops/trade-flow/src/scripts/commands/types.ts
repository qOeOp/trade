import type { JSONRecord } from "../lib/json"
import type { RunMode } from "../lib/run-mode"

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
  observeFromTools: boolean
  automationCycle: boolean
  runShadowFromTools: boolean
  runLiveSmall: boolean
  recoverFlow: boolean
  reconcileFlow: boolean
  reconcileFromTools: boolean
  applyReconcile: boolean
  cronRecoverFromTools: boolean
  track: TrackMode
  yes: boolean
  chainId: string
  tradingConfigPath: string
  accountConfigPath: string
  strategiesDir: string
  input: JSONRecord
}
