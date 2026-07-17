import { expect, test } from "bun:test"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplaySourceEventPitPayloadView,
  replaySourceEventPitPayloadCounts,
} from "../../../contracts/src/lib/replay-source-event-pit-payload-view"
import { replaySourceEventWireTestFixture } from "../../../data-adapter/src/lib/replay-cross-source-test-fixture"
import { evaluateReplaySourceEventWirePreExecutionGate } from "../../../data-adapter/src/lib/replay-source-event-wire-gate"
import { buildReplaySourceEventAvailabilityCursor } from "./replay-source-event-availability-cursor"
import { reduceReplaySourceEventWireCandidateSchedule } from "./replay-source-event-wire-candidate-reducer"
import {
  assertReplaySourceEventPitPayloadViewLineage,
  buildReplaySourceEventPitPayloadView,
  type ReplaySourceEventPitPayloadViewInput,
} from "./replay-source-event-pit-payload-view"
import { buildReplaySourceEventVisibilityCut } from "./replay-source-event-visibility-cut"

function payloadViewInput(asOfTime: string): ReplaySourceEventPitPayloadViewInput {
  const fixture = replaySourceEventWireTestFixture()
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
  const cursorInput = {
    wire_manifest: fixture.wire_manifest,
    ordering_attestation: fixture.ordering_attestation,
    pre_execution_gate: preExecutionGate,
    candidate_trace: candidateTrace,
  }
  const availabilityCursor = buildReplaySourceEventAvailabilityCursor(cursorInput)
  const cutInput = { ...cursorInput, availability_cursor: availabilityCursor, as_of_time: asOfTime }
  return {
    ...cutInput,
    visibility_cut: buildReplaySourceEventVisibilityCut(cutInput),
  }
}

test("PIT payload view materializes exactly the visible Cut members and no future payload", () => {
  const input = payloadViewInput("2026-07-14T04:00:00Z")
  const view = buildReplaySourceEventPitPayloadView(input)
  const replayed = buildReplaySourceEventPitPayloadView(structuredClone(input))

  expect(() => assertReplaySourceEventPitPayloadView(view)).not.toThrow()
  expect(() => assertReplaySourceEventPitPayloadViewLineage(view, input)).not.toThrow()
  expect(replayed.view_hash).toBe(view.view_hash)
  expect(view.records.map((record) => record.source_kind)).toEqual(["funding", "aggregate_trade", "ohlcv"])
  expect(view.records.some((record) => record.source_kind === "instrument_status")).toBeFalse()
  expect(view.future_transition_count).toBe(2)
  expect(view.future_payload_materialization).toBe("forbidden")
  expect(view.decision_authority).toBe("none")
  expect(view.harness_compatibility).toBe("not_bound")
})

test("PIT payload view admits delayed status only at availability and preserves an empty view", () => {
  const boundary = buildReplaySourceEventPitPayloadView(payloadViewInput("2026-07-14T04:00:00.500Z"))
  const status = boundary.records.find((record) => record.source_kind === "instrument_status")!
  expect(status.visibility_class).toBe("delayed_historical_fact")
  expect(status.availability_at).toBe("2026-07-14T04:00:00.500Z")
  expect(status.payload_access).toBe("visible_at_cut")

  const empty = buildReplaySourceEventPitPayloadView(payloadViewInput("2026-07-14T03:59:59.999Z"))
  expect(empty.records).toEqual([])
  expect(empty.payloads_hash).toBe(canonicalHash([]))
  expect(empty.future_transition_count).toBe(5)
})

test("PIT payload view rejects a rehashed payload substitution against Wire lineage", () => {
  const input = payloadViewInput("2026-07-14T04:00:00Z")
  const view = buildReplaySourceEventPitPayloadView(input)
  const drifted = structuredClone(view)
  const funding = drifted.records.find((record) => record.source_kind === "funding")!
  ;(funding.payload as { rate: number }).rate = 0.5
  funding.payload_hash = canonicalHash(funding.payload)
  drifted.records_hash = canonicalHash(drifted.records)
  drifted.payloads_hash = canonicalHash(drifted.records.map((record) => record.payload))
  drifted.source_payload_counts = replaySourceEventPitPayloadCounts(drifted.records)
  const { view_hash: _viewHash, ...body } = drifted
  drifted.view_hash = canonicalHash(body)

  expect(() => assertReplaySourceEventPitPayloadView(drifted)).not.toThrow()
  expect(() => assertReplaySourceEventPitPayloadViewLineage(drifted, input)).toThrow("Cut/Wire lineage")
})
