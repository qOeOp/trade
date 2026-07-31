import { expect, test } from "bun:test"
import {
  assertFundingReplaySliceContent,
  buildFundingReplaySliceRef,
  compileFundingReplaySliceRef,
} from "./funding-replay-slice-contract"

const HASH = "a".repeat(64)
const EVENTS = [{
  timestamp: "2026-07-23T08:00:00.000Z",
  rate: 0.0001,
  mark_price: 119_000,
}]

test("funding Replay slice is content-addressed and keeps the terminal millisecond inside a half-open window", () => {
  const slice = buildFundingReplaySliceRef({
    symbol: "BTCUSDT",
    coverage_start: "2026-07-23T00:00:00.000Z",
    coverage_end: "2026-07-23T08:00:00.001Z",
    source_archive_id: "funding-archive:BTCUSDT:source",
    coverage_audit_hash: HASH,
    normalized_events_hash: HASH,
    events: EVENTS,
  })
  expect(slice.coverage.end_at).toBe("2026-07-23T08:00:00.001Z")
  expect(slice.last_event_at).toBe("2026-07-23T08:00:00.000Z")
  expect(slice.artifact_ref).toContain(slice.content_sha256)
  expect(compileFundingReplaySliceRef(slice)).toEqual(slice)
  expect(assertFundingReplaySliceContent(slice, EVENTS)).toEqual(EVENTS)
  expect(() => assertFundingReplaySliceContent(slice, [{
    ...EVENTS[0]!,
    mark_price: 0,
  }])).toThrow()
})

test("empty exact funding windows remain explicit Replay evidence", () => {
  const slice = buildFundingReplaySliceRef({
    symbol: "ETHUSDT",
    coverage_start: "2026-07-23T00:00:00.000Z",
    coverage_end: "2026-07-23T04:00:00.001Z",
    source_archive_id: "funding-archive:ETHUSDT:source",
    coverage_audit_hash: HASH,
    normalized_events_hash: HASH,
    events: [],
  })
  expect(slice.row_count).toBe(0)
  expect(slice.first_event_at).toBeNull()
  expect(assertFundingReplaySliceContent(slice, [])).toEqual([])
})
