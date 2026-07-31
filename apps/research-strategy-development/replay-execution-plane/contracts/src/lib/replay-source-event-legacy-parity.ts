import {
  assertReplayEventKey,
  canonicalHash,
  type ReplayInstrumentStatusSnapshot,
  type ReplaySourceEvent,
} from "./replay-contracts"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"
import {
  REPLAY_SOURCE_EVENT_WIRE_POLICY_VERSION,
  assertReplaySourceEventWireManifest,
  type ReplaySourceEventWireManifest,
} from "./replay-source-event-wire"

export const REPLAY_SOURCE_EVENT_LEGACY_PARITY_SCHEMA_VERSION = "trade.rd-replay-source-event-legacy-parity.v1" as const
export const REPLAY_SOURCE_EVENT_LEGACY_PARITY_POLICY_VERSION = "rd-replay-source-event-legacy-parity-v1" as const

export const REPLAY_SOURCE_EVENT_SHARED_KINDS = Object.freeze([
  "instrument_halted",
  "instrument_resumed",
  "funding",
  "bar_open",
  "bar_range",
] as const)

export const REPLAY_SOURCE_EVENT_WIRE_ONLY_KINDS = Object.freeze(["aggregate_trade"] as const)
export const REPLAY_SOURCE_EVENT_LEGACY_SCHEMA_ONLY_KINDS = Object.freeze(["instrument_delisted", "mark"] as const)

export type ReplaySourceEventSharedKind = typeof REPLAY_SOURCE_EVENT_SHARED_KINDS[number]

export interface ReplaySourceEventLegacyParityMatch {
  kind: ReplaySourceEventSharedKind
  effective_time: string
  instrument_status_snapshot_id: string | null
  wire_event_id: string
  legacy_source_event_id: string
}

export interface ReplaySourceEventLegacyParityAttestation {
  schema_version: typeof REPLAY_SOURCE_EVENT_LEGACY_PARITY_SCHEMA_VERSION
  parity_attestation_id: string
  parity_policy_version: typeof REPLAY_SOURCE_EVENT_LEGACY_PARITY_POLICY_VERSION
  wire_policy_version: typeof REPLAY_SOURCE_EVENT_WIRE_POLICY_VERSION
  scope: "legacy_shared_event_schedule_parity_only"
  economic_authority: "none"
  runner_compatibility: "not_bound"
  shared_event_schedule_parity: "certified"
  payload_parity: "not_asserted_legacy_payload_out_of_line"
  event_key_parity: "not_asserted_incompatible_key_schema"
  cross_source_order_parity: "not_asserted"
  wire_manifest_id: string
  wire_manifest_hash: string
  shared_kinds: ReplaySourceEventSharedKind[]
  wire_only_kinds: ["aggregate_trade"]
  legacy_schema_only_kinds: ["instrument_delisted", "mark"]
  wire_shared_events_hash: string
  legacy_source_events_hash: string
  match_count: number
  matches: ReplaySourceEventLegacyParityMatch[]
  matches_hash: string
  attestation_hash: string
}

export type ReplaySourceEventLegacyParityAttestationBody = Omit<
  ReplaySourceEventLegacyParityAttestation,
  "attestation_hash"
>

export function createReplaySourceEventLegacyParityAttestation(
  body: ReplaySourceEventLegacyParityAttestationBody,
): ReplaySourceEventLegacyParityAttestation {
  const value: ReplaySourceEventLegacyParityAttestation = {
    ...structuredClone(body),
    attestation_hash: canonicalHash(body),
  }
  assertReplaySourceEventLegacyParityAttestation(value)
  return value
}

export function assertReplaySourceEventLegacyParityAttestation(
  value: ReplaySourceEventLegacyParityAttestation,
): void {
  if (value.schema_version !== REPLAY_SOURCE_EVENT_LEGACY_PARITY_SCHEMA_VERSION
      || value.parity_policy_version !== REPLAY_SOURCE_EVENT_LEGACY_PARITY_POLICY_VERSION
      || value.wire_policy_version !== REPLAY_SOURCE_EVENT_WIRE_POLICY_VERSION
      || value.scope !== "legacy_shared_event_schedule_parity_only"
      || value.economic_authority !== "none"
      || value.runner_compatibility !== "not_bound"
      || value.shared_event_schedule_parity !== "certified"
      || value.payload_parity !== "not_asserted_legacy_payload_out_of_line"
      || value.event_key_parity !== "not_asserted_incompatible_key_schema"
      || value.cross_source_order_parity !== "not_asserted") {
    throw new Error("unsupported Replay SourceEvent legacy parity claim")
  }
  requireText(value.parity_attestation_id, "SourceEvent parity attestation_id")
  requireText(value.wire_manifest_id, "SourceEvent parity wire_manifest_id")
  for (const [field, item] of Object.entries({
    wire_manifest_hash: value.wire_manifest_hash,
    wire_shared_events_hash: value.wire_shared_events_hash,
    legacy_source_events_hash: value.legacy_source_events_hash,
    matches_hash: value.matches_hash,
    attestation_hash: value.attestation_hash,
  })) requireHash(item, `SourceEvent parity ${field}`)
  if (canonicalHash(value.shared_kinds) !== canonicalHash(REPLAY_SOURCE_EVENT_SHARED_KINDS)
      || canonicalHash(value.wire_only_kinds) !== canonicalHash(REPLAY_SOURCE_EVENT_WIRE_ONLY_KINDS)
      || canonicalHash(value.legacy_schema_only_kinds) !== canonicalHash(REPLAY_SOURCE_EVENT_LEGACY_SCHEMA_ONLY_KINDS)) {
    throw new Error("SourceEvent parity kind coverage is incomplete or non-canonical")
  }
  if (!Number.isSafeInteger(value.match_count) || value.match_count <= 0
      || value.match_count !== value.matches.length) {
    throw new Error("SourceEvent parity match count is invalid")
  }
  const wireIds = new Set<string>()
  const legacyIds = new Set<string>()
  let previousSemanticKey = ""
  for (const match of value.matches) {
    if (!(REPLAY_SOURCE_EVENT_SHARED_KINDS as readonly string[]).includes(match.kind)) {
      throw new Error("SourceEvent parity match kind is not shared")
    }
    requireUtc(match.effective_time, "SourceEvent parity match effective_time")
    requireText(match.wire_event_id, "SourceEvent parity match wire_event_id")
    requireText(match.legacy_source_event_id, "SourceEvent parity match legacy_source_event_id")
    const isStatus = match.kind === "instrument_halted" || match.kind === "instrument_resumed"
    if (isStatus !== (match.instrument_status_snapshot_id !== null)) {
      throw new Error("SourceEvent parity status snapshot binding is invalid")
    }
    if (wireIds.has(match.wire_event_id) || legacyIds.has(match.legacy_source_event_id)) {
      throw new Error("SourceEvent parity matches must be one-to-one")
    }
    wireIds.add(match.wire_event_id)
    legacyIds.add(match.legacy_source_event_id)
    const semanticKey = replaySourceEventParitySemanticKey(match)
    if (semanticKey <= previousSemanticKey) throw new Error("SourceEvent parity matches must use canonical semantic order")
    previousSemanticKey = semanticKey
  }
  if (value.matches_hash !== canonicalHash(value.matches)) throw new Error("SourceEvent parity matches hash mismatch")
  const { attestation_hash: attestationHash, ...body } = value
  if (attestationHash !== canonicalHash(body)) throw new Error("SourceEvent parity attestation hash mismatch")
}

export function assertReplayLegacySourceEvents(events: ReplaySourceEvent[]): void {
  const ids = new Set<string>()
  for (const event of events) {
    requireText(event.source_event_id, "legacy SourceEvent id")
    if (ids.has(event.source_event_id)) throw new Error("legacy SourceEvent ids must be unique")
    ids.add(event.source_event_id)
    if (!Number.isSafeInteger(event.source_index) || event.source_index < 0) {
      throw new Error("legacy SourceEvent source_index must be a non-negative safe integer")
    }
    assertReplayEventKey(event.event_key)
    if (event.event_key.event_time === "") throw new Error("legacy SourceEvent event time is required")
    const isStatus = event.kind === "instrument_halted" || event.kind === "instrument_resumed"
    if (isStatus !== (event.instrument_status_snapshot_id !== undefined)) {
      throw new Error("legacy SourceEvent status snapshot binding is invalid")
    }
  }
}

export function replaySourceEventParitySemanticKey(value: {
  kind: ReplaySourceEventSharedKind
  effective_time: string
  instrument_status_snapshot_id: string | null
}): string {
  return `${value.kind}\u0000${value.effective_time}\u0000${value.instrument_status_snapshot_id ?? ""}`
}

export function replaySourceEventLegacyParityMatches(
  wire: ReplaySourceEventWireManifest,
  legacyEvents: ReplaySourceEvent[],
): ReplaySourceEventLegacyParityMatch[] {
  assertReplaySourceEventWireManifest(wire)
  assertReplayLegacySourceEvents(legacyEvents)
  const shared = (kind: string): kind is ReplaySourceEventSharedKind =>
    (REPLAY_SOURCE_EVENT_SHARED_KINDS as readonly string[]).includes(kind)
  const wireValues = wire.wire_events.filter((event) => shared(event.kind)).map((event) => ({
    semantic_key: replaySourceEventParitySemanticKey({
      kind: event.kind as ReplaySourceEventSharedKind,
      effective_time: event.effective_time,
      instrument_status_snapshot_id: event.kind === "instrument_halted" || event.kind === "instrument_resumed"
        ? (event.payload as ReplayInstrumentStatusSnapshot).snapshot_id
        : null,
    }),
    event,
  }))
  const legacyValues = legacyEvents.filter((event) => shared(event.kind)).map((event) => ({
    semantic_key: replaySourceEventParitySemanticKey({
      kind: event.kind as ReplaySourceEventSharedKind,
      effective_time: event.event_key.event_time,
      instrument_status_snapshot_id: event.instrument_status_snapshot_id ?? null,
    }),
    event,
  }))
  const unique = <T extends { semantic_key: string }>(values: T[], source: string): Map<string, T> => {
    const result = new Map<string, T>()
    for (const value of values) {
      if (result.has(value.semantic_key)) throw new Error(`${source} SourceEvent shared schedule is not semantically unique`)
      result.set(value.semantic_key, value)
    }
    return result
  }
  const wireByKey = unique(wireValues, "Wire v2")
  const legacyByKey = unique(legacyValues, "legacy")
  if (wireByKey.size !== legacyByKey.size || wireByKey.size === 0) {
    throw new Error("SourceEvent shared schedule cardinality parity failed")
  }
  return [...wireByKey.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, wireValue]) => {
    const legacyValue = legacyByKey.get(key)
    if (!legacyValue) throw new Error("SourceEvent shared schedule semantic parity failed")
    const wireEvent = wireValue.event
    return {
      kind: wireEvent.kind as ReplaySourceEventSharedKind,
      effective_time: wireEvent.effective_time,
      instrument_status_snapshot_id: wireEvent.kind === "instrument_halted" || wireEvent.kind === "instrument_resumed"
        ? (wireEvent.payload as ReplayInstrumentStatusSnapshot).snapshot_id
        : null,
      wire_event_id: wireEvent.wire_event_id,
      legacy_source_event_id: legacyValue.event.source_event_id,
    }
  })
}

export function assertReplaySourceEventLegacyParityLineage(
  parity: ReplaySourceEventLegacyParityAttestation,
  wire: ReplaySourceEventWireManifest,
  legacyEvents: ReplaySourceEvent[],
): void {
  assertReplaySourceEventLegacyParityAttestation(parity)
  assertReplaySourceEventWireManifest(wire)
  assertReplayLegacySourceEvents(legacyEvents)
  const sharedWire = wire.wire_events.filter((event) =>
    (REPLAY_SOURCE_EVENT_SHARED_KINDS as readonly string[]).includes(event.kind))
  const expectedMatches = replaySourceEventLegacyParityMatches(wire, legacyEvents)
  if (parity.wire_manifest_id !== wire.wire_manifest_id
      || parity.wire_manifest_hash !== wire.manifest_hash
      || parity.wire_shared_events_hash !== canonicalHash(sharedWire)
      || parity.legacy_source_events_hash !== canonicalHash(legacyEvents)
      || parity.matches_hash !== canonicalHash(expectedMatches)
      || canonicalHash(parity.matches) !== canonicalHash(expectedMatches)) {
    throw new Error("SourceEvent parity source lineage drift")
  }
}
