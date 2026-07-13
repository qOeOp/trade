import { Database } from "bun:sqlite"
import { asRecord, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { ensureOpsRuntimeSchema, recordNotifyAttempt, type NotifyAttempt, type NotifyStatus } from "../../../ops-runtime-store/src/lib/ops-runtime-store"

export interface NotifyChannel {
  channel: string
  enabled: boolean
}

export interface NotifyDispatchResult {
  ok: boolean
  processor_id: "ops_notify_dispatch"
  lifecycle_phase: "post_cycle"
  attempts: NotifyAttempt[]
  refs: string[]
}

export type NotifySender = (attempt: NotifyAttempt, payload: JSONRecord) => Promise<JSONRecord>

export async function runOpsNotifyDispatch(
  db: Database,
  input: JSONRecord,
  sender: NotifySender = stdoutSender,
): Promise<NotifyDispatchResult> {
  ensureOpsRuntimeSchema(db)
  const attemptedAt = stringField(input.attempted_at) || stringField(input.now) || new Date().toISOString()
  const payload = asRecord(input.payload)
  const channels = resolveChannels(input)
  const attempts: NotifyAttempt[] = []
  const refs: string[] = []

  for (const entry of channels) {
    const attempt = buildNotifyAttempt(input, entry.channel, attemptedAt, entry.enabled ? "planned" : "skipped")
    if (!entry.enabled) {
      attempt.result_json = { reason: "channel_disabled" }
      recordNotifyAttempt(db, attempt)
      attempts.push(attempt)
      refs.push(notifyRef(attempt))
      continue
    }
    if (Boolean(input.dry_run)) {
      attempt.status = "skipped"
      attempt.result_json = { dry_run: true, payload }
      recordNotifyAttempt(db, attempt)
      attempts.push(attempt)
      refs.push(notifyRef(attempt))
      continue
    }
    try {
      attempt.result_json = await sender(attempt, payload)
      attempt.status = "sent"
    } catch (error) {
      attempt.status = "failed"
      attempt.result_json = { error: error instanceof Error ? error.message : String(error) }
    }
    recordNotifyAttempt(db, attempt)
    attempts.push(attempt)
    refs.push(notifyRef(attempt))
  }

  return {
    ok: attempts.every((attempt) => attempt.status === "sent" || attempt.status === "skipped"),
    processor_id: "ops_notify_dispatch",
    lifecycle_phase: "post_cycle",
    attempts,
    refs,
  }
}

export function resolveChannels(input: JSONRecord): NotifyChannel[] {
  const raw = input.channels
  if (!Array.isArray(raw) || raw.length === 0) {
    return [{ channel: "stdout", enabled: Boolean(input.message) || Object.keys(asRecord(input.payload)).length > 0 }]
  }
  return raw.map((entry) => {
    if (typeof entry === "string") {
      return { channel: entry, enabled: true }
    }
    const record = asRecord(entry)
    return {
      channel: stringField(record.channel) || "unknown",
      enabled: record.enabled !== false,
    }
  })
}

async function stdoutSender(attempt: NotifyAttempt, payload: JSONRecord): Promise<JSONRecord> {
  const message = stringField(payload.message) || stringField(attempt.payload_ref) || "ops notification"
  console.log(JSON.stringify({ channel: attempt.channel, message, payload }))
  return { delivered: true, channel: attempt.channel }
}

function buildNotifyAttempt(input: JSONRecord, channel: string, attemptedAt: string, status: NotifyStatus): NotifyAttempt {
  const cycleId = stringField(input.cycle_id)
  const suffix = `${cycleId || "cycle"}-${channel}-${attemptedAt}`.replace(/[^A-Za-z0-9_-]/g, "")
  return {
    notify_id: stringField(input.notify_id) || `notify-${suffix || crypto.randomUUID()}`,
    cycle_id: cycleId || undefined,
    channel,
    status,
    payload_ref: stringField(input.payload_ref) || undefined,
    attempted_at: attemptedAt,
  }
}

function notifyRef(attempt: NotifyAttempt): string {
  return `ops_runtime_store:notify_attempt/${attempt.notify_id}`
}
