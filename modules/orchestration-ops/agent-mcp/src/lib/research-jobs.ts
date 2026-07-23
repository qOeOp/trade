import { randomUUID } from "node:crypto"
import { assertProjectRuntimePath } from "../../../../contracts/runtime-core/src/paths"
import { canonicalHash, canonicalJson } from "../../../../contracts/runtime-core/src/canonical-json"
import type { AgentArtifactRef } from "../../../../contracts/agent-run-contract/src/agent-run-contract"
import {
  executeOwnerCli,
  startOwnerCli,
  type OwnerCliCommand,
  type OwnerCliExecutor,
  type OwnerCliStarter,
} from "./owner-cli"

type JSONRecord = Record<string, unknown>

const DEVELOPER_AGENT_CONTEXT_PACK_SCHEMA =
  "trade.rd-developer-agent-context-pack.v1" as const

interface DeveloperSemanticContract extends JSONRecord {
  schema_version: "trade.rd-developer-semantic-contract.v3"
  hypothesis: {
    proposed_market_mechanism: string
    falsifiable_prediction: string
    null_hypothesis: string
  }
  economic_rationale: {
    proposed_edge_source: string
    persistence_rationale: string
    failure_modes: string[]
  }
  evaluation_question: string
}

interface DeveloperAgentContextPack extends JSONRecord {
  schema_version: typeof DEVELOPER_AGENT_CONTEXT_PACK_SCHEMA
  developer_run_id: string
  source_revision: string
  brief: JSONRecord & {
    brief_id: string
    max_trial_budget: number
  }
  capability_assessment: JSONRecord & {
    required_mode: "existing_implementation" | "data_blocked" | "tool_blocked"
    reason_code: string
    required_capabilities: string[]
    family_capability: JSONRecord | null
    data_snapshot_binding: JSONRecord | null
  }
  next_draft_revision: number
  predecessor_run_id: string | null
  replay_result_refs: AgentArtifactRef[]
  requested_at: string
  context_pack_hash: string
}

export interface ResearchJobSubmitInput {
  request_id: string
  program_id: string
  objective: string
  budget?: {
    max_hypotheses?: number
    max_trials_total?: number
    max_locked_holdout_uses?: number
  }
  hypothesis_contract?: JSONRecord
}

export interface PlannerProposalPrepareInput {
  planner_run_id: string
  request_hash: string
  proposal_id: string
  hypothesis_id: string
  universe_node_id: string
  objective: string
  dataset_requirements: string[]
  candidate_space: JSONRecord
  trial_budget: number
  evaluation_protocol_ref: string
  requested_at: string
}

export interface DeveloperSubmissionPrepareInput {
  developer_run_id: string
  request_hash: string
  requested_trial_budget?: number
  semantic_contract?: DeveloperSemanticContract
}

export interface ReviewerSubmissionPrepareInput {
  reviewer_run_id: string
  request_hash: string
  experiment_id: string
  expected_version: number
  stage_id: string
  decision:
    | "reject"
    | "modify"
    | "accept_for_draft"
    | "accept_for_forward"
    | "accept_for_shadow_candidate"
  evidence: Array<{
    result_id: string
    evidence_role:
      | "primary"
      | "supporting"
      | "negative_control"
      | "cost"
      | "stability"
      | "holdout"
  }>
  selected_trial_id: string | null
  rationale: string
  requested_at: string
}

export interface ResearchJobServiceOptions {
  execute?: OwnerCliExecutor
  start?: OwnerCliStarter
  tradeDbPath?: string
  opsRuntimeDbPath?: string
  rdStateDbPath?: string
  catalogDbPath?: string
}

const RESEARCH_LOCK_KEY = "research-rd"
const RESEARCH_LOCK_TTL_MS = 6 * 60 * 60 * 1000

export class ResearchJobService {
  private readonly execute: OwnerCliExecutor
  private readonly start: OwnerCliStarter
  private readonly tradeDbPath: string
  private readonly opsRuntimeDbPath: string
  private readonly rdStateDbPath: string
  private readonly catalogDbPath: string

  constructor(options: ResearchJobServiceOptions = {}) {
    this.execute = options.execute ?? executeOwnerCli
    this.start = options.start ?? startOwnerCli
    this.tradeDbPath = runtimePath(options.tradeDbPath ?? process.env.TRADE_MCP_TRADE_DB ?? "data/trade.db")
    this.opsRuntimeDbPath = runtimePath(options.opsRuntimeDbPath ?? process.env.TRADE_MCP_OPS_DB ?? "data/ops_runtime.db")
    this.rdStateDbPath = runtimePath(options.rdStateDbPath ?? process.env.TRADE_MCP_RD_STATE_DB ?? "data/rd_state.db")
    this.catalogDbPath = runtimePath(options.catalogDbPath ?? process.env.TRADE_MCP_CATALOG_DB ?? "data/data_catalog.db")
  }

  async submit(input: ResearchJobSubmitInput): Promise<JSONRecord> {
    const cycleId = cycleIdFor(input.request_id)
    const existing = await this.tryStatus(cycleId)
    if (existing) return { ...existing, duplicate: true }

    const prepared = input.hypothesis_contract
      ? await this.prepareHypothesis(input.hypothesis_contract)
      : null
    if (prepared && prepared.valid !== true) {
      throw new Error(`strategy hypothesis contract is invalid: ${stringArray(prepared.errors).join("; ")}`)
    }
    if (prepared && prepared.ready !== true) {
      throw new Error(`strategy hypothesis is not ready: ${stringField(prepared.blocked_reason) || "designer projection blocked it"}`)
    }

    const now = new Date().toISOString()
    const holderId = `${cycleId}:${randomUUID()}`
    const lock = await this.runOps("acquire_lock", {
      lock_key: RESEARCH_LOCK_KEY,
      holder_id: holderId,
      acquired_at: now,
      expires_at: new Date(Date.parse(now) + RESEARCH_LOCK_TTL_MS).toISOString(),
    })
    if (lock.acquired !== true) {
      const active = asRecord(lock.lock)
      throw new Error(`research supervisor is already running for ${stringField(active.holder_id) || "another cycle"}`)
    }

    let cycleRecorded = false
    try {
      const program = await this.tryReadProgram(input.program_id)
      const queueItem = prepared ? asRecord(prepared.queue_item) : null
      let initialQueue: JSONRecord[] | undefined
      let queueAction: "existing" | "initial_seed" | "appended"
      if (queueItem && Object.keys(queueItem).length > 0) {
        if (program) {
          assertProgramAcceptsHypothesis(program, input.program_id)
          await this.runProgram(input.program_id, {
            action: "update",
            now,
            status: "active",
            followup_hypotheses: [queueItem],
          })
          queueAction = "appended"
        } else {
          initialQueue = [queueItem]
          queueAction = "initial_seed"
        }
      } else {
        if (!program || stringField(program.status) !== "active" || !hasReadyHypothesis(program)) {
          throw new Error("research submit requires a ready hypothesis_contract or an active existing program with a ready hypothesis queue")
        }
        queueAction = "existing"
      }
      await this.runOps("record_cycle", {
        cycle_id: cycleId,
        now,
        status: "running",
        summary: {
          phase: "queued",
          source: "agent-mcp",
          request_id: input.request_id,
          queue_action: queueAction,
          ...(queueItem ? { hypothesis_id: stringField(queueItem.hypothesis_id) } : {}),
        },
      })
      cycleRecorded = true
      const workerInput = {
        cycle_id: cycleId,
        holder_id: holderId,
        lock_key: RESEARCH_LOCK_KEY,
        trade_db_path: this.tradeDbPath,
        ops_runtime_db: this.opsRuntimeDbPath,
        job_graph: buildResearchJobGraphInput(input, cycleId, now, this, initialQueue),
      }
      const logPath = `tmp/agent-mcp/research-jobs/${cycleId}.log`
      const started = this.start({
        script: "modules/orchestration-ops/agent-mcp/src/scripts/research-job-worker.ts",
        args: ["--json", JSON.stringify(workerInput)],
      }, logPath)
      return {
        schema_version: "trade.agent-mcp.research-job-submit-result.v1",
        job_ref: jobRef(cycleId),
        cycle_id: cycleId,
        status: "queued",
        pid: started.pid,
        log_path: started.log_path,
        queue_action: queueAction,
        hypothesis_id: queueItem ? stringField(queueItem.hypothesis_id) : null,
        duplicate: false,
      }
    } catch (error) {
      await this.runOps("release_lock", { lock_key: RESEARCH_LOCK_KEY, holder_id: holderId }).catch(() => undefined)
      if (cycleRecorded) {
        await this.runOps("record_cycle", {
          cycle_id: cycleId,
          now,
          completed_at: new Date().toISOString(),
          status: "failed",
          summary: { phase: "dispatch_failed", error: error instanceof Error ? error.message : String(error) },
        }).catch(() => undefined)
      }
      throw error
    }
  }

  async prepareHypothesis(contract: JSONRecord): Promise<JSONRecord> {
    const validated = ownerData(await this.runDesigner("validate", contract))
    const warnings = stringArray(validated.warnings)
    const errors = stringArray(validated.errors)
    if (validated.valid !== true) {
      return {
        schema_version: "trade.agent-mcp.research-hypothesis-prepare-result.v1",
        valid: false,
        ready: false,
        errors,
        warnings,
        blocked_reason: "contract_validation_failed",
        queue_item: null,
      }
    }
    const projected = ownerData(await this.runDesigner("queue_item", contract))
    const queueItem = asRecord(projected.queue_item)
    if (Object.keys(queueItem).length === 0) throw new Error("strategy hypothesis designer returned no queue item")
    return {
      schema_version: "trade.agent-mcp.research-hypothesis-prepare-result.v1",
      valid: true,
      ready: queueItem.ready === true,
      errors: [],
      warnings,
      blocked_reason: stringField(queueItem.blocked_reason) || null,
      queue_item: queueItem,
    }
  }

  async preparePlannerProposal(
    input: PlannerProposalPrepareInput,
  ): Promise<JSONRecord> {
    const callId = await this.recordAgentToolCall({
      run_id: input.planner_run_id,
      request_hash: input.request_hash,
      task_profile: "planner",
      tool_name: "research_planner_proposal_prepare",
    })
    const response = ownerData(await this.execute({
      script: "modules/research-strategy-development/research-control-plane/state-store/src/scripts/main.ts",
      args: [
        "--db",
        this.rdStateDbPath,
        "--action",
        "prepare_planner_proposal",
        "--json",
        JSON.stringify(input),
      ],
    }))
    const proposal = asRecord(response.proposal)
    if (Object.keys(proposal).length === 0) {
      throw new Error("Planner proposal owner returned no proposal")
    }
    if (proposal.schema_version !== "trade.rd-planner-proposal-submission.v2") {
      throw new Error("Planner proposal owner schema version drifted")
    }
    await this.persistAgentToolResult({
      call_id: callId,
      run_id: input.planner_run_id,
      request_hash: input.request_hash,
      task_profile: "planner",
      tool_name: "research_planner_proposal_prepare",
      output_schema_version: "trade.rd-planner-proposal-submission.v2",
      output: proposal,
    })
    return {
      schema_version: "trade.agent-mcp.planner-proposal-prepare-result.v1",
      proposal,
    }
  }

  async prepareDeveloperSubmission(
    input: DeveloperSubmissionPrepareInput,
  ): Promise<JSONRecord> {
    const callId = await this.recordAgentToolCall({
      run_id: input.developer_run_id,
      request_hash: input.request_hash,
      task_profile: "developer",
      tool_name: "research_developer_submission_prepare",
    })
    const context = await this.readDeveloperAgentContext(input.developer_run_id, input.request_hash)
    const assessment = context.capability_assessment
    const blocked = assessment.required_mode === "data_blocked"
      || assessment.required_mode === "tool_blocked"
    if (blocked && (input.semantic_contract || input.requested_trial_budget != null)) {
      throw new Error("blocked Developer submission must omit semantic contract and trial budget")
    }
    if (!blocked && !input.semantic_contract) {
      throw new Error("ready Developer submission requires semantic_contract")
    }
    if (!blocked && !assessment.family_capability) {
      throw new Error("ready Developer context omitted family capability")
    }
    if (!blocked && !assessment.data_snapshot_binding) {
      throw new Error("ready Developer context omitted data snapshot binding")
    }
    const response = ownerData(await this.execute({
      script: "modules/research-strategy-development/research-control-plane/state-store/src/scripts/main.ts",
      args: [
        "--db",
        this.rdStateDbPath,
        "--action",
        "prepare_developer_agent_submission",
        "--json",
        JSON.stringify({
          developer_run_id: context.developer_run_id,
          brief_id: context.brief.brief_id,
          source_revision: context.source_revision,
          draft_revision: context.next_draft_revision,
          predecessor_run_id: context.predecessor_run_id,
          implementation_mode: assessment.required_mode,
          reason_code: assessment.reason_code,
          required_capabilities: assessment.required_capabilities,
          requested_at: context.requested_at,
          ...(!blocked ? {
            requested_trial_budget: input.requested_trial_budget ?? context.brief.max_trial_budget,
            semantic_contract: input.semantic_contract,
            family_capability: assessment.family_capability,
            data_snapshot_binding: assessment.data_snapshot_binding,
          } : {}),
        }),
      ],
    }))
    const submission = asRecord(response.submission)
    if (Object.keys(submission).length === 0) {
      throw new Error("Developer submission owner returned no submission")
    }
    if (submission.schema_version !== "trade.rd-developer-agent-submission.v1") {
      throw new Error("Developer submission owner schema version drifted")
    }
    await this.persistAgentToolResult({
      call_id: callId,
      run_id: input.developer_run_id,
      request_hash: input.request_hash,
      task_profile: "developer",
      tool_name: "research_developer_submission_prepare",
      output_schema_version: "trade.rd-developer-agent-submission.v1",
      output: submission,
    })
    return submission
  }

  private async readDeveloperAgentContext(
    runId: string,
    requestHash: string,
  ): Promise<DeveloperAgentContextPack> {
    const response = ownerData(await this.runOps("read_agent_run", { run_id: runId }))
    const agentRun = asRecord(response.agent_run)
    const request = asRecord(agentRun.request)
    if (request.run_id !== runId
        || request.request_hash !== requestHash
        || request.task_profile !== "developer") {
      throw new Error("Developer Agent Run identity drifted")
    }
    if (!["accepted", "running"].includes(stringField(agentRun.status))) {
      throw new Error("Developer Agent Run is not active")
    }
    const refs = Array.isArray(request.input_refs) ? request.input_refs : []
    const contextRef = refs[0] as AgentArtifactRef | undefined
    if (!contextRef || contextRef.media_type !== "application/json") {
      throw new Error("Developer Agent Run context artifact is missing")
    }
    const artifactResponse = await this.execute({
      script: "modules/orchestration-ops/agent-artifact-store/src/scripts/main.ts",
      args: ["--repository-root", "."],
      stdin_json: { action: "read_text", artifact: contextRef },
    })
    if (typeof artifactResponse.text !== "string") {
      throw new Error("Developer context artifact owner returned no text")
    }
    const value = JSON.parse(artifactResponse.text)
    const context = asRecord(value) as unknown as DeveloperAgentContextPack
    if (context.schema_version !== DEVELOPER_AGENT_CONTEXT_PACK_SCHEMA
        || context.developer_run_id !== runId) {
      throw new Error("Developer context identity drifted")
    }
    const { context_pack_hash: packHash, ...body } = context
    if (!/^[a-f0-9]{64}$/.test(packHash)
        || canonicalHash(body) !== packHash) {
      throw new Error("Developer context artifact hash drifted")
    }
    return context
  }

  async prepareReviewerSubmission(
    input: ReviewerSubmissionPrepareInput,
  ): Promise<JSONRecord> {
    const callId = await this.recordAgentToolCall({
      run_id: input.reviewer_run_id,
      request_hash: input.request_hash,
      task_profile: "reviewer",
      tool_name: "research_reviewer_submission_prepare",
    })
    const response = ownerData(await this.execute({
      script: "modules/research-strategy-development/research-control-plane/state-store/src/scripts/main.ts",
      args: [
        "--db",
        this.rdStateDbPath,
        "--action",
        "prepare_reviewer_agent_submission",
        "--json",
        JSON.stringify(input),
      ],
    }))
    const submission = asRecord(response.submission)
    if (Object.keys(submission).length === 0) {
      throw new Error("Reviewer submission owner returned no submission")
    }
    if (submission.schema_version !== "trade.rd-reviewer-agent-submission.v1") {
      throw new Error("Reviewer submission owner schema version drifted")
    }
    await this.persistAgentToolResult({
      call_id: callId,
      run_id: input.reviewer_run_id,
      request_hash: input.request_hash,
      task_profile: "reviewer",
      tool_name: "research_reviewer_submission_prepare",
      output_schema_version: "trade.rd-reviewer-agent-submission.v1",
      output: submission,
    })
    return {
      schema_version: "trade.agent-mcp.reviewer-submission-prepare-result.v1",
      submission,
    }
  }

  private async recordAgentToolCall(input: {
    run_id: string
    request_hash: string
    task_profile: "planner" | "developer" | "reviewer" | "explanation"
    tool_name: string
  }): Promise<string> {
    const callId = `agent-tool:${randomUUID()}`
    const response = ownerData(await this.execute({
      script: "modules/orchestration-ops/ops-runtime-store/src/scripts/main.ts",
      args: [
        "--db",
        this.opsRuntimeDbPath,
        "--action",
        "record_agent_tool_call",
        "--json",
        JSON.stringify({
          call_id: callId,
          ...input,
          occurred_at: new Date().toISOString(),
        }),
      ],
    }))
    const usage = asRecord(response.usage)
    if (Number(usage.tool_calls) < 1) {
      throw new Error("Agent tool-call owner did not attest usage")
    }
    return callId
  }

  private async persistAgentToolResult(input: {
    call_id: string
    run_id: string
    request_hash: string
    task_profile: "planner" | "developer" | "reviewer"
    tool_name:
      | "research_planner_proposal_prepare"
      | "research_developer_submission_prepare"
      | "research_reviewer_submission_prepare"
    output_schema_version:
      | "trade.rd-planner-proposal-submission.v2"
      | "trade.rd-developer-agent-submission.v1"
      | "trade.rd-reviewer-agent-submission.v1"
    output: JSONRecord
  }): Promise<void> {
    const artifactResponse = await this.execute({
      script: "modules/orchestration-ops/agent-artifact-store/src/scripts/main.ts",
      args: ["--repository-root", "."],
      stdin_json: {
        action: "write_text",
        storage: "durable",
        media_type: "application/json",
        text: canonicalJson(input.output),
      },
    })
    const artifact = agentArtifactRef(artifactResponse.artifact)
    const { output: _output, ...toolResultInput } = input
    const response = ownerData(await this.execute({
      script: "modules/orchestration-ops/ops-runtime-store/src/scripts/main.ts",
      args: [
        "--db",
        this.opsRuntimeDbPath,
        "--action",
        "record_agent_tool_result",
        "--json",
        JSON.stringify({
          ...toolResultInput,
          artifact,
          occurred_at: new Date().toISOString(),
        }),
      ],
    }))
    const toolResult = asRecord(response.tool_result)
    if (toolResult.call_id !== input.call_id) {
      throw new Error("Agent tool-result owner did not attest identity")
    }
  }

  async hypothesisBrief(programId: string): Promise<JSONRecord> {
    const planned = ownerData(await this.runProgram(programId, { action: "plan_next" }))
    const state = asRecord(planned.state)
    if (Object.keys(state).length === 0) throw new Error(`rd program returned no state: ${programId}`)
    const nextPlan = asRecord(planned.next_plan)
    const scoutPlan = asRecord(nextPlan.scout_subagent_plan)
    const latestFailureSummary = optionalRecord(state.latest_failure_summary)
    const queueSeedRecommendation = optionalRecord(nextPlan.queue_seed_recommendation)
      ?? optionalRecord(latestFailureSummary?.queue_seed_recommendation)
    const designerInput = {
      program_id: stringField(state.program_id) || programId,
      objective: stringField(state.objective),
      latest_failure_summary: latestFailureSummary,
      latest_reliability_gate: optionalRecord(state.latest_reliability_gate),
      rejected_mechanisms: arrayOfRecords(state.rejected_mechanisms),
      universe_lessons: arrayOfRecords(state.universe_lessons),
      artifact_refs: stringArray(state.artifact_refs),
      control_plane_context: optionalRecord(scoutPlan.control_plane_context),
    }
    const [contextResult, promptResult] = await Promise.all([
      this.runDesigner("context", designerInput),
      this.runDesigner("render_prompt", designerInput),
    ])
    const context = ownerData(contextResult)
    const prompt = stringField(ownerData(promptResult).prompt)
    if (!prompt) throw new Error("strategy hypothesis designer returned no prompt")
    return {
      schema_version: "trade.agent-mcp.research-hypothesis-brief-result.v1",
      program_id: stringField(state.program_id) || programId,
      program_ref: stringField(planned.state_ref) || `research_state_store:rd_program/${programId}`,
      program_status: stringField(state.status),
      planning: {
        status: stringField(nextPlan.status),
        reason: stringField(nextPlan.reason),
        budget_remaining: asRecord(nextPlan.budget_remaining),
        queue_seed_recommendation: queueSeedRecommendation,
        strategy_universe_backlog: asRecord(nextPlan.strategy_universe_backlog),
        strategy_designer_handoff: asRecord(scoutPlan.strategy_designer_handoff),
      },
      context,
      prompt,
    }
  }

  async status(requestId: string): Promise<JSONRecord> {
    const status = await this.tryStatus(cycleIdFor(requestId))
    if (!status) throw new Error(`research job not found: ${requestId}`)
    return status
  }

  async result(requestId: string): Promise<JSONRecord> {
    const cycleId = cycleIdFor(requestId)
    const raw = await this.readCycle(cycleId)
    const cycle = asRecord(asRecord(raw.summary).cycle)
    if (Object.keys(cycle).length === 0) throw new Error(`research job not found: ${requestId}`)
    const cycleStatus = stringField(cycle.status)
    const jobs = arrayOfRecords(asRecord(raw.summary).jobs)
    const job = jobs.find((item) => stringField(item.job_id) === "rd_strategy_supervisor") ?? {}
    const jobStatus = stringField(job.status)
    const status = isTerminal(jobStatus) ? jobStatus : cycleStatus
    if (!isTerminal(status)) throw new Error(`research job is not complete: ${requestId}`)
    return {
      schema_version: "trade.agent-mcp.research-job-result.v1",
      job_ref: jobRef(cycleId),
      cycle_id: cycleId,
      status,
      cycle_status: cycleStatus,
      result_ref: stringField(job.result_ref) || null,
      error: optionalRecord(job.error_json),
      summary: raw.summary,
    }
  }

  paths(): { rdStateDbPath: string; catalogDbPath: string; opsRuntimeDbPath: string } {
    return {
      rdStateDbPath: this.rdStateDbPath,
      catalogDbPath: this.catalogDbPath,
      opsRuntimeDbPath: this.opsRuntimeDbPath,
    }
  }

  private async tryStatus(cycleId: string): Promise<JSONRecord | null> {
    let raw: JSONRecord
    try {
      raw = await this.readCycle(cycleId)
    } catch (error) {
      if (/unable to open database|no such table/i.test(error instanceof Error ? error.message : String(error))) return null
      throw error
    }
    const summary = asRecord(raw.summary)
    const cycle = asRecord(summary.cycle)
    if (Object.keys(cycle).length === 0) return null
    const jobs = arrayOfRecords(summary.jobs)
    const job = jobs.find((item) => stringField(item.job_id) === "rd_strategy_supervisor") ?? {}
    const cycleStatus = stringField(cycle.status)
    const jobStatus = stringField(job.status)
    const status = isTerminal(jobStatus)
      ? jobStatus
      : isTerminal(cycleStatus)
      ? cycleStatus
      : jobStatus === "running" ? "running" : "queued"
    return {
      schema_version: "trade.agent-mcp.research-job-status.v1",
      job_ref: jobRef(cycleId),
      cycle_id: cycleId,
      status,
      cycle_status: cycleStatus,
      result_ref: stringField(job.result_ref) || null,
      error: optionalRecord(job.error_json),
    }
  }

  private readCycle(cycleId: string): Promise<JSONRecord> {
    return this.runOps("summary", { cycle_id: cycleId })
  }

  private runOps(action: string, payload: JSONRecord): Promise<JSONRecord> {
    const command: OwnerCliCommand = {
      script: "modules/orchestration-ops/ops-runtime-store/src/scripts/main.ts",
      args: ["--db", this.opsRuntimeDbPath, "--action", action, "--json", JSON.stringify(payload)],
    }
    return this.execute(command)
  }

  private runDesigner(action: "context" | "render_prompt" | "validate" | "queue_item", input: JSONRecord): Promise<JSONRecord> {
    return this.execute({
      script: "modules/research-strategy-development/agent-roles/planner/strategy-hypothesis-designer/src/scripts/main.ts",
      args: ["--action", action, "--json", JSON.stringify(input)],
    })
  }

  private runProgram(programId: string, payload: JSONRecord): Promise<JSONRecord> {
    return this.execute({
      script: "modules/research-strategy-development/research-control-plane/program-control/src/scripts/main.ts",
      args: ["--db", this.rdStateDbPath, "--program-id", programId, "--json", JSON.stringify(payload)],
    })
  }

  private async tryReadProgram(programId: string): Promise<JSONRecord | null> {
    try {
      const result = ownerData(await this.runProgram(programId, { action: "read" }))
      const state = asRecord(result.state)
      return Object.keys(state).length > 0 ? state : null
    } catch (error) {
      if (/rd program not found|unable to open database|no such table/i.test(error instanceof Error ? error.message : String(error))) return null
      throw error
    }
  }
}

function buildResearchJobGraphInput(
  input: ResearchJobSubmitInput,
  cycleId: string,
  now: string,
  service: ResearchJobService,
  initialQueue?: JSONRecord[],
): JSONRecord {
  const paths = service.paths()
  return {
    cycle_id: cycleId,
    now,
    execute_jobs: true,
    allow_live_writes: false,
    include_account_reconcile: false,
    include_fast_track: false,
    include_runtime_health: false,
    include_slow_track: false,
    include_rd_strategy_supervisor: true,
    include_rd_trackers: false,
    include_closed_flow_review: false,
    include_catalog_hygiene: false,
    include_control_effectiveness_review: false,
    include_ops_notify: false,
    force_jobs: ["rd_strategy_supervisor"],
    rd_state_db: paths.rdStateDbPath,
    rd_program_id: input.program_id,
    catalog_db: paths.catalogDbPath,
    ops_runtime_db: paths.opsRuntimeDbPath,
    rd_strategy_goal: {
      objective: input.objective,
      ...(input.budget ? { budget: input.budget } : {}),
      ...(initialQueue?.length ? { next_hypothesis_queue: initialQueue } : {}),
    },
  }
}

function cycleIdFor(requestId: string): string {
  return `mcp-rd-${requestId.toLowerCase()}`
}

function jobRef(cycleId: string): string {
  return `ops-runtime://cycle/${cycleId}/job/J04`
}

function runtimePath(path: string): string {
  assertProjectRuntimePath(path)
  return path
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function arrayOfRecords(value: unknown): JSONRecord[] {
  return Array.isArray(value) ? value.map(asRecord) : []
}

function optionalRecord(value: unknown): JSONRecord | null {
  const record = asRecord(value)
  return Object.keys(record).length > 0 ? record : null
}

function ownerData(value: JSONRecord): JSONRecord {
  const data = asRecord(value.data)
  return Object.keys(data).length > 0 ? data : value
}

function agentArtifactRef(value: unknown): AgentArtifactRef {
  const artifact = asRecord(value)
  if (!/^agent-artifact:\/\/durable\/[a-f0-9]{64}$/.test(stringField(artifact.ref))
    || !/^[a-f0-9]{64}$/.test(stringField(artifact.sha256))
    || !stringField(artifact.ref).endsWith(stringField(artifact.sha256))
    || artifact.media_type !== "application/json"
    || !Number.isSafeInteger(artifact.bytes)
    || Number(artifact.bytes) < 2
    || Number(artifact.bytes) > 16 * 1024 * 1024) {
    throw new Error("Agent Artifact Store returned an invalid terminal result ref")
  }
  return {
    ref: stringField(artifact.ref),
    sha256: stringField(artifact.sha256),
    media_type: "application/json",
    bytes: Number(artifact.bytes),
  }
}

function hasReadyHypothesis(program: JSONRecord): boolean {
  return arrayOfRecords(program.next_hypothesis_queue).some((item) => item.ready === true)
}

function assertProgramAcceptsHypothesis(program: JSONRecord, programId: string): void {
  const status = stringField(program.status)
  if (status === "paused" || status === "budget_exhausted" || status === "shadow_candidate_found") {
    throw new Error(`rd program ${programId} cannot accept a hypothesis while status is ${status}`)
  }
  const budget = asRecord(program.budget)
  const usage = asRecord(program.usage)
  if (
    numberField(usage.hypotheses_run) >= numberField(budget.max_hypotheses) ||
    numberField(usage.trials_used) >= numberField(budget.max_trials_total)
  ) {
    throw new Error(`rd program ${programId} has exhausted its research budget`)
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : []
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function isTerminal(status: string): boolean {
  return status === "completed" || status === "failed" || status === "blocked"
}
