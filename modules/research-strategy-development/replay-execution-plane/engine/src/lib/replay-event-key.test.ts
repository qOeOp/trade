import { expect, test } from "bun:test"
import { compareReplayEventKeys, createReplayEventKey } from "./replay-event-key"

const key = (overrides: Partial<Parameters<typeof createReplayEventKey>[0]> = {}) => createReplayEventKey({
  event_time: "2026-07-14T08:00:00Z",
  boundary_phase: 20,
  source_sequence: 7,
  event_subphase: 2,
  stable_event_id: "event-a",
  ...overrides,
})

test("Replay EventKey is a deterministic lexicographic total order", () => {
  expect(compareReplayEventKeys(key(), key())).toBe(0)
  expect(compareReplayEventKeys(key(), key({ event_time: "2026-07-14T08:00:01Z" }))).toBeLessThan(0)
  expect(compareReplayEventKeys(key(), key({ boundary_phase: 90 }))).toBeLessThan(0)
  expect(compareReplayEventKeys(key(), key({ source_sequence: 8 }))).toBeLessThan(0)
  expect(compareReplayEventKeys(key(), key({ event_subphase: 3 }))).toBeLessThan(0)
  expect(compareReplayEventKeys(key(), key({ stable_event_id: "event-b" }))).toBeLessThan(0)
})

test("Replay EventKey rejects ambiguous or invalid ordering fields", () => {
  expect(() => key({ event_time: "2026-07-14 08:00:00" })).toThrow("RFC 3339 UTC")
  expect(() => key({ source_sequence: -1 })).toThrow("source_sequence")
  expect(() => key({ event_subphase: 0.5 })).toThrow("event_subphase")
  expect(() => key({ stable_event_id: "" })).toThrow("stable_event_id")
})
