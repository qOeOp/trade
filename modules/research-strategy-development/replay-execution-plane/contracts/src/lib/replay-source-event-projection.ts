import { canonicalHash } from "./replay-contracts"
import {
  REPLAY_CROSS_SOURCE_EVENT_KEY_POLICY_VERSION,
  REPLAY_CROSS_SOURCE_PHASE_BY_SOURCE,
  REPLAY_CROSS_SOURCE_RANK_BY_SOURCE,
  assertReplayCrossSourceEventKey,
  compareReplayCrossSourceEventKeys,
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
  type ReplayCrossSourceEventKey,
  type ReplayCrossSourceKind,
  type ReplayCrossSourceOrderingAttestation,
} from "./replay-cross-source-ordering"

export const REPLAY_SOURCE_EVENT_PROJECTION_SCHEMA_VERSION = "trade.rd-replay-source-event-projection.v1" as const
export const REPLAY_SOURCE_EVENT_PROJECTION_ATTESTATION_SCHEMA_VERSION = "trade.rd-replay-source-event-projection-attestation.v1" as const
export const REPLAY_SOURCE_EVENT_PROJECTION_POLICY_VERSION = "rd-replay-source-event-projection-v1" as const

export type ReplayProjectedSourceEventKind =
  | "instrument_halted"
  | "instrument_resumed"
  | "funding"
  | "aggregate_trade"
  | "bar_open"
  | "bar_range"

export type ReplaySourceEventProjectionLimitation =
  | "production-replay-source-event-schema-not-bound"
  | "aggregate-trade-engine-consumer-not-certified"
  | "semantic-payload-materialization-not-certified"

export const REPLAY_SOURCE_EVENT_PROJECTION_LIMITATIONS = Object.freeze([
  "production-replay-source-event-schema-not-bound",
  "aggregate-trade-engine-consumer-not-certified",
  "semantic-payload-materialization-not-certified",
] as const satisfies readonly ReplaySourceEventProjectionLimitation[])

export interface ReplaySourceEventProjection {
  schema_version: typeof REPLAY_SOURCE_EVENT_PROJECTION_SCHEMA_VERSION
  projection_event_id: string
  source_kind: ReplayCrossSourceKind
  projected_kind: ReplayProjectedSourceEventKind
  symbol: string
  source_index: number
  effective_time: string
  availability_at: string
  native_event_id: string
  payload_hash: string
  source_envelope_hash: string
  ordering_key: ReplayCrossSourceEventKey
  execution_disposition: "non_economic_projection_only"
}

export interface ReplaySourceEventProjectionAttestation {
  schema_version: typeof REPLAY_SOURCE_EVENT_PROJECTION_ATTESTATION_SCHEMA_VERSION
  projection_id: string
  projection_policy_version: typeof REPLAY_SOURCE_EVENT_PROJECTION_POLICY_VERSION
  scope: "pre_integration_source_event_projection_only"
  economic_authority: "none"
  production_source_event_compatibility: "not_asserted"
  payload_materialization: "hash_only"
  trial_id: string
  run_id: string
  reservation_ref: string
  reservation_hash: string
  dataset_manifest_ref: string
  dataset_hash: string
  ordering_admission_ref: string
  ordering_admission_hash: string
  ordering_attestation_id: string
  ordering_attestation_hash: string
  event_key_policy_version: typeof REPLAY_CROSS_SOURCE_EVENT_KEY_POLICY_VERSION
  symbol: string
  timeframe: string
  window_start_inclusive: string
  window_end_exclusive: string
  source_kinds: ["instrument_status", "funding", "aggregate_trade", "ohlcv"]
  ordering_resolution: ReplayCrossSourceOrderingAttestation["ordering_resolution"]
  ordered_events_hash: string
  ambiguity_groups_hash: string
  ambiguity_group_count: number
  ordering_limitations_hash: string
  projected_events: ReplaySourceEventProjection[]
  projected_events_hash: string
  projection_limitations: ReplaySourceEventProjectionLimitation[]
  projection_limitations_hash: string
  projection_hash: string
}

export type ReplaySourceEventProjectionAttestationBody = Omit<
  ReplaySourceEventProjectionAttestation,
  "projection_hash"
>

export function replayProjectedSourceEventKind(
  kind: ReplayCrossSourceOrderingAttestation["ordered_events"][number]["event_kind"],
): ReplayProjectedSourceEventKind {
  return kind === "funding_settlement" ? "funding" : kind
}

export function createReplaySourceEventProjectionAttestation(
  body: ReplaySourceEventProjectionAttestationBody,
): ReplaySourceEventProjectionAttestation {
  const value: ReplaySourceEventProjectionAttestation = {
    ...structuredClone(body),
    projection_hash: canonicalHash(body),
  }
  assertReplaySourceEventProjectionAttestation(value)
  return value
}

export function assertReplaySourceEventProjectionAttestation(
  value: ReplaySourceEventProjectionAttestation,
): void {
  if (value.schema_version !== REPLAY_SOURCE_EVENT_PROJECTION_ATTESTATION_SCHEMA_VERSION
      || value.projection_policy_version !== REPLAY_SOURCE_EVENT_PROJECTION_POLICY_VERSION
      || value.scope !== "pre_integration_source_event_projection_only"
      || value.economic_authority !== "none"
      || value.production_source_event_compatibility !== "not_asserted"
      || value.payload_materialization !== "hash_only"
      || value.event_key_policy_version !== REPLAY_CROSS_SOURCE_EVENT_KEY_POLICY_VERSION) {
    throw new Error("unsupported Replay SourceEvent projection authority")
  }
  for (const [field, item] of Object.entries({
    projection_id: value.projection_id,
    trial_id: value.trial_id,
    run_id: value.run_id,
    reservation_ref: value.reservation_ref,
    dataset_manifest_ref: value.dataset_manifest_ref,
    ordering_admission_ref: value.ordering_admission_ref,
    ordering_attestation_id: value.ordering_attestation_id,
    symbol: value.symbol,
    timeframe: value.timeframe,
  })) requireText(item, `source-event projection ${field}`)
  for (const [field, item] of Object.entries({
    reservation_hash: value.reservation_hash,
    dataset_hash: value.dataset_hash,
    ordering_admission_hash: value.ordering_admission_hash,
    ordering_attestation_hash: value.ordering_attestation_hash,
    ordered_events_hash: value.ordered_events_hash,
    ambiguity_groups_hash: value.ambiguity_groups_hash,
    ordering_limitations_hash: value.ordering_limitations_hash,
    projected_events_hash: value.projected_events_hash,
    projection_limitations_hash: value.projection_limitations_hash,
    projection_hash: value.projection_hash,
  })) requireHash(item, `source-event projection ${field}`)
  requireUtc(value.window_start_inclusive, "source-event projection window_start_inclusive")
  requireUtc(value.window_end_exclusive, "source-event projection window_end_exclusive")
  if (Date.parse(value.window_start_inclusive) >= Date.parse(value.window_end_exclusive)) {
    throw new Error("source-event projection window must be positive and half-open")
  }
  if (canonicalHash(value.source_kinds)
      !== canonicalHash(["instrument_status", "funding", "aggregate_trade", "ohlcv"])) {
    throw new Error("source-event projection requires the canonical four-source set")
  }
  if (!["exact_by_declared_timestamps", "resolution_limited"].includes(value.ordering_resolution)) {
    throw new Error("unsupported source-event projection ordering resolution")
  }
  if (!Number.isSafeInteger(value.ambiguity_group_count) || value.ambiguity_group_count < 0
      || (value.ordering_resolution === "resolution_limited" && value.ambiguity_group_count === 0)
      || (value.ordering_resolution === "exact_by_declared_timestamps" && value.ambiguity_group_count !== 0)) {
    throw new Error("source-event projection ambiguity resolution overclaim")
  }
  if (value.projected_events.length === 0) throw new Error("source-event projection requires projected events")
  let previousKey: ReplayCrossSourceEventKey | null = null
  const ids = new Set<string>()
  for (const event of value.projected_events) {
    assertReplaySourceEventProjection(event)
    if (event.symbol !== value.symbol) throw new Error("source-event projection symbol drift")
    const effective = Date.parse(event.effective_time)
    if (effective < Date.parse(value.window_start_inclusive)
        || effective >= Date.parse(value.window_end_exclusive)) {
      throw new Error("projected SourceEvent falls outside the half-open window")
    }
    if (ids.has(event.projection_event_id)) throw new Error("projected SourceEvent ids must be unique")
    ids.add(event.projection_event_id)
    if (previousKey && compareReplayCrossSourceEventKeys(previousKey, event.ordering_key) >= 0) {
      throw new Error("projected SourceEvent ordering keys must be strictly increasing")
    }
    previousKey = event.ordering_key
  }
  if (value.projected_events_hash !== canonicalHash(value.projected_events)) {
    throw new Error("projected SourceEvent collection hash mismatch")
  }
  if (canonicalHash(value.projection_limitations) !== canonicalHash(REPLAY_SOURCE_EVENT_PROJECTION_LIMITATIONS)
      || value.projection_limitations_hash !== canonicalHash(value.projection_limitations)) {
    throw new Error("source-event projection limitations are incomplete or non-canonical")
  }
  const { projection_hash: projectionHash, ...body } = value
  if (projectionHash !== canonicalHash(body)) throw new Error("source-event projection attestation hash mismatch")
}

export function assertReplaySourceEventProjection(value: ReplaySourceEventProjection): void {
  if (value.schema_version !== REPLAY_SOURCE_EVENT_PROJECTION_SCHEMA_VERSION
      || value.execution_disposition !== "non_economic_projection_only") {
    throw new Error("unsupported projected SourceEvent authority")
  }
  requireText(value.projection_event_id, "projected SourceEvent projection_event_id")
  requireText(value.symbol, "projected SourceEvent symbol")
  requireText(value.native_event_id, "projected SourceEvent native_event_id")
  requireHash(value.payload_hash, "projected SourceEvent payload_hash")
  requireHash(value.source_envelope_hash, "projected SourceEvent source_envelope_hash")
  requireUtc(value.effective_time, "projected SourceEvent effective_time")
  requireUtc(value.availability_at, "projected SourceEvent availability_at")
  if (Date.parse(value.availability_at) < Date.parse(value.effective_time)) {
    throw new Error("projected SourceEvent cannot be available before effective time")
  }
  if (!Number.isSafeInteger(value.source_index) || value.source_index < 0) {
    throw new Error("projected SourceEvent source_index must be a non-negative safe integer")
  }
  assertReplayCrossSourceEventKey(value.ordering_key)
  if (value.ordering_key.event_time !== value.effective_time
      || value.ordering_key.boundary_phase !== REPLAY_CROSS_SOURCE_PHASE_BY_SOURCE[value.source_kind]
      || value.ordering_key.source_rank !== REPLAY_CROSS_SOURCE_RANK_BY_SOURCE[value.source_kind]
      || value.ordering_key.source_sequence !== value.source_index
      || value.ordering_key.stable_event_id !== value.native_event_id) {
    throw new Error("projected SourceEvent ordering lineage drift")
  }
  const allowedKinds: Record<ReplayCrossSourceKind, readonly ReplayProjectedSourceEventKind[]> = {
    instrument_status: ["instrument_halted", "instrument_resumed"],
    funding: ["funding"],
    aggregate_trade: ["aggregate_trade"],
    ohlcv: ["bar_open", "bar_range"],
  }
  if (!allowedKinds[value.source_kind].includes(value.projected_kind)) {
    throw new Error("projected SourceEvent kind/source binding is invalid")
  }
}
