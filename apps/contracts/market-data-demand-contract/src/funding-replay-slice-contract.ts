import { createHash } from "node:crypto"
import {
  canonicalHash,
  canonicalJson,
} from "../../runtime-core/src/canonical-json"

export const FUNDING_REPLAY_SLICE_SCHEMA =
  "trade.funding-replay-slice-ref.v1" as const

export interface FundingReplayEvent {
  timestamp: string
  rate: number
  mark_price: number
}

export interface FundingReplaySliceRef {
  schema_version: typeof FUNDING_REPLAY_SLICE_SCHEMA
  slice_ref: string
  artifact_ref: string
  content_sha256: string
  venue: "binance_usdm"
  symbol: string
  coverage: {
    start_at: string
    end_at: string
    boundary: "half_open"
  }
  row_count: number
  first_event_at: string | null
  last_event_at: string | null
  source: {
    archive_id: string
    coverage_audit_hash: string
    normalized_events_hash: string
  }
  domain_authority: "none"
  slice_hash: string
}

export function buildFundingReplaySliceRef(input: {
  symbol: string
  coverage_start: string
  coverage_end: string
  source_archive_id: string
  coverage_audit_hash: string
  normalized_events_hash: string
  events: FundingReplayEvent[]
}): FundingReplaySliceRef {
  const events = compileFundingReplayEvents(input.events, {
    start_at: input.coverage_start,
    end_at: input.coverage_end,
  })
  const contentSha256 = fundingReplaySliceContentSha256(events)
  const body = {
    schema_version: FUNDING_REPLAY_SLICE_SCHEMA,
    slice_ref: `market-data://funding-slice/${contentSha256}`,
    artifact_ref:
      `data/artifacts/market-data/funding-slices/${contentSha256}/funding.json`,
    content_sha256: contentSha256,
    venue: "binance_usdm" as const,
    symbol: marketSymbol(input.symbol),
    coverage: {
      start_at: canonicalTime(input.coverage_start, "coverage.start_at"),
      end_at: canonicalTime(input.coverage_end, "coverage.end_at"),
      boundary: "half_open" as const,
    },
    row_count: events.length,
    first_event_at: events[0]?.timestamp ?? null,
    last_event_at: events.at(-1)?.timestamp ?? null,
    source: {
      archive_id: identifier(input.source_archive_id, "source.archive_id"),
      coverage_audit_hash: hash(
        input.coverage_audit_hash,
        "source.coverage_audit_hash",
      ),
      normalized_events_hash: hash(
        input.normalized_events_hash,
        "source.normalized_events_hash",
      ),
    },
    domain_authority: "none" as const,
  }
  if (Date.parse(body.coverage.end_at)
      <= Date.parse(body.coverage.start_at)) {
    throw new Error("funding Replay slice coverage is invalid")
  }
  return { ...body, slice_hash: canonicalHash(body) }
}

export function compileFundingReplaySliceRef(
  value: unknown,
): FundingReplaySliceRef {
  const input = record(value, "funding_replay_slice")
  exact(input, [
    "schema_version", "slice_ref", "artifact_ref", "content_sha256",
    "venue", "symbol", "coverage", "row_count", "first_event_at",
    "last_event_at", "source", "domain_authority", "slice_hash",
  ], "funding_replay_slice")
  if (input.schema_version !== FUNDING_REPLAY_SLICE_SCHEMA
      || input.venue !== "binance_usdm"
      || input.domain_authority !== "none") {
    throw new Error("funding Replay slice authority or schema drifted")
  }
  const contentSha256 = hash(input.content_sha256, "content_sha256")
  const expectedRef = `market-data://funding-slice/${contentSha256}`
  const expectedArtifact =
    `data/artifacts/market-data/funding-slices/${contentSha256}/funding.json`
  if (input.slice_ref !== expectedRef
      || input.artifact_ref !== expectedArtifact) {
    throw new Error("funding Replay slice content address drifted")
  }
  const coverageInput = record(input.coverage, "coverage")
  exact(coverageInput, ["start_at", "end_at", "boundary"], "coverage")
  if (coverageInput.boundary !== "half_open") {
    throw new Error("funding Replay slice boundary is unsupported")
  }
  const startAt = canonicalTime(coverageInput.start_at, "coverage.start_at")
  const endAt = canonicalTime(coverageInput.end_at, "coverage.end_at")
  if (Date.parse(endAt) <= Date.parse(startAt)) {
    throw new Error("funding Replay slice coverage is invalid")
  }
  const rowCount = integer(input.row_count, 0, 10_000_000, "row_count")
  const firstEventAt = nullableTime(input.first_event_at, "first_event_at")
  const lastEventAt = nullableTime(input.last_event_at, "last_event_at")
  if ((rowCount === 0) !== (firstEventAt == null)
      || (firstEventAt == null) !== (lastEventAt == null)
      || (firstEventAt != null
        && (Date.parse(firstEventAt) < Date.parse(startAt)
          || Date.parse(lastEventAt!) >= Date.parse(endAt)
          || Date.parse(firstEventAt) > Date.parse(lastEventAt!)))) {
    throw new Error("funding Replay slice event bounds drifted")
  }
  const sourceInput = record(input.source, "source")
  exact(sourceInput, [
    "archive_id", "coverage_audit_hash", "normalized_events_hash",
  ], "source")
  const body = {
    schema_version: FUNDING_REPLAY_SLICE_SCHEMA,
    slice_ref: expectedRef,
    artifact_ref: expectedArtifact,
    content_sha256: contentSha256,
    venue: "binance_usdm" as const,
    symbol: marketSymbol(input.symbol),
    coverage: {
      start_at: startAt,
      end_at: endAt,
      boundary: "half_open" as const,
    },
    row_count: rowCount,
    first_event_at: firstEventAt,
    last_event_at: lastEventAt,
    source: {
      archive_id: identifier(sourceInput.archive_id, "source.archive_id"),
      coverage_audit_hash: hash(
        sourceInput.coverage_audit_hash,
        "source.coverage_audit_hash",
      ),
      normalized_events_hash: hash(
        sourceInput.normalized_events_hash,
        "source.normalized_events_hash",
      ),
    },
    domain_authority: "none" as const,
  }
  const sliceHash = hash(input.slice_hash, "slice_hash")
  if (canonicalHash(body) !== sliceHash) {
    throw new Error("funding Replay slice hash drifted")
  }
  return { ...body, slice_hash: sliceHash }
}

export function assertFundingReplaySliceContent(
  sliceValue: unknown,
  eventsValue: unknown,
): FundingReplayEvent[] {
  const slice = compileFundingReplaySliceRef(sliceValue)
  const events = compileFundingReplayEvents(eventsValue, slice.coverage)
  if (events.length !== slice.row_count
      || (events[0]?.timestamp ?? null) !== slice.first_event_at
      || (events.at(-1)?.timestamp ?? null) !== slice.last_event_at
      || fundingReplaySliceContentSha256(events)
        !== slice.content_sha256) {
    throw new Error("funding Replay slice content drifted")
  }
  return events
}

export function fundingReplaySliceBytes(
  events: FundingReplayEvent[],
): Buffer {
  return Buffer.from(`${canonicalJson(events)}\n`)
}

function fundingReplaySliceContentSha256(
  events: FundingReplayEvent[],
): string {
  return createHash("sha256")
    .update(fundingReplaySliceBytes(events))
    .digest("hex")
}

function compileFundingReplayEvents(
  value: unknown,
  coverage: { start_at: string; end_at: string },
): FundingReplayEvent[] {
  if (!Array.isArray(value) || value.length > 10_000_000) {
    throw new Error("funding Replay events must be a bounded array")
  }
  const start = Date.parse(canonicalTime(coverage.start_at, "coverage.start_at"))
  const end = Date.parse(canonicalTime(coverage.end_at, "coverage.end_at"))
  if (end <= start) throw new Error("funding Replay event coverage is invalid")
  let prior = -1
  return value.map((item, index) => {
    const event = record(item, `events[${index}]`)
    exact(event, ["timestamp", "rate", "mark_price"], `events[${index}]`)
    const timestamp = canonicalTime(
      event.timestamp,
      `events[${index}].timestamp`,
    )
    const time = Date.parse(timestamp)
    if (time < start || time >= end || time <= prior) {
      throw new Error("funding Replay events are outside or unordered")
    }
    const rate = finite(event.rate, `events[${index}].rate`)
    const markPrice = finite(
      event.mark_price,
      `events[${index}].mark_price`,
    )
    if (markPrice <= 0) {
      throw new Error("funding Replay mark price must be positive")
    }
    prior = time
    return { timestamp, rate, mark_price: markPrice }
  })
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function exact(
  value: Record<string, unknown>,
  fields: string[],
  field: string,
): void {
  const expected = new Set(fields)
  if (Object.keys(value).some((key) => !expected.has(key))
      || fields.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`${field} shape drifted`)
  }
}

function canonicalTime(value: unknown, field: string): string {
  if (typeof value !== "string"
      || !Number.isFinite(Date.parse(value))
      || new Date(value).toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC time`)
  }
  return value
}

function nullableTime(value: unknown, field: string): string | null {
  return value == null ? null : canonicalTime(value, field)
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (!Number.isSafeInteger(value)
      || Number(value) < minimum
      || Number(value) > maximum) {
    throw new Error(`${field} is outside bounds`)
  }
  return Number(value)
}

function finite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be finite`)
  }
  return Object.is(value, -0) ? 0 : value
}

function hash(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function marketSymbol(value: unknown): string {
  if (typeof value !== "string"
      || !/^[A-Z0-9]{5,20}$/.test(value)) {
    throw new Error("symbol is invalid")
  }
  return value
}
