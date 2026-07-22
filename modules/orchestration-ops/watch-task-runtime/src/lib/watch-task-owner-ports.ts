import { resolve } from "node:path"
import {
  compileWatchTaskDefinition,
  parseWatchTaskObservation,
  WATCH_TASK_STATUSES,
  type WatchTaskStatus,
} from "../../../../contracts/watch-task-contract/src/watch-task-contract"
import { asRecord, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import type { RuntimeWatchTaskRecord, WatchTaskObservationPort, WatchTaskStatePort } from "./watch-task-runtime"
import type {
  WatchHandoffRevalidationPort,
  WatchHandoffRevalidationRequest,
} from "./watch-task-handoff-session"

export function createOpsRuntimeStorePort(input: {
  repositoryRoot: string
  bunPath: string
  dbPath: string
  timeoutMs?: number
}): WatchTaskStatePort & {
  handoff(task: RuntimeWatchTaskRecord, receiptRef: string, now: string): RuntimeWatchTaskRecord
  complete(task: RuntimeWatchTaskRecord, input: {
    result_ref: string
    outcome: "revalidation_passed" | "blocked"
    reason: string
    now: string
  }): RuntimeWatchTaskRecord
} {
  const command = resolve(input.repositoryRoot, "modules/orchestration-ops/ops-runtime-store/src/scripts/main.ts")
  const timeoutMs = input.timeoutMs ?? 5_000
  const invoke = (action: string, json: JSONRecord): JSONRecord => {
    const process = Bun.spawnSync({
      cmd: [input.bunPath, command, "--db", input.dbPath, "--action", action, "--json", JSON.stringify(json)],
      cwd: input.repositoryRoot,
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
    })
    if (process.exitCode !== 0) throw new Error(`ops runtime store ${action} failed`)
    const envelope = asRecord(JSON.parse(process.stdout.toString()))
    if (envelope.ok !== true) throw new Error(`ops runtime store ${action} rejected request`)
    return envelope
  }
  return {
    create: (definition) => decodeTask(invoke("watch_create", { definition }).watch_task),
    read: (taskId) => decodeTask(invoke("watch_read", { task_id: taskId }).watch_task),
    arm: (task, now) => decodeTask(invoke("watch_arm", {
      task_id: task.definition.task_id,
      definition_hash: task.definition.definition_hash,
      expected_version: task.version,
      now,
    }).watch_task),
    apply: (task, evaluation) => decodeTask(invoke("watch_apply_evaluation", {
      task_id: task.definition.task_id,
      expected_version: task.version,
      evaluation,
    }).watch_task),
    handoff: (task, receiptRef, now) => decodeTask(invoke("watch_handoff", {
      task_id: task.definition.task_id,
      expected_version: task.version,
      handoff_receipt_ref: receiptRef,
      now,
    }).watch_task),
    complete: (task, completion) => decodeTask(invoke("watch_complete", {
      task_id: task.definition.task_id,
      expected_version: task.version,
      downstream_result_ref: completion.result_ref,
      downstream_outcome: completion.outcome,
      downstream_reason: completion.reason,
      now: completion.now,
    }).watch_task),
    acquireLease: (taskId, holderId, now, expiresAt) => {
      const envelope = invoke("acquire_lock", {
        lock_key: `watch-task:${taskId}`,
        holder_id: holderId,
        acquired_at: now,
        expires_at: expiresAt,
      })
      const lock = asRecord(envelope.lock)
      return { acquired: envelope.acquired === true, fencing_token: positiveInteger(lock.fencing_token) || undefined }
    },
    renewLease: (taskId, holderId, fencingToken, now, expiresAt) => invoke("renew_lock", {
      lock_key: `watch-task:${taskId}`,
      holder_id: holderId,
      fencing_token: fencingToken,
      renewed_at: now,
      expires_at: expiresAt,
    }).renewed === true,
    releaseLease: (taskId, holderId, fencingToken) => {
      invoke("release_lock", {
        lock_key: `watch-task:${taskId}`,
        holder_id: holderId,
        fencing_token: fencingToken,
      })
    },
  }
}

export function createWatchHandoffRevalidationPort(input: {
  repositoryRoot: string
  bunPath: string
  timeoutMs?: number
}): WatchHandoffRevalidationPort {
  const command = resolve(
    input.repositoryRoot,
    "modules/live-execution-control/watch-handoff-revalidation/src/scripts/main.ts",
  )
  const timeoutMs = input.timeoutMs ?? 5_000
  return {
    revalidate: async (request: WatchHandoffRevalidationRequest) => {
      const process = Bun.spawnSync({
        cmd: [input.bunPath, command, "--json", JSON.stringify(request)],
        cwd: input.repositoryRoot,
        stdout: "pipe",
        stderr: "pipe",
        timeout: timeoutMs,
      })
      if (process.exitCode !== 0) throw new Error("watch handoff revalidation owner failed")
      const envelope = asRecord(JSON.parse(process.stdout.toString()))
      if (envelope.ok !== true) throw new Error("watch handoff revalidation owner rejected request")
      return decodeRevalidationResult(envelope.data)
    },
  }
}

export function createPublicMarkObservationPort(input: {
  repositoryRoot: string
  bunPath: string
  timeoutMs?: number
}): WatchTaskObservationPort {
  const command = resolve(input.repositoryRoot, "modules/market-data-products/binance-read/symbol-snapshot/src/scripts/main.ts")
  const timeoutMs = input.timeoutMs ?? 10_000
  return {
    observe: async (definition) => {
      const process = Bun.spawnSync({
        cmd: [
          input.bunPath,
          command,
          "--symbol", definition.symbol,
          "--funding-limit", "0",
          "--timeout", String(timeoutMs),
        ],
        cwd: input.repositoryRoot,
        stdout: "pipe",
        stderr: "pipe",
        timeout: timeoutMs + 2_000,
      })
      if (process.exitCode !== 0) throw new Error("public symbol snapshot failed")
      const envelope = asRecord(JSON.parse(process.stdout.toString()))
      if (envelope.ok !== true) throw new Error("public symbol snapshot returned an error")
      const data = asRecord(envelope.data)
      const premium = asRecord(data.premiumIndex)
      const sourceTime = Number(premium.time)
      const generatedAt = canonicalIso(data.generated_at, "symbol_snapshot.generated_at")
      if (!Number.isFinite(sourceTime) || sourceTime <= 0) throw new Error("symbol snapshot source time is invalid")
      return parseWatchTaskObservation({
        schema_version: "trade.watch-task-observation.v1",
        observation_ref: `binance-symbol-snapshot:${definition.symbol}:${sourceTime}`,
        symbol: definition.symbol,
        observed_at: generatedAt,
        source_observed_at: new Date(sourceTime).toISOString(),
        mark_price: Number(premium.markPrice),
        continuity: "point_in_time",
      })
    },
  }
}

function decodeTask(value: unknown): RuntimeWatchTaskRecord {
  const input = asRecord(value)
  const status = stringField(input.status)
  if (!WATCH_TASK_STATUSES.includes(status as WatchTaskStatus)) throw new Error("ops store returned an invalid watch status")
  return {
    definition: compileWatchTaskDefinition(input.definition),
    status: status as WatchTaskStatus,
    observation_count: nonNegativeInteger(input.observation_count, "observation_count"),
    error_count: nonNegativeInteger(input.error_count, "error_count"),
    version: positiveInteger(input.version, "version"),
    updated_at: canonicalIso(input.updated_at, "updated_at"),
    terminal_reason: stringField(input.terminal_reason) || undefined,
    last_observation_ref: stringField(input.last_observation_ref) || undefined,
    handoff: Object.keys(asRecord(input.handoff)).length > 0 ? asRecord(input.handoff) : undefined,
    handoff_receipt_ref: stringField(input.handoff_receipt_ref) || undefined,
    downstream_result_ref: stringField(input.downstream_result_ref) || undefined,
  }
}

function decodeRevalidationResult(value: unknown): Awaited<ReturnType<WatchHandoffRevalidationPort["revalidate"]>> {
  const input = asRecord(value)
  const status = stringField(input.status)
  const authority = stringField(input.execution_authority)
  if (input.schema_version !== "trade.watch-handoff-revalidation.v1") throw new Error("revalidation schema is unsupported")
  if (status !== "revalidation_passed" && status !== "blocked") throw new Error("revalidation status is unsupported")
  if (authority !== "none") throw new Error("revalidation widened execution authority")
  return {
    schema_version: "trade.watch-handoff-revalidation.v1",
    receipt_ref: stringField(input.receipt_ref),
    task_id: stringField(input.task_id),
    status,
    reason: stringField(input.reason),
    execution_authority: "none",
  }
}

function canonicalIso(value: unknown, field: string): string {
  const result = stringField(value)
  const millis = Date.parse(result)
  if (!result || !Number.isFinite(millis) || new Date(millis).toISOString() !== result) throw new Error(`${field} must be canonical UTC ISO`)
  return result
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${field} must be a non-negative integer`)
  return Number(value)
}

function positiveInteger(value: unknown, field = "value"): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    if (field === "value") return 0
    throw new Error(`${field} must be a positive integer`)
  }
  return Number(value)
}
