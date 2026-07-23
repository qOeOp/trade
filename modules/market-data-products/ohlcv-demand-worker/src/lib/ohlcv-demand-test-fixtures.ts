import { canonicalHash } from "../../../../contracts/runtime-core/src/canonical-json"
import {
  OHLCV_COVERAGE_AUDIT_SCHEMA,
  timeframeMilliseconds,
  type OhlcvCoverageAudit,
} from "../../../../contracts/market-data-demand-contract/src/ohlcv-coverage-contract"

export function emptyCoverageAudit(
  target: { symbol: string; timeframe: string; start_open_time: number; end_open_time: number },
  observedAt: string,
): OhlcvCoverageAudit {
  const timeframeMs = timeframeMilliseconds(target.timeframe)
  const expectedCount = ((target.end_open_time - target.start_open_time) / timeframeMs) + 1
  const withoutHash = {
    schema_version: OHLCV_COVERAGE_AUDIT_SCHEMA,
    observed_at: observedAt,
    exchange: "binanceusdm",
    symbol: target.symbol,
    timeframe: target.timeframe,
    timeframe_ms: timeframeMs,
    requested_open_range: {
      start_open_time: target.start_open_time,
      end_open_time: target.end_open_time,
    },
    expected_count: expectedCount,
    actual_count: 0,
    missing_count: expectedCount,
    gap_range_count: 1,
    gap_ranges_truncated: false,
    gap_ranges: [{
      start_open_time: target.start_open_time,
      end_open_time: target.end_open_time,
      missing_count: expectedCount,
    }],
    first_open_time: null,
    last_open_time: null,
    complete: false,
    source_ref: `ohlcv_store:canonical_candle/binanceusdm/${target.symbol}/${target.timeframe}`,
  }
  return { ...withoutHash, audit_hash: canonicalHash(withoutHash) }
}
