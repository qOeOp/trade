import { canonicalHash } from "./replay-contracts"

export const REPLAY_CROSS_SOURCE_EVENT_ENVELOPE_SCHEMA_VERSION = "trade.rd-replay-cross-source-event-envelope.v1" as const
export const REPLAY_CROSS_SOURCE_ORDERING_ATTESTATION_SCHEMA_VERSION = "trade.rd-replay-cross-source-ordering-attestation.v1" as const
export const REPLAY_CROSS_SOURCE_EVENT_KEY_POLICY_VERSION = "rd-replay-cross-source-event-key-v1" as const

export type ReplayCrossSourceKind = "instrument_status" | "funding" | "aggregate_trade" | "ohlcv"
export type ReplayCrossSourceEventKind =
  | "instrument_halted"
  | "instrument_resumed"
  | "funding_settlement"
  | "aggregate_trade"
  | "bar_open"
  | "bar_range"

export type ReplayCrossSourceOrderingLimitation =
  | "cross-source-global-sequence-unavailable"
  | "source-clock-resolution-does-not-prove-within-timestamp-order"
  | "aggregate-trade-external-completeness-not-verified"
  | "funding-external-completeness-not-asserted"
  | "ohlcv-aggregate-trade-bar-link-not-attested"
  | "instrument-status-effective-vs-availability-separated"

export const REPLAY_CROSS_SOURCE_PHASE_BY_SOURCE = Object.freeze({
  instrument_status: 0,
  funding: 10,
  aggregate_trade: 20,
  ohlcv: 20,
} as const)

export const REPLAY_CROSS_SOURCE_RANK_BY_SOURCE = Object.freeze({
  instrument_status: 0,
  funding: 10,
  aggregate_trade: 20,
  ohlcv: 30,
} as const)

const EVENT_KINDS_BY_SOURCE: Record<ReplayCrossSourceKind, readonly ReplayCrossSourceEventKind[]> = {
  instrument_status: ["instrument_halted", "instrument_resumed"],
  funding: ["funding_settlement"],
  aggregate_trade: ["aggregate_trade"],
  ohlcv: ["bar_open", "bar_range"],
}

const NATIVE_ORDERING_BY_SOURCE = {
  instrument_status: "effective-time-then-archive-sequence",
  funding: "event-time-then-manifest-sequence",
  aggregate_trade: "strict-contiguous-aggregate-trade-id",
  ohlcv: "bar-open-then-range-with-previous-close-before-next-open",
} as const

const COMPLETENESS_BY_SOURCE = {
  instrument_status: ["complete_history", "current_snapshot_only"],
  funding: ["manifest_bound_not_externally_certified"],
  aggregate_trade: ["not_verified"],
  ohlcv: ["manifest_bound_closed_candles"],
} as const

export interface ReplayCrossSourceEventKey {
  event_time: string
  boundary_phase: 0 | 10 | 20
  source_rank: 0 | 10 | 20 | 30
  source_sequence: number
  stable_event_id: string
}

export interface ReplayCrossSourceEventEnvelope {
  schema_version: typeof REPLAY_CROSS_SOURCE_EVENT_ENVELOPE_SCHEMA_VERSION
  source_kind: ReplayCrossSourceKind
  event_kind: ReplayCrossSourceEventKind
  symbol: string
  effective_time: string
  availability_at: string
  native_event_id: string
  payload_hash: string
  event_key: ReplayCrossSourceEventKey
}

export interface ReplayCrossSourceCollectionBinding {
  source_kind: ReplayCrossSourceKind
  source_record_count: number
  emitted_event_count: number
  content_hash: string
  native_ordering: typeof NATIVE_ORDERING_BY_SOURCE[ReplayCrossSourceKind]
  external_completeness: typeof COMPLETENESS_BY_SOURCE[ReplayCrossSourceKind][number]
}

export interface ReplayCrossSourceAmbiguityGroup {
  event_time: string
  source_kinds: ReplayCrossSourceKind[]
  stable_event_ids: string[]
  reason: "cross_source_global_sequence_unavailable"
  deterministic_policy: "semantic_phase_then_source_rank_then_native_sequence"
}

export interface ReplayCrossSourceOrderingAttestation {
  schema_version: typeof REPLAY_CROSS_SOURCE_ORDERING_ATTESTATION_SCHEMA_VERSION
  attestation_id: string
  scope: "pre_integration_ordering_evidence_only"
  economic_admission: "forbidden_until_runner_contract_binds_attestation"
  key_policy_version: typeof REPLAY_CROSS_SOURCE_EVENT_KEY_POLICY_VERSION
  symbol: string
  timeframe: string
  window_start_inclusive: string
  window_end_exclusive: string
  source_collections: ReplayCrossSourceCollectionBinding[]
  ordered_events: ReplayCrossSourceEventEnvelope[]
  ordered_events_hash: string
  ambiguity_groups: ReplayCrossSourceAmbiguityGroup[]
  ordering_resolution: "exact_by_declared_timestamps" | "resolution_limited"
  limitations: ReplayCrossSourceOrderingLimitation[]
  attestation_hash: string
}

export type ReplayCrossSourceOrderingAttestationBody = Omit<ReplayCrossSourceOrderingAttestation, "attestation_hash">

export function compareReplayCrossSourceEventKeys(
  left: ReplayCrossSourceEventKey,
  right: ReplayCrossSourceEventKey,
): number {
  assertReplayCrossSourceEventKey(left)
  assertReplayCrossSourceEventKey(right)
  const leftTime = Date.parse(left.event_time)
  const rightTime = Date.parse(right.event_time)
  if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1
  for (const field of ["boundary_phase", "source_rank", "source_sequence"] as const) {
    if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1
  }
  if (left.stable_event_id === right.stable_event_id) return 0
  return left.stable_event_id < right.stable_event_id ? -1 : 1
}

export function replayCrossSourceOrderingAttestationHash(
  value: ReplayCrossSourceOrderingAttestationBody,
): string {
  return canonicalHash(value)
}

export function replayCrossSourceAmbiguityGroups(
  events: ReplayCrossSourceEventEnvelope[],
): ReplayCrossSourceAmbiguityGroup[] {
  const byTime = new Map<string, ReplayCrossSourceEventEnvelope[]>()
  for (const event of events) {
    const group = byTime.get(event.effective_time) ?? []
    group.push(event)
    byTime.set(event.effective_time, group)
  }
  return [...byTime.entries()]
    .sort(([left], [right]) => Date.parse(left) - Date.parse(right))
    .flatMap(([eventTime, group]) => {
      const sourceKinds = [...new Set(group.map((event) => event.source_kind))]
        .sort((left, right) => REPLAY_CROSS_SOURCE_RANK_BY_SOURCE[left] - REPLAY_CROSS_SOURCE_RANK_BY_SOURCE[right])
      if (sourceKinds.length < 2) return []
      return [{
        event_time: eventTime,
        source_kinds: sourceKinds,
        stable_event_ids: group.map((event) => event.event_key.stable_event_id).sort(),
        reason: "cross_source_global_sequence_unavailable" as const,
        deterministic_policy: "semantic_phase_then_source_rank_then_native_sequence" as const,
      }]
    })
}

export function replayCrossSourceOrderingLimitations(
  events: ReplayCrossSourceEventEnvelope[],
  ambiguityGroups: ReplayCrossSourceAmbiguityGroup[],
): ReplayCrossSourceOrderingLimitation[] {
  const sources = new Set(events.map((event) => event.source_kind))
  const limitations: ReplayCrossSourceOrderingLimitation[] = []
  if (ambiguityGroups.length > 0) {
    limitations.push(
      "cross-source-global-sequence-unavailable",
      "source-clock-resolution-does-not-prove-within-timestamp-order",
    )
  }
  if (sources.has("aggregate_trade")) limitations.push("aggregate-trade-external-completeness-not-verified")
  if (sources.has("funding")) limitations.push("funding-external-completeness-not-asserted")
  if (sources.has("aggregate_trade") && sources.has("ohlcv")) limitations.push("ohlcv-aggregate-trade-bar-link-not-attested")
  if (events.some((event) => event.source_kind === "instrument_status"
      && event.availability_at !== event.effective_time)) {
    limitations.push("instrument-status-effective-vs-availability-separated")
  }
  return limitations
}

export function assertReplayCrossSourceOrderingAttestation(value: ReplayCrossSourceOrderingAttestation): void {
  if (value.schema_version !== REPLAY_CROSS_SOURCE_ORDERING_ATTESTATION_SCHEMA_VERSION
      || value.scope !== "pre_integration_ordering_evidence_only"
      || value.economic_admission !== "forbidden_until_runner_contract_binds_attestation"
      || value.key_policy_version !== REPLAY_CROSS_SOURCE_EVENT_KEY_POLICY_VERSION) {
    throw new Error("unsupported Replay cross-source ordering authority")
  }
  requireText(value.attestation_id, "cross-source attestation_id")
  requireText(value.symbol, "cross-source symbol")
  requireText(value.timeframe, "cross-source timeframe")
  requireUtc(value.window_start_inclusive, "cross-source window_start_inclusive")
  requireUtc(value.window_end_exclusive, "cross-source window_end_exclusive")
  if (Date.parse(value.window_start_inclusive) >= Date.parse(value.window_end_exclusive)) {
    throw new Error("cross-source ordering window must be positive and half-open")
  }
  if (value.source_collections.length === 0 || value.ordered_events.length === 0) {
    throw new Error("cross-source ordering evidence requires at least one source and event")
  }
  const collectionSources = new Set<ReplayCrossSourceKind>()
  let previousRank = -1
  for (const collection of value.source_collections) {
    if (collectionSources.has(collection.source_kind)) throw new Error("cross-source collection source must be unique")
    collectionSources.add(collection.source_kind)
    const rank = REPLAY_CROSS_SOURCE_RANK_BY_SOURCE[collection.source_kind]
    if (rank <= previousRank) throw new Error("cross-source collections must use canonical source-rank order")
    previousRank = rank
    if (!Number.isSafeInteger(collection.source_record_count) || collection.source_record_count <= 0
        || !Number.isSafeInteger(collection.emitted_event_count) || collection.emitted_event_count <= 0) {
      throw new Error("cross-source collection counts must be positive safe integers")
    }
    requireHash(collection.content_hash, "cross-source collection content_hash")
    if (collection.native_ordering !== NATIVE_ORDERING_BY_SOURCE[collection.source_kind]) {
      throw new Error("cross-source collection native ordering policy mismatch")
    }
    if (!(COMPLETENESS_BY_SOURCE[collection.source_kind] as readonly string[])
      .includes(collection.external_completeness)) {
      throw new Error("cross-source collection completeness claim is unsupported")
    }
  }
  let previousKey: ReplayCrossSourceEventKey | null = null
  const eventCounts = new Map<ReplayCrossSourceKind, number>()
  for (const event of value.ordered_events) {
    assertReplayCrossSourceEventEnvelope(event)
    if (!collectionSources.has(event.source_kind)) throw new Error("cross-source event lacks a collection binding")
    const eventTime = Date.parse(event.effective_time)
    const closesWindow = event.source_kind === "ohlcv"
      && event.event_kind === "bar_range"
      && event.effective_time === value.window_end_exclusive
    if (eventTime < Date.parse(value.window_start_inclusive)
        || (eventTime >= Date.parse(value.window_end_exclusive) && !closesWindow)) {
      throw new Error("cross-source event falls outside the half-open ordering window")
    }
    if (previousKey && compareReplayCrossSourceEventKeys(previousKey, event.event_key) >= 0) {
      throw new Error("cross-source EventKeys must be unique and strictly increasing")
    }
    previousKey = event.event_key
    eventCounts.set(event.source_kind, (eventCounts.get(event.source_kind) ?? 0) + 1)
  }
  for (const collection of value.source_collections) {
    if (eventCounts.get(collection.source_kind) !== collection.emitted_event_count) {
      throw new Error("cross-source collection event count mismatch")
    }
  }
  requireHash(value.ordered_events_hash, "cross-source ordered_events_hash")
  if (value.ordered_events_hash !== canonicalHash(value.ordered_events)) {
    throw new Error("cross-source ordered events hash mismatch")
  }
  const ambiguityGroups = replayCrossSourceAmbiguityGroups(value.ordered_events)
  if (canonicalHash(value.ambiguity_groups) !== canonicalHash(ambiguityGroups)) {
    throw new Error("cross-source ambiguity groups are incomplete or inconsistent")
  }
  const expectedResolution = ambiguityGroups.length > 0 ? "resolution_limited" : "exact_by_declared_timestamps"
  if (value.ordering_resolution !== expectedResolution) throw new Error("cross-source ordering resolution overclaims evidence")
  const limitations = replayCrossSourceOrderingLimitations(value.ordered_events, ambiguityGroups)
  if (canonicalHash(value.limitations) !== canonicalHash(limitations)) {
    throw new Error("cross-source ordering limitations are incomplete or inconsistent")
  }
  requireHash(value.attestation_hash, "cross-source attestation_hash")
  const { attestation_hash: attestationHash, ...body } = value
  if (attestationHash !== replayCrossSourceOrderingAttestationHash(body)) {
    throw new Error("cross-source ordering attestation hash mismatch")
  }
}

export function assertReplayCrossSourceEventEnvelope(value: ReplayCrossSourceEventEnvelope): void {
  if (value.schema_version !== REPLAY_CROSS_SOURCE_EVENT_ENVELOPE_SCHEMA_VERSION) {
    throw new Error("unsupported Replay cross-source event envelope")
  }
  requireText(value.symbol, "cross-source event symbol")
  requireText(value.native_event_id, "cross-source native_event_id")
  requireHash(value.payload_hash, "cross-source payload_hash")
  requireUtc(value.effective_time, "cross-source effective_time")
  requireUtc(value.availability_at, "cross-source availability_at")
  if (Date.parse(value.availability_at) < Date.parse(value.effective_time)) {
    throw new Error("cross-source event cannot be available before it is effective")
  }
  if (!EVENT_KINDS_BY_SOURCE[value.source_kind]?.includes(value.event_kind)) {
    throw new Error("cross-source event kind/source binding is invalid")
  }
  assertReplayCrossSourceEventKey(value.event_key)
  if (value.event_key.event_time !== value.effective_time
      || value.event_key.boundary_phase !== REPLAY_CROSS_SOURCE_PHASE_BY_SOURCE[value.source_kind]
      || value.event_key.source_rank !== REPLAY_CROSS_SOURCE_RANK_BY_SOURCE[value.source_kind]
      || value.event_key.stable_event_id !== value.native_event_id) {
    throw new Error("cross-source EventKey does not bind its source event")
  }
}

export function assertReplayCrossSourceEventKey(value: ReplayCrossSourceEventKey): void {
  requireUtc(value.event_time, "cross-source EventKey event_time")
  if (![0, 10, 20].includes(value.boundary_phase)) throw new Error("unsupported cross-source boundary phase")
  if (![0, 10, 20, 30].includes(value.source_rank)) throw new Error("unsupported cross-source source rank")
  if (!Number.isSafeInteger(value.source_sequence) || value.source_sequence < 0) {
    throw new Error("cross-source source_sequence must be a non-negative safe integer")
  }
  requireText(value.stable_event_id, "cross-source stable_event_id")
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`)
  return value
}

function requireHash(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${field} must be a lowercase sha256 digest`)
  return value
}

function requireUtc(value: unknown, field: string): string {
  if (typeof value !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
      || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be an RFC 3339 UTC timestamp`)
  }
  return value
}

export {
  requireHash as requireReplayCrossSourceHash,
  requireText as requireReplayCrossSourceText,
  requireUtc as requireReplayCrossSourceUtc,
}
