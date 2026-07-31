import { boundedInteger, nonNegativeInteger, positiveInteger, record, requireUtc, text } from "./validation"

export const L2_OWNER_BOOK_WATCH_SCHEMA = "trade.l2-owner-book-watch.v1" as const
export const L2_BOOK_WATCH_MAX_EVENTS = 100
export const L2_BOOK_WATCH_MAX_MS = 5_000
export const L2_BOOK_WATCH_DEADLINE_OVERHEAD_MS = 1_500

export interface L2BookWatermark {
  schema_version: "trade.l2-book-watermark.v1"
  symbol: string
  stream_epoch: string
  last_update_id: number
  local_receive_time_ms: number
  published_at_ms: number
  continuity_status: string
  resync_required: boolean
}

export interface L2OwnerBookWatch {
  schema_version: typeof L2_OWNER_BOOK_WATCH_SCHEMA
  observed_at: string
  symbol: string
  requested_max_events: number
  requested_watch_ms: number
  query_deadline_ms: number
  timed_out: boolean
  event_count: number
  epoch_count: number
  resync_count: number
  final_state: "live" | "resync_required" | "not_live"
  events: L2BookWatermark[]
  transport_semantics: "latest_only_coalescing_watermark"
  non_economic: true
  execution_compatible: false
  authority: "market_data_read_only"
  limitations: string[]
}

export function buildL2OwnerBookWatch(input: {
  observed_at: string
  expected_symbol: string
  max_events: number
  watch_ms: number
  query_result: unknown
}): L2OwnerBookWatch {
  requireUtc(input.observed_at, "observed_at")
  boundedInteger(input.max_events, 1, L2_BOOK_WATCH_MAX_EVENTS, "max_events")
  boundedInteger(input.watch_ms, 100, L2_BOOK_WATCH_MAX_MS, "watch_ms")
  const batch = record(input.query_result, "watch batch")
  if (batch.schema_version !== "trade.l2-book-watch-batch.v1" || batch.symbol !== input.expected_symbol) {
    throw new Error("L2 book watch batch identity drifted")
  }
  if (batch.max_events !== input.max_events || batch.watch_ms !== input.watch_ms || typeof batch.timed_out !== "boolean") {
    throw new Error("L2 book watch request contract drifted")
  }
  if (!Array.isArray(batch.events) || batch.events.length < 1 || batch.events.length > input.max_events) {
    throw new Error("L2 book watch event count is invalid")
  }
  const events = batch.events.map((value, index) => watermark(value, input.expected_symbol, index))
  const epochs: string[] = []
  for (const [index, event] of events.entries()) {
    if (!epochs.includes(event.stream_epoch)) epochs.push(event.stream_epoch)
    if (index === 0) continue
    const previous = events[index - 1]
    if (event.published_at_ms < previous.published_at_ms) throw new Error("L2 book watch publish time regressed")
    if (event.stream_epoch === previous.stream_epoch) {
      if (event.last_update_id < previous.last_update_id) throw new Error("L2 book watch update id regressed")
    } else {
      if (!event.resync_required) throw new Error("L2 book watch epoch changed without resync")
      if (epochs.slice(0, -1).includes(event.stream_epoch)) throw new Error("L2 book watch epoch returned after rollover")
    }
  }
  const final = events.at(-1) as L2BookWatermark
  return {
    schema_version: L2_OWNER_BOOK_WATCH_SCHEMA,
    observed_at: input.observed_at,
    symbol: input.expected_symbol,
    requested_max_events: input.max_events,
    requested_watch_ms: input.watch_ms,
    query_deadline_ms: input.watch_ms + L2_BOOK_WATCH_DEADLINE_OVERHEAD_MS,
    timed_out: batch.timed_out,
    event_count: events.length,
    epoch_count: epochs.length,
    resync_count: events.filter((event) => event.resync_required).length,
    final_state: final.resync_required ? "resync_required" : final.continuity_status === "live" ? "live" : "not_live",
    events,
    transport_semantics: "latest_only_coalescing_watermark",
    non_economic: true,
    execution_compatible: false,
    authority: "market_data_read_only",
    limitations: [
      "watermarks-may-coalesce-and-are-not-a-depth-delta-stream",
      "epoch-change-or-resync-requires-a-new-current-book-snapshot",
      "no-fill-queue-position-slippage-or-execution-authority",
      "bounded-local-observation-not-external-completeness-proof",
    ],
  }
}

function watermark(value: unknown, symbol: string, index: number): L2BookWatermark {
  const event = record(value, `events[${index}]`)
  if (event.schema_version !== "trade.l2-book-watermark.v1" || event.symbol !== symbol) {
    throw new Error(`L2 book watch event ${index} identity drifted`)
  }
  const streamEpoch = text(event.stream_epoch)
  const continuityStatus = text(event.continuity_status)
  if (!streamEpoch || !CONTINUITY_STATUSES.has(continuityStatus)) throw new Error(`L2 book watch event ${index} state is invalid`)
  if (typeof event.resync_required !== "boolean") throw new Error(`L2 book watch event ${index} resync flag is invalid`)
  const lastUpdateId = nonNegativeInteger(event.last_update_id, `events[${index}].last_update_id`)
  const localReceiveTimeMs = nonNegativeInteger(event.local_receive_time_ms, `events[${index}].local_receive_time_ms`)
  const publishedAtMs = positiveInteger(event.published_at_ms, `events[${index}].published_at_ms`)
  if (localReceiveTimeMs > publishedAtMs) throw new Error(`L2 book watch event ${index} time order is invalid`)
  if (continuityStatus === "live" && !event.resync_required && localReceiveTimeMs === 0) {
    throw new Error(`L2 book watch event ${index} live receive time is missing`)
  }
  return {
    schema_version: "trade.l2-book-watermark.v1",
    symbol,
    stream_epoch: streamEpoch,
    last_update_id: lastUpdateId,
    local_receive_time_ms: localReceiveTimeMs,
    published_at_ms: publishedAtMs,
    continuity_status: continuityStatus,
    resync_required: event.resync_required,
  }
}

const CONTINUITY_STATUSES = new Set(["starting", "buffering", "bridging", "live", "resyncing", "degraded", "draining", "stopped"])
