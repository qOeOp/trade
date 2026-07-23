import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import { buildCanonicalCandles, ensureOhlcvSchema, upsertCanonicalCandles } from "./market-data-store"
import { auditCanonicalCandleCoverage, compileOhlcvCoverageAudit } from "./ohlcv-coverage-audit"

test("OHLCV coverage audit reports exact leading, interior, and trailing gaps", () => {
  const db = new Database(":memory:")
  ensureOhlcvSchema(db)
  const hour = 3_600_000
  try {
    upsertCanonicalCandles(db, buildCanonicalCandles([0, 2, 3].map((offset) => ({
      manifest_id: "manifest-1",
      exchange: "binanceusdm",
      symbol: "BTCUSDT",
      timeframe: "1h",
      open_time: offset * hour,
      close_time: ((offset + 1) * hour) - 1,
      open: 1,
      high: 2,
      low: 1,
      close: 2,
    }))))
    const audit = auditCanonicalCandleCoverage(db, {
      exchange: "binanceusdm",
      symbol: "BTCUSDT",
      timeframe: "1h",
      start_open_time: 0,
      end_open_time: 5 * hour,
      observed_at: "2026-07-23T00:00:00.000Z",
    })
    assert.equal(audit.expected_count, 6)
    assert.equal(audit.actual_count, 3)
    assert.equal(audit.missing_count, 3)
    assert.deepEqual(audit.gap_ranges, [
      { start_open_time: hour, end_open_time: hour, missing_count: 1 },
      { start_open_time: 4 * hour, end_open_time: 5 * hour, missing_count: 2 },
    ])
    assert.equal(audit.complete, false)
    assert.match(audit.audit_hash, /^[a-f0-9]{64}$/)
    assert.equal(compileOhlcvCoverageAudit(audit).audit_hash, audit.audit_hash)
    assert.throws(() => compileOhlcvCoverageAudit({ ...audit, missing_count: 2 }), /closure/)
  } finally {
    db.close()
  }
})

test("OHLCV coverage audit is complete only for every aligned expected candle", () => {
  const db = new Database(":memory:")
  ensureOhlcvSchema(db)
  const hour = 3_600_000
  try {
    upsertCanonicalCandles(db, buildCanonicalCandles([0, 1].map((offset) => ({
      manifest_id: "manifest-2",
      exchange: "binanceusdm",
      symbol: "ETHUSDT",
      timeframe: "1h",
      open_time: offset * hour,
      close_time: ((offset + 1) * hour) - 1,
      open: 1,
      high: 2,
      low: 1,
      close: 2,
    }))))
    const audit = auditCanonicalCandleCoverage(db, {
      exchange: "binanceusdm",
      symbol: "ETHUSDT",
      timeframe: "1h",
      start_open_time: 0,
      end_open_time: hour,
      observed_at: "2026-07-23T00:00:00.000Z",
    })
    assert.equal(audit.complete, true)
    assert.deepEqual(audit.gap_ranges, [])
    assert.throws(() => auditCanonicalCandleCoverage(db, {
      exchange: "binanceusdm",
      symbol: "ETHUSDT",
      timeframe: "1h",
      start_open_time: 1,
      end_open_time: hour,
    }), /aligned/)
  } finally {
    db.close()
  }
})
