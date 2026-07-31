import { expect, test } from "bun:test"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import { assertReplaySourceEventCandidateTrace } from "../../../contracts/src/lib/replay-source-event-wire-gate"
import { replaySourceEventWireTestFixture } from "../../../data-adapter/src/lib/replay-cross-source-test-fixture"
import { evaluateReplaySourceEventWirePreExecutionGate } from "../../../data-adapter/src/lib/replay-source-event-wire-gate"
import {
  assertReplaySourceEventWireCandidateReducerLineage,
  reduceReplaySourceEventWireCandidateSchedule,
} from "./replay-source-event-wire-candidate-reducer"

test("candidate reducer preserves ambiguity per event without creating execution effects", () => {
  const fixture = replaySourceEventWireTestFixture()
  const gate = evaluateReplaySourceEventWirePreExecutionGate({
    wire_manifest: fixture.wire_manifest,
    ordering_attestation: fixture.ordering_attestation,
    requested_capability: "non_economic_schedule_trace",
  })
  const input = {
    wire_manifest: fixture.wire_manifest,
    ordering_attestation: fixture.ordering_attestation,
    pre_execution_gate: gate,
  }
  const trace = reduceReplaySourceEventWireCandidateSchedule(input)
  const replayed = reduceReplaySourceEventWireCandidateSchedule(structuredClone(input))

  expect(() => assertReplaySourceEventCandidateTrace(trace)).not.toThrow()
  expect(() => assertReplaySourceEventWireCandidateReducerLineage(trace, input)).not.toThrow()
  expect(replayed.trace_hash).toBe(trace.trace_hash)
  expect(trace.trace_events.filter((event) => event.ordering_evidence === "deterministic_tie_break_only"))
    .toHaveLength(4)
  expect(trace.trace_events.at(-1)!.ordering_evidence).toBe("declared_timestamp_unique")
  expect(trace.trace_events.every((event) => event.execution_effect === "none")).toBeTrue()
  expect(trace.source_observation_counts).toEqual({
    instrument_status: 1,
    funding: 1,
    aggregate_trade: 1,
    ohlcv: 2,
  })
  expect(trace.economic_authority).toBe("none")
  expect(trace.execution_effects).toBe("forbidden")

  const drifted = structuredClone(trace)
  drifted.trace_events[0]!.ordering_evidence = "declared_timestamp_unique"
  drifted.trace_events[0]!.ambiguity_group_hash = null
  drifted.trace_events_hash = canonicalHash(drifted.trace_events)
  const { trace_hash: _traceHash, ...body } = drifted
  drifted.trace_hash = canonicalHash(body)
  expect(() => assertReplaySourceEventWireCandidateReducerLineage(drifted, input)).toThrow("event lineage")
})

test("candidate reducer refuses every economic gate and exact traces remain non-economic", () => {
  const fixture = replaySourceEventWireTestFixture({ exact: true })
  const traceGate = evaluateReplaySourceEventWirePreExecutionGate({
    wire_manifest: fixture.wire_manifest,
    ordering_attestation: fixture.ordering_attestation,
    requested_capability: "non_economic_schedule_trace",
  })
  const economicGate = evaluateReplaySourceEventWirePreExecutionGate({
    wire_manifest: fixture.wire_manifest,
    ordering_attestation: fixture.ordering_attestation,
    requested_capability: "economic_exact_trigger",
  })
  const trace = reduceReplaySourceEventWireCandidateSchedule({
    wire_manifest: fixture.wire_manifest,
    ordering_attestation: fixture.ordering_attestation,
    pre_execution_gate: traceGate,
  })
  expect(trace.ordering_resolution).toBe("exact_by_declared_timestamps")
  expect(trace.trace_events.every((event) => event.ordering_evidence === "declared_timestamp_unique")).toBeTrue()
  expect(() => reduceReplaySourceEventWireCandidateSchedule({
    wire_manifest: fixture.wire_manifest,
    ordering_attestation: fixture.ordering_attestation,
    pre_execution_gate: economicGate,
  })).toThrow("admitted non-economic")
})
