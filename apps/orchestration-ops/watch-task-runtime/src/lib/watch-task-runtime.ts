import { randomUUID } from "node:crypto"
import {
  compileWatchTaskDefinition,
  evaluateWatchTask,
  type WatchTaskDefinition,
  type WatchTaskEvaluation,
  type WatchTaskObservation,
  type WatchTaskStatus,
} from "../../../../contracts/watch-task-contract/src/watch-task-contract"
import type { JSONRecord } from "../../../../contracts/runtime-core/src/json"

export interface RuntimeWatchTaskRecord {
  definition: WatchTaskDefinition
  status: WatchTaskStatus
  observation_count: number
  error_count: number
  version: number
  updated_at: string
  terminal_reason?: string
  last_observation_ref?: string
  handoff?: JSONRecord
  handoff_receipt_ref?: string
  downstream_result_ref?: string
}

export interface WatchTaskLease {
  acquired: boolean
  fencing_token?: number
}

export interface WatchTaskStatePort {
  create(definition: WatchTaskDefinition): RuntimeWatchTaskRecord
  read(taskId: string): RuntimeWatchTaskRecord
  arm(task: RuntimeWatchTaskRecord, now: string): RuntimeWatchTaskRecord
  apply(task: RuntimeWatchTaskRecord, evaluation: WatchTaskEvaluation): RuntimeWatchTaskRecord
  acquireLease(taskId: string, holderId: string, now: string, expiresAt: string): WatchTaskLease
  renewLease(taskId: string, holderId: string, fencingToken: number, now: string, expiresAt: string): boolean
  releaseLease(taskId: string, holderId: string, fencingToken: number): void
}

export interface WatchTaskHandoffStatePort extends WatchTaskStatePort {
  handoff(task: RuntimeWatchTaskRecord, receiptRef: string, now: string): RuntimeWatchTaskRecord
  complete(task: RuntimeWatchTaskRecord, input: {
    result_ref: string
    outcome: "revalidation_passed" | "blocked"
    reason: string
    now: string
  }): RuntimeWatchTaskRecord
}

export interface WatchTaskObservationPort {
  observe(definition: WatchTaskDefinition): Promise<WatchTaskObservation>
}

export interface WatchTaskClock {
  now(): string
  sleep(milliseconds: number): Promise<void>
}

export interface WatchTaskSessionResult {
  schema_version: "trade.watch-task-session.v1"
  task_id: string
  status: "triggered" | "terminal" | "lease_unavailable" | "lease_lost" | "handoff_pending_or_complete"
  task_status: WatchTaskStatus
  observation_count: number
  error_count: number
  terminal_reason?: string
  handoff?: JSONRecord
  execution_authority: "none"
  limitations: string[]
}

export async function runWatchTaskSession(input: {
  definition: WatchTaskDefinition
  state: WatchTaskStatePort
  observations: WatchTaskObservationPort
  clock?: WatchTaskClock
  holderId?: string
}): Promise<WatchTaskSessionResult> {
  const definition = compileWatchTaskDefinition(input.definition)
  const clock = input.clock ?? systemClock
  const holderId = input.holderId ?? `watch-worker:${randomUUID()}`
  let task = input.state.create(definition)
  const acquiredAt = clock.now()
  const lease = input.state.acquireLease(
    definition.task_id,
    holderId,
    acquiredAt,
    leaseExpiry(acquiredAt, definition),
  )
  if (!lease.acquired || !lease.fencing_token) return result("lease_unavailable", task)
  try {
    while (true) {
      task = input.state.read(definition.task_id)
      if (task.definition.definition_hash !== definition.definition_hash) throw new Error("persisted watch task definition drifted")
      if (task.status === "created") task = input.state.arm(task, clock.now())
      if (task.status === "triggered") return result("triggered", task)
      if (task.status === "handed_off") return result("handoff_pending_or_complete", task)
      if (isTerminal(task.status)) return result("terminal", task)

      const now = clock.now()
      let observation: WatchTaskObservation | undefined
      if (Date.parse(now) >= Date.parse(definition.lifetime.not_before)
        && Date.parse(now) < Date.parse(definition.lifetime.deadline)) {
        try {
          observation = await input.observations.observe(definition)
        } catch {
          observation = undefined
        }
      }
      const evaluation = evaluateWatchTask({
        definition,
        observation,
        now,
        observation_count: task.observation_count,
        error_count: task.error_count,
      })
      task = input.state.apply(task, evaluation)
      if (task.status === "triggered") return result("triggered", task)
      if (isTerminal(task.status)) return result("terminal", task)

      const renewedAt = clock.now()
      if (!input.state.renewLease(
        definition.task_id,
        holderId,
        lease.fencing_token,
        renewedAt,
        leaseExpiry(renewedAt, definition),
      )) return result("lease_lost", task)
      const remainingMs = Date.parse(definition.lifetime.deadline) - Date.parse(renewedAt)
      if (remainingMs > 0) await clock.sleep(Math.min(definition.budget.poll_interval_ms, remainingMs))
    }
  } finally {
    input.state.releaseLease(definition.task_id, holderId, lease.fencing_token)
  }
}

function result(status: WatchTaskSessionResult["status"], task: RuntimeWatchTaskRecord): WatchTaskSessionResult {
  return {
    schema_version: "trade.watch-task-session.v1",
    task_id: task.definition.task_id,
    status,
    task_status: task.status,
    observation_count: task.observation_count,
    error_count: task.error_count,
    terminal_reason: task.terminal_reason,
    handoff: task.handoff,
    execution_authority: "none",
    limitations: [
      "bounded_single_mark_price_predicate_only",
      "trigger_is_revalidation_handoff_not_execution",
      "no_preflight_exchange_write_trade_event_or_llm_authority",
    ],
  }
}

function leaseExpiry(now: string, definition: WatchTaskDefinition): string {
  const deadline = Date.parse(definition.lifetime.deadline)
  return new Date(Math.min(deadline, Date.parse(now) + Math.max(30_000, definition.budget.poll_interval_ms * 3))).toISOString()
}

function isTerminal(status: WatchTaskStatus): boolean {
  return status === "completed" || status === "expired" || status === "cancelled" || status === "blocked"
}

const systemClock: WatchTaskClock = {
  now: () => new Date().toISOString(),
  sleep: (milliseconds) => Bun.sleep(milliseconds),
}
