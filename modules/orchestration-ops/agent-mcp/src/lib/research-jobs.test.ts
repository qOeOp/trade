import assert from "node:assert/strict"
import test from "node:test"
import type { OwnerCliCommand } from "./owner-cli"
import { ResearchJobService } from "./research-jobs"

type JSONRecord = Record<string, unknown>

test("research submit acquires the shared lock and dispatches only J04", async () => {
  const calls: Array<{ owner: string; action: string; payload: JSONRecord }> = []
  let startedCommand: OwnerCliCommand | undefined
  const service = new ResearchJobService({
    execute: async (command) => {
      const payload = JSON.parse(argAfter(command.args, "--json")) as JSONRecord
      if (command.script.includes("strategy-hypothesis-designer")) {
        const action = argAfter(command.args, "--action")
        calls.push({ owner: "designer", action, payload })
        if (action === "validate") return { ok: true, data: { valid: true, errors: [], warnings: [] } }
        return { ok: true, data: { queue_item: { hypothesis_id: "h-ready", ready: true } } }
      }
      if (command.script.includes("program-control")) {
        const action = String(payload.action)
        calls.push({ owner: "program", action, payload })
        throw new Error("rd program not found: rd-program")
      }
      const action = argAfter(command.args, "--action")
      calls.push({ owner: "ops", action, payload })
      if (action === "summary") return { ok: true, summary: { cycle: null, jobs: [] } }
      if (action === "acquire_lock") return { ok: true, acquired: true, lock: payload }
      return { ok: true, action }
    },
    start: (command, logPath) => {
      startedCommand = command
      return { pid: 4321, log_path: logPath }
    },
  })

  const submitted = await service.submit({
    request_id: "Request-01",
    program_id: "rd-program",
    objective: "find a robust 4H swing strategy",
    budget: { max_hypotheses: 3, max_trials_total: 12 },
    hypothesis_contract: { schema_version: "trade-flow.strategy-hypothesis-contract.v1", hypothesis_id: "h-ready" },
  })

  assert.equal(submitted.status, "queued")
  assert.equal(submitted.cycle_id, "mcp-rd-request-01")
  assert.equal(submitted.job_ref, "ops-runtime://cycle/mcp-rd-request-01/job/J04")
  assert.equal(submitted.queue_action, "initial_seed")
  assert.equal(submitted.hypothesis_id, "h-ready")
  assert.deepEqual(calls.map((call) => `${call.owner}:${call.action}`), [
    "ops:summary",
    "designer:validate",
    "designer:queue_item",
    "ops:acquire_lock",
    "program:read",
    "ops:record_cycle",
  ])
  const lockCall = calls.find((call) => call.action === "acquire_lock")
  assert.equal(lockCall?.payload.lock_key, "research-rd")
  assert.match(String(lockCall?.payload.holder_id), /^mcp-rd-request-01:[0-9a-f-]{36}$/)
  assert.equal(startedCommand?.script, "modules/orchestration-ops/agent-mcp/src/scripts/research-job-worker.ts")

  const workerInput = JSON.parse(argAfter(startedCommand?.args ?? [], "--json")) as JSONRecord
  const jobGraph = workerInput.job_graph as JSONRecord
  assert.equal(jobGraph.execute_jobs, true)
  assert.equal(jobGraph.allow_live_writes, false)
  assert.equal(jobGraph.include_rd_strategy_supervisor, true)
  assert.equal(jobGraph.include_fast_track, false)
  assert.equal(jobGraph.include_slow_track, false)
  assert.equal(jobGraph.include_runtime_health, false)
  assert.deepEqual(jobGraph.force_jobs, ["rd_strategy_supervisor"])
  const goal = jobGraph.rd_strategy_goal as JSONRecord
  assert.deepEqual(goal.next_hypothesis_queue, [{ hypothesis_id: "h-ready", ready: true }])
})

test("research hypothesis preparation returns validation errors and blocked projections without writes", async () => {
  let mode: "invalid" | "blocked" = "invalid"
  const service = new ResearchJobService({
    execute: async (command) => {
      const action = argAfter(command.args, "--action")
      if (action === "validate" && mode === "invalid") {
        return { ok: true, data: { valid: false, errors: ["thesis.mechanism is required"], warnings: [] } }
      }
      if (action === "validate") return { ok: true, data: { valid: true, errors: [], warnings: ["review cost assumptions"] } }
      return { ok: true, data: { queue_item: { hypothesis_id: "h-blocked", ready: false, blocked_reason: "manifest_path_required_before_strategy_trials" } } }
    },
    start: () => ({ pid: 1, log_path: "tmp/unused.log" }),
  })

  const invalid = await service.prepareHypothesis({ title: "thin" })
  assert.equal(invalid.valid, false)
  assert.equal(invalid.ready, false)
  assert.deepEqual(invalid.errors, ["thesis.mechanism is required"])

  mode = "blocked"
  const blocked = await service.prepareHypothesis({ title: "structured" })
  assert.equal(blocked.valid, true)
  assert.equal(blocked.ready, false)
  assert.equal(blocked.blocked_reason, "manifest_path_required_before_strategy_trials")
  assert.deepEqual(blocked.warnings, ["review cost assumptions"])
})

test("research submit rejects a blocked projection before acquiring the research lock", async () => {
  const actions: string[] = []
  const service = new ResearchJobService({
    execute: async (command) => {
      if (command.script.includes("strategy-hypothesis-designer")) {
        const action = argAfter(command.args, "--action")
        actions.push(action)
        if (action === "validate") return { ok: true, data: { valid: true, errors: [], warnings: [] } }
        return { ok: true, data: { queue_item: { hypothesis_id: "panel-only", ready: false, blocked_reason: "panel_research_requires_panel_evaluator_before_supervisor_strategy_trials" } } }
      }
      const action = argAfter(command.args, "--action")
      actions.push(action)
      return { ok: true, summary: { cycle: null, jobs: [] } }
    },
    start: () => ({ pid: 1, log_path: "tmp/unused.log" }),
  })

  await assert.rejects(() => service.submit({
    request_id: "Blocked-Projection",
    program_id: "rd-program",
    objective: "must not spend a trial",
    hypothesis_contract: { schema_version: "trade-flow.strategy-hypothesis-contract.v1" },
  }), /panel_research_requires_panel_evaluator/)
  assert.deepEqual(actions, ["summary", "validate", "queue_item"])
})

test("research submit appends a validated hypothesis through the existing program owner", async () => {
  let updatePayload: JSONRecord | undefined
  const service = new ResearchJobService({
    execute: async (command) => {
      const payload = JSON.parse(argAfter(command.args, "--json")) as JSONRecord
      if (command.script.includes("strategy-hypothesis-designer")) {
        const action = argAfter(command.args, "--action")
        if (action === "validate") return { ok: true, data: { valid: true, errors: [], warnings: [] } }
        return { ok: true, data: { queue_item: { hypothesis_id: "h-followup", ready: true } } }
      }
      if (command.script.includes("program-control")) {
        if (payload.action === "read") {
          return { ok: true, data: { state: {
            status: "data_or_tool_blocked",
            budget: { max_hypotheses: 3, max_trials_total: 8 },
            usage: { hypotheses_run: 1, trials_used: 2 },
            next_hypothesis_queue: [],
          } } }
        }
        updatePayload = payload
        return { ok: true, data: { state: { status: "active" } } }
      }
      const action = argAfter(command.args, "--action")
      if (action === "summary") return { ok: true, summary: { cycle: null, jobs: [] } }
      if (action === "acquire_lock") return { ok: true, acquired: true, lock: payload }
      return { ok: true, action }
    },
    start: () => ({ pid: 9, log_path: "tmp/research.log" }),
  })

  const submitted = await service.submit({
    request_id: "Followup-01",
    program_id: "rd-existing",
    objective: "continue the existing program",
    hypothesis_contract: { schema_version: "trade-flow.strategy-hypothesis-contract.v1", hypothesis_id: "h-followup" },
  })
  assert.equal(submitted.queue_action, "appended")
  assert.equal(updatePayload?.status, "active")
  assert.deepEqual(updatePayload?.followup_hypotheses, [{ hypothesis_id: "h-followup", ready: true }])
})

test("research hypothesis brief binds durable program memory and control-plane context into the owner prompt", async () => {
  const designerInputs = new Map<string, JSONRecord>()
  const service = new ResearchJobService({
    execute: async (command) => {
      const payload = JSON.parse(argAfter(command.args, "--json")) as JSONRecord
      if (command.script.includes("program-control")) {
        assert.equal(payload.action, "plan_next")
        return { ok: true, data: {
          state_ref: "research_state_store:rd_program/rd-brief",
          state: {
            program_id: "rd-brief",
            objective: "find a distinct 4H edge",
            status: "active",
            latest_failure_summary: { reason: "cost stress failed" },
            latest_reliability_gate: { status: "reject" },
            rejected_mechanisms: [{ family: "funding_carry_v1" }],
            universe_lessons: [{ lesson: "breadth matters" }],
            artifact_refs: ["artifact://prior/report"],
          },
          next_plan: {
            status: "blocked",
            reason: "queue is empty",
            budget_remaining: { max_hypotheses: 2, max_trials_total: 5 },
            queue_seed_recommendation: { family_id: "marketability_score_v1" },
            strategy_universe_backlog: { recommended_queue_order: ["marketability_score_v1"] },
            scout_subagent_plan: {
              control_plane_context: { active_canonicals: [{ node_id: "canonical-1" }] },
              strategy_designer_handoff: { output_contract_schema: "trade-flow.strategy-hypothesis-contract.v1" },
            },
          },
        } }
      }
      const action = argAfter(command.args, "--action")
      designerInputs.set(action, payload)
      if (action === "context") return { ok: true, data: { schema_version: "trade-flow.strategy-hypothesis-design-context.v1", objective: payload.objective } }
      if (action === "render_prompt") return { ok: true, data: { prompt: "Return exactly one structured hypothesis contract." } }
      throw new Error(`unexpected designer action: ${action}`)
    },
    start: () => ({ pid: 1, log_path: "tmp/unused.log" }),
  })

  const brief = await service.hypothesisBrief("rd-brief")
  assert.equal(brief.program_ref, "research_state_store:rd_program/rd-brief")
  assert.equal(brief.program_status, "active")
  assert.match(String(brief.prompt), /structured hypothesis contract/)
  const planning = brief.planning as JSONRecord
  assert.equal(planning.status, "blocked")
  assert.deepEqual(planning.queue_seed_recommendation, { family_id: "marketability_score_v1" })
  const contextInput = designerInputs.get("context") ?? {}
  assert.deepEqual(contextInput.latest_failure_summary, { reason: "cost stress failed" })
  assert.deepEqual(contextInput.rejected_mechanisms, [{ family: "funding_carry_v1" }])
  assert.deepEqual(contextInput.control_plane_context, { active_canonicals: [{ node_id: "canonical-1" }] })
  assert.deepEqual(designerInputs.get("render_prompt"), contextInput)
})

test("research status and terminal result are derived from durable ops state", async () => {
  let terminal = false
  const service = new ResearchJobService({
    execute: async () => ({
      ok: true,
      summary: {
        cycle: {
          cycle_id: "mcp-rd-request-02",
          status: terminal ? "completed" : "running",
        },
        jobs: [{
          job_id: "rd_strategy_supervisor",
          status: terminal ? "completed" : "running",
          result_ref: terminal ? "artifact://rd/result-02" : null,
        }],
        ops_summary: { counts: { total: 1 } },
      },
    }),
    start: () => ({ pid: 1, log_path: "tmp/unused.log" }),
  })

  const status = await service.status("Request-02")
  assert.equal(status.status, "running")
  assert.equal(status.result_ref, null)
  await assert.rejects(() => service.result("Request-02"), /not complete/)

  terminal = true
  const result = await service.result("Request-02")
  assert.equal(result.status, "completed")
  assert.equal(result.cycle_status, "completed")
  assert.equal(result.job_ref, "ops-runtime://cycle/mcp-rd-request-02/job/J04")
  assert.equal(result.result_ref, "artifact://rd/result-02")
  assert.equal(result.error, null)
  assert.equal((result.summary as JSONRecord).ops_summary instanceof Object, true)
})

test("research submit is idempotent for an existing request id", async () => {
  let starts = 0
  const service = new ResearchJobService({
    execute: async () => ({
      ok: true,
      summary: {
        cycle: { cycle_id: "mcp-rd-repeat-01", status: "completed" },
        jobs: [{ job_id: "rd_strategy_supervisor", status: "completed", result_ref: "artifact://existing" }],
      },
    }),
    start: () => {
      starts += 1
      return { pid: 1, log_path: "tmp/unused.log" }
    },
  })

  const result = await service.submit({
    request_id: "Repeat-01",
    program_id: "rd-program",
    objective: "must not run twice",
  })
  assert.equal(result.duplicate, true)
  assert.equal(result.status, "completed")
  assert.equal(starts, 0)
})

test("research status preserves a blocked J04 inside a failed aggregate cycle", async () => {
  const service = new ResearchJobService({
    execute: async () => ({
      ok: true,
      summary: {
        cycle: { cycle_id: "mcp-rd-blocked-01", status: "failed" },
        jobs: [{
          job_id: "rd_strategy_supervisor",
          status: "blocked",
          result_ref: "research_state_store:rd_program/blocked-01",
        }],
      },
    }),
    start: () => ({ pid: 1, log_path: "tmp/unused.log" }),
  })

  const status = await service.status("Blocked-01")
  assert.equal(status.status, "blocked")
  assert.equal(status.cycle_status, "failed")
  const result = await service.result("Blocked-01")
  assert.equal(result.status, "blocked")
  assert.equal(result.cycle_status, "failed")
})

function argAfter(args: string[], name: string): string {
  const index = args.indexOf(name)
  if (index === -1 || !args[index + 1]) throw new Error(`missing ${name}`)
  return args[index + 1]!
}
