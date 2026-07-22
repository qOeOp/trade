import assert from "node:assert/strict"
import test from "node:test"
import { buildL2OwnerBookWatch } from "./book-watch"

test("L2 owner watch preserves bounded latest-only watermark semantics", () => {
  const value = build(batch())
  assert.equal(value.event_count, 3)
  assert.equal(value.epoch_count, 2)
  assert.equal(value.resync_count, 1)
  assert.equal(value.final_state, "resync_required")
  assert.equal(value.query_deadline_ms, 1_750)
  assert.equal(value.transport_semantics, "latest_only_coalescing_watermark")
  assert.equal(value.execution_compatible, false)
})

test("L2 owner watch rejects regressions, silent rollover, and unbounded controls", () => {
  const source = batch()
  assert.throws(() => build({ ...source, max_events: 6 }), /request contract drifted/)
  assert.throws(() => build({ ...source, events: [source.events[1], source.events[0]] }), /publish time regressed/)
  assert.throws(() => build({ ...source, events: [source.events[0], { ...source.events[2], resync_required: false }] }), /without resync/)
  assert.throws(() => build({ ...source, events: [{ ...source.events[0], symbol: "ETHUSDT" }] }), /identity drifted/)
  assert.throws(() => build(source, 101), /max_events/)
})

function build(queryResult: unknown, maxEvents = 5) {
  return buildL2OwnerBookWatch({
    observed_at: "2026-07-22T13:00:01Z",
    expected_symbol: "BTCUSDT",
    max_events: maxEvents,
    watch_ms: 250,
    query_result: queryResult,
  })
}

function batch() {
  return {
    schema_version: "trade.l2-book-watch-batch.v1",
    symbol: "BTCUSDT",
    max_events: 5,
    watch_ms: 250,
    timed_out: true,
    events: [
      event("epoch-1", 100, 1000, false, "live"),
      event("epoch-1", 105, 1010, false, "live"),
      event("epoch-2", 200, 1020, true, "bridging"),
    ],
  }
}

function event(epoch: string, updateId: number, publishedAt: number, resync: boolean, continuity: string) {
  return {
    schema_version: "trade.l2-book-watermark.v1",
    symbol: "BTCUSDT",
    stream_epoch: epoch,
    last_update_id: updateId,
    local_receive_time_ms: publishedAt - 1,
    published_at_ms: publishedAt,
    continuity_status: continuity,
    resync_required: resync,
  }
}
