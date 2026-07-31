import { asRecord, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { runL2BookWatchProbe } from "./l2-book-watch-probe"
import { runL2CurrentBookProbe } from "./l2-current-book-probe"

export const L2_BOOK_WATCH_SESSION_SCHEMA = "trade.ops-l2-book-watch-session.v1" as const
const RETRY_DELAYS_MS = [100, 200, 400, 800, 1_600, 2_000] as const
const MAX_SESSION_FAILURES = 20

export interface L2BookWatchSessionDependencies {
  readSnapshot?: (input: JSONRecord) => JSONRecord | Promise<JSONRecord>
  readWatch?: (input: JSONRecord) => JSONRecord | Promise<JSONRecord>
  sleep?: (milliseconds: number) => Promise<void>
  monotonicNow?: () => number
  utcNow?: () => string
  shouldStop?: () => boolean
  onTransition?: (transition: L2BookWatchSessionTransition) => void
  yieldControl?: () => Promise<void>
}

interface SnapshotIdentity {
  streamEpoch: string
  bookHash: string
  freshnessMs: number
}

interface WatchIdentity {
  startEpoch: string
  finalEpoch: string
  eventCount: number
  resyncCount: number
  timedOut: boolean
}

export interface L2BookWatchSessionTransition extends JSONRecord {
  sequence: number
  kind: "snapshot" | "watch" | "retry"
}

export type L2BookWatchFailureClass =
  | "owner_health_unavailable"
  | "owner_health_not_ready"
  | "current_book_unavailable"
  | "current_book_stale"
  | "snapshot_contract_drift"
  | "snapshot_unavailable"
  | "watch_contract_drift"
  | "watch_unavailable"

export async function runL2BookWatchSession(
  input: JSONRecord,
  dependencies: L2BookWatchSessionDependencies = {},
): Promise<JSONRecord> {
  rejectUnknownInput(input)
  const controls = {
    symbol: optionalSymbol(input.symbol),
    max_cycles: boundedInteger(input.max_cycles ?? 3, 1, 120, "max_cycles"),
    session_ms: boundedInteger(input.session_ms ?? 30_000, 2_000, 300_000, "session_ms"),
    max_events: boundedInteger(input.max_events ?? 20, 1, 100, "max_events"),
    watch_ms: boundedInteger(input.watch_ms ?? 1_000, 100, 5_000, "watch_ms"),
    depth: boundedInteger(input.depth ?? 20, 1, 100, "depth"),
    max_freshness_ms: boundedInteger(input.max_freshness_ms ?? 1_000, 100, 2_000, "max_freshness_ms"),
  }
  const monotonicNow = dependencies.monotonicNow ?? performance.now.bind(performance)
  const utcNow = dependencies.utcNow ?? (() => new Date().toISOString())
  const sleep = dependencies.sleep ?? ((milliseconds: number) => Bun.sleep(milliseconds))
  const readSnapshot = dependencies.readSnapshot ?? ((payload: JSONRecord) => runL2CurrentBookProbe(payload) as unknown as JSONRecord)
  const readWatch = dependencies.readWatch ?? ((payload: JSONRecord) => runL2BookWatchProbe(payload))
  const yieldControl = dependencies.yieldControl ?? (() => Bun.sleep(0))
  const startedAt = monotonicNow()
  const transitions: L2BookWatchSessionTransition[] = []
  const epochs = new Set<string>()
  let baseline: SnapshotIdentity | undefined
  let operation: "snapshot" | "watch" = "snapshot"
  let snapshotReason: "initial" | "watch_failure" | "epoch_or_resync" = "initial"
  let completedWatches = 0
  let watchFailures = 0
  let snapshotFailures = 0
  let snapshotCount = 0
  let resnapshotCount = 0
  let resyncSignalCount = 0
  let epochRolloverCount = 0
  let reconnectCount = 0
  let retrySleepMs = 0
  let consecutiveFailures = 0
  let maximumConsecutiveFailures = 0
  let totalFailures = 0
  let status: "completed" | "deadline_reached" | "unavailable" | "stopped" = "completed"
  let stopReason: "max_cycles_reached" | "session_deadline_reached" | "retry_budget_exhausted" | "stop_requested" = "max_cycles_reached"

  while (true) {
    if (dependencies.shouldStop?.()) {
      status = "stopped"
      stopReason = "stop_requested"
      break
    }
    if (completedWatches >= controls.max_cycles && operation === "watch") break
    const elapsed = elapsedMs(monotonicNow(), startedAt)
    const operationBudget = operation === "watch" ? controls.watch_ms + 1_500 : 1_500
    if (elapsed + operationBudget > controls.session_ms) {
      status = "deadline_reached"
      stopReason = "session_deadline_reached"
      break
    }
    try {
      if (operation === "snapshot") {
        const result = await readSnapshot({
          ...(controls.symbol == null ? {} : { symbol: controls.symbol }),
          depth: controls.depth,
          max_freshness_ms: controls.max_freshness_ms,
        })
        const snapshot = requireSnapshot(result)
        if (baseline && snapshot.streamEpoch !== baseline.streamEpoch) epochRolloverCount += 1
        baseline = snapshot
        epochs.add(snapshot.streamEpoch)
        snapshotCount += 1
        if (snapshotReason !== "initial") resnapshotCount += 1
        emitTransition(transitions, {
          sequence: transitions.length + 1,
          kind: "snapshot",
          reason: snapshotReason,
          stream_epoch: snapshot.streamEpoch,
          book_hash: snapshot.bookHash,
          freshness_ms: snapshot.freshnessMs,
        }, dependencies.onTransition)
        operation = "watch"
        consecutiveFailures = 0
        await yieldControl()
        continue
      }

      const result = await readWatch({
        ...(controls.symbol == null ? {} : { symbol: controls.symbol }),
        max_events: controls.max_events,
        watch_ms: controls.watch_ms,
      })
      const watch = requireWatch(result)
      if (!baseline) throw new Error("watch cannot precede a snapshot")
      epochs.add(watch.startEpoch)
      epochs.add(watch.finalEpoch)
      resyncSignalCount += watch.resyncCount
      completedWatches += 1
      const requiresSnapshot = watch.resyncCount > 0
        || watch.startEpoch !== baseline.streamEpoch
        || watch.finalEpoch !== baseline.streamEpoch
      emitTransition(transitions, {
        sequence: transitions.length + 1,
        kind: "watch",
        cycle: completedWatches,
        baseline_epoch: baseline.streamEpoch,
        start_epoch: watch.startEpoch,
        final_epoch: watch.finalEpoch,
        event_count: watch.eventCount,
        resync_count: watch.resyncCount,
        timed_out: watch.timedOut,
        follow_up: requiresSnapshot ? "read_new_current_book_snapshot" : "none",
      }, dependencies.onTransition)
      operation = requiresSnapshot ? "snapshot" : "watch"
      if (requiresSnapshot) snapshotReason = "epoch_or_resync"
      consecutiveFailures = 0
      await yieldControl()
    } catch (error) {
      const failedOperation = operation
      const errorClass = classifyFailure(error, failedOperation)
      if (failedOperation === "watch") {
        watchFailures += 1
        reconnectCount += 1
        snapshotReason = "watch_failure"
      } else {
        snapshotFailures += 1
      }
      operation = "snapshot"
      consecutiveFailures += 1
      totalFailures += 1
      maximumConsecutiveFailures = Math.max(maximumConsecutiveFailures, consecutiveFailures)
      if (consecutiveFailures > RETRY_DELAYS_MS.length || totalFailures > MAX_SESSION_FAILURES) {
        status = "unavailable"
        stopReason = "retry_budget_exhausted"
        break
      }
      const delay = RETRY_DELAYS_MS[consecutiveFailures - 1]
      const remaining = controls.session_ms - elapsedMs(monotonicNow(), startedAt)
      if (remaining <= delay + 1_500) {
        status = "deadline_reached"
        stopReason = "session_deadline_reached"
        break
      }
      emitTransition(transitions, {
        sequence: transitions.length + 1,
        kind: "retry",
        operation: failedOperation,
        attempt: consecutiveFailures,
        delay_ms: delay,
        error_class: errorClass,
      }, dependencies.onTransition)
      retrySleepMs += delay
      await sleep(delay)
    }
  }

  const durationMs = elapsedMs(monotonicNow(), startedAt)
  return {
    schema_version: L2_BOOK_WATCH_SESSION_SCHEMA,
    ok: status !== "unavailable",
    observed_at: utcNow(),
    status,
    stop_reason: stopReason,
    controls,
    metrics: {
      duration_ms: durationMs,
      completed_watch_cycles: completedWatches,
      snapshot_count: snapshotCount,
      resnapshot_count: resnapshotCount,
      watch_failure_count: watchFailures,
      snapshot_failure_count: snapshotFailures,
      reconnect_count: reconnectCount,
      resync_signal_count: resyncSignalCount,
      epoch_rollover_count: epochRolloverCount,
      observed_epoch_count: epochs.size,
      retry_sleep_ms: retrySleepMs,
      max_consecutive_failures: maximumConsecutiveFailures,
      total_failure_count: totalFailures,
    },
    final_baseline: baseline ? {
      stream_epoch: baseline.streamEpoch,
      book_hash: baseline.bookHash,
      freshness_ms: baseline.freshnessMs,
    } : null,
    transitions,
    retry_policy: {
      strategy: "bounded_exponential_backoff",
      delays_ms: [...RETRY_DELAYS_MS],
      max_total_failures: MAX_SESSION_FAILURES,
      watch_failure_requires_resnapshot: true,
      epoch_or_resync_requires_resnapshot: true,
    },
    consumer_authority: "non_economic_observation_only",
    writes: [],
    limitations: [
      "bounded-session-not-a-permanent-process-supervisor",
      "watermarks-are-latest-only-and-may-coalesce",
      "snapshot-restores-current-state-not-missed-depth-deltas",
      "no-strategy-signal-trading-execution-or-lifecycle-authority",
    ],
  }
}

function classifyFailure(error: unknown, operation: "snapshot" | "watch"): L2BookWatchFailureClass {
  const message = error instanceof Error ? error.message : ""
  if (operation === "watch") {
    return /drift|schema|authority|contract|epoch|event count|follow-up/i.test(message)
      ? "watch_contract_drift"
      : "watch_unavailable"
  }
  if (/health is not ready|health source identity is not ready/i.test(message)) return "owner_health_not_ready"
  if (/service health failed|owner health response|unsupported L2 owner health/i.test(message)) return "owner_health_unavailable"
  if (/current book failed/i.test(message)) return "current_book_unavailable"
  if (/not fresh\/live/i.test(message)) return "current_book_stale"
  if (/drift|schema|authority|contract|level count|best level|time order|hash|spread|depth quantity/i.test(message)) {
    return "snapshot_contract_drift"
  }
  return "snapshot_unavailable"
}

function requireSnapshot(result: JSONRecord): SnapshotIdentity {
  if (result.schema_version !== "trade.ops-l2-current-book-probe.v1" || result.ok !== true || result.status !== "observed") {
    throw new Error("L2 session snapshot identity drifted")
  }
  if (result.consumer_authority !== "non_economic_observation_only" || !Array.isArray(result.writes) || result.writes.length !== 0) {
    throw new Error("L2 session snapshot authority drifted")
  }
  const dependency = asRecord(result.dependency)
  const observation = asRecord(result.observation)
  const streamEpoch = stringField(observation.stream_epoch)
  if (!streamEpoch || dependency.stream_epoch !== streamEpoch) throw new Error("L2 session snapshot epoch drifted")
  const bookHash = stringField(observation.book_hash)
  if (!/^[a-f0-9]{64}$/.test(bookHash)) throw new Error("L2 session snapshot hash drifted")
  return {
    streamEpoch,
    bookHash,
    freshnessMs: boundedInteger(observation.freshness_ms, 0, 2_000, "snapshot.freshness_ms"),
  }
}

function requireWatch(result: JSONRecord): WatchIdentity {
  if (result.schema_version !== "trade.ops-l2-book-watch-probe.v1" || result.ok !== true) {
    throw new Error("L2 session watch identity drifted")
  }
  if (!new Set(["observed", "resync_observed"]).has(stringField(result.status))
    || result.consumer_authority !== "non_economic_observation_only"
    || !Array.isArray(result.writes) || result.writes.length !== 0) {
    throw new Error("L2 session watch authority drifted")
  }
  const dependency = asRecord(result.dependency)
  const observation = asRecord(result.observation)
  const events = Array.isArray(observation.events) ? observation.events : []
  const eventCount = boundedInteger(observation.event_count, 1, 100, "watch.event_count")
  if (events.length !== eventCount) throw new Error("L2 session watch event count drifted")
  const finalEvent = asRecord(events.at(-1))
  const startEpoch = stringField(dependency.stream_epoch)
  const finalEpoch = stringField(finalEvent.stream_epoch)
  if (!startEpoch || !finalEpoch) throw new Error("L2 session watch epoch is missing")
  const resyncCount = boundedInteger(observation.resync_count, 0, eventCount, "watch.resync_count")
  if (typeof observation.timed_out !== "boolean") throw new Error("L2 session watch timeout drifted")
  const expectedFollowUp = resyncCount > 0 || Number(observation.epoch_count) > 1 || observation.final_state === "resync_required"
    ? "read_new_current_book_snapshot" : "none"
  if (result.follow_up !== expectedFollowUp) throw new Error("L2 session watch follow-up drifted")
  return { startEpoch, finalEpoch, eventCount, resyncCount, timedOut: observation.timed_out }
}

function boundedInteger(value: unknown, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`)
  }
  return Number(value)
}

function elapsedMs(now: number, startedAt: number): number {
  return Math.max(0, Math.trunc(now - startedAt))
}

function emitTransition(
  transitions: L2BookWatchSessionTransition[],
  transition: L2BookWatchSessionTransition,
  callback?: (transition: L2BookWatchSessionTransition) => void,
): void {
  transitions.push(transition)
  callback?.(transition)
}

function rejectUnknownInput(input: JSONRecord): void {
  const allowed = new Set(["symbol", "max_cycles", "session_ms", "max_events", "watch_ms", "depth", "max_freshness_ms"])
  for (const field of Object.keys(input)) if (!allowed.has(field)) throw new Error(`unknown input field: ${field}`)
}

function optionalSymbol(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value !== "string" || !/^[A-Z0-9]{5,20}$/.test(value)) throw new Error("symbol is invalid")
  return value
}
