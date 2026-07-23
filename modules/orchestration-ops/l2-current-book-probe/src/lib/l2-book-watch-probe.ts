import { asRecord, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { runOwnerToolRecordSync } from "../../../../contracts/runtime-core/src/owner-tool-client"
import { requireReadyL2OwnerHealth } from "./l2-current-book-probe"

export const L2_BOOK_WATCH_PROBE_SCHEMA = "trade.ops-l2-book-watch-probe.v1" as const

export interface L2BookWatchProbeDependencies {
  readHealth?: (args: string[]) => JSONRecord
  readWatch?: (args: string[]) => JSONRecord
}

export function runL2BookWatchProbe(
  input: JSONRecord,
  dependencies: L2BookWatchProbeDependencies = {},
): JSONRecord {
  rejectUnknownInput(input)
  const maxEvents = boundedInteger(input.max_events ?? 20, 1, 100, "max_events")
  const watchMs = boundedInteger(input.watch_ms ?? 1_000, 100, 5_000, "watch_ms")
  const requestedSymbol = optionalSymbol(input.symbol)
  const symbolArgs = requestedSymbol == null ? [] : ["--symbol", requestedSymbol]
  const healthResponse = (dependencies.readHealth ?? readHealth)(symbolArgs)
  const identity = requireReadyL2OwnerHealth(healthResponse)
  if (requestedSymbol != null && identity.symbol !== requestedSymbol) throw new Error("L2 requested/owner symbol identity drifted")
  const watchResponse = (dependencies.readWatch ?? readWatch)([
    "--max-events", String(maxEvents),
    "--watch-ms", String(watchMs),
    ...symbolArgs,
  ])
  if (watchResponse.ok !== true || watchResponse.action !== "watch_active_l2_book") {
    throw new Error("L2 owner watch response identity drifted")
  }
  const watch = asRecord(watchResponse.watch)
  requireMatchingWatch(watch, identity, maxEvents, watchMs)
  const resyncObserved = Number(watch.resync_count) > 0 || Number(watch.epoch_count) > 1 || watch.final_state === "resync_required"
  return {
    schema_version: L2_BOOK_WATCH_PROBE_SCHEMA,
    ok: true,
    status: resyncObserved ? "resync_observed" : "observed",
    dependency: {
      name: "l2_service:owner_health",
      status: "ok",
      owner_schema: "trade.l2-service-owner-health.v1",
      symbol: identity.symbol,
      stream_epoch: identity.streamEpoch,
    },
    observation: watch,
    follow_up: resyncObserved ? "read_new_current_book_snapshot" : "none",
    consumer_authority: "non_economic_observation_only",
    writes: [],
    limitations: [
      "watermarks-are-latest-only-and-may-coalesce",
      "not-a-depth-delta-or-replay-stream",
      "resync-or-epoch-change-requires-a-new-snapshot",
      "no-strategy-signal-trading-or-execution-authority",
    ],
  }
}

function readHealth(args: string[]): JSONRecord {
  return runOwnerToolRecordSync("market-data.l2-service-health", args, "L2 service health")
}

function readWatch(args: string[]): JSONRecord {
  return runOwnerToolRecordSync("market-data.l2-book-watch", args, "L2 book watch")
}

function requireMatchingWatch(
  watch: JSONRecord,
  identity: { symbol: string; streamEpoch: string },
  maxEvents: number,
  watchMs: number,
): void {
  if (watch.schema_version !== "trade.l2-owner-book-watch.v1" || watch.symbol !== identity.symbol) {
    throw new Error("L2 health/watch identity drifted")
  }
  if (watch.non_economic !== true || watch.execution_compatible !== false || watch.authority !== "market_data_read_only") {
    throw new Error("L2 book watch authority drifted")
  }
  if (watch.requested_max_events !== maxEvents || watch.requested_watch_ms !== watchMs || watch.query_deadline_ms !== watchMs + 1_500) {
    throw new Error("L2 book watch request contract drifted")
  }
  if (watch.transport_semantics !== "latest_only_coalescing_watermark" || typeof watch.timed_out !== "boolean") {
    throw new Error("L2 book watch transport contract drifted")
  }
  const eventCount = boundedInteger(watch.event_count, 1, maxEvents, "watch.event_count")
  const epochCount = boundedInteger(watch.epoch_count, 1, eventCount, "watch.epoch_count")
  boundedInteger(watch.resync_count, 0, eventCount, "watch.resync_count")
  if (!Array.isArray(watch.events) || watch.events.length !== eventCount) throw new Error("L2 book watch event count drifted")
  const first = asRecord(watch.events[0])
  if (stringField(first.symbol) !== identity.symbol || stringField(first.stream_epoch) !== identity.streamEpoch) {
    throw new Error("L2 health/watch initial epoch drifted")
  }
  const seenEpochs = new Set(watch.events.map((event) => stringField(asRecord(event).stream_epoch)))
  if (seenEpochs.size !== epochCount || seenEpochs.has("")) throw new Error("L2 book watch epoch count drifted")
  if (!new Set(["live", "resync_required", "not_live"]).has(stringField(watch.final_state))) {
    throw new Error("L2 book watch final state drifted")
  }
}

function boundedInteger(value: unknown, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`)
  }
  return Number(value)
}

function rejectUnknownInput(input: JSONRecord): void {
  const allowed = new Set(["symbol", "max_events", "watch_ms"])
  for (const field of Object.keys(input)) if (!allowed.has(field)) throw new Error(`unknown input field: ${field}`)
}

function optionalSymbol(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value !== "string" || !/^[A-Z0-9]{5,20}$/.test(value)) throw new Error("symbol is invalid")
  return value
}
