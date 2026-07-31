import { canonicalHash } from "../../runtime-core/src/canonical-json"

export const OHLCV_COVERAGE_AUDIT_SCHEMA = "trade.ohlcv-coverage-audit.v1" as const

export interface OhlcvCoverageAudit {
  schema_version: typeof OHLCV_COVERAGE_AUDIT_SCHEMA
  observed_at: string
  exchange: string
  symbol: string
  timeframe: string
  timeframe_ms: number
  requested_open_range: { start_open_time: number; end_open_time: number }
  expected_count: number
  actual_count: number
  missing_count: number
  gap_range_count: number
  gap_ranges_truncated: boolean
  gap_ranges: Array<{ start_open_time: number; end_open_time: number; missing_count: number }>
  first_open_time: number | null
  last_open_time: number | null
  complete: boolean
  source_ref: string
  audit_hash: string
}

export function compileOhlcvCoverageAudit(value: unknown): OhlcvCoverageAudit {
  const input = record(value, "OHLCV coverage audit")
  exact(input, [
    "schema_version", "observed_at", "exchange", "symbol", "timeframe", "timeframe_ms",
    "requested_open_range", "expected_count", "actual_count", "missing_count",
    "gap_range_count", "gap_ranges_truncated", "gap_ranges", "first_open_time",
    "last_open_time", "complete", "source_ref", "audit_hash",
  ])
  if (input.schema_version !== OHLCV_COVERAGE_AUDIT_SCHEMA) throw new Error("OHLCV coverage audit schema is unsupported")
  const exchange = identifier(String(input.exchange), "exchange")
  const symbol = venueSymbol(String(input.symbol))
  const timeframe = String(input.timeframe)
  const timeframeMs = timeframeMilliseconds(timeframe)
  if (input.timeframe_ms !== timeframeMs) throw new Error("OHLCV coverage audit timeframe_ms drifted")
  const requestedRange = record(input.requested_open_range, "requested_open_range")
  exact(requestedRange, ["start_open_time", "end_open_time"])
  const start = alignedTimestamp(Number(requestedRange.start_open_time), timeframeMs, "start_open_time")
  const end = alignedTimestamp(Number(requestedRange.end_open_time), timeframeMs, "end_open_time")
  const expectedCount = ((end - start) / timeframeMs) + 1
  if (input.expected_count !== expectedCount) throw new Error("OHLCV coverage audit expected_count drifted")
  const actualCount = integer(Number(input.actual_count), 0, expectedCount, "actual_count")
  const missingCount = integer(Number(input.missing_count), 0, expectedCount, "missing_count")
  const gapRangeCount = integer(Number(input.gap_range_count), 0, expectedCount, "gap_range_count")
  if (actualCount + missingCount !== expectedCount) throw new Error("OHLCV coverage audit count closure drifted")
  if (typeof input.gap_ranges_truncated !== "boolean" || typeof input.complete !== "boolean") {
    throw new Error("OHLCV coverage audit boolean field drifted")
  }
  const gapsInput = Array.isArray(input.gap_ranges) ? input.gap_ranges : []
  const gapRanges = gapsInput.map((item, index) => {
    const gap = record(item, `gap_ranges[${index}]`)
    exact(gap, ["start_open_time", "end_open_time", "missing_count"])
    const gapStart = alignedTimestamp(Number(gap.start_open_time), timeframeMs, "gap start_open_time")
    const gapEnd = alignedTimestamp(Number(gap.end_open_time), timeframeMs, "gap end_open_time")
    const count = ((gapEnd - gapStart) / timeframeMs) + 1
    if (gapStart < start || gapEnd > end || gapEnd < gapStart || gap.missing_count !== count) {
      throw new Error("OHLCV coverage audit gap range drifted")
    }
    return { start_open_time: gapStart, end_open_time: gapEnd, missing_count: count }
  })
  if ((!input.gap_ranges_truncated && gapRanges.length !== gapRangeCount)
    || (input.gap_ranges_truncated && gapRanges.length >= gapRangeCount)) {
    throw new Error("OHLCV coverage audit gap truncation drifted")
  }
  if (input.complete !== (missingCount === 0 && actualCount === expectedCount)
    || (input.complete && gapRangeCount !== 0)) {
    throw new Error("OHLCV coverage audit completeness drifted")
  }
  const sourceRef = `ohlcv_store:canonical_candle/${exchange}/${symbol}/${timeframe}`
  if (input.source_ref !== sourceRef) throw new Error("OHLCV coverage audit source_ref drifted")
  const nullableTimestamp = (item: unknown, field: string): number | null => (
    item === null ? null : alignedTimestamp(Number(item), timeframeMs, field)
  )
  const withoutHash = {
    schema_version: OHLCV_COVERAGE_AUDIT_SCHEMA,
    observed_at: canonicalTime(String(input.observed_at)),
    exchange,
    symbol,
    timeframe,
    timeframe_ms: timeframeMs,
    requested_open_range: { start_open_time: start, end_open_time: end },
    expected_count: expectedCount,
    actual_count: actualCount,
    missing_count: missingCount,
    gap_range_count: gapRangeCount,
    gap_ranges_truncated: input.gap_ranges_truncated,
    gap_ranges: gapRanges,
    first_open_time: nullableTimestamp(input.first_open_time, "first_open_time"),
    last_open_time: nullableTimestamp(input.last_open_time, "last_open_time"),
    complete: input.complete,
    source_ref: sourceRef,
  }
  if (!/^[a-f0-9]{64}$/.test(String(input.audit_hash))
    || canonicalHash(withoutHash) !== input.audit_hash) {
    throw new Error("OHLCV coverage audit hash drifted")
  }
  return { ...withoutHash, audit_hash: String(input.audit_hash) }
}

export function timeframeMilliseconds(value: string): number {
  const match = /^(1|3|5|15|30)m$|^(1|2|4|6|8|12)h$|^1d$/.exec(value)
  if (!match) throw new Error("OHLCV timeframe is unsupported")
  const unit = value.at(-1)
  const amount = Number(value.slice(0, -1))
  return amount * (unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000)
}

export function alignedTimestamp(value: number, quantum: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value % quantum !== 0) {
    throw new Error(`${field} must be a non-negative timeframe-aligned integer`)
  }
  return value
}

export function integer(value: number, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

export function identifier(value: string, field: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/.test(value)) throw new Error(`${field} is invalid`)
  return value
}

export function venueSymbol(value: string): string {
  if (!/^[A-Z0-9]{5,20}$/.test(value)) throw new Error("symbol is invalid")
  return value
}

export function canonicalTime(value: string): string {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error("observed_at must be canonical UTC time")
  }
  return value
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, fields: string[]): void {
  const allowed = new Set(fields)
  const unknown = Object.keys(value).filter((field) => !allowed.has(field))
  const missing = fields.filter((field) => !Object.hasOwn(value, field))
  if (unknown.length > 0 || missing.length > 0) throw new Error("OHLCV coverage audit shape drifted")
}
