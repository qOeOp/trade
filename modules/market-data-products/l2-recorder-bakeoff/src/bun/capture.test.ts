import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"
import { buildCapturedFixture, parseDepthMessage, selectContinuousEvents, SequenceCaptureError } from "./capture"
import { parseFixture } from "./projector"

describe("public L2 fixture capture", () => {
  test("parses the routed combined stream envelope", () => {
    const event = parseDepthMessage(JSON.stringify({
      stream: "btcusdt@depth@100ms",
      data: { e: "depthUpdate", E: 200, T: 199, s: "BTCUSDT", U: 10, u: 12, pu: 9, b: [["100.0", "1"]], a: [] },
    }), "BTCUSDT", 202)
    expect(event).toEqual({
      event_time_ms: 200,
      transaction_time_ms: 199,
      local_receive_time_ms: 202,
      first_update_id: 10,
      final_update_id: 12,
      previous_final_update_id: 9,
      bids: [["100.0", "1"]],
      asks: [],
    })
  })

  test("selects a snapshot bridge and exact continuous window", () => {
    const fixture = parseFixture(readFileSync("fixtures/complete.json", "utf8"))
    expect(selectContinuousEvents(100, fixture.events, 2)).toEqual(fixture.events)
    const captured = buildCapturedFixture("BTCUSDT", fixture.snapshot, fixture.events, new Date("2026-07-22T00:00:00Z"))
    expect(captured.expected).toEqual(fixture.expected)
  })

  test("fails closed when pu does not equal the prior u", () => {
    const fixture = parseFixture(readFileSync("fixtures/gap.json", "utf8"))
    expect(() => selectContinuousEvents(100, fixture.events, 3)).toThrow(SequenceCaptureError)
  })

  test("rejects a foreign symbol", () => {
    expect(() => parseDepthMessage(JSON.stringify({
      stream: "ethusdt@depth@100ms",
      data: { e: "depthUpdate", E: 200, T: 199, s: "ETHUSDT", U: 10, u: 12, pu: 9, b: [], a: [] },
    }), "BTCUSDT", 202)).toThrow("unexpected depth symbol")
  })
})
