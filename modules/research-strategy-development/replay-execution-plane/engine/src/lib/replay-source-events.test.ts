import { expect, test } from "bun:test"
import { compareReplayEventKeys } from "./replay-event-key"
import { buildReplaySourceEvents } from "./replay-source-events"

test("source-event merge orders funding before market at the same timestamp", () => {
  const events = buildReplaySourceEvents({
    bars: [{
      open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z",
      open: 100, high: 110, low: 90, close: 105, volume: 10, closed: true,
    }],
    funding_events: [{ timestamp: "2026-07-14T04:00:00Z", rate: 0.001, mark_price: 100 }],
    start_time: "2026-07-14T04:00:00Z",
    end_time: "2026-07-14T08:00:00Z",
  })
  expect(events.map((event) => event.kind)).toEqual(["funding", "bar_open", "bar_range"])
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
    delisted_at: "2026-07-14T08:00:00Z",
    start_time: "2026-07-14T04:00:00Z",
    end_time: "2026-07-14T08:00:00Z",
  })
  expect(events.map((event) => event.kind)).toEqual(["bar_open", "instrument_delisted", "funding", "bar_range"])
  expect(events[1].event_key.boundary_phase).toBe(0)
})
