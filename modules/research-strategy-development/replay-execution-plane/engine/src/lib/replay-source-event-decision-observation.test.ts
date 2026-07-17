import { expect, test } from "bun:test"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplaySourceEventDecisionObservationProjection,
} from "../../../contracts/src/lib/replay-source-event-decision-observation"
import { replaySourceEventWireTestFixture } from "../../../data-adapter/src/lib/replay-cross-source-test-fixture"
import { evaluateReplaySourceEventWirePreExecutionGate } from "../../../data-adapter/src/lib/replay-source-event-wire-gate"
import { buildReplaySourceEventAvailabilityCursor } from "./replay-source-event-availability-cursor"
import {
  assertReplaySourceEventDecisionObservationLineage,
  buildReplaySourceEventDecisionObservationProjection,
  type ReplaySourceEventDecisionObservationInput,
} from "./replay-source-event-decision-observation"
import { buildReplaySourceEventPitPayloadView } from "./replay-source-event-pit-payload-view"
import { buildReplaySourceEventVisibilityCut } from "./replay-source-event-visibility-cut"
import { reduceReplaySourceEventWireCandidateSchedule } from "./replay-source-event-wire-candidate-reducer"

function observationInput(asOfTime: string): ReplaySourceEventDecisionObservationInput {
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
  const visibilityCut = buildReplaySourceEventVisibilityCut(cutInput)
  const viewInput = { ...cutInput, visibility_cut: visibilityCut }
  return { ...viewInput, pit_payload_view: buildReplaySourceEventPitPayloadView(viewInput) }
}

test("decision observation projection exposes bar open without closed-bar range fields", () => {
  const input = observationInput("2026-07-14T04:00:00Z")
  const projection = buildReplaySourceEventDecisionObservationProjection(input)
  const replayed = buildReplaySourceEventDecisionObservationProjection(structuredClone(input))

  expect(() => assertReplaySourceEventDecisionObservationProjection(projection)).not.toThrow()
  expect(() => assertReplaySourceEventDecisionObservationLineage(projection, input)).not.toThrow()
  expect(replayed.projection_hash).toBe(projection.projection_hash)
  expect(projection.observations.map((item) => item.observation_type))
    .toEqual(["funding_settlement", "aggregate_trade", "bar_open"])
  const barOpen = projection.observations.find((item) => item.observation_type === "bar_open")!
  expect(Object.keys(barOpen.observation).sort()).toEqual(["open", "open_time"])
  expect(projection.decision_input_compatibility).toBe("not_asserted")
  expect(projection.signal_authority).toBe("none")
  expect(projection.order_authority).toBe("none")
})

test("decision observation admits delayed status at availability and full OHLCV only at close", () => {
  const statusProjection = buildReplaySourceEventDecisionObservationProjection(
    observationInput("2026-07-14T04:00:00.500Z"),
  )
  expect(statusProjection.observations.at(-1)!.observation_type).toBe("instrument_status")

  const closedProjection = buildReplaySourceEventDecisionObservationProjection(
    observationInput("2026-07-14T04:08:00Z"),
  )
  const closed = closedProjection.observations.at(-1)!
  expect(closed.observation_type).toBe("closed_bar")
  expect(Object.keys(closed.observation).sort())
    .toEqual(["close", "close_time", "closed", "high", "low", "open", "open_time", "volume"])
  expect((closed.observation as { closed: true }).closed).toBeTrue()

  const empty = buildReplaySourceEventDecisionObservationProjection(
    observationInput("2026-07-14T03:59:59.999Z"),
  )
  expect(empty.observations).toEqual([])
})

test("decision observation rejects range-field leakage and rehashed semantic substitution", () => {
  const input = observationInput("2026-07-14T04:00:00Z")
  const projection = buildReplaySourceEventDecisionObservationProjection(input)
  const leaked = structuredClone(projection)
  const barOpen = leaked.observations.find((item) => item.observation_type === "bar_open")!
  ;(barOpen.observation as unknown as Record<string, unknown>).high = 104
  barOpen.observation_hash = canonicalHash(barOpen.observation)
  leaked.observations_hash = canonicalHash(leaked.observations)
  leaked.observation_values_hash = canonicalHash(leaked.observations.map((item) => item.observation))
  const { projection_hash: _leakedHash, ...leakedBody } = leaked
  leaked.projection_hash = canonicalHash(leakedBody)
  expect(() => assertReplaySourceEventDecisionObservationProjection(leaked)).toThrow("field whitelist")

  const substituted = structuredClone(projection)
  const funding = substituted.observations.find((item) => item.observation_type === "funding_settlement")!
  ;(funding.observation as { rate: number }).rate = 0.5
  funding.observation_hash = canonicalHash(funding.observation)
  substituted.observations_hash = canonicalHash(substituted.observations)
  substituted.observation_values_hash = canonicalHash(substituted.observations.map((item) => item.observation))
  const { projection_hash: _substitutedHash, ...substitutedBody } = substituted
  substituted.projection_hash = canonicalHash(substitutedBody)
  expect(() => assertReplaySourceEventDecisionObservationProjection(substituted)).not.toThrow()
  expect(() => assertReplaySourceEventDecisionObservationLineage(substituted, input)).toThrow("payload record lineage")
})
