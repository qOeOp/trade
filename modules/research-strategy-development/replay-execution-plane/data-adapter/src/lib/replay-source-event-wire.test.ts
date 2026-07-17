import { expect, test } from "bun:test"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplaySourceEventWireManifest,
  replaySourceEventWireEnvelope,
} from "../../../contracts/src/lib/replay-source-event-wire"
import {
  replaySourceEventWireTestFixture,
} from "./replay-cross-source-test-fixture"
import {
  assertReplaySourceEventWireMaterializationLineage,
  materializeReplaySourceEventWire,
} from "./replay-source-event-wire"

test("Projection-bound materializer consumes every admitted four-source payload exactly once", () => {
  const fixture = replaySourceEventWireTestFixture()
  const projection = fixture.projection
  const input = { ...fixture, projection }
  const wire = fixture.wire_manifest
  const replayed = materializeReplaySourceEventWire(structuredClone(input))

  expect(() => assertReplaySourceEventWireManifest(wire)).not.toThrow()
  expect(() => assertReplaySourceEventWireMaterializationLineage(wire, input)).not.toThrow()
  expect(replayed.manifest_hash).toBe(wire.manifest_hash)
  expect(wire.wire_events.map((event) => event.kind)).toEqual([
    "instrument_resumed", "funding", "aggregate_trade", "bar_open", "bar_range",
  ])
  expect(wire.wire_events.every((event, index) =>
    event.payload_hash === projection.projected_events[index]!.payload_hash
      && event.source_envelope_hash === projection.projected_events[index]!.source_envelope_hash)).toBeTrue()
  expect(wire.ordered_source_envelopes_hash).toBe(fixture.ordering_attestation.ordered_events_hash)
  expect(canonicalHash(wire.wire_events.map(replaySourceEventWireEnvelope)))
    .toBe(fixture.ordering_attestation.ordered_events_hash)
  expect(wire.runner_compatibility).toBe("not_bound")
  expect(wire.economic_authority).toBe("none")
})

test("materializer fails closed when raw payloads no longer rebuild Admission-bound ordering", () => {
  const fixture = replaySourceEventWireTestFixture()
  const projection = fixture.projection
  const drifted = structuredClone({ ...fixture, projection })
  drifted.funding_events[0]!.mark_price = 101
  expect(() => materializeReplaySourceEventWire(drifted)).toThrow("do not rebuild")

  const missing = structuredClone({ ...fixture, projection })
  missing.aggregate_trade_events = []
  expect(() => materializeReplaySourceEventWire(missing)).toThrow("do not rebuild")
})
