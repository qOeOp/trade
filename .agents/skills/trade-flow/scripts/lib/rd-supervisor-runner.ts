import {
  readRdProgramState,
  runRdProgramStateCommand,
  updateRdProgramState,
  writeRdProgramState,
  type RdProgramState,
} from "./rd-program-state"
import {
  runStrategyRndCampaign,
  runStrategyRndLoop,
  strategyRndCampaignInputFromJson,
  strategyRndLoopInputFromJson,
} from "./strategy-rnd"
import type { JSONRecord } from "./json"

interface RdSupervisorRunInput {
  path: string
  input?: JSONRecord
  catalogDbPath?: string
}

interface RdSupervisorRunResult {
  schema_version: "trade-flow.rd-supervisor-run-result.v1"
  state_ref: string
  started_at: string
  stopped_at: string
  status: "shadow_candidate_found" | "budget_exhausted" | "data_or_tool_blocked" | "iteration_limit_reached" | "stopped"
  stop_reason: string
  iterations: RdSupervisorRunIteration[]
  final_state: RdProgramState
  guardrails: {
    may_write_trade_db: false
    may_call_binance_write: false
    evidence_status: "research_memory_not_strategy_evidence"
  }
}

interface RdSupervisorRunIteration {
  iteration: number
  plan_id: string
  plan_status: "ready" | "blocked" | "stopped"
  command: string | null
  reason: string
  result_ref?: string
  result_status?: string
  state_status: string
  error?: string
}

interface RdSupervisorRunDeps {
  runLoop: (input: JSONRecord) => JSONRecord
  runCampaign: (input: JSONRecord) => JSONRecord
}

function runRdSupervisorLoop(input: RdSupervisorRunInput): RdSupervisorRunResult {
  return runRdSupervisorLoopWithDeps(input, {
    runLoop: (payload) => runStrategyRndLoop(strategyRndLoopInputFromJson(payload)) as unknown as JSONRecord,
    runCampaign: (payload) => runStrategyRndCampaign(strategyRndCampaignInputFromJson(payload)) as unknown as JSONRecord,
  })
}

function runRdSupervisorLoopWithDeps(input: RdSupervisorRunInput, deps: RdSupervisorRunDeps): RdSupervisorRunResult {
  if (!input.path) {
    throw new Error("--rd-supervisor-run requires --state")
  }
  const request = input.input || {}
  const startedAt = normalizeDate(stringField(request.now) || undefined)
  const maxIterations = boundedSupervisorIterations(request.max_iterations)
  const iterations: RdSupervisorRunIteration[] = []

  for (let index = 0; index < maxIterations; index += 1) {
    const planned = runRdProgramStateCommand({
      path: input.path,
      input: { ...request, action: "plan_next", now: iterationNow(startedAt, index) },
      catalogDbPath: input.catalogDbPath,
    })
    const plan = planned.next_plan
    if (!plan) {
      return finish(input.path, startedAt, iterations, "data_or_tool_blocked", "rd supervisor did not receive a next_plan")
    }
    if (plan.status !== "ready" || !plan.command || !plan.payload) {
      if (plan.status === "blocked") {
        markSupervisorBlocked(input.path, input.catalogDbPath, plan.reason, plan.created_at)
      }
      iterations.push({
        iteration: index + 1,
        plan_id: plan.plan_id,
        plan_status: plan.status,
        command: plan.command,
        reason: plan.reason,
        state_status: readRdProgramState(input.path).status,
      })
      return finish(input.path, startedAt, iterations, readRdProgramState(input.path).status === "active" ? "stopped" : readRdProgramState(input.path).status, plan.reason)
    }

    try {
      const result = executePlannedResearch(plan.command, plan.payload, deps)
      const state = readRdProgramState(input.path)
      iterations.push({
        iteration: index + 1,
        plan_id: plan.plan_id,
        plan_status: plan.status,
        command: plan.command,
        reason: plan.reason,
        result_ref: stringField(result.artifact_ref),
        result_status: stringField(result.stop_reason) || stringField(result.outcome),
        state_status: state.status,
      })
      if (state.status !== "active") {
        return finish(input.path, startedAt, iterations, state.status, `rd program state reached ${state.status}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      markSupervisorBlocked(input.path, input.catalogDbPath, message, iterationNow(startedAt, index))
      const state = readRdProgramState(input.path)
      iterations.push({
        iteration: index + 1,
        plan_id: plan.plan_id,
        plan_status: plan.status,
        command: plan.command,
        reason: plan.reason,
        state_status: state.status,
        error: message,
      })
      return finish(input.path, startedAt, iterations, "data_or_tool_blocked", message)
    }
  }

  return finish(input.path, startedAt, iterations, "iteration_limit_reached", "rd supervisor max_iterations reached")
}

function executePlannedResearch(command: string, payload: JSONRecord, deps: RdSupervisorRunDeps): JSONRecord {
  if (command === "--strategy-rnd-loop") return deps.runLoop(payload)
  if (command === "--strategy-rnd-campaign") return deps.runCampaign(payload)
  throw new Error(`rd supervisor cannot execute command: ${command}`)
}

function markSupervisorBlocked(path: string, catalogDbPath: string | undefined, reason: string, now: string): void {
  const updated = updateRdProgramState(readRdProgramState(path), {
    now,
    status: "data_or_tool_blocked",
    latestFailureSummary: {
      primary_failure_area: "rd_supervisor",
      reason,
      next_system_actions: ["Repair the R&D queue or data/tool blocker before continuing the supervisor loop."],
    },
    latestReliabilityGate: {
      source: "rd_supervisor",
      status: "blocked",
      reason,
    },
  })
  writeRdProgramState(path, updated, catalogDbPath)
}

function finish(
  path: string,
  startedAt: string,
  iterations: RdSupervisorRunIteration[],
  status: RdSupervisorRunResult["status"] | RdProgramState["status"],
  stopReason: string,
): RdSupervisorRunResult {
  const finalState = readRdProgramState(path)
  const stoppedAt = iterations.length > 0 ? iterationNow(startedAt, iterations.length) : startedAt
  return {
    schema_version: "trade-flow.rd-supervisor-run-result.v1",
    state_ref: path,
    started_at: startedAt,
    stopped_at: stoppedAt,
    status: normalizeRunStatus(status),
    stop_reason: stopReason,
    iterations,
    final_state: finalState,
    guardrails: {
      may_write_trade_db: false,
      may_call_binance_write: false,
      evidence_status: "research_memory_not_strategy_evidence",
    },
  }
}

function normalizeRunStatus(status: RdSupervisorRunResult["status"] | RdProgramState["status"]): RdSupervisorRunResult["status"] {
  if (status === "shadow_candidate_found" || status === "budget_exhausted" || status === "data_or_tool_blocked") return status
  if (status === "iteration_limit_reached") return status
  return "stopped"
}

function boundedSupervisorIterations(value: unknown): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(25, parsed) : 10
}

function iterationNow(startedAt: string, iteration: number): string {
  return new Date(new Date(startedAt).getTime() + iteration * 1000).toISOString()
}

function normalizeDate(value: unknown): string {
  const date = value ? new Date(String(value)) : new Date()
  if (!Number.isFinite(date.getTime())) {
    throw new Error("rd supervisor date must be valid")
  }
  return date.toISOString()
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export {
  runRdSupervisorLoop,
  runRdSupervisorLoopWithDeps,
  type RdSupervisorRunResult,
}
