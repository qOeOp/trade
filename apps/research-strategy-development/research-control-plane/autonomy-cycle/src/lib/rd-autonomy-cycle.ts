type JSONRecord = Record<string, unknown>

export type AutonomyOwner = "plan" | "model_task" | "gateway" | "assess" | "queue" | "supervisor"
export type AutonomyInvoker = (owner: AutonomyOwner, payload: JSONRecord) => Promise<JSONRecord>

export interface RdAutonomyCycleInput {
  cycle_id: string
  now: string
  program_id: string
  program_ref: string
  supervisor_payload: JSONRecord
}

export async function runRdAutonomyCycle(input: RdAutonomyCycleInput, invoke: AutonomyInvoker): Promise<JSONRecord> {
  const planned = await invoke("plan", { action: "plan_next", now: input.now })
  const state = requiredRecord(planned.state, "program plan state")
  const plan = requiredRecord(planned.next_plan, "program next plan")
  const planStatus = requiredText(plan.status, "plan status")
  if (planStatus === "stopped") return result("stopped", plan, { model_called: false, supervisor_called: false })
  if (planStatus === "ready") {
    const supervisor = await invoke("supervisor", input.supervisor_payload)
    return result("supervisor_completed", plan, { model_called: false, supervisor_called: true, supervisor })
  }
  if (planStatus !== "blocked" || state.status !== "active") {
    return result("blocked", plan, { model_called: false, supervisor_called: false, blocked_reason: "program_not_active_or_plan_not_refillable" })
  }

  const taskInput = {
    task_id: safeId(`rd-hypothesis-${requiredText(plan.plan_id, "plan id")}`),
    idempotency_key: safeId(`rd:hypothesis:${requiredText(plan.plan_id, "plan id")}`),
    trace_id: safeId(input.cycle_id),
    program_ref: input.program_ref,
    designer_input: designerInput(input.program_id, state, plan),
  }
  const taskEnvelope = await invoke("model_task", taskInput)
  const modelTask = requiredRecord(taskEnvelope.model_task, "hypothesis model task")
  const gatewayResult = await invoke("gateway", modelTask)
  const assessment = await invoke("assess", { request: modelTask, result: gatewayResult })
  if (assessment.valid !== true || assessment.ready !== true) {
    return result("blocked", plan, {
      model_called: true,
      supervisor_called: false,
      blocked_reason: stringField(assessment.blocked_reason) || "model_proposal_not_ready",
      assessment,
    })
  }
  const queueItem = requiredRecord(assessment.queue_item, "ready queue proposal")
  const expectedUpdatedAt = requiredText(state.updated_at, "program updated_at")
  const queued = await invoke("queue", {
    action: "queue_proposal",
    expected_updated_at: expectedUpdatedAt,
    now: nextTimestamp(expectedUpdatedAt, input.now),
    proposal: queueItem,
  })
  if (queued.queued !== true && queued.duplicate !== true) throw new Error("Control Plane did not accept or identify the queue proposal")
  const supervisor = await invoke("supervisor", input.supervisor_payload)
  return result("queue_replenished_and_supervisor_completed", plan, {
    model_called: true,
    supervisor_called: true,
    queue: { queued: queued.queued === true, duplicate: queued.duplicate === true },
    assessment,
    supervisor,
  })
}

function designerInput(programId: string, state: JSONRecord, plan: JSONRecord): JSONRecord {
  const scout = record(plan.scout_subagent_plan)
  return {
    program_id: programId,
    objective: stringField(state.objective),
    latest_failure_summary: nullableRecord(state.latest_failure_summary),
    latest_reliability_gate: nullableRecord(state.latest_reliability_gate),
    rejected_mechanisms: records(state.rejected_mechanisms),
    universe_lessons: records(state.universe_lessons),
    artifact_refs: strings(state.artifact_refs),
    control_plane_context: nullableRecord(scout.control_plane_context),
  }
}

function result(status: string, plan: JSONRecord, detail: JSONRecord): JSONRecord {
  return {
    schema_version: "trade.rd-autonomy-cycle-result.v1",
    status,
    plan_id: stringField(plan.plan_id),
    plan_status: stringField(plan.status),
    ...detail,
    execution_authority: "none",
  }
}

function nextTimestamp(expected: string, candidate: string): string {
  const expectedMs = Date.parse(expected)
  const candidateMs = Date.parse(candidate)
  if (!Number.isFinite(expectedMs) || !Number.isFinite(candidateMs)) throw new Error("autonomy cycle timestamps are invalid")
  return new Date(Math.max(expectedMs + 1, candidateMs)).toISOString()
}

function safeId(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._:-]+/g, "-")
  let start = 0
  let end = normalized.length
  while (normalized[start] === "-") start += 1
  while (end > start && normalized[end - 1] === "-") end -= 1
  const result = normalized.slice(start, end).slice(0, 128)
  if (!result) throw new Error("autonomy identity is empty")
  return result
}
function record(value: unknown): JSONRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {} }
function requiredRecord(value: unknown, field: string): JSONRecord { const result = record(value); if (!Object.keys(result).length) throw new Error(`${field} is missing`); return result }
function nullableRecord(value: unknown): JSONRecord | null { const result = record(value); return Object.keys(result).length ? result : null }
function records(value: unknown): JSONRecord[] { return Array.isArray(value) ? value.map(record).filter((item) => Object.keys(item).length > 0) : [] }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [] }
function stringField(value: unknown): string { return typeof value === "string" ? value.trim() : "" }
function requiredText(value: unknown, field: string): string { const result = stringField(value); if (!result) throw new Error(`${field} is missing`); return result }
