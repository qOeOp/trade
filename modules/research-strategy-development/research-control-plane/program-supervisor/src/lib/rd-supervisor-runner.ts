import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join } from "node:path"
import {
  readRdProgramState,
  runRdProgramStateCommand,
  updateRdProgramState,
  writeRdProgramState,
  type RdProgramState,
} from "../../../program-control/src/lib/rd-program-state"
import { displayPath, resolveRepoPath } from "../../../../../contracts/runtime-core/src/paths"
import { lintStrategyContract } from "../../../../../contracts/strategy-contract/src/strategy-contract"
import {
  runStrategyRndLoop,
} from "../../../../agent-roles/developer/rd-loop-runner/src/lib/rd-loop-runner"
import {
  runStrategyRndCampaign,
} from "../../../../agent-roles/developer/rd-campaign-runner/src/lib/rd-campaign-runner"
import {
  strategyRndCampaignInputFromJson,
  strategyRndLoopInputFromJson,
} from "../../../../agent-roles/developer/candidate-batch-engine/src/lib/strategy-rnd-inputs"
import {
  SOURCE_SCHEMA_VERSION,
  lintStrategyPolicyShape,
  renderStrategyPolicyMarkdown,
  strategyPolicySlug,
  type StrategyPolicySource,
} from "../../../strategy-policy-writer/src/lib/strategy-policy-writer"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { Database } from "bun:sqlite"
import { ensureResearchStateSchema } from "../../../state-store/src/lib/research-state-store"
import {
  finishTrial,
  publishExperimentResultAndFinishTrials,
  reserveTrial,
  type ExperimentResultWrite,
  type TrialReservation,
} from "../../../state-store/src/lib/research-control-plane-operations"

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
      if (request.control_plane_required === true && Object.keys(asRecord(plan.payload.control_plane)).length === 0) {
        throw new Error("control_plane_required: hypothesis must bind a registered Experiment and Trial reservations")
      }
      const result = executePlannedResearchWithControlPlane(plan.command, plan.payload, deps, input.dbPath)
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
      if (Object.keys(asRecord(plan.payload.control_plane)).length > 0) {
        return finish(
          input.path, startedAt, iterations, "stopped",
          "Control Plane Result published; experiment is awaiting Research Reviewer decision",
          undefined, input.dbPath,
        )
      }
      if (state.status !== "active") {
        const strategyRef = state.status === "shadow_candidate_found" && request.legacy_draft_materialization === true
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

function executePlannedResearchWithControlPlane(
  command: string, payload: JSONRecord, deps: RdSupervisorRunDeps, dbPath?: string,
): JSONRecord {
  const boundary = asRecord(payload.control_plane)
  if (Object.keys(boundary).length === 0) return executePlannedResearch(command, payload, deps)
  if (!dbPath) throw new Error("Control Plane execution requires rd_state_db")
  const trials = asArray(boundary.trials).map(asRecord)
  if (trials.length === 0) throw new Error("Control Plane execution requires predeclared Trial reservations")
  const db = new Database(dbPath)
  const reserved: string[] = []
  try {
    ensureResearchStateSchema(db)
    const priorResult = db.query(`
      SELECT summary_json FROM rd_experiment_result WHERE idempotency_key=$key
    `).get({ $key: requiredBoundaryText(boundary.result_idempotency_key, "result_idempotency_key") }) as { summary_json: string } | null
    if (priorResult) return JSON.parse(priorResult.summary_json) as JSONRecord
    for (const trial of trials) {
      const reservation = trial as unknown as TrialReservation
      reserveTrial(db, reservation)
      reserved.push(reservation.trial_id)
    }
    const executionPayload = { ...payload }
    if (boundary.legacy_program_writeback !== true) {
      delete executionPayload.rd_program_ref
      delete executionPayload.rd_state_db
    }
    const result = executePlannedResearch(command, executionPayload, deps)
    const completedAt = stringField(boundary.completed_at) || stringField(payload.now) || new Date().toISOString()
    publishExperimentResultAndFinishTrials(db, {
      result: resultWriteFromBoundary(boundary, result, trials, completedAt),
      trial_ids: reserved,
      completed_at: completedAt,
    })
    return result
  } catch (error) {
    const failedAt = stringField(boundary.completed_at) || stringField(payload.now) || new Date().toISOString()
    for (const trialId of reserved) {
      try { finishTrial(db, { trial_id: trialId, status: "failed", completed_at: failedAt }) }
      catch { /* idempotent retry or transaction already finalized */ }
    }
    throw error
  } finally {
    db.close()
  }
}

function resultWriteFromBoundary(
  boundary: JSONRecord, result: JSONRecord, trials: JSONRecord[], createdAt: string,
): ExperimentResultWrite {
  const artifactRef = stringField(result.artifact_ref)
  if (!artifactRef) throw new Error("Replay boundary must return artifact_ref before Result publication")
  const fingerprint = aggregateEvidenceFingerprint(boundary, result, trials, artifactRef)
  const singleTrial = trials.length === 1 ? trials[0]! : null
  return {
    result_id: requiredBoundaryText(boundary.result_id, "result_id"),
    experiment_id: requiredBoundaryText(boundary.experiment_id, "experiment_id"),
    result_scope: singleTrial ? "trial" : "trial_group",
    ...(singleTrial ? { trial_id: requiredBoundaryText(singleTrial.trial_id, "trial_id") } : {}),
    trial_group_id: requiredBoundaryText(boundary.trial_group_id, "trial_group_id"),
    run_id: requiredBoundaryText(boundary.run_id ?? result.run_id, "run_id"),
    idempotency_key: requiredBoundaryText(boundary.result_idempotency_key, "result_idempotency_key"),
    stage_id: requiredBoundaryText(boundary.stage_id, "stage_id"),
    result_type_id: requiredBoundaryText(boundary.result_type_id, "result_type_id"),
    artifact_ref: artifactRef,
    evidence_fingerprint_json: fingerprint,
    summary_json: result,
    created_at: createdAt,
  }
}

export function aggregateEvidenceFingerprint(
  boundary: JSONRecord,
  result: JSONRecord,
  trials: JSONRecord[],
  artifactRef: string,
): JSONRecord {
  const supplied = asRecord(result.evidence_fingerprint_json ?? result.fingerprint)
  if (hasRequiredEvidenceFields(supplied)) return supplied
  const artifactContentHash = artifactHash(artifactRef)
  if (!artifactContentHash) {
    throw new Error("Replay boundary must publish a readable artifact or supply a complete evidence fingerprint")
  }
  const components = collectReplayEvidence(result)
  if (components.harness_hashes.length === 0 || components.data_hashes.length === 0
      || components.assumptions_hashes.length === 0 || components.temporal_contracts.length === 0) {
    throw new Error("Replay boundary result does not contain complete nested Replay provenance")
  }
  const identityBinding = {
    experiment_id: requiredBoundaryText(boundary.experiment_id, "experiment_id"),
    trial_group_id: requiredBoundaryText(boundary.trial_group_id, "trial_group_id"),
    stage_id: requiredBoundaryText(boundary.stage_id, "stage_id"),
    result_type_id: requiredBoundaryText(boundary.result_type_id, "result_type_id"),
    trials: trials.map((trial) => ({
      trial_id: requiredBoundaryText(trial.trial_id, "trial_id"),
      candidate_id: requiredBoundaryText(trial.candidate_id, "candidate_id"),
      candidate_identity_hash: requiredBoundaryText(trial.candidate_identity_hash, "candidate_identity_hash"),
    })).sort((left, right) => left.trial_id.localeCompare(right.trial_id)),
  }
  return {
    schema_version: "trade-flow.rd-aggregate-evidence-fingerprint.v1",
    policy_hash: canonicalSha256(identityBinding),
    harness_hash: canonicalSha256(components.harness_hashes),
    data_hash: canonicalSha256(components.data_hashes),
    assumptions_hash: canonicalSha256(components.assumptions_hashes),
    temporal_contract: `sha256:${canonicalSha256(components.temporal_contracts)}`,
    artifact_content_hash: artifactContentHash,
    replay_component_count: components.component_count,
    replay_components_hash: canonicalSha256(components),
    identity_binding_hash: canonicalSha256(identityBinding),
  }
}

function collectReplayEvidence(value: unknown): {
  component_count: number
  harness_hashes: string[]
  data_hashes: string[]
  assumptions_hashes: string[]
  temporal_contracts: JSONRecord[]
} {
  const harness = new Set<string>()
  const data = new Set<string>()
  const assumptions = new Set<string>()
  const temporal = new Map<string, JSONRecord>()
  const visited = new Set<object>()
  const visit = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object" || visited.has(candidate as object)) return
    visited.add(candidate as object)
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item)
      return
    }
    const record = candidate as JSONRecord
    const provenance = asRecord(record.provenance)
    const harnessHash = stringField(provenance.harness_hash)
    const dataHash = stringField(provenance.data_hash)
    const assumptionsHash = stringField(provenance.assumptions_hash)
    const temporalContract = asRecord(provenance.temporal_contract)
    if (harnessHash && dataHash && assumptionsHash && Object.keys(temporalContract).length > 0) {
      harness.add(harnessHash)
      data.add(dataHash)
      assumptions.add(assumptionsHash)
      temporal.set(canonicalSha256(temporalContract), temporalContract)
    }
    for (const nested of Object.values(record)) visit(nested)
  }
  visit(value)
  return {
    component_count: temporal.size,
    harness_hashes: [...harness].sort(),
    data_hashes: [...data].sort(),
    assumptions_hashes: [...assumptions].sort(),
    temporal_contracts: [...temporal.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, contract]) => contract),
  }
}

function artifactHash(artifactRef: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(artifactRef)) return ""
  const path = resolveRepoPath(artifactRef)
  return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : ""
}

function hasRequiredEvidenceFields(value: JSONRecord): boolean {
  return ["policy_hash", "harness_hash", "data_hash", "assumptions_hash", "temporal_contract"]
    .every((field) => Boolean(stringField(value[field])))
}

function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  const record = value as JSONRecord
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`
}

function requiredBoundaryText(value: unknown, field: string): string {
  const text = stringField(value)
  if (!text) throw new Error(`Control Plane boundary requires ${field}`)
  return text
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
  const slug = strategyPolicySlug(candidateID)
  const strategyPath = resolveRepoPath(join(strategyRoot, `s-${slug}.md`))
  const strategyRef = displayPath(strategyPath)
  if (!existsSync(strategyPath)) {
    const markdown = renderStrategyPolicyMarkdown(strategyPolicySourceFromState(state, candidate, strategyRef, now))
    const shape = lintStrategyPolicyShape(markdown)
    if (!shape.valid) {
      throw new Error(`strategy policy shape failed lint: ${shape.errors.join("; ")}`)
    }
    mkdirSync(dirname(strategyPath), { recursive: true })
    writeFileSync(strategyPath, markdown)
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

function strategyPolicySourceFromState(state: RdProgramState, candidate: JSONRecord, strategyRef: string, now: string): StrategyPolicySource {
  const params = asRecord(candidate.params)
  return {
    schema_version: SOURCE_SCHEMA_VERSION,
    program_id: state.program_id,
    objective: state.objective,
    drafted_at: now,
    strategy_ref: strategyRef,
    evidence_refs: state.artifact_refs,
    candidate: {
      candidate_id: stringField(candidate.candidate_id),
      family: stringField(candidate.family),
      ...(Number.isFinite(Number(candidate.parameter_count)) ? { parameter_count: Number(candidate.parameter_count) } : {}),
      ...(stringField(candidate.timeframe) ? { timeframe: stringField(candidate.timeframe) } : {}),
      ...(stringField(candidate.validation_run_ref) ? { validation_run_ref: stringField(candidate.validation_run_ref) } : {}),
      params,
    },
  }
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
  executePlannedResearchWithControlPlane,
  runRdSupervisorLoop,
  runRdSupervisorLoopWithDeps,
  type RdSupervisorRunResult,
}
