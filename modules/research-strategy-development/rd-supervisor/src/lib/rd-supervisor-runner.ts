import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  readRdProgramState,
  runRdProgramStateCommand,
  updateRdProgramState,
  writeRdProgramState,
  type RdProgramState,
} from "../../../rd-program-state/src/lib/rd-program-state"
import { displayPath, resolveRepoPath } from "../../../../contracts/runtime-core/src/paths"
import { lintStrategyContract } from "../../../../contracts/strategy-contract/src/strategy-contract"
import {
  runStrategyRndLoop,
} from "../../../rd-loop-runner/src/lib/rd-loop-runner"
import {
  runStrategyRndCampaign,
} from "../../../rd-campaign-runner/src/lib/rd-campaign-runner"
import {
  strategyRndCampaignInputFromJson,
  strategyRndLoopInputFromJson,
} from "../../../candidate-batch-engine/src/lib/strategy-rnd-inputs"
import type { JSONRecord } from "../../../../contracts/runtime-core/src/json"

interface RdSupervisorRunInput {
  path: string
  dbPath?: string
  input?: JSONRecord
  catalogDbPath?: string
}

interface RdSupervisorRunResult {
  schema_version: "trade-flow.rd-supervisor-run-result.v1"
  state_ref: string
  started_at: string
  stopped_at: string
  status: "strategy_draft_created" | "shadow_candidate_found" | "budget_exhausted" | "data_or_tool_blocked" | "iteration_limit_reached" | "stopped"
  stop_reason: string
  strategy_ref?: string
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
  queue_seed_recommendation?: JSONRecord | null
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
    throw new Error("rd-supervisor requires a research_state_store program ref")
  }
  const request = input.input || {}
  const startedAt = normalizeDate(stringField(request.now) || undefined)
  const maxIterations = boundedSupervisorIterations(request.max_iterations)
  const iterations: RdSupervisorRunIteration[] = []

  for (let index = 0; index < maxIterations; index += 1) {
    const planned = runRdProgramStateCommand({
      path: input.path,
      dbPath: input.dbPath,
      input: { ...request, action: "plan_next", now: iterationNow(startedAt, index), rd_state_db: input.dbPath },
      catalogDbPath: input.catalogDbPath,
    })
    const plan = planned.next_plan
    if (!plan) {
      return finish(input.path, startedAt, iterations, "data_or_tool_blocked", "rd supervisor did not receive a next_plan", undefined, input.dbPath)
    }
    if (plan.status !== "ready" || !plan.command || !plan.payload) {
      if (plan.status === "blocked") {
        markSupervisorBlocked(input.path, input.catalogDbPath, plan.reason, plan.created_at, asRecord(plan.queue_seed_recommendation), input.dbPath)
      }
      iterations.push({
        iteration: index + 1,
        plan_id: plan.plan_id,
        plan_status: plan.status,
        command: plan.command,
        reason: plan.reason,
        queue_seed_recommendation: plan.queue_seed_recommendation,
        state_status: readRdProgramState(input.path, input.dbPath).status,
      })
      const state = readRdProgramState(input.path, input.dbPath)
      return finish(input.path, startedAt, iterations, state.status === "active" ? "stopped" : state.status, plan.reason, undefined, input.dbPath)
    }

    try {
      const result = executePlannedResearch(plan.command, plan.payload, deps)
      const state = readRdProgramState(input.path, input.dbPath)
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
        const strategyRef = state.status === "shadow_candidate_found"
          ? draftStrategyFromValidatedCandidate(input.path, input.catalogDbPath, iterationNow(startedAt, index + 1), stringField(request.strategy_root), input.dbPath)
          : undefined
        return finish(
          input.path,
          startedAt,
          iterations,
          strategyRef ? "strategy_draft_created" : state.status,
          strategyRef ? "validated candidate was written as a draft strategy policy" : `rd program state reached ${state.status}`,
          strategyRef,
          input.dbPath,
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      markSupervisorBlocked(input.path, input.catalogDbPath, message, iterationNow(startedAt, index), {}, input.dbPath)
      const state = readRdProgramState(input.path, input.dbPath)
      iterations.push({
        iteration: index + 1,
        plan_id: plan.plan_id,
        plan_status: plan.status,
        command: plan.command,
        reason: plan.reason,
        state_status: state.status,
        error: message,
      })
      return finish(input.path, startedAt, iterations, "data_or_tool_blocked", message, undefined, input.dbPath)
    }
  }

  return finish(input.path, startedAt, iterations, "iteration_limit_reached", "rd supervisor max_iterations reached", undefined, input.dbPath)
}

function executePlannedResearch(command: string, payload: JSONRecord, deps: RdSupervisorRunDeps): JSONRecord {
  if (command === "research.rd-loop-runner") return deps.runLoop(payload)
  if (command === "research.rd-campaign-runner") return deps.runCampaign(payload)
  throw new Error(`rd supervisor cannot execute command: ${command}`)
}

function markSupervisorBlocked(path: string, catalogDbPath: string | undefined, reason: string, now: string, queueSeedRecommendation: JSONRecord = {}, dbPath?: string): void {
  const nextActions = asArray(queueSeedRecommendation.next_actions).map(String).filter(Boolean)
  const familyID = stringField(queueSeedRecommendation.family_id)
  const requiredAction = stringField(queueSeedRecommendation.required_action)
  const updated = updateRdProgramState(readRdProgramState(path, dbPath), {
    now,
    status: "data_or_tool_blocked",
    latestFailureSummary: {
      primary_failure_area: "rd_supervisor",
      reason,
      queue_seed_recommendation: Object.keys(queueSeedRecommendation).length > 0 ? queueSeedRecommendation : undefined,
      next_system_actions: nextActions.length > 0
        ? nextActions
        : [`Repair the R&D queue or data/tool blocker before continuing the supervisor loop${familyID ? `; recommended family ${familyID}${requiredAction ? ` requires ${requiredAction}` : ""}` : ""}.`],
    },
    latestReliabilityGate: {
      source: "rd_supervisor",
      status: "blocked",
      reason,
      queue_seed_recommendation: Object.keys(queueSeedRecommendation).length > 0 ? queueSeedRecommendation : undefined,
    },
  })
  writeRdProgramState(path, updated, catalogDbPath, dbPath)
}

function finish(
  path: string,
  startedAt: string,
  iterations: RdSupervisorRunIteration[],
  status: RdSupervisorRunResult["status"] | RdProgramState["status"],
  stopReason: string,
  strategyRef?: string,
  dbPath?: string,
): RdSupervisorRunResult {
  const finalState = readRdProgramState(path, dbPath)
  const stoppedAt = iterations.length > 0 ? iterationNow(startedAt, iterations.length) : startedAt
  return {
    schema_version: "trade-flow.rd-supervisor-run-result.v1",
    state_ref: path,
    started_at: startedAt,
    stopped_at: stoppedAt,
    status: normalizeRunStatus(status),
    stop_reason: stopReason,
    ...(strategyRef ? { strategy_ref: strategyRef } : {}),
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
  if (status === "strategy_draft_created") return status
  if (status === "shadow_candidate_found" || status === "budget_exhausted" || status === "data_or_tool_blocked") return status
  if (status === "iteration_limit_reached") return status
  return "stopped"
}

function draftStrategyFromValidatedCandidate(path: string, catalogDbPath: string | undefined, now: string, strategyRoot = "strategies", dbPath?: string): string | undefined {
  const state = readRdProgramState(path, dbPath)
  const candidate = asRecord(asRecord(state.latest_reliability_gate).validated_candidate)
  const candidateID = stringField(candidate.candidate_id)
  const family = stringField(candidate.family)
  if (!candidateID || !family) {
    return undefined
  }
  const slug = safeID(candidateID)
  const strategyPath = resolveRepoPath(join(strategyRoot, `s-${slug}.md`))
  const strategyRef = displayPath(strategyPath)
  if (!existsSync(strategyPath)) {
    mkdirSync(dirname(strategyPath), { recursive: true })
    writeFileSync(strategyPath, buildDraftStrategyMarkdown(state, candidate, strategyRef, now))
  }
  const lint = lintStrategyContract(strategyPath)
  if (!lint.valid) {
    throw new Error(`strategy draft failed lint: ${lint.errors.join("; ")}`)
  }
  writeRdProgramState(
    path,
    updateRdProgramState(state, {
      now,
      latestReliabilityGate: {
        ...asRecord(state.latest_reliability_gate),
        strategy_ref: strategyRef,
      },
      artifactRefs: [strategyRef],
    }),
    catalogDbPath,
    dbPath,
  )
  return strategyRef
}

function buildDraftStrategyMarkdown(state: RdProgramState, candidate: JSONRecord, strategyRef: string, now: string): string {
  const candidateID = stringField(candidate.candidate_id)
  const family = stringField(candidate.family)
  const params = asRecord(candidate.params)
  const slug = safeID(candidateID)
  const strategyID = `S-${slug.toUpperCase()}`
  const setupID = slug
  const candidateParams = Object.entries(params)
    .filter(([key, value]) => !riskParamKeys().has(key) && yamlScalarOrArray(value))
  const risk = {
    stop_atr: numberOrDefault(params.stop_atr, 1),
    max_risk_atr: numberOrDefault(params.max_risk_atr, 2),
    reward_risk: numberOrDefault(params.reward_risk, 2),
    max_hold_bars: numberOrDefault(params.max_hold_bars, 18),
  }
  const optionalRisk = ["break_even_after_r", "break_even_offset_r"]
    .filter((key) => Number.isFinite(Number(params[key])))
    .map((key) => `  ${key}: ${Number(params[key])}`)
  return `---
strategy_id: ${strategyID}
contract_schema_version: 1
name: ${titleFromSlug(slug)}
status: draft
tags: [rd, draft, 4h, swing]
---

# ${titleFromSlug(slug)}

Auto-drafted by the R&D supervisor after a validated candidate was found. This file is a draft strategy policy only; it is not promotion evidence and does not authorize shadow or live-small.

Research refs:

- Program: ${state.program_id}
- Objective: ${state.objective}
- Candidate: ${candidateID}
- Family: ${family}
- Validation run: ${stringField(candidate.validation_run_ref) || "not recorded"}
- Drafted at: ${now}

## Trade Contract

\`\`\`yaml
setup_id: ${setupID}
engine: rnd_family_v1
hypothesis: ${state.objective}
timeframe: 4h
family: ${family}
candidate:
${candidateParams.length > 0 ? candidateParams.map(([key, value]) => `  ${key}: ${yamlValue(value)}`).join("\n") : "  side: long"}
risk:
  stop_atr: ${risk.stop_atr}
  max_risk_atr: ${risk.max_risk_atr}
  reward_risk: ${risk.reward_risk}
  max_hold_bars: ${risk.max_hold_bars}
${optionalRisk.length > 0 ? `${optionalRisk.join("\n")}\n` : ""}cost_model:
  fee_bps: 2
  slippage_bps: 1
  adverse_funding_bps_per_8h: 0
universe:
  source: rd_supervisor_validated_candidate
execution:
  entry_rule: generated from rnd_family_v1 closed-candle signal; enter next open or equivalent executable quote only.
  stop_rule: generated from contract risk parameters.
  target_rule: generated from fixed reward_risk.
  no_trade_conditions: stale closed 4H data, missing required supplemental data, unresolved existing lane exposure, abnormal funding or spread, or setup not causally available before entry.
proof:
  evidence_ref: ${stringField(candidate.validation_run_ref) || strategyRef}
  live_permission: draft_only
  next_required_proof: append replay evidence and run strategy-review before any shadow promotion.
\`\`\`
`
}

function riskParamKeys(): Set<string> {
  return new Set(["stop_atr", "max_risk_atr", "reward_risk", "max_hold_bars", "break_even_after_r", "break_even_offset_r"])
}

function yamlScalarOrArray(value: unknown): boolean {
  return typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
    || (Array.isArray(value) && value.every((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean"))
}

function yamlValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(yamlValue).join(", ")}]`
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return String(value).replace(/[:\n\r]/g, " ").trim() || "null"
}

function numberOrDefault(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function titleFromSlug(slug: string): string {
  return slug.split("-").filter(Boolean).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ")
}

function safeID(value: string): string {
  return safeFileName(value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")) || "rd-strategy"
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-")
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function boundedSupervisorIterations(value: unknown): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(25, parsed) : 20
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
