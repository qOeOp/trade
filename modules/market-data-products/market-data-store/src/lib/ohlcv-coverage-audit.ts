import type { Database } from "bun:sqlite"
import { canonicalHash } from "../../../../contracts/runtime-core/src/canonical-json"
import {
  alignedTimestamp,
  canonicalTime,
  compileOhlcvCoverageAudit,
  identifier,
  integer,
  OHLCV_COVERAGE_AUDIT_SCHEMA,
  timeframeMilliseconds,
  venueSymbol,
  type OhlcvCoverageAudit,
} from "../../../../contracts/market-data-demand-contract/src/ohlcv-coverage-contract"

export {
  compileOhlcvCoverageAudit,
  OHLCV_COVERAGE_AUDIT_SCHEMA,
  timeframeMilliseconds,
  type OhlcvCoverageAudit,
}

export function auditCanonicalCandleCoverage(
  db: Database,
  input: {
    exchange: string
    symbol: string
    timeframe: string
    start_open_time: number
    end_open_time: number
    max_gap_ranges?: number
    observed_at?: string
  },
): OhlcvCoverageAudit {
  const exchange = identifier(input.exchange, "exchange")
  const symbol = venueSymbol(input.symbol)
  const timeframeMs = timeframeMilliseconds(input.timeframe)
  const start = alignedTimestamp(input.start_open_time, timeframeMs, "start_open_time")
  const end = alignedTimestamp(input.end_open_time, timeframeMs, "end_open_time")
  if (end < start) throw new Error("OHLCV coverage end_open_time precedes start_open_time")
  const expectedCount = ((end - start) / timeframeMs) + 1
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 1 || expectedCount > 2_000_000) {
    throw new Error("OHLCV coverage audit range is outside the bounded row limit")
  }
  const maxGapRanges = integer(input.max_gap_ranges ?? 100, 1, 1_000, "max_gap_ranges")
  const observedAt = canonicalTime(input.observed_at ?? new Date().toISOString())
  const rows = db.query(`
    SELECT open_time
    FROM canonical_candle
    WHERE exchange = $exchange
      AND symbol = $symbol
      AND timeframe = $timeframe
      AND open_time >= $start_open_time
      AND open_time <= $end_open_time
    ORDER BY open_time
  `).all({
    $exchange: exchange,
    $symbol: symbol,
    $timeframe: input.timeframe,
    $start_open_time: start,
    $end_open_time: end,
  }) as Array<{ open_time: number }>
  let cursor = start
  let missingCount = 0
  let gapRangeCount = 0
  const gapRanges: OhlcvCoverageAudit["gap_ranges"] = []
  for (const row of rows) {
    const openTime = alignedTimestamp(row.open_time, timeframeMs, "stored open_time")
    if (openTime < cursor) throw new Error("canonical candle ordering or identity drifted")
    if (openTime > cursor) {
      const count = (openTime - cursor) / timeframeMs
      missingCount += count
      gapRangeCount += 1
      if (gapRanges.length < maxGapRanges) {
        gapRanges.push({
          start_open_time: cursor,
          end_open_time: openTime - timeframeMs,
          missing_count: count,
        })
      }
    }
    cursor = openTime + timeframeMs
  }
  if (cursor <= end) {
    const count = ((end - cursor) / timeframeMs) + 1
    missingCount += count
    gapRangeCount += 1
    if (gapRanges.length < maxGapRanges) {
      gapRanges.push({ start_open_time: cursor, end_open_time: end, missing_count: count })
    }
  }
  const withoutHash = {
    schema_version: OHLCV_COVERAGE_AUDIT_SCHEMA,
    observed_at: observedAt,
    exchange,
    symbol,
    timeframe: input.timeframe,
    timeframe_ms: timeframeMs,
    requested_open_range: { start_open_time: start, end_open_time: end },
    expected_count: expectedCount,
    actual_count: rows.length,
    missing_count: missingCount,
    gap_range_count: gapRangeCount,
    gap_ranges_truncated: gapRangeCount > gapRanges.length,
    gap_ranges: gapRanges,
    first_open_time: rows[0]?.open_time ?? null,
    last_open_time: rows.at(-1)?.open_time ?? null,
    complete: missingCount === 0 && rows.length === expectedCount,
    source_ref: `ohlcv_store:canonical_candle/${exchange}/${symbol}/${input.timeframe}`,
  }
  return { ...withoutHash, audit_hash: canonicalHash(withoutHash) }
}
