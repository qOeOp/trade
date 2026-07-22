import { createHash } from "node:crypto"

export type Level = [string, string]

export interface Snapshot {
  last_update_id: number
  bids: Level[]
  asks: Level[]
}

export interface DepthEvent {
  event_time_ms: number
  transaction_time_ms: number
  local_receive_time_ms: number
  first_update_id: number
  final_update_id: number
  previous_final_update_id: number
  bids: Level[]
  asks: Level[]
}

export interface Gap {
  event_index: number
  expected_previous_final_update_id: number
  actual_previous_final_update_id: number
}

export interface ProjectionOutcome {
  status: "complete" | "incomplete"
  last_update_id: number
  applied_event_count: number
  book_hash: string
  bids: Level[]
  asks: Level[]
  gap?: Gap
}

export interface L2Fixture {
  schema_version: "trade.l2-bakeoff-fixture.v1"
  fixture_id: string
  stream_epoch: string
  symbol: string
  snapshot: Snapshot
  events: DepthEvent[]
  expected: ProjectionOutcome
}

export interface BakeoffResult {
  schema_version: "trade.l2-bakeoff-result.v1"
  implementation: "bun" | "go" | "rust"
  fixture_id: string
  source_hash: string
  iterations: number
  processed_event_count: number
  elapsed_ns: number
  outcome: ProjectionOutcome
}

const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/

export function normalizeDecimal(value: string): string {
  if (!DECIMAL_PATTERN.test(value)) {
    throw new Error(`invalid unsigned decimal: ${value}`)
  }
  const [integer, rawFraction = ""] = value.split(".")
  const fraction = rawFraction.replace(/0+$/, "")
  return fraction.length > 0 ? `${integer}.${fraction}` : integer
}

export function compareDecimals(left: string, right: string): number {
  const [leftInteger, leftFraction = ""] = left.split(".")
  const [rightInteger, rightFraction = ""] = right.split(".")
  if (leftInteger.length !== rightInteger.length) {
    return leftInteger.length < rightInteger.length ? -1 : 1
  }
  if (leftInteger !== rightInteger) {
    return leftInteger < rightInteger ? -1 : 1
  }
  const width = Math.max(leftFraction.length, rightFraction.length)
  const paddedLeft = leftFraction.padEnd(width, "0")
  const paddedRight = rightFraction.padEnd(width, "0")
  if (paddedLeft === paddedRight) return 0
  return paddedLeft < paddedRight ? -1 : 1
}

export function parseFixture(raw: string): L2Fixture {
  const value: unknown = JSON.parse(raw)
  const fixture = requireRecord(value, "fixture")
  if (fixture.schema_version !== "trade.l2-bakeoff-fixture.v1") {
    throw new Error("unsupported fixture schema_version")
  }
  const snapshot = parseSnapshot(fixture.snapshot)
  if (!Array.isArray(fixture.events) || fixture.events.length === 0) {
    throw new Error("fixture.events must be a non-empty array")
  }
  return {
    schema_version: "trade.l2-bakeoff-fixture.v1",
    fixture_id: requireString(fixture.fixture_id, "fixture_id"),
    stream_epoch: requireString(fixture.stream_epoch, "stream_epoch"),
    symbol: requireString(fixture.symbol, "symbol"),
    snapshot,
    events: fixture.events.map(parseEvent),
    expected: parseOutcome(fixture.expected),
  }
}

export function projectFixture(fixture: L2Fixture): ProjectionOutcome {
  const bids = levelsToMap(fixture.snapshot.bids)
  const asks = levelsToMap(fixture.snapshot.asks)
  let previousFinalUpdateId = fixture.snapshot.last_update_id
  let appliedEventCount = 0
  let bridged = false
  let gap: Gap | undefined

  for (const [eventIndex, event] of fixture.events.entries()) {
    if (event.final_update_id < fixture.snapshot.last_update_id) continue
    if (!bridged) {
      if (event.first_update_id > fixture.snapshot.last_update_id
        || event.final_update_id < fixture.snapshot.last_update_id) {
        gap = {
          event_index: eventIndex,
          expected_previous_final_update_id: fixture.snapshot.last_update_id,
          actual_previous_final_update_id: event.previous_final_update_id,
        }
        break
      }
      bridged = true
    } else if (event.previous_final_update_id !== previousFinalUpdateId) {
      gap = {
        event_index: eventIndex,
        expected_previous_final_update_id: previousFinalUpdateId,
        actual_previous_final_update_id: event.previous_final_update_id,
      }
      break
    }
    applyLevels(bids, event.bids)
    applyLevels(asks, event.asks)
    previousFinalUpdateId = event.final_update_id
    appliedEventCount += 1
  }

  const sortedBids = mapToLevels(bids, "desc")
  const sortedAsks = mapToLevels(asks, "asc")
  const bookHash = sha256(JSON.stringify({ asks: sortedAsks, bids: sortedBids }))
  return {
    status: gap == null ? "complete" : "incomplete",
    last_update_id: previousFinalUpdateId,
    applied_event_count: appliedEventCount,
    book_hash: bookHash,
    bids: sortedBids,
    asks: sortedAsks,
    ...(gap == null ? {} : { gap }),
  }
}

export function runBakeoff(raw: string, iterations: number): BakeoffResult {
  if (!Number.isSafeInteger(iterations) || iterations < 1) {
    throw new Error("iterations must be a positive safe integer")
  }
  const fixture = parseFixture(raw)
  let outcome: ProjectionOutcome | undefined
  const startedAt = process.hrtime.bigint()
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    outcome = projectFixture(fixture)
  }
  const elapsedNs = Number(process.hrtime.bigint() - startedAt)
  if (outcome == null) throw new Error("projection produced no outcome")
  return {
    schema_version: "trade.l2-bakeoff-result.v1",
    implementation: "bun",
    fixture_id: fixture.fixture_id,
    source_hash: sha256(raw),
    iterations,
    processed_event_count: outcome.applied_event_count * iterations,
    elapsed_ns: elapsedNs,
    outcome,
  }
}

function levelsToMap(levels: Level[]): Map<string, string> {
  const output = new Map<string, string>()
  applyLevels(output, levels)
  return output
}

function applyLevels(book: Map<string, string>, levels: Level[]): void {
  for (const [rawPrice, rawQuantity] of levels) {
    const price = normalizeDecimal(rawPrice)
    const quantity = normalizeDecimal(rawQuantity)
    if (quantity === "0") book.delete(price)
    else book.set(price, quantity)
  }
}

function mapToLevels(book: Map<string, string>, direction: "asc" | "desc"): Level[] {
  return [...book.entries()].sort((left, right) => {
    const comparison = compareDecimals(left[0], right[0])
    return direction === "asc" ? comparison : -comparison
  })
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function parseSnapshot(value: unknown): Snapshot {
  const snapshot = requireRecord(value, "snapshot")
  return {
    last_update_id: requireInteger(snapshot.last_update_id, "snapshot.last_update_id"),
    bids: parseLevels(snapshot.bids, "snapshot.bids"),
    asks: parseLevels(snapshot.asks, "snapshot.asks"),
  }
}

function parseEvent(value: unknown, index: number): DepthEvent {
  const event = requireRecord(value, `events[${index}]`)
  const localReceiveTimeMs = requireInteger(event.local_receive_time_ms, `events[${index}].local_receive_time_ms`)
  if (localReceiveTimeMs === 0) throw new Error(`events[${index}].local_receive_time_ms must be positive`)
  return {
    event_time_ms: requireInteger(event.event_time_ms, `events[${index}].event_time_ms`),
    transaction_time_ms: requireInteger(event.transaction_time_ms, `events[${index}].transaction_time_ms`),
    local_receive_time_ms: localReceiveTimeMs,
    first_update_id: requireInteger(event.first_update_id, `events[${index}].first_update_id`),
    final_update_id: requireInteger(event.final_update_id, `events[${index}].final_update_id`),
    previous_final_update_id: requireInteger(event.previous_final_update_id, `events[${index}].previous_final_update_id`),
    bids: parseLevels(event.bids, `events[${index}].bids`),
    asks: parseLevels(event.asks, `events[${index}].asks`),
  }
}

function parseOutcome(value: unknown): ProjectionOutcome {
  const outcome = requireRecord(value, "expected")
  if (outcome.status !== "complete" && outcome.status !== "incomplete") {
    throw new Error("expected.status must be complete or incomplete")
  }
  const gapValue = outcome.gap
  let gap: Gap | undefined
  if (gapValue != null) {
    const record = requireRecord(gapValue, "expected.gap")
    gap = {
      event_index: requireInteger(record.event_index, "expected.gap.event_index"),
      expected_previous_final_update_id: requireInteger(record.expected_previous_final_update_id, "expected.gap.expected_previous_final_update_id"),
      actual_previous_final_update_id: requireInteger(record.actual_previous_final_update_id, "expected.gap.actual_previous_final_update_id"),
    }
  }
  return {
    status: outcome.status,
    last_update_id: requireInteger(outcome.last_update_id, "expected.last_update_id"),
    applied_event_count: requireInteger(outcome.applied_event_count, "expected.applied_event_count"),
    book_hash: requireString(outcome.book_hash, "expected.book_hash"),
    bids: parseLevels(outcome.bids, "expected.bids"),
    asks: parseLevels(outcome.asks, "expected.asks"),
    ...(gap == null ? {} : { gap }),
  }
}

function parseLevels(value: unknown, path: string): Level[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
  return value.map((level, index) => {
    if (!Array.isArray(level) || level.length !== 2) {
      throw new Error(`${path}[${index}] must contain price and quantity`)
    }
    const price = requireString(level[0], `${path}[${index}][0]`)
    const quantity = requireString(level[1], `${path}[${index}][1]`)
    normalizeDecimal(price)
    normalizeDecimal(quantity)
    return [price, quantity]
  })
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be a non-empty string`)
  return value
}

function requireInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${path} must be a non-negative safe integer`)
  return value as number
}
