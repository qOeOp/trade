import type { ReplayCrossSourceOrderingAdmissionSnapshot } from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  canonicalHash,
  type ReplayAggregateTradeEvent,
  type ReplayFundingEvent,
  type ReplayInstrumentStatusSnapshot,
  type ReplayMarketBar,
  type ReplaySourceEvent,
} from "../../../contracts/src/lib/replay-contracts"
import type { ReplayCrossSourceOrderingAttestation } from "../../../contracts/src/lib/replay-cross-source-ordering"
import type { ReplaySourceEventProjectionAttestation } from "../../../contracts/src/lib/replay-source-event-projection"
import {
  REPLAY_SOURCE_EVENT_LEGACY_PARITY_POLICY_VERSION,
  REPLAY_SOURCE_EVENT_LEGACY_PARITY_SCHEMA_VERSION,
  REPLAY_SOURCE_EVENT_LEGACY_SCHEMA_ONLY_KINDS,
  REPLAY_SOURCE_EVENT_SHARED_KINDS,
  REPLAY_SOURCE_EVENT_WIRE_ONLY_KINDS,
  assertReplayLegacySourceEvents,
  assertReplaySourceEventLegacyParityLineage,
  createReplaySourceEventLegacyParityAttestation,
  replaySourceEventLegacyParityMatches,
  type ReplaySourceEventLegacyParityAttestation,
} from "../../../contracts/src/lib/replay-source-event-legacy-parity"
import {
  REPLAY_SOURCE_EVENT_WIRE_MANIFEST_SCHEMA_VERSION,
  REPLAY_SOURCE_EVENT_WIRE_MIGRATION_REASONS,
  REPLAY_SOURCE_EVENT_WIRE_POLICY_VERSION,
  assertReplaySourceEventWireManifest,
  createReplaySourceEventWireEvent,
  createReplaySourceEventWireManifest,
  type ReplaySourceEventWireManifest,
  type ReplaySourceEventWirePayload,
} from "../../../contracts/src/lib/replay-source-event-wire"
import { buildReplayCrossSourceOrderingAttestation } from "./replay-cross-source-ordering"
import {
  assertReplaySourceEventProjectionLineage,
} from "./replay-source-event-projection"

export interface ReplaySourceEventWirePayloadCollections {
  bars: ReplayMarketBar[]
  funding_events: ReplayFundingEvent[]
  instrument_status_events: ReplayInstrumentStatusSnapshot[]
  aggregate_trade_events: ReplayAggregateTradeEvent[]
}

export interface ReplaySourceEventWireMaterializationInput extends ReplaySourceEventWirePayloadCollections {
  ordering_admission: ReplayCrossSourceOrderingAdmissionSnapshot
  ordering_attestation: ReplayCrossSourceOrderingAttestation
  projection: ReplaySourceEventProjectionAttestation
}

export function materializeReplaySourceEventWire(
  input: ReplaySourceEventWireMaterializationInput,
): ReplaySourceEventWireManifest {
  assertReplaySourceEventProjectionLineage(input.projection, input.ordering_admission, input.ordering_attestation)
  assertPayloadCollectionsRebuildAttestation(input)
  const payloads = sourcePayloadByNativeEventId(input)
  const wireEvents = input.projection.projected_events.map((projected) => {
    const payload = payloads.get(projected.native_event_id)
    if (!payload) throw new Error(`SourceEvent Wire payload missing for ${projected.native_event_id}`)
    const event = createReplaySourceEventWireEvent({
      source_kind: projected.source_kind,
      kind: projected.projected_kind,
      symbol: projected.symbol,
      timeframe: input.projection.timeframe,
      effective_time: projected.effective_time,
      availability_at: projected.availability_at,
      native_event_id: projected.native_event_id,
      ordering_key: structuredClone(projected.ordering_key),
      payload,
    })
    if (event.payload_hash !== projected.payload_hash
        || event.source_envelope_hash !== projected.source_envelope_hash) {
      throw new Error("SourceEvent Wire materialization does not bind its hash-only projection")
    }
    return event
  })
  if (wireEvents.length !== payloads.size) {
    throw new Error("SourceEvent Wire materialization must consume every admitted payload exactly once")
  }
  const bodyWithoutId = {
    schema_version: REPLAY_SOURCE_EVENT_WIRE_MANIFEST_SCHEMA_VERSION,
    wire_policy_version: REPLAY_SOURCE_EVENT_WIRE_POLICY_VERSION,
    event_key_policy_version: input.projection.event_key_policy_version,
    scope: "candidate_source_event_wire_contract_only" as const,
    economic_authority: "none" as const,
    runner_compatibility: "not_bound" as const,
    payload_materialization: "inline_typed" as const,
    migration_mode: "parallel_epoch" as const,
    legacy_wire_status: "preserved_unchanged" as const,
    legacy_semantic_parity: "not_certified" as const,
    migration_reasons: [...REPLAY_SOURCE_EVENT_WIRE_MIGRATION_REASONS],
    projection_schema_version: input.projection.schema_version,
    projection_policy_version: input.projection.projection_policy_version,
    projection_id: input.projection.projection_id,
    projection_hash: input.projection.projection_hash,
    ordering_admission_ref: input.ordering_admission.admission_ref,
    ordering_admission_hash: input.ordering_admission.admission_hash,
    ordering_attestation_id: input.ordering_attestation.attestation_id,
    ordering_attestation_hash: input.ordering_attestation.attestation_hash,
    reservation_ref: input.projection.reservation_ref,
    reservation_hash: input.projection.reservation_hash,
    dataset_manifest_ref: input.projection.dataset_manifest_ref,
    dataset_hash: input.projection.dataset_hash,
    symbol: input.projection.symbol,
    timeframe: input.projection.timeframe,
    window_start_inclusive: input.projection.window_start_inclusive,
    window_end_exclusive: input.projection.window_end_exclusive,
    source_kinds: structuredClone(input.projection.source_kinds),
    ordering_resolution: input.projection.ordering_resolution,
    ambiguity_group_count: input.projection.ambiguity_group_count,
    ambiguity_groups_hash: input.projection.ambiguity_groups_hash,
    ordering_limitations_hash: input.projection.ordering_limitations_hash,
    ordered_source_envelopes_hash: input.ordering_attestation.ordered_events_hash,
    wire_events: wireEvents,
    wire_events_hash: canonicalHash(wireEvents),
    payloads_hash: canonicalHash(wireEvents.map((event) => event.payload)),
  }
  const body = {
    ...bodyWithoutId,
    wire_manifest_id: `source-event-wire-manifest-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  }
  const value = createReplaySourceEventWireManifest(body)
  assertReplaySourceEventWireMaterializationLineage(value, input)
  return value
}

export function assertReplaySourceEventWireMaterializationLineage(
  wire: ReplaySourceEventWireManifest,
  input: ReplaySourceEventWireMaterializationInput,
): void {
  assertReplaySourceEventWireManifest(wire)
  assertReplaySourceEventProjectionLineage(input.projection, input.ordering_admission, input.ordering_attestation)
  assertPayloadCollectionsRebuildAttestation(input)
  if (wire.projection_id !== input.projection.projection_id
      || wire.projection_hash !== input.projection.projection_hash
      || wire.ordering_admission_ref !== input.ordering_admission.admission_ref
      || wire.ordering_admission_hash !== input.ordering_admission.admission_hash
      || wire.ordering_attestation_id !== input.ordering_attestation.attestation_id
      || wire.ordering_attestation_hash !== input.ordering_attestation.attestation_hash
      || wire.ordered_source_envelopes_hash !== input.ordering_attestation.ordered_events_hash) {
    throw new Error("SourceEvent Wire authority or source-envelope lineage drift")
  }
  const payloads = sourcePayloadByNativeEventId(input)
  if (wire.wire_events.length !== input.projection.projected_events.length
      || wire.wire_events.length !== payloads.size) {
    throw new Error("SourceEvent Wire event cardinality drift")
  }
  for (const [index, projected] of input.projection.projected_events.entries()) {
    const event = wire.wire_events[index]
    const payload = payloads.get(projected.native_event_id)
    if (!event || !payload || event.source_envelope_hash !== projected.source_envelope_hash
        || event.payload_hash !== projected.payload_hash || canonicalHash(event.payload) !== canonicalHash(payload)) {
      throw new Error("SourceEvent Wire event payload or projection lineage drift")
    }
  }
}

export function certifyReplaySourceEventLegacyParity(input: {
  wire_manifest: ReplaySourceEventWireManifest
  legacy_source_events: ReplaySourceEvent[]
}): ReplaySourceEventLegacyParityAttestation {
  assertReplaySourceEventWireManifest(input.wire_manifest)
  assertReplayLegacySourceEvents(input.legacy_source_events)
  const sharedWire = input.wire_manifest.wire_events.filter(isSharedWireEvent)
  const matches = replaySourceEventLegacyParityMatches(input.wire_manifest, input.legacy_source_events)
  const bodyWithoutId = {
    schema_version: REPLAY_SOURCE_EVENT_LEGACY_PARITY_SCHEMA_VERSION,
    parity_policy_version: REPLAY_SOURCE_EVENT_LEGACY_PARITY_POLICY_VERSION,
    wire_policy_version: REPLAY_SOURCE_EVENT_WIRE_POLICY_VERSION,
    scope: "legacy_shared_event_schedule_parity_only" as const,
    economic_authority: "none" as const,
    runner_compatibility: "not_bound" as const,
    shared_event_schedule_parity: "certified" as const,
    payload_parity: "not_asserted_legacy_payload_out_of_line" as const,
    event_key_parity: "not_asserted_incompatible_key_schema" as const,
    cross_source_order_parity: "not_asserted" as const,
    wire_manifest_id: input.wire_manifest.wire_manifest_id,
    wire_manifest_hash: input.wire_manifest.manifest_hash,
    shared_kinds: [...REPLAY_SOURCE_EVENT_SHARED_KINDS],
    wire_only_kinds: [...REPLAY_SOURCE_EVENT_WIRE_ONLY_KINDS] as ["aggregate_trade"],
    legacy_schema_only_kinds: [...REPLAY_SOURCE_EVENT_LEGACY_SCHEMA_ONLY_KINDS] as ["instrument_delisted", "mark"],
    wire_shared_events_hash: canonicalHash(sharedWire),
    legacy_source_events_hash: canonicalHash(input.legacy_source_events),
    match_count: matches.length,
    matches,
    matches_hash: canonicalHash(matches),
  }
  const body = {
    ...bodyWithoutId,
    parity_attestation_id: `source-event-legacy-parity-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  }
  const value = createReplaySourceEventLegacyParityAttestation(body)
  assertReplaySourceEventLegacyParityLineage(value, input.wire_manifest, input.legacy_source_events)
  return value
}

function assertPayloadCollectionsRebuildAttestation(input: ReplaySourceEventWireMaterializationInput): void {
  const statusCollection = input.ordering_attestation.source_collections
    .find((collection) => collection.source_kind === "instrument_status")
  if (!statusCollection || !["complete_history", "current_snapshot_only"].includes(statusCollection.external_completeness)) {
    throw new Error("SourceEvent Wire lacks a valid instrument-status completeness declaration")
  }
  const rebuilt = buildReplayCrossSourceOrderingAttestation({
    symbol: input.ordering_attestation.symbol,
    timeframe: input.ordering_attestation.timeframe,
    window_start_inclusive: input.ordering_attestation.window_start_inclusive,
    window_end_exclusive: input.ordering_attestation.window_end_exclusive,
    bars: input.bars,
    funding_events: input.funding_events,
    instrument_status_events: input.instrument_status_events,
    instrument_status_completeness: statusCollection.external_completeness as "complete_history" | "current_snapshot_only",
    aggregate_trade_events: input.aggregate_trade_events,
  })
  if (canonicalHash(rebuilt) !== canonicalHash(input.ordering_attestation)) {
    throw new Error("SourceEvent Wire payload collections do not rebuild the admitted ordering attestation")
  }
}

function sourcePayloadByNativeEventId(
  input: ReplaySourceEventWirePayloadCollections & { ordering_attestation: ReplayCrossSourceOrderingAttestation },
): Map<string, ReplaySourceEventWirePayload> {
  const symbol = input.ordering_attestation.symbol
  const timeframe = input.ordering_attestation.timeframe
  const entries: Array<[string, ReplaySourceEventWirePayload]> = [
    ...input.instrument_status_events.map((event) =>
      [`instrument-status:${event.snapshot_id}:${event.effective_at}`, event] as [string, ReplaySourceEventWirePayload]),
    ...input.funding_events.map((event, index) =>
      [`funding:${symbol}:${index + 1}:${event.timestamp}`, event] as [string, ReplaySourceEventWirePayload]),
    ...input.aggregate_trade_events.map((event) =>
      [`aggregate-trade:${symbol}:${event.aggregate_trade_id}`, event] as [string, ReplaySourceEventWirePayload]),
    ...input.bars.flatMap((bar) => [
      [`ohlcv:${symbol}:${timeframe}:bar-open:${bar.open_time}`, { open_time: bar.open_time, open: bar.open }],
      [`ohlcv:${symbol}:${timeframe}:bar-range:${bar.close_time}`, bar],
    ] as Array<[string, ReplaySourceEventWirePayload]>),
  ]
  const payloads = new Map<string, ReplaySourceEventWirePayload>()
  for (const [id, payload] of entries) {
    if (payloads.has(id)) throw new Error(`SourceEvent Wire duplicate native payload id ${id}`)
    payloads.set(id, structuredClone(payload))
  }
  return payloads
}

function isSharedWireEvent(
  event: ReplaySourceEventWireManifest["wire_events"][number],
): boolean {
  return (REPLAY_SOURCE_EVENT_SHARED_KINDS as readonly string[]).includes(event.kind)
}
