import { randomUUID } from "node:crypto"
import { canonicalHash } from "../../../../contracts/runtime-core/src/canonical-json"
import type { JSONRecord } from "../../../../contracts/runtime-core/src/json"
import type {
  RuntimeWatchTaskRecord,
  WatchTaskClock,
  WatchTaskHandoffStatePort,
} from "./watch-task-runtime"

export interface WatchHandoffRevalidationRequest {
  definition: RuntimeWatchTaskRecord["definition"]
  handoff: JSONRecord
  current_observation: unknown
  preflight: unknown
  now: string
}

export interface WatchHandoffRevalidationReceipt {
  schema_version: "trade.watch-handoff-revalidation.v1"
  receipt_ref: string
  task_id: string
  status: "revalidation_passed" | "blocked"
  reason: string
  execution_authority: "none"
}

export interface WatchHandoffRevalidationPort {
  revalidate(input: WatchHandoffRevalidationRequest): Promise<WatchHandoffRevalidationReceipt>
}

export interface WatchTaskHandoffSessionResult {
  schema_version: "trade.watch-task-handoff-session.v1"
  task_id: string
  status: "completed" | "already_completed" | "lease_unavailable" | "lease_lost"
  task_status: RuntimeWatchTaskRecord["status"]
  receipt_ref?: string
  revalidation_status?: "revalidation_passed" | "blocked"
  execution_authority: "none"
}

export async function closeWatchTaskRevalidation(input: {
  taskId: string
  state: WatchTaskHandoffStatePort
  revalidation: WatchHandoffRevalidationPort
  currentObservation: unknown
  preflight: unknown
  clock?: WatchTaskClock
  holderId?: string
}): Promise<WatchTaskHandoffSessionResult> {
  const clock = input.clock ?? systemClock
  const holderId = input.holderId ?? `watch-handoff:${randomUUID()}`
  let task = input.state.read(input.taskId)
  if (task.status === "completed") return sessionResult("already_completed", task)
  if (task.status !== "triggered" && task.status !== "handed_off") {
    throw new Error(`watch task cannot revalidate from ${task.status}`)
  }
  const acquiredAt = clock.now()
  const lease = input.state.acquireLease(
    task.definition.task_id,
    holderId,
    acquiredAt,
    leaseExpiry(acquiredAt),
  )
  if (!lease.acquired || !lease.fencing_token) return sessionResult("lease_unavailable", task)
  try {
    task = input.state.read(input.taskId)
    if (task.status === "completed") return sessionResult("already_completed", task)
    if (!task.handoff) throw new Error("watch task handoff payload is missing")
    if (task.status === "triggered") {
      task = input.state.handoff(task, intakeReceiptRef(task), clock.now())
    }
    if (task.status !== "handed_off") throw new Error(`watch task cannot continue handoff from ${task.status}`)
    const handoff = task.handoff
    if (!handoff) throw new Error("watch task handoff payload disappeared")
    const renewedAt = clock.now()
    if (!input.state.renewLease(
      task.definition.task_id,
      holderId,
      lease.fencing_token,
      renewedAt,
      leaseExpiry(renewedAt),
    )) return sessionResult("lease_lost", task)
    const receipt = await input.revalidation.revalidate({
      definition: task.definition,
      handoff,
      current_observation: input.currentObservation,
      preflight: input.preflight,
      now: clock.now(),
    })
    validateReceipt(receipt, task)
    task = input.state.complete(task, {
      result_ref: receipt.receipt_ref,
      outcome: receipt.status,
      reason: receipt.reason,
      now: clock.now(),
    })
    return {
      ...sessionResult("completed", task),
      receipt_ref: receipt.receipt_ref,
      revalidation_status: receipt.status,
    }
  } finally {
    input.state.releaseLease(task.definition.task_id, holderId, lease.fencing_token)
  }
}

function intakeReceiptRef(task: RuntimeWatchTaskRecord): string {
  return `watch-revalidation-intake:${canonicalHash({
    task_id: task.definition.task_id,
    definition_hash: task.definition.definition_hash,
    handoff: task.handoff,
  })}`
}

function validateReceipt(receipt: WatchHandoffRevalidationReceipt, task: RuntimeWatchTaskRecord): void {
  if (receipt.schema_version !== "trade.watch-handoff-revalidation.v1") throw new Error("revalidation receipt schema is unsupported")
  if (!receipt.receipt_ref) throw new Error("revalidation receipt_ref is required")
  if (receipt.task_id !== task.definition.task_id) throw new Error("revalidation receipt task identity drifted")
  if (receipt.execution_authority !== "none") throw new Error("revalidation receipt widened execution authority")
  if (receipt.status !== "revalidation_passed" && receipt.status !== "blocked") {
    throw new Error("revalidation receipt status is unsupported")
  }
  if (!receipt.reason) throw new Error("revalidation receipt reason is required")
}

function sessionResult(
  status: WatchTaskHandoffSessionResult["status"],
  task: RuntimeWatchTaskRecord,
): WatchTaskHandoffSessionResult {
  return {
    schema_version: "trade.watch-task-handoff-session.v1",
    task_id: task.definition.task_id,
    status,
    task_status: task.status,
    receipt_ref: task.downstream_result_ref,
    execution_authority: "none",
  }
}

function leaseExpiry(now: string): string {
  return new Date(Date.parse(now) + 30_000).toISOString()
}

const systemClock: WatchTaskClock = {
  now: () => new Date().toISOString(),
  sleep: (milliseconds) => Bun.sleep(milliseconds),
}
