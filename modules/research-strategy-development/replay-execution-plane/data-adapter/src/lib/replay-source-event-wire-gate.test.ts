import { expect, test } from "bun:test"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplaySourceEventWireGateLineage,
  assertReplaySourceEventWirePreExecutionGate,
} from "../../../contracts/src/lib/replay-source-event-wire-gate"
import { replaySourceEventWireTestFixture } from "./replay-cross-source-test-fixture"
import { evaluateReplaySourceEventWirePreExecutionGate } from "./replay-source-event-wire-gate"

test("pre-execution gate admits only non-economic trace while preserving resolution limits", () => {
  const fixture = replaySourceEventWireTestFixture()
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

  expect(() => assertReplaySourceEventWirePreExecutionGate(traceGate)).not.toThrow()
  expect(() => assertReplaySourceEventWireGateLineage(
    traceGate,
    fixture.wire_manifest,
    fixture.ordering_attestation,
  )).not.toThrow()
  expect(traceGate.decision).toBe("admitted_candidate_trace")
  expect(traceGate.ordering_resolution).toBe("resolution_limited")
  expect(economicGate.decision).toBe("rejected_resolution_limited")
  expect(economicGate.reason).toBe("cross_source_ordering_is_resolution_limited")
  expect(economicGate.economic_authority).toBe("none")
})

test("declared-timestamp exact ordering still cannot claim a certified economic consumer", () => {
  const fixture = replaySourceEventWireTestFixture({ exact: true })
  const gate = evaluateReplaySourceEventWirePreExecutionGate({
    wire_manifest: fixture.wire_manifest,
    ordering_attestation: fixture.ordering_attestation,
    requested_capability: "economic_exact_trigger",
  })
  expect(gate.ordering_resolution).toBe("exact_by_declared_timestamps")
  expect(gate.ambiguity_group_count).toBe(0)
  expect(gate.decision).toBe("rejected_economic_consumer_not_certified")

  const overclaim = structuredClone(gate)
  overclaim.decision = "admitted_candidate_trace"
  overclaim.reason = "non_economic_trace_preserves_ordering_limitations"
  const { gate_hash: _gateHash, ...body } = overclaim
  overclaim.gate_hash = canonicalHash(body)
  expect(() => assertReplaySourceEventWirePreExecutionGate(overclaim)).toThrow("overclaims")
})
