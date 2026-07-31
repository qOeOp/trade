import { expect, test } from "bun:test"
import {
  REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
  canonicalHash,
  type ReplayInstrumentStatusSnapshot,
} from "../../contracts/src/lib/replay-contracts"
import {
  assertReplaySourceEventLegacyParityAttestation,
  assertReplaySourceEventLegacyParityLineage,
} from "../../contracts/src/lib/replay-source-event-legacy-parity"
import { replaySourceEventWireTestFixture } from "../../data-adapter/src/lib/replay-cross-source-test-fixture"
import {
  certifyReplaySourceEventLegacyParity,
} from "../../data-adapter/src/lib/replay-source-event-wire"
import { buildReplaySourceEvents } from "../../engine/src/lib/replay-source-events"

test("actual legacy builder matches Wire v2 shared event schedule while stronger parity stays unclaimed", () => {
  const fixture = replaySourceEventWireTestFixture()
  const wire = fixture.wire_manifest
  const baseline: ReplayInstrumentStatusSnapshot = {
    schema_version: REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
    snapshot_id: "status-baseline",
    venue_id: "binance-usdm",
    symbol: "BTCUSDT",
    status: "halted",
    effective_at: "2026-07-14T03:59:00Z",
    valid_until: "2026-07-14T04:00:00Z",
    observed_at: "2026-07-14T03:59:00Z",
    source_ref: "archive:instrument-status:0",
    source_hash: "2".repeat(64),
  }
  const legacyEvents = buildReplaySourceEvents({
    bars: fixture.bars,
    funding_events: fixture.funding_events,
    mark_events: [],
    instrument_status_epochs: [baseline, ...fixture.instrument_status_events],
    start_time: "2026-07-14T04:00:00Z",
    end_time: "2026-07-14T04:09:59.999Z",
  })
  const parity = certifyReplaySourceEventLegacyParity({
    wire_manifest: wire,
    legacy_source_events: legacyEvents,
  })

  expect(() => assertReplaySourceEventLegacyParityAttestation(parity)).not.toThrow()
  expect(() => assertReplaySourceEventLegacyParityLineage(parity, wire, legacyEvents)).not.toThrow()
  expect(parity.match_count).toBe(4)
  expect(parity.matches.map((match) => match.kind)).toEqual([
    "bar_open", "bar_range", "funding", "instrument_resumed",
  ])
  expect(parity.shared_event_schedule_parity).toBe("certified")
  expect(parity.payload_parity).toBe("not_asserted_legacy_payload_out_of_line")
  expect(parity.event_key_parity).toBe("not_asserted_incompatible_key_schema")
  expect(parity.cross_source_order_parity).toBe("not_asserted")
  expect(parity.wire_only_kinds).toEqual(["aggregate_trade"])

  const remapped = structuredClone(parity)
  const firstLegacyId = remapped.matches[0]!.legacy_source_event_id
  remapped.matches[0]!.legacy_source_event_id = remapped.matches[1]!.legacy_source_event_id
  remapped.matches[1]!.legacy_source_event_id = firstLegacyId
  remapped.matches_hash = canonicalHash(remapped.matches)
  const { attestation_hash: _attestationHash, ...body } = remapped
  remapped.attestation_hash = canonicalHash(body)
  expect(() => assertReplaySourceEventLegacyParityLineage(remapped, wire, legacyEvents)).toThrow()
})

test("legacy parity rejects missing or time-shifted shared events", () => {
  const fixture = replaySourceEventWireTestFixture({ exact: true })
  const wire = fixture.wire_manifest
  const legacyEvents = buildReplaySourceEvents({
    bars: fixture.bars,
    funding_events: fixture.funding_events,
    mark_events: [],
    start_time: "2026-07-14T04:00:00Z",
    end_time: "2026-07-14T04:09:59.999Z",
  })
  expect(() => certifyReplaySourceEventLegacyParity({
    wire_manifest: wire,
    legacy_source_events: legacyEvents,
  })).toThrow("cardinality")

  const withStatus = structuredClone(legacyEvents)
  const statusWire = wire.wire_events.find((event) => event.kind === "instrument_resumed")!
  withStatus.push({
    source_event_id: "legacy-status-shifted",
    kind: "instrument_resumed",
    source_index: 0,
    instrument_status_snapshot_id: "status-trading",
    event_key: {
      event_time: "2026-07-14T04:00:01Z",
      boundary_phase: 0,
      source_sequence: 1,
      event_subphase: 0,
      stable_event_id: "legacy-status-shifted",
    },
  })
  expect(statusWire.effective_time).toBe("2026-07-14T04:00:00Z")
  expect(() => certifyReplaySourceEventLegacyParity({
    wire_manifest: wire,
    legacy_source_events: withStatus,
  })).toThrow("semantic parity")
})
