import { expect, test } from "bun:test"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplaySourceEventVisibilityCut,
  replaySourceEventVisibilityCutSummary,
} from "../../../contracts/src/lib/replay-source-event-visibility-cut"
import { replaySourceEventWireTestFixture } from "../../../data-adapter/src/lib/replay-cross-source-test-fixture"
import { evaluateReplaySourceEventWirePreExecutionGate } from "../../../data-adapter/src/lib/replay-source-event-wire-gate"
import { buildReplaySourceEventAvailabilityCursor } from "./replay-source-event-availability-cursor"
import { reduceReplaySourceEventWireCandidateSchedule } from "./replay-source-event-wire-candidate-reducer"
import {
  assertReplaySourceEventVisibilityCutLineage,
  buildReplaySourceEventVisibilityCut,
  type ReplaySourceEventVisibilityCutInput,
} from "./replay-source-event-visibility-cut"

function cutInput(asOfTime: string): ReplaySourceEventVisibilityCutInput {
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
  return {
    ...cursorInput,
    availability_cursor: buildReplaySourceEventAvailabilityCursor(cursorInput),
    as_of_time: asOfTime,
  }
}

test("visibility cut closes the as-of prefix and excludes delayed status before availability", () => {
  const input = cutInput("2026-07-14T04:00:00Z")
  const cut = buildReplaySourceEventVisibilityCut(input)
  const replayed = buildReplaySourceEventVisibilityCut(structuredClone(input))

  expect(() => assertReplaySourceEventVisibilityCut(cut)).not.toThrow()
  expect(() => assertReplaySourceEventVisibilityCutLineage(cut, input)).not.toThrow()
  expect(replayed.cut_hash).toBe(cut.cut_hash)
  expect(cut.visible_transitions.map((item) => item.source_kind))
    .toEqual(["funding", "aggregate_trade", "ohlcv"])
  expect(cut.visible_prefix_length).toBe(3)
  expect(cut.future_transition_count).toBe(2)
  expect(cut.delayed_historical_visible_count).toBe(0)
  expect(cut.payload_view).toBe("identity_lineage_only_no_payload")
  expect(cut.decision_authority).toBe("none")
})

test("visibility cut is inclusive at availability and supports an empty pre-history view", () => {
  const boundaryInput = cutInput("2026-07-14T04:00:00.500Z")
  const boundary = buildReplaySourceEventVisibilityCut(boundaryInput)
  expect(boundary.visible_transitions.map((item) => item.source_kind))
    .toEqual(["funding", "aggregate_trade", "ohlcv", "instrument_status"])
  expect(boundary.delayed_historical_visible_count).toBe(1)
  expect(boundary.latest_visible_at).toBe("2026-07-14T04:00:00.500Z")

  const empty = buildReplaySourceEventVisibilityCut(cutInput("2026-07-14T03:59:59.999Z"))
  expect(empty.visible_transitions).toEqual([])
  expect(empty.visible_prefix_length).toBe(0)
  expect(empty.future_transition_count).toBe(5)
  expect(empty.latest_visible_at).toBeNull()
  expect(empty.max_effective_time_visible).toBeNull()
})

test("visibility cut rejects a rehashed omission from the closed-world visible prefix", () => {
  const input = cutInput("2026-07-14T04:00:00Z")
  const cut = buildReplaySourceEventVisibilityCut(input)
  const drifted = structuredClone(cut)
  drifted.visible_transitions.pop()
  drifted.visible_prefix_length = drifted.visible_transitions.length
  drifted.future_transition_count = drifted.cursor_transition_count - drifted.visible_prefix_length
  drifted.visible_transitions_hash = canonicalHash(drifted.visible_transitions)
  drifted.future_transition_ids_hash = canonicalHash(
    input.availability_cursor.visibility_transitions
      .slice(drifted.visible_prefix_length)
      .map((item) => item.transition_id),
  )
  Object.assign(drifted, replaySourceEventVisibilityCutSummary(drifted.visible_transitions))
  const { cut_hash: _cutHash, ...body } = drifted
  drifted.cut_hash = canonicalHash(body)

  expect(() => assertReplaySourceEventVisibilityCut(drifted)).not.toThrow()
  expect(() => assertReplaySourceEventVisibilityCutLineage(drifted, input)).toThrow("closed-world")
})
