import { expect, test } from "bun:test"
import { compareReplayEventKeys } from "./replay-event-key"
import { buildReplaySourceEvents } from "./replay-source-events"

test("source-event merge orders funding then mark before market at the same timestamp", () => {
  const events = buildReplaySourceEvents({
    bars: [{
      open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z",
      open: 100, high: 110, low: 90, close: 105, volume: 10, closed: true,
    }],
    funding_events: [{ timestamp: "2026-07-14T04:00:00Z", rate: 0.001, mark_price: 100 }],
    mark_events: [{ timestamp: "2026-07-14T04:00:00Z", available_at: "2026-07-14T04:00:00Z", source_sequence: 1, mark_price: 100 }],
    start_time: "2026-07-14T04:00:00Z",
    end_time: "2026-07-14T08:00:00Z",
  })
  expect(events.map((event) => event.kind)).toEqual(["funding", "mark", "bar_open", "bar_range"])
  expect(events.slice(0, 3).map((event) => event.event_key.boundary_phase)).toEqual([10, 15, 20])
  for (let index = 1; index < events.length; index += 1) {
    expect(compareReplayEventKeys(events[index - 1].event_key, events[index].event_key)).toBeLessThan(0)
  }
})

test("instrument delisting precedes funding and market facts at the same timestamp", () => {
  const events = buildReplaySourceEvents({
    bars: [{
      open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z",
      open: 100, high: 110, low: 90, close: 105, volume: 10, closed: true,
    }],
    funding_events: [{ timestamp: "2026-07-14T08:00:00Z", rate: 0.001, mark_price: 105 }],
    mark_events: [],
    delisted_at: "2026-07-14T08:00:00Z",
    start_time: "2026-07-14T04:00:00Z",
    end_time: "2026-07-14T08:00:00Z",
  })
  expect(events.map((event) => event.kind)).toEqual(["bar_open", "instrument_delisted", "funding", "bar_range"])
  expect(events[1].event_key.boundary_phase).toBe(0)
})

test("instrument status transitions precede funding and market while delisting remains terminal-first", () => {
  const transitionTime = "2026-07-14T08:00:00Z"
  const events = buildReplaySourceEvents({
    bars: [{
      open_time: "2026-07-14T04:00:00Z", close_time: transitionTime,
      open: 100, high: 104, low: 98, close: 101, volume: 10, closed: true,
    }],
    funding_events: [{ timestamp: transitionTime, rate: 0.001, mark_price: 101 }],
    mark_events: [],
    instrument_status_epochs: [
      { schema_version: "trade.rd-replay-instrument-status-snapshot.v1", snapshot_id: "status-trading", venue_id: "binance-usdm", symbol: "BTCUSDT", status: "trading", effective_at: "2020-01-01T00:00:00Z", valid_until: transitionTime, observed_at: "2026-07-13T00:00:00Z", source_ref: "fixture:status-trading", source_hash: "a".repeat(64) },
      { schema_version: "trade.rd-replay-instrument-status-snapshot.v1", snapshot_id: "status-halted", venue_id: "binance-usdm", symbol: "BTCUSDT", status: "halted", effective_at: transitionTime, valid_until: null, observed_at: "2026-07-13T00:00:00Z", source_ref: "fixture:status-halted", source_hash: "b".repeat(64) },
    ],
    delisted_at: transitionTime,
    start_time: "2026-07-14T04:00:00Z",
    end_time: transitionTime,
  })
  expect(events.map((event) => event.kind)).toEqual([
    "bar_open", "instrument_delisted", "instrument_halted", "funding", "bar_range",
  ])
  expect(events.slice(1, 3).map((event) => event.event_key.boundary_phase)).toEqual([0, 0])
  expect(events[2].instrument_status_snapshot_id).toBe("status-halted")
})
