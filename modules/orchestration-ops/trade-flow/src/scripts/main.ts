#!/usr/bin/env bun

import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { Database } from "bun:sqlite"
import { parseArgs } from "./commands/args"
import { handleExecutionCommand } from "./commands/execution"
import { HELP_TEXT } from "./commands/help"
import { handleObserveCommand } from "./commands/observe"
import { handleRecoveryCommand } from "./commands/recovery"
import { errorResponse, successResponse } from "./commands/response"
import { handleRuntimeCommand } from "./commands/runtime"
import type { ScriptResponse } from "./commands/types"
import {
  buildMockExecutionResult,
  runOneFlowStep,
} from "../../../../live-execution-control/execution-flow-runner/src/lib/execution-flow-runner"
import { buildRecordedExecutionEvent } from "../../../../live-execution-control/execution-recorder/src/lib/execution-recorder"
import { applyReconcileDrafts, findActiveLaneConflicts, laneKeyFromObserve, latestSlowObserve, listActiveFlows, reduceFlowState } from "../../../../portfolio-execution-state/flow-projector/src/lib/flow-projector"
import { runLiveSmall } from "../../../../live-execution-control/live-small-runner/src/lib/live-small-runner"
import { runShadowFromTools } from "./lib/live-execution"
import { buildAutomationCyclePlan } from "./lib/automation-cycle"
import { loadRuntime, observeFromTools, observeFromToolsWithRunner } from "./lib/observe-flow"
import { assertProjectRuntimePath, resolveRepoPath } from "./lib/paths"
import {
  appendPlanEvent,
  buildOrderFillEvent,
  buildReviewEvent,
  ensureSchema,
  readFlowEvents,
  readLatestOrderFill,
  validateOrderFill,
  validatePlanEvent,
  validateReview,
  type PlanEvent,
} from "../../../../portfolio-execution-state/event-store/src/lib/event-store"
import { cronRecoverFromTools, reconcileFromTools } from "../../../../live-execution-control/recovery-runner/src/lib/recovery-runner"
import { buildTrackDryRunSummary, runTrackDryRunAtPath } from "./lib/track-runner"
import type { CommandConfig } from "./commands/types"

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP_TEXT)
    return
  }

  const response = await run(argv)
  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`)
  if (!response.ok) {
    process.exit(1)
  }
}

async function run(argv: string[]): Promise<ScriptResponse> {
  try {
    const config = normalizeCommandPaths(parseArgs(argv))

    const observeResponse = await handleObserveCommand(config)
    if (observeResponse) {
      return observeResponse
    }

    if (config.track) {
      return successResponse(await runTrackDryRunAtPath(config.dbPath, config.track))
    }

    mkdirSync(dirname(config.dbPath), { recursive: true })
    const db = new Database(config.dbPath)
    try {
      ensureSchema(db)
      if (config.automationCycle) {
        return successResponse(buildAutomationCyclePlan(db, config.dbPath, config.input))
      }
      const runtimeResponse = handleRuntimeCommand(db, config)
      if (runtimeResponse) {
        return runtimeResponse
      }
      const executionResponse = await handleExecutionCommand(db, config)
      if (executionResponse) {
        return executionResponse
      }
      const recoveryResponse = await handleRecoveryCommand(db, config)
      if (recoveryResponse) {
        return recoveryResponse
      }
      throw new Error("provide --init, --track, --automation-cycle, --append-order-fill, --append-review, --record-execution, --run, --load-runtime, --build-observe, --observe-from-tools, --run-shadow-from-tools, --run-live-small, --recover-flow, --reconcile-flow, --reconcile-from-tools, --apply-reconcile, or --cron-recover-from-tools")
    } finally {
      db.close()
    }
  } catch (error) {
    return errorResponse(error)
  }
}

function normalizeCommandPaths(config: CommandConfig): CommandConfig {
  for (const path of runtimeOutputPaths(config)) {
    assertProjectRuntimePath(path)
  }
  return {
    ...config,
    dbPath: resolveRepoPath(config.dbPath),
    tradingConfigPath: config.tradingConfigPath ? resolveRepoPath(config.tradingConfigPath) : config.tradingConfigPath,
    accountConfigPath: config.accountConfigPath ? resolveRepoPath(config.accountConfigPath) : config.accountConfigPath,
    strategiesDir: config.strategiesDir ? resolveRepoPath(config.strategiesDir) : config.strategiesDir,
  }
}

function runtimeOutputPaths(config: CommandConfig): string[] {
  return [
    config.dbPath,
  ].filter(Boolean)
}

export {
  appendPlanEvent,
  applyReconcileDrafts,
  buildOrderFillEvent,
  buildReviewEvent,
  buildRecordedExecutionEvent,
  buildMockExecutionResult,
  buildTrackDryRunSummary,
  buildAutomationCyclePlan,
  cronRecoverFromTools,
  ensureSchema,
  readFlowEvents,
  readLatestOrderFill,
  reduceFlowState,
  findActiveLaneConflicts,
  laneKeyFromObserve,
  latestSlowObserve,
  listActiveFlows,
  loadRuntime,
  observeFromTools,
  observeFromToolsWithRunner,
  run,
  reconcileFromTools,
  runLiveSmall,
  runShadowFromTools,
  runOneFlowStep,
  validateOrderFill,
  validatePlanEvent,
  validateReview,
  type PlanEvent,
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  void main()
}
