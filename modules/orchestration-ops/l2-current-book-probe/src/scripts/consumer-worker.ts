#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import {
  L2_WATCH_CONSUMER_OBSERVATION_SCHEMA,
  assertL2WatchConsumerRuntimeRef,
  atomicWriteJson,
  carryForwardL2WatchConsumerMetrics,
  validateL2WatchConsumerConfig,
  type L2WatchConsumerConfig,
  type L2WatchConsumerObservationState,
} from "../lib/l2-book-watch-consumer-runtime"
import {
  runL2BookWatchSession,
  type L2BookWatchFailureClass,
  type L2BookWatchSessionTransition,
} from "../lib/l2-book-watch-session"

const root = repoRoot()
const args = parseArgs(process.argv.slice(2))
const runtimeDirectory = assertL2WatchConsumerRuntimeRef(root, args.runtimeDir)
const observationPath = resolve(runtimeDirectory, "observation-state.json")
const config = JSON.parse(args.config) as L2WatchConsumerConfig
validateL2WatchConsumerConfig(config)
const workerAttempt = positiveInteger(args.workerAttempt, "worker_attempt")
let stopRequested = false
const startedAt = new Date().toISOString()
const metrics = readPreviousMetrics()
let state: L2WatchConsumerObservationState = {
  schema_version: L2_WATCH_CONSUMER_OBSERVATION_SCHEMA,
  updated_at: startedAt,
  started_at: startedAt,
  status: "starting",
  ready: false,
  consumer_pid: process.pid,
  baseline_snapshot_at: null,
  stream_epoch: null,
  book_hash: null,
  snapshot_freshness_ms: null,
  last_watch_at: null,
  last_watch_event_count: 0,
  last_error_class: "",
  last_failure: readPreviousLastFailure(),
  metrics,
}
writeObservation()

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopRequested = true
    state.status = "stopping"
    state.ready = false
    writeObservation()
  })
}

while (!stopRequested) {
  const result = await runL2BookWatchSession({
    max_cycles: config.max_cycles,
    session_ms: config.session_ms,
    max_events: config.max_events,
    watch_ms: config.watch_ms,
    depth: config.depth,
    max_freshness_ms: config.max_freshness_ms,
  }, {
    shouldStop: () => stopRequested,
    onTransition: applyTransition,
  })
  if (result.status === "stopped" || stopRequested) break
  if (result.status === "unavailable") {
    state.status = "unavailable"
    state.ready = false
    state.last_error_class = "session_unavailable"
    writeObservation()
    await boundedBackoff(2_000)
  }
}

state.status = "stopping"
state.ready = false
writeObservation()

function applyTransition(transition: L2BookWatchSessionTransition): void {
  if (transition.kind === "snapshot") {
    const epoch = requiredText(transition.stream_epoch, "snapshot.stream_epoch")
    if (state.stream_epoch && state.stream_epoch !== epoch) state.metrics.epoch_change_total += 1
    state.stream_epoch = epoch
    state.book_hash = requiredHash(transition.book_hash)
    state.snapshot_freshness_ms = nonNegativeInteger(transition.freshness_ms, "snapshot.freshness_ms")
    state.baseline_snapshot_at = new Date().toISOString()
    state.status = "live"
    state.ready = true
    state.last_error_class = ""
    state.metrics.snapshot_total += 1
    if (transition.reason !== "initial") state.metrics.resnapshot_total += 1
  } else if (transition.kind === "watch") {
    const finalEpoch = requiredText(transition.final_epoch, "watch.final_epoch")
    const eventCount = nonNegativeInteger(transition.event_count, "watch.event_count")
    const resyncCount = nonNegativeInteger(transition.resync_count, "watch.resync_count")
    state.last_watch_at = new Date().toISOString()
    state.last_watch_event_count = eventCount
    state.metrics.watch_cycle_total += 1
    state.metrics.observed_event_total += eventCount
    state.metrics.resync_signal_total += resyncCount
    if (transition.follow_up === "read_new_current_book_snapshot" || finalEpoch !== state.stream_epoch) {
      state.status = "resyncing"
      state.ready = false
    } else {
      state.status = "live"
      state.ready = true
    }
  } else {
    const operation = requiredText(transition.operation, "retry.operation")
    const errorClass = requiredFailureClass(transition.error_class)
    const failureAt = new Date().toISOString()
    state.status = "backoff"
    state.ready = false
    state.last_error_class = errorClass
    state.last_failure = {
      observed_at: failureAt,
      operation: operation === "watch" ? "watch" : "snapshot",
      error_class: errorClass,
      attempt: nonNegativeInteger(transition.attempt, "retry.attempt"),
    }
    state.metrics.retry_total += 1
    if (operation === "watch") {
      state.metrics.watch_failure_total += 1
      state.metrics.reconnect_total += 1
    } else {
      state.metrics.snapshot_failure_total += 1
    }
  }
  writeObservation()
}

async function boundedBackoff(milliseconds: number): Promise<void> {
  const deadline = Date.now() + milliseconds
  while (!stopRequested && Date.now() < deadline) await Bun.sleep(Math.min(100, deadline - Date.now()))
}

function writeObservation(): void {
  state = { ...state, updated_at: new Date().toISOString() }
  atomicWriteJson(observationPath, state)
}

function readPreviousMetrics(): L2WatchConsumerObservationState["metrics"] {
  const previous = existsSync(observationPath) ? JSON.parse(readFileSync(observationPath, "utf8")) : null
  return carryForwardL2WatchConsumerMetrics(previous, workerAttempt)
}

function readPreviousLastFailure(): L2WatchConsumerObservationState["last_failure"] {
  if (!existsSync(observationPath)) return null
  const previous = JSON.parse(readFileSync(observationPath, "utf8")) as Partial<L2WatchConsumerObservationState>
  return previous.schema_version === L2_WATCH_CONSUMER_OBSERVATION_SCHEMA ? previous.last_failure ?? null : null
}

function requiredFailureClass(value: unknown): L2BookWatchFailureClass {
  const failureClass = requiredText(value, "retry.error_class") as L2BookWatchFailureClass
  const allowed = new Set<L2BookWatchFailureClass>([
    "owner_health_unavailable",
    "owner_health_not_ready",
    "current_book_unavailable",
    "current_book_stale",
    "snapshot_contract_drift",
    "snapshot_unavailable",
    "watch_contract_drift",
    "watch_unavailable",
  ])
  if (!allowed.has(failureClass)) throw new Error("retry.error_class is invalid")
  return failureClass
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${field} is invalid`)
  return value
}

function requiredHash(value: unknown): string {
  const hash = requiredText(value, "snapshot.book_hash")
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("snapshot.book_hash is invalid")
  return hash
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${field} is invalid`)
  return Number(value)
}

function positiveInteger(value: string, field: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${field} is invalid`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${field} is invalid`)
  return parsed
}

function parseArgs(argv: string[]): { runtimeDir: string; config: string; workerAttempt: string } {
  return {
    runtimeDir: requiredArg(argv, "--runtime-dir"),
    config: requiredArg(argv, "--config"),
    workerAttempt: requiredArg(argv, "--worker-attempt"),
  }
}

function requiredArg(argv: string[], name: string): string {
  const index = argv.indexOf(name)
  const value = index < 0 ? undefined : argv[index + 1]
  if (!value) throw new Error(`${name} is required`)
  return value
}
