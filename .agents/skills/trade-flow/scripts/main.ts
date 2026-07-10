#!/usr/bin/env bun

import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { Database } from "bun:sqlite"
import { parseArgs } from "./commands/args"
import { handleCatalogCommand } from "./commands/catalog"
import { handleEvidenceCommand } from "./commands/evidence"
import { handleExecutionCommand } from "./commands/execution"
import { HELP_TEXT } from "./commands/help"
import { handleObserveCommand } from "./commands/observe"
import { handleResearchCommand } from "./commands/research"
import { handleRecoveryCommand } from "./commands/recovery"
import { errorResponse, successResponse } from "./commands/response"
import { handleRuntimeCommand } from "./commands/runtime"
import type { ScriptResponse } from "./commands/types"
import {
  buildMockExecutionResult,
  buildRecordedExecutionEvent,
  runOneFlowStep,
} from "./lib/execution-flow"
import { applyReconcileDrafts, findActiveLaneConflicts, laneKeyFromObserve, latestSlowObserve, listActiveFlows, reduceFlowState } from "./lib/flow-state"
import { runLiveSmall, runShadowFromSkills } from "./lib/live-execution"
import { buildAutomationCyclePlan } from "./lib/automation-cycle"
import { loadRuntime, observeFromSkills, observeFromSkillsWithRunner } from "./lib/observe-flow"
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
} from "./lib/plan-events"
import { cronRecoverFromSkills, reconcileFromSkills } from "./lib/recovery-flow"
import { buildTrackDryRunSummary, runTrackDryRunAtPath } from "./lib/track-runner"

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
    const config = parseArgs(argv)

    const catalogResponse = handleCatalogCommand(config)
    if (catalogResponse) {
      return catalogResponse
    }
    const observeResponse = await handleObserveCommand(config)
    if (observeResponse) {
      return observeResponse
    }
    const researchResponse = handleResearchCommand(config)
    if (researchResponse) {
      return researchResponse
    }
    const evidenceResponse = handleEvidenceCommand(config)
    if (evidenceResponse) {
      return evidenceResponse
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
      throw new Error("provide --init, --track, --automation-cycle, --catalog-init, --catalog-scan, --catalog-query, --catalog-stale, --catalog-gc, --append-order-fill, --append-review, --record-execution, --run, --load-runtime, --build-observe, --observe-from-skills, --replay-strategy, --strategy-rnd-batch, --strategy-rnd-loop, --strategy-rnd-campaign, --strategy-panel-rnd, --strategy-data-split, --strategy-benchmark, --strategy-calibration-suite, --strategy-signal, --strategy-compile, --strategy-lint, --artifact-gc, --append-strategy-evidence, --strategy-review, --strategy-promote, --strategy-cycle, --run-shadow-from-skills, --run-live-small, --recover-flow, --reconcile-flow, --reconcile-from-skills, --apply-reconcile, or --cron-recover-from-skills")
    } finally {
      db.close()
    }
  } catch (error) {
    return errorResponse(error)
  }
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
  cronRecoverFromSkills,
  ensureSchema,
  readFlowEvents,
  readLatestOrderFill,
  reduceFlowState,
  findActiveLaneConflicts,
  laneKeyFromObserve,
  latestSlowObserve,
  listActiveFlows,
  loadRuntime,
  observeFromSkills,
  observeFromSkillsWithRunner,
  run,
  reconcileFromSkills,
  runLiveSmall,
  runShadowFromSkills,
  runOneFlowStep,
  validateOrderFill,
  validatePlanEvent,
  validateReview,
  type PlanEvent,
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  void main()
}
