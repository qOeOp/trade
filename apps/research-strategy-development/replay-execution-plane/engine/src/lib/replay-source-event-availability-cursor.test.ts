import { expect, test } from "bun:test"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplaySourceEventAvailabilityCursor,
} from "../../../contracts/src/lib/replay-source-event-availability-cursor"
import { replaySourceEventWireTestFixture } from "../../../data-adapter/src/lib/replay-cross-source-test-fixture"
import { evaluateReplaySourceEventWirePreExecutionGate } from "../../../data-adapter/src/lib/replay-source-event-wire-gate"
import { reduceReplaySourceEventWireCandidateSchedule } from "./replay-source-event-wire-candidate-reducer"
import {
  assertReplaySourceEventAvailabilityCursorLineage,
  buildReplaySourceEventAvailabilityCursor,
  replaySourceEventTransitionsVisibleAt,
  type ReplaySourceEventAvailabilityCursorInput,
} from "./replay-source-event-availability-cursor"

function cursorInput(exact = false): ReplaySourceEventAvailabilityCursorInput {
  const fixture = replaySourceEventWireTestFixture({ exact })
  const preExecutionGate = evaluateReplaySourceEventWirePreExecutionGate({
    wire_manifest: fixture.wire_manifest,
    ordering_attestation: fixture.ordering_attestation,
    requested_capability: "non_economic_schedule_trace",
  })
  const candidateTrace = reduceReplaySourceEventWireCandidateSchedule({
    wire_manifest: fixture.wire_manifest,
    ordering_attestation: fixture.ordering_attestation,
    pre_execution_gate: preExecutionGate,
  })
  return {
    wire_manifest: fixture.wire_manifest,
    ordering_attestation: fixture.ordering_attestation,
    pre_execution_gate: preExecutionGate,
    candidate_trace: candidateTrace,
  }
}

test("availability cursor withholds a delayed fact until observation without retroactive execution", () => {
  const input = cursorInput()
  const cursor = buildReplaySourceEventAvailabilityCursor(input)
  const replayed = buildReplaySourceEventAvailabilityCursor(structuredClone(input))

  expect(() => assertReplaySourceEventAvailabilityCursor(cursor)).not.toThrow()
  expect(() => assertReplaySourceEventAvailabilityCursorLineage(cursor, input)).not.toThrow()
  expect(replayed.cursor_hash).toBe(cursor.cursor_hash)
  expect(cursor.delayed_visibility_count).toBe(1)
  const status = cursor.visibility_transitions.find((item) => item.source_kind === "instrument_status")!
  expect(status.visibility_class).toBe("delayed_historical_fact")
  expect(status.availability_lag_ms).toBe(500)
  expect(status.visibility_ordinal).toBe(3)
  expect(status.retroactive_execution_effect).toBe("none")
  expect(replaySourceEventTransitionsVisibleAt(cursor, "2026-07-14T04:00:00Z")
    .map((item) => item.source_kind)).toEqual(["funding", "aggregate_trade", "ohlcv"])
  expect(replaySourceEventTransitionsVisibleAt(cursor, "2026-07-14T04:00:00.500Z")
    .map((item) => item.source_kind)).toEqual(["funding", "aggregate_trade", "ohlcv", "instrument_status"])
  expect(cursor.economic_authority).toBe("none")
  expect(cursor.retroactive_execution).toBe("forbidden")
})

test("availability cursor preserves the effective trace while exact input has no delayed visibility", () => {
  const input = cursorInput(true)
  const cursor = buildReplaySourceEventAvailabilityCursor(input)
  expect(cursor.delayed_visibility_count).toBe(0)
  expect(cursor.effective_timeline_hash).toBe(input.candidate_trace.trace_events_hash)
  expect(cursor.visibility_transitions.map((item) => item.wire_event_id))
    .toEqual(input.candidate_trace.trace_events.map((item) => item.wire_event_id))
  expect(cursor.visibility_transitions.every((item) => item.visibility_class === "effective_immediate")).toBeTrue()
})

test("availability cursor rejects a rehashed attempt to reveal delayed status early", () => {
  const input = cursorInput()
  const cursor = buildReplaySourceEventAvailabilityCursor(input)
  const drifted = structuredClone(cursor)
  const statusIndex = drifted.visibility_transitions.findIndex((item) => item.source_kind === "instrument_status")
  const status = drifted.visibility_transitions[statusIndex]!
  status.availability_at = status.effective_time
  status.availability_lag_ms = 0
  status.visibility_class = "effective_immediate"
  status.availability_key.visible_at = status.effective_time
  drifted.visibility_transitions.splice(statusIndex, 1)
  drifted.visibility_transitions.unshift(status)
  drifted.visibility_transitions.forEach((item, index) => { item.visibility_ordinal = index })
  drifted.delayed_visibility_count = 0
  drifted.visibility_timeline_hash = canonicalHash(drifted.visibility_transitions)
  const { cursor_hash: _cursorHash, ...body } = drifted
  drifted.cursor_hash = canonicalHash(body)

  expect(() => assertReplaySourceEventAvailabilityCursor(drifted)).not.toThrow()
  expect(() => assertReplaySourceEventAvailabilityCursorLineage(drifted, input)).toThrow("transition lineage")
})
