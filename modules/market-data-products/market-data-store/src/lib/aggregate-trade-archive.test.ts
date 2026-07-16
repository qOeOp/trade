import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import { canonicalHash } from "../../../../contracts/runtime-core/src/canonical-json"
import {
  assertAggregateTradeArchive,
  commitAggregateTradeArchive,
  createAggregateTradeArchive,
  ensureAggregateTradeArchiveSchema,
  readAggregateTradeArchive,
} from "./aggregate-trade-archive"

const COVERAGE_START = "2026-07-15T00:00:00Z"
const COVERAGE_END = "2026-07-15T00:01:00Z"
const IMPORTED_AT = "2026-07-15T00:02:00Z"

function payload(ids = [700, 701, 702]): string {
  const prices = [100, 102, 95]
  return JSON.stringify(ids.map((id, index) => ({
    a: id,
    p: String(prices[index]),
    q: "1.25",
    f: 900 + index,
    l: 900 + index,
    T: Date.parse(COVERAGE_START) + 1_000 + index * 100,
    m: index % 2 === 0,
  })))
}

function archive(rawPayload = payload()) {
  return createAggregateTradeArchive({
    archive_id: "binance-usdm-btc-aggtrades-minute-1",
    receipt_id: "offline-aggtrades-minute-1",
    symbol: "BTCUSDT",
    endpoint: "offline-import:binance-usdm-aggtrades",
    coverage_start: COVERAGE_START,
    coverage_end: COVERAGE_END,
    source_observed_through: COVERAGE_END,
    imported_at: IMPORTED_AT,
    source_ref: "venue-archive:binance-usdm:BTCUSDT:minute-1",
    raw_payload: rawPayload,
  })
}

test("aggregate trade archive preserves raw bytes and create-or-identical semantics", () => {
  const db = new Database(":memory:")
  ensureAggregateTradeArchiveSchema(db)
  const rawPayload = payload()
  const value = archive(rawPayload)
  try {
    assert.equal(commitAggregateTradeArchive(db, value, rawPayload), "created")
    assert.equal(commitAggregateTradeArchive(db, value, rawPayload), "existing")
    assert.deepEqual(readAggregateTradeArchive(db, value.archive_id), value)
    assert.throws(() => commitAggregateTradeArchive(db, value, `${rawPayload} `), /hash or byte count mismatch/)
    const conflicting = createAggregateTradeArchive({
      archive_id: value.archive_id,
      receipt_id: "offline-aggtrades-minute-1-correction",
      symbol: "BTCUSDT",
      endpoint: "offline-import:binance-usdm-aggtrades",
      coverage_start: COVERAGE_START,
      coverage_end: COVERAGE_END,
      source_observed_through: COVERAGE_END,
      imported_at: "2026-07-15T00:03:00Z",
      source_ref: "venue-archive:binance-usdm:BTCUSDT:minute-1-correction",
      raw_payload: rawPayload,
    })
    assert.throws(() => commitAggregateTradeArchive(db, conflicting, rawPayload), /different content/)
  } finally {
    db.close()
  }
})

test("aggregate trade archive rejects sequence gaps, window drift, and hash-recomputed tamper", () => {
  assert.throws(() => archive(payload([700, 702, 703])), /contiguous ids/)
  const outsidePayload = JSON.stringify([{
    a: 700, p: "100", q: "1", f: 900, l: 900,
    T: Date.parse(COVERAGE_END), m: true,
  }])
  assert.throws(() => archive(outsidePayload), /half-open coverage/)
  const value = archive()
  const semanticTamper = {
    ...value,
    availability_policy: "measured-wire-latency",
  }
  const { archive_hash: _archiveHash, ...body } = semanticTamper
  assert.throws(() => assertAggregateTradeArchive({
    ...semanticTamper,
    archive_hash: canonicalHash(body),
  } as typeof value), /unsupported aggregate trade archive policy/)
})

test("aggregate trade archive read detects persisted raw-payload tamper", () => {
  const db = new Database(":memory:")
  const rawPayload = payload()
  const value = archive(rawPayload)
  try {
    commitAggregateTradeArchive(db, value, rawPayload)
    db.query("UPDATE aggregate_trade_archive SET raw_payload = $payload WHERE archive_id = $archive_id").run({
      $payload: new TextEncoder().encode(payload([800, 801, 802])),
      $archive_id: value.archive_id,
    })
    assert.throws(() => readAggregateTradeArchive(db, value.archive_id), /hash or byte count mismatch/)
  } finally {
    db.close()
  }
})
