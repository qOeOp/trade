import {
  REPLAY_AGGREGATE_TRADE_EVENT_SCHEMA_VERSION,
  assertReplayAggregateTradeEvents,
  assertReplayInstrumentStatusSnapshot,
  assertReplayMarketBars,
  canonicalHash,
  type ReplayAggregateTradeEvent,
  type ReplayFundingEvent,
  type ReplayInstrumentStatusSnapshot,
  type ReplayMarketBar,
} from "./replay-contracts"
import {
  REPLAY_CROSS_SOURCE_EVENT_ENVELOPE_SCHEMA_VERSION,
  REPLAY_CROSS_SOURCE_EVENT_KEY_POLICY_VERSION,
  REPLAY_CROSS_SOURCE_PHASE_BY_SOURCE,
  REPLAY_CROSS_SOURCE_RANK_BY_SOURCE,
  assertReplayCrossSourceEventEnvelope,
  assertReplayCrossSourceEventKey,
  compareReplayCrossSourceEventKeys,
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
  type ReplayCrossSourceEventEnvelope,
  type ReplayCrossSourceEventKey,
  type ReplayCrossSourceKind,
} from "./replay-cross-source-ordering"
import {
  REPLAY_SOURCE_EVENT_PROJECTION_ATTESTATION_SCHEMA_VERSION,
  REPLAY_SOURCE_EVENT_PROJECTION_POLICY_VERSION,
} from "./replay-source-event-projection"

export const REPLAY_SOURCE_EVENT_WIRE_SCHEMA_VERSION = "trade.rd-replay-source-event-wire.v2" as const
export const REPLAY_SOURCE_EVENT_WIRE_MANIFEST_SCHEMA_VERSION = "trade.rd-replay-source-event-wire-manifest.v1" as const
export const REPLAY_SOURCE_EVENT_WIRE_POLICY_VERSION = "rd-replay-source-event-wire-v2" as const

export const REPLAY_SOURCE_EVENT_WIRE_MIGRATION_REASONS = Object.freeze([
  "legacy-source-event-lacks-availability-and-payload-lineage",
  "legacy-event-key-cannot-preserve-source-rank-before-native-sequence",
  "legacy-source-event-lacks-aggregate-trade-kind",
] as const)

export type ReplaySourceEventWireKind =
  | "instrument_halted"
  | "instrument_resumed"
  | "funding"
  | "aggregate_trade"
  | "bar_open"
  | "bar_range"

export interface ReplaySourceEventBarOpenPayload {
  open_time: string
  open: number
}

export type ReplaySourceEventWirePayload =
  | ReplayInstrumentStatusSnapshot
  | ReplayFundingEvent
  | ReplayAggregateTradeEvent
  | ReplaySourceEventBarOpenPayload
  | ReplayMarketBar

export interface ReplaySourceEventWireBody {
  source_kind: ReplayCrossSourceKind
  kind: ReplaySourceEventWireKind
  symbol: string
  timeframe: string
  effective_time: string
  availability_at: string
  native_event_id: string
  ordering_key: ReplayCrossSourceEventKey
  payload: ReplaySourceEventWirePayload
}

export interface ReplaySourceEventWireEvent extends ReplaySourceEventWireBody {
  schema_version: typeof REPLAY_SOURCE_EVENT_WIRE_SCHEMA_VERSION
  wire_event_id: string
  payload_hash: string
  source_envelope_hash: string
  execution_disposition: "candidate_wire_not_executable"
}

export interface ReplaySourceEventWireManifest {
  schema_version: typeof REPLAY_SOURCE_EVENT_WIRE_MANIFEST_SCHEMA_VERSION
  wire_manifest_id: string
  wire_policy_version: typeof REPLAY_SOURCE_EVENT_WIRE_POLICY_VERSION
  event_key_policy_version: typeof REPLAY_CROSS_SOURCE_EVENT_KEY_POLICY_VERSION
  scope: "candidate_source_event_wire_contract_only"
  economic_authority: "none"
  runner_compatibility: "not_bound"
  payload_materialization: "inline_typed"
  migration_mode: "parallel_epoch"
  legacy_wire_status: "preserved_unchanged"
  legacy_semantic_parity: "not_certified"
  migration_reasons: typeof REPLAY_SOURCE_EVENT_WIRE_MIGRATION_REASONS[number][]
  projection_schema_version: typeof REPLAY_SOURCE_EVENT_PROJECTION_ATTESTATION_SCHEMA_VERSION
  projection_policy_version: typeof REPLAY_SOURCE_EVENT_PROJECTION_POLICY_VERSION
  projection_id: string
  projection_hash: string
  ordering_admission_ref: string
  ordering_admission_hash: string
  ordering_attestation_id: string
  ordering_attestation_hash: string
  reservation_ref: string
  reservation_hash: string
  dataset_manifest_ref: string
  dataset_hash: string
  symbol: string
  timeframe: string
  window_start_inclusive: string
  window_end_exclusive: string
  source_kinds: ["instrument_status", "funding", "aggregate_trade", "ohlcv"]
  ordering_resolution: "exact_by_declared_timestamps" | "resolution_limited"
  ambiguity_group_count: number
  ambiguity_groups_hash: string
  ordering_limitations_hash: string
  ordered_source_envelopes_hash: string
  wire_events: ReplaySourceEventWireEvent[]
  wire_events_hash: string
  payloads_hash: string
  manifest_hash: string
}

export type ReplaySourceEventWireManifestBody = Omit<ReplaySourceEventWireManifest, "manifest_hash">

export function createReplaySourceEventWireEvent(body: ReplaySourceEventWireBody): ReplaySourceEventWireEvent {
  const payloadHash = canonicalHash(body.payload)
  const envelope = replaySourceEventWireEnvelope({
    ...structuredClone(body),
    schema_version: REPLAY_SOURCE_EVENT_WIRE_SCHEMA_VERSION,
    wire_event_id: "pending",
    payload_hash: payloadHash,
    source_envelope_hash: "0".repeat(64),
    execution_disposition: "candidate_wire_not_executable",
  })
  const sourceEnvelopeHash = canonicalHash(envelope)
  const value: ReplaySourceEventWireEvent = {
    ...structuredClone(body),
    schema_version: REPLAY_SOURCE_EVENT_WIRE_SCHEMA_VERSION,
    wire_event_id: `source-event-wire-${sourceEnvelopeHash.slice(0, 24)}`,
    payload_hash: payloadHash,
    source_envelope_hash: sourceEnvelopeHash,
    execution_disposition: "candidate_wire_not_executable",
  }
  assertReplaySourceEventWireEvent(value)
  return value
}

export function createReplaySourceEventWireManifest(
  body: ReplaySourceEventWireManifestBody,
): ReplaySourceEventWireManifest {
  const value: ReplaySourceEventWireManifest = {
    ...structuredClone(body),
    manifest_hash: canonicalHash(body),
  }
  assertReplaySourceEventWireManifest(value)
  return value
}

export function replaySourceEventWireEnvelope(event: ReplaySourceEventWireEvent): ReplayCrossSourceEventEnvelope {
  return {
    schema_version: REPLAY_CROSS_SOURCE_EVENT_ENVELOPE_SCHEMA_VERSION,
    source_kind: event.source_kind,
    event_kind: event.kind === "funding" ? "funding_settlement" : event.kind,
    symbol: event.symbol,
    effective_time: event.effective_time,
    availability_at: event.availability_at,
    native_event_id: event.native_event_id,
    payload_hash: event.payload_hash,
    event_key: structuredClone(event.ordering_key),
  }
}

export function assertReplaySourceEventWireManifest(value: ReplaySourceEventWireManifest): void {
  if (value.schema_version !== REPLAY_SOURCE_EVENT_WIRE_MANIFEST_SCHEMA_VERSION
      || value.wire_policy_version !== REPLAY_SOURCE_EVENT_WIRE_POLICY_VERSION
      || value.event_key_policy_version !== REPLAY_CROSS_SOURCE_EVENT_KEY_POLICY_VERSION
      || value.scope !== "candidate_source_event_wire_contract_only"
      || value.economic_authority !== "none"
      || value.runner_compatibility !== "not_bound"
      || value.payload_materialization !== "inline_typed"
      || value.migration_mode !== "parallel_epoch"
      || value.legacy_wire_status !== "preserved_unchanged"
      || value.legacy_semantic_parity !== "not_certified"
      || value.projection_schema_version !== REPLAY_SOURCE_EVENT_PROJECTION_ATTESTATION_SCHEMA_VERSION
      || value.projection_policy_version !== REPLAY_SOURCE_EVENT_PROJECTION_POLICY_VERSION) {
    throw new Error("unsupported Replay SourceEvent Wire authority or migration claim")
  }
  for (const [field, item] of Object.entries({
    wire_manifest_id: value.wire_manifest_id,
    projection_id: value.projection_id,
    ordering_admission_ref: value.ordering_admission_ref,
    ordering_attestation_id: value.ordering_attestation_id,
    reservation_ref: value.reservation_ref,
    dataset_manifest_ref: value.dataset_manifest_ref,
    symbol: value.symbol,
    timeframe: value.timeframe,
  })) requireText(item, `SourceEvent Wire ${field}`)
  for (const [field, item] of Object.entries({
    projection_hash: value.projection_hash,
    ordering_admission_hash: value.ordering_admission_hash,
    ordering_attestation_hash: value.ordering_attestation_hash,
    reservation_hash: value.reservation_hash,
    dataset_hash: value.dataset_hash,
    ambiguity_groups_hash: value.ambiguity_groups_hash,
    ordering_limitations_hash: value.ordering_limitations_hash,
    ordered_source_envelopes_hash: value.ordered_source_envelopes_hash,
    wire_events_hash: value.wire_events_hash,
    payloads_hash: value.payloads_hash,
    manifest_hash: value.manifest_hash,
  })) requireHash(item, `SourceEvent Wire ${field}`)
  requireUtc(value.window_start_inclusive, "SourceEvent Wire window_start_inclusive")
  requireUtc(value.window_end_exclusive, "SourceEvent Wire window_end_exclusive")
  if (Date.parse(value.window_start_inclusive) >= Date.parse(value.window_end_exclusive)) {
    throw new Error("SourceEvent Wire window must be positive and half-open")
  }
  if (canonicalHash(value.source_kinds)
      !== canonicalHash(["instrument_status", "funding", "aggregate_trade", "ohlcv"])) {
    throw new Error("SourceEvent Wire requires the canonical four-source set")
  }
  if (canonicalHash(value.migration_reasons) !== canonicalHash(REPLAY_SOURCE_EVENT_WIRE_MIGRATION_REASONS)) {
    throw new Error("SourceEvent Wire migration reasons are incomplete or non-canonical")
  }
  if (!Number.isSafeInteger(value.ambiguity_group_count) || value.ambiguity_group_count < 0
      || (value.ordering_resolution === "resolution_limited" && value.ambiguity_group_count === 0)
      || (value.ordering_resolution === "exact_by_declared_timestamps" && value.ambiguity_group_count !== 0)) {
    throw new Error("SourceEvent Wire ambiguity resolution overclaim")
  }
  if (value.wire_events.length === 0) throw new Error("SourceEvent Wire requires events")
  const sources = new Set<ReplayCrossSourceKind>()
  let previousKey: ReplayCrossSourceEventKey | null = null
  for (const event of value.wire_events) {
    assertReplaySourceEventWireEvent(event)
    sources.add(event.source_kind)
    if (event.symbol !== value.symbol || event.timeframe !== value.timeframe) {
      throw new Error("SourceEvent Wire event identity drift")
    }
    const effective = Date.parse(event.effective_time)
    if (effective < Date.parse(value.window_start_inclusive)
        || effective >= Date.parse(value.window_end_exclusive)) {
      throw new Error("SourceEvent Wire event falls outside the half-open window")
    }
    if (previousKey && compareReplayCrossSourceEventKeys(previousKey, event.ordering_key) >= 0) {
      throw new Error("SourceEvent Wire ordering keys must be unique and strictly increasing")
    }
    previousKey = event.ordering_key
  }
  if (canonicalHash([...sources].sort((left, right) =>
    REPLAY_CROSS_SOURCE_RANK_BY_SOURCE[left] - REPLAY_CROSS_SOURCE_RANK_BY_SOURCE[right]))
      !== canonicalHash(value.source_kinds)) {
    throw new Error("SourceEvent Wire event set does not cover all admitted sources")
  }
  const envelopes = value.wire_events.map(replaySourceEventWireEnvelope)
  if (value.ordered_source_envelopes_hash !== canonicalHash(envelopes)) {
    throw new Error("SourceEvent Wire does not bind the ordered source envelopes")
  }
  if (value.wire_events_hash !== canonicalHash(value.wire_events)) {
    throw new Error("SourceEvent Wire events hash mismatch")
  }
  if (value.payloads_hash !== canonicalHash(value.wire_events.map((event) => event.payload))) {
    throw new Error("SourceEvent Wire payloads hash mismatch")
  }
  const { manifest_hash: manifestHash, ...body } = value
  if (manifestHash !== canonicalHash(body)) throw new Error("SourceEvent Wire manifest hash mismatch")
}

export function assertReplaySourceEventWireEvent(value: ReplaySourceEventWireEvent): void {
  if (value.schema_version !== REPLAY_SOURCE_EVENT_WIRE_SCHEMA_VERSION
      || value.execution_disposition !== "candidate_wire_not_executable") {
    throw new Error("unsupported Replay SourceEvent Wire event authority")
  }
  requireText(value.symbol, "SourceEvent Wire event symbol")
  requireText(value.timeframe, "SourceEvent Wire event timeframe")
  requireText(value.native_event_id, "SourceEvent Wire event native_event_id")
  requireHash(value.payload_hash, "SourceEvent Wire event payload_hash")
  requireHash(value.source_envelope_hash, "SourceEvent Wire event source_envelope_hash")
  requireUtc(value.effective_time, "SourceEvent Wire event effective_time")
  requireUtc(value.availability_at, "SourceEvent Wire event availability_at")
  if (Date.parse(value.availability_at) < Date.parse(value.effective_time)) {
    throw new Error("SourceEvent Wire event cannot be available before effective time")
  }
  assertReplayCrossSourceEventKey(value.ordering_key)
  if (value.ordering_key.event_time !== value.effective_time
      || value.ordering_key.boundary_phase !== REPLAY_CROSS_SOURCE_PHASE_BY_SOURCE[value.source_kind]
      || value.ordering_key.source_rank !== REPLAY_CROSS_SOURCE_RANK_BY_SOURCE[value.source_kind]
      || value.ordering_key.stable_event_id !== value.native_event_id) {
    throw new Error("SourceEvent Wire ordering-key lineage drift")
  }
  assertWirePayloadBinding(value)
  if (value.payload_hash !== canonicalHash(value.payload)) throw new Error("SourceEvent Wire payload hash mismatch")
  const envelope = replaySourceEventWireEnvelope(value)
  assertReplayCrossSourceEventEnvelope(envelope)
  if (value.source_envelope_hash !== canonicalHash(envelope)) {
    throw new Error("SourceEvent Wire source envelope hash mismatch")
  }
  if (value.wire_event_id !== `source-event-wire-${value.source_envelope_hash.slice(0, 24)}`) {
    throw new Error("SourceEvent Wire event id does not bind its source envelope")
  }
}

function assertWirePayloadBinding(event: ReplaySourceEventWireEvent): void {
  if (event.source_kind === "instrument_status") {
    assertExactKeys(event.payload, [
      "schema_version", "snapshot_id", "venue_id", "symbol", "status", "effective_at",
      "valid_until", "observed_at", "source_ref", "source_hash",
    ], "instrument status wire payload")
    const payload = event.payload as ReplayInstrumentStatusSnapshot
    assertReplayInstrumentStatusSnapshot(payload)
    const expectedKind = payload.status === "halted" ? "instrument_halted" : "instrument_resumed"
    if (event.kind !== expectedKind || event.symbol !== payload.symbol
        || event.effective_time !== payload.effective_at || event.availability_at !== payload.observed_at) {
      throw new Error("SourceEvent Wire instrument-status payload lineage drift")
    }
    return
  }
  if (event.source_kind === "funding") {
    assertExactKeys(event.payload, ["timestamp", "rate", "mark_price"], "funding wire payload")
    const payload = event.payload as ReplayFundingEvent
    requireUtc(payload.timestamp, "SourceEvent Wire funding timestamp")
    if (!Number.isFinite(payload.rate) || !Number.isFinite(payload.mark_price) || payload.mark_price <= 0
        || event.kind !== "funding" || event.effective_time !== payload.timestamp
        || event.availability_at !== payload.timestamp) {
      throw new Error("SourceEvent Wire funding payload lineage drift")
    }
    return
  }
  if (event.source_kind === "aggregate_trade") {
    assertExactKeys(event.payload, [
      "schema_version", "symbol", "aggregate_trade_id", "first_trade_id", "last_trade_id",
      "trade_time", "available_at", "price", "quantity", "buyer_is_maker",
    ], "aggregate trade wire payload")
    const payload = event.payload as ReplayAggregateTradeEvent
    assertReplayAggregateTradeEvents([payload])
    if (payload.schema_version !== REPLAY_AGGREGATE_TRADE_EVENT_SCHEMA_VERSION
        || event.kind !== "aggregate_trade" || event.symbol !== payload.symbol
        || event.effective_time !== payload.trade_time || event.availability_at !== payload.available_at
        || event.ordering_key.source_sequence !== payload.aggregate_trade_id) {
      throw new Error("SourceEvent Wire aggregate-trade payload lineage drift")
    }
    return
  }
  if (event.source_kind !== "ohlcv" || !["bar_open", "bar_range"].includes(event.kind)) {
    throw new Error("SourceEvent Wire kind/source binding is invalid")
  }
  if (event.kind === "bar_open") {
    assertExactKeys(event.payload, ["open_time", "open"], "bar-open wire payload")
    const payload = event.payload as ReplaySourceEventBarOpenPayload
    requireUtc(payload.open_time, "SourceEvent Wire bar-open time")
    if (!Number.isFinite(payload.open) || payload.open <= 0 || event.effective_time !== payload.open_time
        || event.availability_at !== payload.open_time) {
      throw new Error("SourceEvent Wire bar-open payload lineage drift")
    }
    return
  }
  assertExactKeys(event.payload, ["open_time", "close_time", "open", "high", "low", "close", "volume", "closed"], "bar-range wire payload")
  const payload = event.payload as ReplayMarketBar
  assertReplayMarketBars([payload])
  if (event.effective_time !== payload.close_time || event.availability_at !== payload.close_time) {
    throw new Error("SourceEvent Wire bar-range payload lineage drift")
  }
}

function assertExactKeys(value: unknown, keys: string[], field: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || canonicalHash(Object.keys(value).sort()) !== canonicalHash([...keys].sort())) {
    throw new Error(`${field} fields are not canonical`)
  }
}
