import { expect, test } from "bun:test"
import {
  REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
  canonicalHash,
  compareReplayEventKeys,
  type ReplayEventKey,
} from "./replay-contracts"
import {
  REPLAY_CROSS_SOURCE_PHASE_BY_SOURCE,
  REPLAY_CROSS_SOURCE_RANK_BY_SOURCE,
  compareReplayCrossSourceEventKeys,
  type ReplayCrossSourceEventKey,
  type ReplayCrossSourceKind,
} from "./replay-cross-source-ordering"
import {
  REPLAY_SOURCE_EVENT_WIRE_MANIFEST_SCHEMA_VERSION,
  REPLAY_SOURCE_EVENT_WIRE_MIGRATION_REASONS,
  REPLAY_SOURCE_EVENT_WIRE_POLICY_VERSION,
  assertReplaySourceEventWireEvent,
  assertReplaySourceEventWireManifest,
  createReplaySourceEventWireEvent,
  createReplaySourceEventWireManifest,
  replaySourceEventWireEnvelope,
  type ReplaySourceEventWireBody,
  type ReplaySourceEventWireEvent,
  type ReplaySourceEventWireManifest,
} from "./replay-source-event-wire"

const HASH = "a".repeat(64)

function key(
  source: ReplayCrossSourceKind,
  eventTime: string,
  sequence: number,
  stableEventId: string,
): ReplayCrossSourceEventKey {
  return {
    event_time: eventTime,
    boundary_phase: REPLAY_CROSS_SOURCE_PHASE_BY_SOURCE[source],
    source_rank: REPLAY_CROSS_SOURCE_RANK_BY_SOURCE[source],
    source_sequence: sequence,
    stable_event_id: stableEventId,
  }
}

function event(body: Omit<ReplaySourceEventWireBody, "ordering_key"> & { source_sequence: number }): ReplaySourceEventWireEvent {
  const { source_sequence: sourceSequence, ...eventBody } = body
  return createReplaySourceEventWireEvent({
    ...eventBody,
    ordering_key: key(body.source_kind, body.effective_time, sourceSequence, body.native_event_id),
  })
}

function wireEvents(collision = false): ReplaySourceEventWireEvent[] {
  const statusTime = "2026-07-14T04:00:00Z"
  const fundingTime = collision ? statusTime : "2026-07-14T04:01:00Z"
  const tradeTime = collision ? statusTime : "2026-07-14T04:02:00Z"
  const openTime = collision ? statusTime : "2026-07-14T04:03:00Z"
  return [
    event({
      source_kind: "instrument_status",
      kind: "instrument_resumed",
      symbol: "BTCUSDT",
      timeframe: "5m",
      effective_time: statusTime,
      availability_at: collision ? "2026-07-14T04:00:00.500Z" : statusTime,
      native_event_id: `instrument-status:status-trading:${statusTime}`,
      source_sequence: 1,
      payload: {
        schema_version: REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
        snapshot_id: "status-trading",
        venue_id: "binance-usdm",
        symbol: "BTCUSDT",
        status: "trading",
        effective_at: statusTime,
        valid_until: null,
        observed_at: collision ? "2026-07-14T04:00:00.500Z" : statusTime,
        source_ref: "archive:instrument-status:1",
        source_hash: "b".repeat(64),
      },
    }),
    event({
      source_kind: "funding",
      kind: "funding",
      symbol: "BTCUSDT",
      timeframe: "5m",
      effective_time: fundingTime,
      availability_at: fundingTime,
      native_event_id: `funding:BTCUSDT:1:${fundingTime}`,
      source_sequence: 1,
      payload: { timestamp: fundingTime, rate: 0.0001, mark_price: 100 },
    }),
    event({
      source_kind: "aggregate_trade",
      kind: "aggregate_trade",
      symbol: "BTCUSDT",
      timeframe: "5m",
      effective_time: tradeTime,
      availability_at: tradeTime,
      native_event_id: "aggregate-trade:BTCUSDT:7",
      source_sequence: 7,
      payload: {
        schema_version: "trade.rd-replay-aggregate-trade-event.v1",
        symbol: "BTCUSDT",
        aggregate_trade_id: 7,
        first_trade_id: 70,
        last_trade_id: 71,
        trade_time: tradeTime,
        available_at: tradeTime,
        price: 100,
        quantity: 1,
        buyer_is_maker: false,
      },
    }),
    event({
      source_kind: "ohlcv",
      kind: "bar_open",
      symbol: "BTCUSDT",
      timeframe: "5m",
      effective_time: openTime,
      availability_at: openTime,
      native_event_id: `ohlcv:BTCUSDT:5m:bar-open:${openTime}`,
      source_sequence: 0,
      payload: { open_time: openTime, open: 100 },
    }),
    event({
      source_kind: "ohlcv",
      kind: "bar_range",
      symbol: "BTCUSDT",
      timeframe: "5m",
      effective_time: "2026-07-14T04:08:00Z",
      availability_at: "2026-07-14T04:08:00Z",
      native_event_id: "ohlcv:BTCUSDT:5m:bar-range:2026-07-14T04:08:00Z",
      source_sequence: 1,
      payload: {
        open_time: openTime,
        close_time: "2026-07-14T04:08:00Z",
        open: 100,
        high: 104,
        low: 98,
        close: 101,
        volume: 10,
        closed: true,
      },
    }),
  ]
}

function manifest(events: ReplaySourceEventWireEvent[], collision = false): ReplaySourceEventWireManifest {
  return createReplaySourceEventWireManifest({
    schema_version: REPLAY_SOURCE_EVENT_WIRE_MANIFEST_SCHEMA_VERSION,
    wire_manifest_id: "source-event-wire-manifest-1",
    wire_policy_version: REPLAY_SOURCE_EVENT_WIRE_POLICY_VERSION,
    event_key_policy_version: "rd-replay-cross-source-event-key-v1",
    scope: "candidate_source_event_wire_contract_only",
    economic_authority: "none",
    runner_compatibility: "not_bound",
    payload_materialization: "inline_typed",
    migration_mode: "parallel_epoch",
    legacy_wire_status: "preserved_unchanged",
    legacy_semantic_parity: "not_certified",
    migration_reasons: [...REPLAY_SOURCE_EVENT_WIRE_MIGRATION_REASONS],
    projection_schema_version: "trade.rd-replay-source-event-projection-attestation.v1",
    projection_policy_version: "rd-replay-source-event-projection-v1",
    projection_id: "source-event-projection-1",
    projection_hash: HASH,
    ordering_admission_ref: "research-state://cross-source-ordering-admission/1",
    ordering_admission_hash: "b".repeat(64),
    ordering_attestation_id: "cross-source-ordering-1",
    ordering_attestation_hash: "c".repeat(64),
    reservation_ref: "research-state://trial-reservation/1",
    reservation_hash: "d".repeat(64),
    dataset_manifest_ref: "artifact://dataset/manifest.json",
    dataset_hash: "e".repeat(64),
    symbol: "BTCUSDT",
    timeframe: "5m",
    window_start_inclusive: "2026-07-14T04:00:00Z",
    window_end_exclusive: "2026-07-14T04:10:00Z",
    source_kinds: ["instrument_status", "funding", "aggregate_trade", "ohlcv"],
    ordering_resolution: collision ? "resolution_limited" : "exact_by_declared_timestamps",
    ambiguity_group_count: collision ? 1 : 0,
    ambiguity_groups_hash: "f".repeat(64),
    ordering_limitations_hash: "1".repeat(64),
    ordered_source_envelopes_hash: canonicalHash(events.map(replaySourceEventWireEnvelope)),
    wire_events: events,
    wire_events_hash: canonicalHash(events),
    payloads_hash: canonicalHash(events.map((item) => item.payload)),
  })
}

function rehashManifest(value: ReplaySourceEventWireManifest): void {
  const { manifest_hash: _manifestHash, ...body } = value
  value.manifest_hash = canonicalHash(body)
}

test("SourceEvent Wire v2 carries typed four-source payloads without changing the legacy epoch", () => {
  const events = wireEvents()
  const value = manifest(events)

  expect(() => assertReplaySourceEventWireManifest(value)).not.toThrow()
  expect(events.map((item) => item.kind)).toEqual([
    "instrument_resumed", "funding", "aggregate_trade", "bar_open", "bar_range",
  ])
  expect(events.every((item) => item.payload_hash === canonicalHash(item.payload))).toBeTrue()
  expect(events.every((item) => item.source_envelope_hash === canonicalHash(replaySourceEventWireEnvelope(item)))).toBeTrue()
  expect(value.migration_mode).toBe("parallel_epoch")
  expect(value.legacy_wire_status).toBe("preserved_unchanged")
  expect(value.legacy_semantic_parity).toBe("not_certified")
  expect(value.runner_compatibility).toBe("not_bound")
})

test("Wire v2 preserves source-rank-before-native-sequence where the legacy key cannot", () => {
  const events = wireEvents(true)
  const aggregate = events[2]!
  const ohlcv = events[3]!
  expect(compareReplayCrossSourceEventKeys(aggregate.ordering_key, ohlcv.ordering_key)).toBeLessThan(0)

  const legacyKey = (event: ReplaySourceEventWireEvent): ReplayEventKey => ({
    event_time: event.effective_time,
    boundary_phase: event.ordering_key.boundary_phase,
    source_sequence: event.ordering_key.source_sequence,
    event_subphase: event.ordering_key.source_rank,
    stable_event_id: event.native_event_id,
  })
  expect(compareReplayEventKeys(legacyKey(aggregate), legacyKey(ohlcv))).toBeGreaterThan(0)
  expect(() => assertReplaySourceEventWireManifest(manifest(events, true))).not.toThrow()
})

test("Wire v2 fails closed on payload lineage drift and migration overclaim", () => {
  const events = wireEvents()
  const driftedEvent = structuredClone(events[1]!)
  ;(driftedEvent.payload as { mark_price: number }).mark_price = 101
  expect(() => assertReplaySourceEventWireEvent(driftedEvent)).toThrow("payload hash mismatch")

  const value = manifest(events)
  const replacement = createReplaySourceEventWireEvent({
    ...events[1]!,
    payload: { ...(events[1]!.payload as { timestamp: string; rate: number; mark_price: number }), mark_price: 101 },
  })
  value.wire_events[1] = replacement
  value.wire_events_hash = canonicalHash(value.wire_events)
  value.payloads_hash = canonicalHash(value.wire_events.map((item) => item.payload))
  rehashManifest(value)
  expect(() => assertReplaySourceEventWireManifest(value)).toThrow("ordered source envelopes")

  const overclaim = manifest(wireEvents())
  ;(overclaim as unknown as { legacy_semantic_parity: string }).legacy_semantic_parity = "certified"
  rehashManifest(overclaim)
  expect(() => assertReplaySourceEventWireManifest(overclaim))
    .toThrow("migration claim")
})
