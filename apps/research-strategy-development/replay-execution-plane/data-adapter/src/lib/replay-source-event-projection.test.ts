import { expect, test } from "bun:test"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplaySourceEventProjectionAttestation,
} from "../../../contracts/src/lib/replay-source-event-projection"
import {
  replayCrossSourceOrderingAdmission,
  replayCrossSourceTestFixture,
} from "./replay-cross-source-test-fixture"
import {
  assertReplaySourceEventProjectionLineage,
  buildReplaySourceEventProjectionAttestation,
} from "./replay-source-event-projection"

const orderingAttestation = (input: { exact?: boolean } = {}) => replayCrossSourceTestFixture(input).ordering_attestation
const orderingAdmission = replayCrossSourceOrderingAdmission

test("Admission-bound projection preserves every ordered envelope without claiming production compatibility", () => {
  const attestation = orderingAttestation()
  const admission = orderingAdmission(attestation)
  const projection = buildReplaySourceEventProjectionAttestation({
    ordering_admission: admission,
    ordering_attestation: attestation,
  })
  const replayed = buildReplaySourceEventProjectionAttestation({
    ordering_admission: structuredClone(admission),
    ordering_attestation: structuredClone(attestation),
  })

  expect(() => assertReplaySourceEventProjectionAttestation(projection)).not.toThrow()
  expect(() => assertReplaySourceEventProjectionLineage(projection, admission, attestation)).not.toThrow()
  expect(replayed.projection_hash).toBe(projection.projection_hash)
  expect(projection.projected_events).toHaveLength(attestation.ordered_events.length)
  expect(projection.projected_events.slice(0, 4).map((event) => event.projected_kind))
    .toEqual(["instrument_resumed", "funding", "aggregate_trade", "bar_open"])
  expect(projection.projected_events[0]!.effective_time).toBe("2026-07-14T04:00:00Z")
  expect(projection.projected_events[0]!.availability_at).toBe("2026-07-14T04:00:00.500Z")
  expect(projection.projected_events[0]!.payload_hash).toBe(attestation.ordered_events[0]!.payload_hash)
  expect(projection.projected_events[0]!.ordering_key).toEqual(attestation.ordered_events[0]!.event_key)
  expect(projection.ordering_resolution).toBe("resolution_limited")
  expect(projection.economic_authority).toBe("none")
  expect(projection.production_source_event_compatibility).toBe("not_asserted")
})

test("exact declared timestamps remain non-economic until the production SourceEvent epoch is designed", () => {
  const attestation = orderingAttestation({ exact: true })
  const projection = buildReplaySourceEventProjectionAttestation({
    ordering_admission: orderingAdmission(attestation),
    ordering_attestation: attestation,
  })

  expect(projection.ordering_resolution).toBe("exact_by_declared_timestamps")
  expect(projection.production_source_event_compatibility).toBe("not_asserted")
  expect(projection.projection_limitations).toEqual([
    "production-replay-source-event-schema-not-bound",
    "aggregate-trade-engine-consumer-not-certified",
    "semantic-payload-materialization-not-certified",
  ])
})

test("projection rejects admission drift and loss of availability lineage", () => {
  const attestation = orderingAttestation()
  const admission = orderingAdmission(attestation)
  const driftedAdmission = orderingAdmission(attestation, { ordered_events_hash: "9".repeat(64) })
  expect(() => buildReplaySourceEventProjectionAttestation({
    ordering_admission: driftedAdmission,
    ordering_attestation: attestation,
  })).toThrow("does not bind")

  const projection = buildReplaySourceEventProjectionAttestation({
    ordering_admission: admission,
    ordering_attestation: attestation,
  })
  const driftedProjection = structuredClone(projection)
  driftedProjection.projected_events[0]!.availability_at = "2026-07-14T04:00:00.750Z"
  driftedProjection.projected_events_hash = canonicalHash(driftedProjection.projected_events)
  const { projection_hash: _projectionHash, ...body } = driftedProjection
  driftedProjection.projection_hash = canonicalHash(body)
  expect(() => assertReplaySourceEventProjectionLineage(driftedProjection, admission, attestation))
    .toThrow("losslessly preserve")
})
