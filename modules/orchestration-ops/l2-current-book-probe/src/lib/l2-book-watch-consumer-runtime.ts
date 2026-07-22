import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs"
import { relative, resolve } from "node:path"
import type { JSONRecord } from "../../../../contracts/runtime-core/src/json"

export const L2_WATCH_CONSUMER_RECEIPT_SCHEMA = "trade.ops-l2-watch-consumer-launch-receipt.v1" as const
export const L2_WATCH_CONSUMER_RUNTIME_SCHEMA = "trade.ops-l2-watch-consumer-runtime-state.v1" as const
export const L2_WATCH_CONSUMER_OBSERVATION_SCHEMA = "trade.ops-l2-watch-consumer-observation-state.v1" as const
export const L2_WATCH_CONSUMER_TERMINAL_SCHEMA = "trade.ops-l2-watch-consumer-terminal-state.v1" as const
export const L2_WATCH_CONSUMER_OWNER_READ_SCHEMA = "trade.ops-l2-watch-consumer-owner-read.v1" as const

export interface L2WatchConsumerConfig {
  max_cycles: number
  session_ms: number
  max_events: number
  watch_ms: number
  depth: number
  max_freshness_ms: number
  duration_seconds: number
  restart_limit: number
}

export interface L2WatchConsumerReceipt {
  schema_version: typeof L2_WATCH_CONSUMER_RECEIPT_SCHEMA
  launched_at: string
  supervisor_pid: number
  runtime_directory: string
  runtime_state_path: string
  observation_state_path: string
  terminal_state_path: string
  log_path: string
  config: L2WatchConsumerConfig
}

export interface L2WatchConsumerRuntimeState {
  schema_version: typeof L2_WATCH_CONSUMER_RUNTIME_SCHEMA
  updated_at: string
  status: "starting" | "running" | "backoff" | "stopping"
  supervisor_pid: number
  consumer_pid: number | null
  attempt: number
  consecutive_failures: number
  last_exit_code: number | null
  next_restart_at: string | null
}

export interface L2WatchConsumerObservationState {
  schema_version: typeof L2_WATCH_CONSUMER_OBSERVATION_SCHEMA
  updated_at: string
  started_at: string
  status: "starting" | "live" | "resyncing" | "backoff" | "stopping" | "unavailable"
  ready: boolean
  consumer_pid: number
  baseline_snapshot_at: string | null
  stream_epoch: string | null
  book_hash: string | null
  snapshot_freshness_ms: number | null
  last_watch_at: string | null
  last_watch_event_count: number
  last_error_class: "" | "snapshot_unavailable" | "watch_unavailable" | "session_unavailable"
  metrics: {
    worker_start_total: number
    watch_cycle_total: number
    snapshot_total: number
    resnapshot_total: number
    retry_total: number
    watch_failure_total: number
    snapshot_failure_total: number
    reconnect_total: number
    resync_signal_total: number
    epoch_change_total: number
    observed_event_total: number
  }
}

export interface ActiveL2WatchConsumer {
  receipt: L2WatchConsumerReceipt
  runtime: L2WatchConsumerRuntimeState
  observation: L2WatchConsumerObservationState | null
  terminal: JSONRecord | null
}

let atomicWriteSequence = 0

export function validateL2WatchConsumerConfig(config: L2WatchConsumerConfig): void {
  bounded(config.max_cycles, 1, 120, "max_cycles")
  bounded(config.session_ms, 2_000, 300_000, "session_ms")
  bounded(config.max_events, 1, 100, "max_events")
  bounded(config.watch_ms, 100, 5_000, "watch_ms")
  bounded(config.depth, 1, 100, "depth")
  bounded(config.max_freshness_ms, 100, 2_000, "max_freshness_ms")
  bounded(config.duration_seconds, 0, 86_400, "duration_seconds")
  bounded(config.restart_limit, 0, 1_000_000, "restart_limit")
  if (config.session_ms < config.watch_ms + 3_000) {
    throw new Error("session_ms must cover one snapshot and one bounded watch")
  }
}

export function parseL2WatchConsumerLaunchArgs(argv: string[]): L2WatchConsumerConfig {
  const allowed = new Set([
    "max_cycles", "session_ms", "max_events", "watch_ms", "depth", "max_freshness_ms", "duration_seconds", "restart_limit",
  ])
  const values: Record<string, string> = {}
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (name == null || value == null || !name.startsWith("--")) throw new Error(`incomplete argument: ${name ?? "<missing>"}`)
    const field = name.slice(2).replaceAll("-", "_")
    if (!allowed.has(field)) throw new Error(`unknown argument: ${name}`)
    if (field in values) throw new Error(`duplicate argument: ${name}`)
    values[field] = value
  }
  const config = {
    max_cycles: numberValue(values.max_cycles, 120),
    session_ms: numberValue(values.session_ms, 300_000),
    max_events: numberValue(values.max_events, 20),
    watch_ms: numberValue(values.watch_ms, 1_000),
    depth: numberValue(values.depth, 20),
    max_freshness_ms: numberValue(values.max_freshness_ms, 1_000),
    duration_seconds: numberValue(values.duration_seconds, 0),
    restart_limit: numberValue(values.restart_limit, 0),
  }
  validateL2WatchConsumerConfig(config)
  return config
}

export function assertL2WatchConsumerRuntimeRef(root: string, ref: string): string {
  const path = resolve(root, ref)
  const normalized = relative(root, path).replaceAll("\\", "/")
  if (!normalized.startsWith("tmp/l2-book-watch-consumer/") || normalized.includes("../")) {
    throw new Error("L2 watch consumer control files must stay under tmp/l2-book-watch-consumer/")
  }
  return path
}

export function atomicWriteJson(path: string, value: unknown): void {
  atomicWriteSequence += 1
  const temporary = `${path}.tmp.${process.pid}.${atomicWriteSequence}`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 })
  renameSync(temporary, path)
}

export function carryForwardL2WatchConsumerMetrics(
  previous: unknown,
  workerAttempt: number,
): L2WatchConsumerObservationState["metrics"] {
  bounded(workerAttempt, 1, Number.MAX_SAFE_INTEGER, "worker_attempt")
  const metrics = emptyMetrics()
  if (previous != null) {
    if (typeof previous !== "object" || Array.isArray(previous)) throw new Error("previous L2 watch consumer observation state is invalid")
    const observation = previous as Partial<L2WatchConsumerObservationState>
    if (observation.schema_version !== L2_WATCH_CONSUMER_OBSERVATION_SCHEMA || observation.metrics == null) {
      throw new Error("previous L2 watch consumer observation state is invalid")
    }
    for (const field of Object.keys(metrics) as Array<keyof typeof metrics>) {
      const value = observation.metrics[field] ?? (field === "worker_start_total" ? 0 : undefined)
      metrics[field] = metricValue(value, `previous.metrics.${field}`)
    }
  }
  metrics.worker_start_total = Math.max(metrics.worker_start_total, workerAttempt)
  return metrics
}

export function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM"
  }
}

export function findUniqueActiveL2WatchConsumer(root: string): ActiveL2WatchConsumer | null {
  const runtimeRoot = assertL2WatchConsumerRuntimeRef(root, "tmp/l2-book-watch-consumer/runtime")
  if (!existsSync(runtimeRoot)) return null
  const active: ActiveL2WatchConsumer[] = []
  for (const entry of readdirSync(runtimeRoot, { withFileTypes: true }).filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const receiptPath = resolve(runtimeRoot, entry.name, "launch-receipt.json")
    if (!existsSync(receiptPath)) continue
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as L2WatchConsumerReceipt
    if (receipt.schema_version !== L2_WATCH_CONSUMER_RECEIPT_SCHEMA) throw new Error("unsupported L2 watch consumer receipt")
    validateL2WatchConsumerConfig(receipt.config)
    if (!processIsAlive(receipt.supervisor_pid)) continue
    const runtimePath = assertL2WatchConsumerRuntimeRef(root, receipt.runtime_state_path)
    if (!existsSync(runtimePath)) continue
    const runtime = JSON.parse(readFileSync(runtimePath, "utf8")) as L2WatchConsumerRuntimeState
    if (runtime.schema_version !== L2_WATCH_CONSUMER_RUNTIME_SCHEMA || runtime.supervisor_pid !== receipt.supervisor_pid) {
      throw new Error("L2 watch consumer runtime identity drifted")
    }
    const observationPath = assertL2WatchConsumerRuntimeRef(root, receipt.observation_state_path)
    const observation = existsSync(observationPath)
      ? JSON.parse(readFileSync(observationPath, "utf8")) as L2WatchConsumerObservationState : null
    if (observation != null && observation.schema_version !== L2_WATCH_CONSUMER_OBSERVATION_SCHEMA) {
      throw new Error("unsupported L2 watch consumer observation state")
    }
    const terminalPath = assertL2WatchConsumerRuntimeRef(root, receipt.terminal_state_path)
    const terminal = existsSync(terminalPath) ? JSON.parse(readFileSync(terminalPath, "utf8")) as JSONRecord : null
    if (terminal != null && terminal.schema_version !== L2_WATCH_CONSUMER_TERMINAL_SCHEMA) {
      throw new Error("unsupported L2 watch consumer terminal state")
    }
    active.push({ receipt, runtime, observation, terminal })
  }
  if (active.length > 1) throw new Error("multiple active L2 watch consumer supervisors require operator resolution")
  return active[0] ?? null
}

export function buildL2WatchConsumerOwnerRead(input: {
  observed_at: string
  active: ActiveL2WatchConsumer | null
}): JSONRecord {
  requireUtc(input.observed_at, "observed_at")
  if (input.active == null) return unavailableOwnerRead(input.observed_at)
  const { receipt, runtime, observation, terminal } = input.active
  if (receipt.schema_version !== L2_WATCH_CONSUMER_RECEIPT_SCHEMA) throw new Error("unsupported L2 watch consumer receipt")
  if (runtime.schema_version !== L2_WATCH_CONSUMER_RUNTIME_SCHEMA || runtime.supervisor_pid !== receipt.supervisor_pid) {
    throw new Error("L2 watch consumer runtime identity drifted")
  }
  validateL2WatchConsumerConfig(receipt.config)
  requireUtc(runtime.updated_at, "runtime.updated_at")
  bounded(runtime.attempt, 0, Number.MAX_SAFE_INTEGER, "runtime.attempt")
  bounded(runtime.consecutive_failures, 0, Number.MAX_SAFE_INTEGER, "runtime.consecutive_failures")
  if (!new Set(["starting", "running", "backoff", "stopping"]).has(runtime.status)) throw new Error("L2 watch consumer runtime status drifted")
  if (observation != null) validateObservation(observation, runtime.consumer_pid)
  const supervisorAlive = processIsAlive(receipt.supervisor_pid)
  const consumerAlive = runtime.consumer_pid != null && processIsAlive(runtime.consumer_pid)
  const stateAgeMs = Date.parse(input.observed_at) - Date.parse(runtime.updated_at)
  if (stateAgeMs < 0) throw new Error("L2 watch consumer runtime is newer than owner observation")
  const observationAgeMs = observation == null ? null : Date.parse(input.observed_at) - Date.parse(observation.updated_at)
  if (observationAgeMs != null && observationAgeMs < 0) throw new Error("L2 watch consumer observation is newer than owner observation")
  const staleAfterMs = Math.max(15_000, (receipt.config.watch_ms + 1_500) * 3)
  const runtimeFresh = stateAgeMs <= staleAfterMs
  const observationFresh = observationAgeMs != null && observationAgeMs <= staleAfterMs
  const overallReady = supervisorAlive && consumerAlive && runtime.status === "running" && runtimeFresh
    && observationFresh && observation?.ready === true && observation.status === "live"
  const terminalStatus = terminal?.status
  const status = terminalStatus === "completed" ? "stopped"
    : terminalStatus === "failed" ? "failed"
      : !supervisorAlive ? "orphaned"
        : overallReady ? "healthy"
          : observation == null || observation.status === "starting" ? "starting" : "degraded"
  return {
    schema_version: L2_WATCH_CONSUMER_OWNER_READ_SCHEMA,
    observed_at: input.observed_at,
    status,
    readiness: {
      supervisor_alive: supervisorAlive,
      consumer_alive: consumerAlive,
      runtime_state_fresh: runtimeFresh,
      observation_state_fresh: observationFresh,
      baseline_ready: observation?.ready === true,
      overall_ready: overallReady,
    },
    control: {
      runtime_status: runtime.status,
      state_age_ms: stateAgeMs,
      state_stale_after_ms: staleAfterMs,
      attempt: runtime.attempt,
      restart_total: Math.max(0, runtime.attempt - 1),
      consecutive_failures: runtime.consecutive_failures,
    },
    latest_baseline: observation?.stream_epoch && observation.book_hash && observation.baseline_snapshot_at ? {
      stream_epoch: observation.stream_epoch,
      book_hash: observation.book_hash,
      snapshot_observed_at: observation.baseline_snapshot_at,
      snapshot_freshness_ms: observation.snapshot_freshness_ms,
      last_watch_at: observation.last_watch_at,
      last_watch_event_count: observation.last_watch_event_count,
    } : null,
    metrics: observation?.metrics ?? emptyMetrics(),
    last_error_class: observation?.last_error_class ?? "",
    consumer_authority: "non_economic_observation_only",
    lifecycle_authority: "none",
    writes: [],
    limitations: limitations(),
  }
}

function unavailableOwnerRead(observedAt: string): JSONRecord {
  return {
    schema_version: L2_WATCH_CONSUMER_OWNER_READ_SCHEMA,
    observed_at: observedAt,
    status: "unavailable",
    readiness: {
      supervisor_alive: false,
      consumer_alive: false,
      runtime_state_fresh: false,
      observation_state_fresh: false,
      baseline_ready: false,
      overall_ready: false,
    },
    control: null,
    latest_baseline: null,
    metrics: emptyMetrics(),
    last_error_class: "no_active_consumer",
    consumer_authority: "non_economic_observation_only",
    lifecycle_authority: "none",
    writes: [],
    limitations: limitations(),
  }
}

function emptyMetrics(): L2WatchConsumerObservationState["metrics"] {
  return {
    worker_start_total: 0,
    watch_cycle_total: 0,
    snapshot_total: 0,
    resnapshot_total: 0,
    retry_total: 0,
    watch_failure_total: 0,
    snapshot_failure_total: 0,
    reconnect_total: 0,
    resync_signal_total: 0,
    epoch_change_total: 0,
    observed_event_total: 0,
  }
}

function validateObservation(observation: L2WatchConsumerObservationState, expectedPid: number | null): void {
  if (observation.schema_version !== L2_WATCH_CONSUMER_OBSERVATION_SCHEMA) {
    throw new Error("unsupported L2 watch consumer observation state")
  }
  requireUtc(observation.updated_at, "observation.updated_at")
  requireUtc(observation.started_at, "observation.started_at")
  if (observation.consumer_pid !== expectedPid) throw new Error("L2 watch consumer observation pid drifted")
  if (typeof observation.ready !== "boolean" || !new Set(["starting", "live", "resyncing", "backoff", "stopping", "unavailable"]).has(observation.status)) {
    throw new Error("L2 watch consumer observation status drifted")
  }
  for (const [field, value] of Object.entries(observation.metrics)) bounded(value, 0, Number.MAX_SAFE_INTEGER, `metrics.${field}`)
  bounded(observation.last_watch_event_count, 0, 100, "last_watch_event_count")
  if (observation.ready) {
    if (!observation.stream_epoch || !observation.baseline_snapshot_at || !observation.book_hash?.match(/^[a-f0-9]{64}$/)) {
      throw new Error("ready L2 watch consumer baseline is incomplete")
    }
    requireUtc(observation.baseline_snapshot_at, "baseline_snapshot_at")
    bounded(observation.snapshot_freshness_ms, 0, 2_000, "snapshot_freshness_ms")
  }
  if (observation.last_watch_at != null) requireUtc(observation.last_watch_at, "last_watch_at")
}

function limitations(): string[] {
  return [
    "local-supervised-consumer-and-atomic-projection-only",
    "latest-baseline-and-watermark-metrics-not-depth-delta-delivery",
    "consumer-health-does-not-prove-external-market-data-completeness",
    "no-start-stop-restart-signal-or-lifecycle-authority",
    "no-strategy-signal-trading-replay-fill-or-execution-authority",
  ]
}

function bounded(value: unknown, minimum: number, maximum: number, field: string): void {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`)
  }
}

function requireUtc(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be RFC 3339 UTC`)
  }
}

function metricValue(value: unknown, field: string): number {
  bounded(value, 0, Number.MAX_SAFE_INTEGER, field)
  return Number(value)
}

function numberValue(value: string | undefined, fallback: number): number {
  if (value == null) return fallback
  if (!/^\d+$/.test(value)) throw new Error("numeric arguments must be unsigned integers")
  return Number(value)
}
