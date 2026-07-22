import assert from "node:assert/strict"
import test from "node:test"
import { runRdAutonomyCycle, type AutonomyInvoker, type AutonomyOwner } from "./rd-autonomy-cycle"

test("ready plan delegates without a model call and stopped plan does nothing", async () => {
  const ready = harness({ planStatus: "ready" })
  const readyResult = await runRdAutonomyCycle(input(), ready.invoke)
  assert.equal(readyResult.status, "supervisor_completed")
  assert.deepEqual(ready.calls, ["plan", "supervisor"])
  const stopped = harness({ planStatus: "stopped", stateStatus: "budget_exhausted" })
  const stoppedResult = await runRdAutonomyCycle(input(), stopped.invoke)
  assert.equal(stoppedResult.status, "stopped")
  assert.deepEqual(stopped.calls, ["plan"])
})

test("blocked active plan validates, CAS queues, and then delegates supervisor", async () => {
  const run = harness({ planStatus: "blocked", assessment: { valid: true, ready: true, queue_item: { hypothesis_id: "h-1", ready: true } } })
  const output = await runRdAutonomyCycle(input(), run.invoke)
  assert.equal(output.status, "queue_replenished_and_supervisor_completed")
  assert.equal(output.execution_authority, "none")
  assert.deepEqual(run.calls, ["plan", "model_task", "gateway", "assess", "queue", "supervisor"])
  assert.equal(run.payloads.queue.expected_updated_at, "2026-07-23T00:00:00.000Z")
  assert.equal(run.payloads.queue.now, "2026-07-23T00:00:00.001Z")
})

test("provider or domain assessment failure writes no queue and runs no Trial", async () => {
  const run = harness({ planStatus: "blocked", assessment: { valid: false, ready: false, blocked_reason: "contract_validation_failed" } })
  const output = await runRdAutonomyCycle(input(), run.invoke)
  assert.equal(output.status, "blocked")
  assert.equal(output.blocked_reason, "contract_validation_failed")
  assert.deepEqual(run.calls, ["plan", "model_task", "gateway", "assess"])
})

function input() {
  return {
    cycle_id: "cycle-1", now: "2026-07-23T00:00:00.000Z", program_id: "rd-program",
    program_ref: "research_state_store:rd_program/rd-program", supervisor_payload: { cycle_id: "cycle-1" },
  }
}

function harness(options: { planStatus: string; stateStatus?: string; assessment?: Record<string, unknown> }) {
  const calls: AutonomyOwner[] = []
  const payloads = {} as Record<AutonomyOwner, Record<string, unknown>>
  const invoke: AutonomyInvoker = async (owner, payload) => {
    calls.push(owner); payloads[owner] = payload
    if (owner === "plan") return {
      state: {
        status: options.stateStatus || "active", objective: "find edge", updated_at: "2026-07-23T00:00:00.000Z",
        rejected_mechanisms: [], universe_lessons: [], artifact_refs: [],
      },
      next_plan: { plan_id: "plan-1", status: options.planStatus, scout_subagent_plan: { control_plane_context: { active: true } } },
    }
    if (owner === "model_task") return { model_task: { schema_version: "trade.model-task-request.v1", task_id: "task-1" } }
    if (owner === "gateway") return { schema_version: "trade.model-task-result.v1", status: "completed" }
    if (owner === "assess") return options.assessment || {}
    if (owner === "queue") return { queued: true, duplicate: false }
    return { status: "completed" }
  }
  return { calls, payloads, invoke }
}
