import assert from "node:assert/strict"
import test from "node:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  assertFundingReplaySliceContent,
} from "../../../../contracts/market-data-demand-contract/src/funding-replay-slice-contract"
import {
  commitFundingAcquisition,
  ensureFundingEventArchiveSchema,
  exportFundingReplaySlice,
  readFundingArchiveEvents,
  readFundingCoverageAudit,
  resolveFundingCoverage,
} from "./funding-event-archive"

test("funding acquisition preserves raw pages and admits immutable exact-window evidence", () => {
  const db = new Database(":memory:")
  ensureFundingEventArchiveSchema(db)
  const page = JSON.stringify([
    { symbol: "BTCUSDT", fundingTime: Date.parse("2026-07-22T16:00:00.000Z"), fundingRate: "0.00010000", markPrice: "118000.10" },
    { symbol: "BTCUSDT", fundingTime: Date.parse("2026-07-23T00:00:00.000Z"), fundingRate: "-0.00002000", markPrice: "119000.20" },
  ])
  const input = {
    symbol: "BTCUSDT",
    coverage_start: "2026-07-22T00:00:00.000Z",
    coverage_end: "2026-07-23T08:00:00.000Z",
    pages: [{
      requested_start_ms: Date.parse("2026-07-22T00:00:00.000Z"),
      requested_end_ms: Date.parse("2026-07-23T08:00:00.000Z") - 1,
      response_body: page,
    }],
    acquired_at: "2026-07-23T08:00:01.000Z",
  }
  const created = commitFundingAcquisition(db, input)
  assert.equal(created.commit_status, "created")
  assert.equal(commitFundingAcquisition(db, input).commit_status, "existing")
  assert.deepEqual(readFundingCoverageAudit(db, created.archive_id), created.audit)
  assert.equal(resolveFundingCoverage(db, {
    symbol: input.symbol,
    coverage_start: input.coverage_start,
    coverage_end: input.coverage_end,
  }).status, "ready")
  assert.deepEqual(readFundingArchiveEvents(db, created.archive_id), [{
    event_ordinal: 0,
    timestamp: "2026-07-22T16:00:00.000Z",
    rate: "0.00010000",
    mark_price: "118000.10",
  }, {
    event_ordinal: 1,
    timestamp: "2026-07-23T00:00:00.000Z",
    rate: "-0.00002000",
    mark_price: "119000.20",
  }])
  assert.throws(() => db.run("DELETE FROM funding_event_archive_event"), /immutable/)
  db.close()
})

test("funding owner exports one immutable Replay-ready exact-window slice", () => {
  const db = new Database(":memory:")
  const root = mkdtempSync(join(tmpdir(), "funding-replay-slice-"))
  ensureFundingEventArchiveSchema(db)
  try {
    const end = "2026-07-23T08:00:00.001Z"
    const committed = commitFundingAcquisition(db, {
      symbol: "BTCUSDT",
      coverage_start: "2026-07-23T00:00:00.000Z",
      coverage_end: end,
      pages: [{
        requested_start_ms: Date.parse("2026-07-23T00:00:00.000Z"),
        requested_end_ms: Date.parse(end) - 1,
        response_body: JSON.stringify([{
          fundingTime: Date.parse("2026-07-23T08:00:00.000Z"),
          fundingRate: "0.00010000",
          markPrice: "119000.20",
        }]),
      }],
      acquired_at: "2026-07-23T08:00:01.000Z",
    })
    const slice = exportFundingReplaySlice(db, {
      repository_root: root,
      archive_id: committed.archive_id,
    })
    const events = JSON.parse(
      readFileSync(join(root, slice.artifact_ref), "utf8"),
    )
    assert.deepEqual(assertFundingReplaySliceContent(slice, events), [{
      timestamp: "2026-07-23T08:00:00.000Z",
      rate: 0.0001,
      mark_price: 119000.2,
    }])
    assert.deepEqual(exportFundingReplaySlice(db, {
      repository_root: root,
      archive_id: committed.archive_id,
    }), slice)
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test("funding acquisition rejects non-exhausted, reordered, and out-of-window evidence", () => {
  const db = new Database(":memory:")
  ensureFundingEventArchiveSchema(db)
  const base = {
    symbol: "BTCUSDT",
    coverage_start: "2026-07-22T00:00:00.000Z",
    coverage_end: "2026-07-23T08:00:00.000Z",
    acquired_at: "2026-07-23T08:00:01.000Z",
  }
  assert.throws(() => commitFundingAcquisition(db, {
    ...base,
    pages: [{
      requested_start_ms: Date.parse(base.coverage_start),
      requested_end_ms: Date.parse(base.coverage_end) - 1,
      response_body: JSON.stringify(Array.from({ length: 1_000 }, (_, index) => ({
        fundingTime: Date.parse(base.coverage_start) + index,
        fundingRate: "0",
      }))),
    }],
  }), /terminal page exhaustion/)
  assert.throws(() => commitFundingAcquisition(db, {
    ...base,
    pages: [{
      requested_start_ms: Date.parse(base.coverage_start),
      requested_end_ms: Date.parse(base.coverage_end) - 1,
      response_body: JSON.stringify([
        { fundingTime: Date.parse("2026-07-23T00:00:00.000Z"), fundingRate: "0" },
        { fundingTime: Date.parse("2026-07-22T16:00:00.000Z"), fundingRate: "0" },
      ]),
    }],
  }), /strictly ordered/)
  db.close()
})
