#!/usr/bin/env bun

import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { Database } from "bun:sqlite"
import { parseArgs } from "./commands/args"
import { handleEvidenceCommand } from "./commands/evidence"
import { handleExecutionCommand } from "./commands/execution"
import { HELP_TEXT } from "./commands/help"
import { handleObserveCommand } from "./commands/observe"
import { handleResearchCommand } from "./commands/research"
import { handleRecoveryCommand } from "./commands/recovery"
import { handleRuntimeCommand } from "./commands/runtime"
import type { ScriptResponse } from "./commands/types"
import {
  buildMockExecutionResult,
  buildRecordedExecutionEvent,
  runOneFlowStep,
} from "./lib/execution-flow"
import { applyReconcileDrafts, findActiveLaneConflicts, laneKeyFromObserve, latestSlowObserve, listActiveFlows, reduceFlowState } from "./lib/flow-state"
import { runLiveSmall, runShadowFromSkills } from "./lib/live-execution"
import { loadRuntime, observeFromSkills, observeFromSkillsWithRunner } from "./lib/observe-flow"
import {
  appendPlanEvent,
  buildOrderFillEvent,
  ensureSchema,
  readFlowEvents,
  readLatestOrderFill,
  validateOrderFill,
  validatePlanEvent,
  type PlanEvent,
} from "./lib/plan-events"
import { cronRecoverFromSkills, reconcileFromSkills } from "./lib/recovery-flow"
import { buildTrackDryRunSummary } from "./lib/track-runner"

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

    mkdirSync(dirname(config.dbPath), { recursive: true })
    const db = new Database(config.dbPath)
    try {
      ensureSchema(db)
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
      throw new Error("provide --init, --track, --append-order-fill, --record-execution, --run, --load-runtime, --build-observe, --observe-from-skills, --replay-strategy, --strategy-rnd-batch, --strategy-rnd-loop, --strategy-rnd-campaign, --strategy-panel-rnd, --strategy-benchmark, --strategy-calibration-suite, --strategy-signal, --artifact-gc, --append-strategy-evidence, --strategy-review, --strategy-promote, --run-shadow-from-skills, --run-live-small, --recover-flow, --reconcile-flow, --reconcile-from-skills, --apply-reconcile, or --cron-recover-from-skills")
    } finally {
      db.close()
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export {
  appendPlanEvent,
  applyReconcileDrafts,
  buildOrderFillEvent,
  buildRecordedExecutionEvent,
  buildMockExecutionResult,
  buildTrackDryRunSummary,
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
  type PlanEvent,
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  void main()
}
