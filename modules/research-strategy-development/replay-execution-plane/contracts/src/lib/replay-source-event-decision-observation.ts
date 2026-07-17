import {
  canonicalHash,
  type ReplayAggregateTradeEvent,
  type ReplayFundingEvent,
  type ReplayInstrumentStatusSnapshot,
  type ReplayMarketBar,
} from "./replay-contracts"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
  type ReplayCrossSourceKind,
} from "./replay-cross-source-ordering"
import {
  assertReplaySourceEventPitPayloadRecord,
  assertReplaySourceEventPitPayloadView,
  type ReplaySourceEventPitPayloadRecord,
  type ReplaySourceEventPitPayloadView,
} from "./replay-source-event-pit-payload-view"
import type { ReplaySourceEventBarOpenPayload } from "./replay-source-event-wire"

export const REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_PROJECTION_SCHEMA_VERSION = "trade.rd-replay-source-event-decision-observation-projection.v1" as const
export const REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_RECORD_SCHEMA_VERSION = "trade.rd-replay-source-event-decision-observation-record.v1" as const
export const REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_POLICY_VERSION = "rd-replay-source-event-decision-observation-v1" as const
export const REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_FIELD_POLICY_VERSION = "rd-replay-source-event-decision-observation-fields-v1" as const

export interface ReplayInstrumentStatusObservation {
  snapshot_id: string
  venue_id: string
  symbol: string
  status: "trading" | "halted"
  effective_at: string
  valid_until: string | null
  observed_at: string
  source_ref: string
  source_hash: string
}

export interface ReplayFundingSettlementObservation {
  event_time: string
  rate: number
  mark_price: number
}

export interface ReplayAggregateTradeObservation {
  symbol: string
  aggregate_trade_id: number
  first_trade_id: number
  last_trade_id: number
  trade_time: string
  price: number
  quantity: number
  buyer_is_maker: boolean
}

export interface ReplayBarOpenObservation {
  open_time: string
  open: number
}

export interface ReplayClosedBarObservation {
  open_time: string
  close_time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  closed: true
}

export type ReplaySourceEventDecisionObservation =
  | ReplayInstrumentStatusObservation
  | ReplayFundingSettlementObservation
  | ReplayAggregateTradeObservation
  | ReplayBarOpenObservation
  | ReplayClosedBarObservation

export type ReplaySourceEventDecisionObservationType =
  | "instrument_status"
  | "funding_settlement"
  | "aggregate_trade"
  | "bar_open"
  | "closed_bar"

export interface ReplaySourceEventDecisionObservationRecord {
  schema_version: typeof REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_RECORD_SCHEMA_VERSION
  observation_id: string
  observation_ordinal: number
  payload_record_id: string
  payload_record_hash: string
  transition_id: string
  wire_event_id: string
  source_kind: ReplayCrossSourceKind
  effective_time: string
  availability_at: string
  observation_type: ReplaySourceEventDecisionObservationType
  observation: ReplaySourceEventDecisionObservation
  observation_hash: string
  payload_hash: string
  source_envelope_hash: string
  projection_effect: "read_only_observation"
  execution_effect: "none"
}

export interface ReplaySourceEventDecisionObservationProjection {
  schema_version: typeof REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_PROJECTION_SCHEMA_VERSION
  projection_id: string
  projection_policy_version: typeof REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_POLICY_VERSION
  field_policy_version: typeof REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_FIELD_POLICY_VERSION
  scope: "pre_integration_non_economic_decision_observation_projection"
  projection_purpose: "candidate_decision_input_fields_only"
  decision_input_compatibility: "not_asserted"
  decision_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  harness_compatibility: "not_bound"
  runner_compatibility: "not_bound"
  future_payload_access: "forbidden"
  bar_open_visibility: "open_only_no_range_fields"
  closed_bar_visibility: "full_ohlcv_only_when_closed"
  payload_view_id: string
  payload_view_hash: string
  wire_manifest_id: string
  wire_manifest_hash: string
  cut_id: string
  cut_hash: string
  as_of_time: string
  observation_count: number
  observations: ReplaySourceEventDecisionObservationRecord[]
  observations_hash: string
  observation_values_hash: string
  source_observation_counts: Record<ReplayCrossSourceKind, number>
  future_transition_count: number
  future_transition_ids_hash: string
  projection_hash: string
}

export type ReplaySourceEventDecisionObservationProjectionBody = Omit<
  ReplaySourceEventDecisionObservationProjection,
  "projection_hash"
>

export function createReplaySourceEventDecisionObservationProjection(
  body: ReplaySourceEventDecisionObservationProjectionBody,
): ReplaySourceEventDecisionObservationProjection {
  const value: ReplaySourceEventDecisionObservationProjection = {
    ...structuredClone(body),
    projection_hash: canonicalHash(body),
  }
  assertReplaySourceEventDecisionObservationProjection(value)
  return value
}

export function assertReplaySourceEventDecisionObservationProjection(
  value: ReplaySourceEventDecisionObservationProjection,
): void {
  if (value.schema_version !== REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_PROJECTION_SCHEMA_VERSION
      || value.projection_policy_version !== REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_POLICY_VERSION
      || value.field_policy_version !== REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_FIELD_POLICY_VERSION
      || value.scope !== "pre_integration_non_economic_decision_observation_projection"
      || value.projection_purpose !== "candidate_decision_input_fields_only"
      || value.decision_input_compatibility !== "not_asserted"
      || value.decision_authority !== "none"
      || value.signal_authority !== "none"
      || value.order_authority !== "none"
      || value.economic_authority !== "none"
      || value.harness_compatibility !== "not_bound"
      || value.runner_compatibility !== "not_bound"
      || value.future_payload_access !== "forbidden"
      || value.bar_open_visibility !== "open_only_no_range_fields"
      || value.closed_bar_visibility !== "full_ohlcv_only_when_closed") {
    throw new Error("unsupported SourceEvent decision observation authority")
  }
  for (const item of [value.projection_id, value.payload_view_id, value.wire_manifest_id, value.cut_id]) {
    requireText(item, "SourceEvent decision observation identity")
  }
  for (const [field, item] of Object.entries({
    payload_view_hash: value.payload_view_hash,
    wire_manifest_hash: value.wire_manifest_hash,
    cut_hash: value.cut_hash,
    observations_hash: value.observations_hash,
    observation_values_hash: value.observation_values_hash,
    future_transition_ids_hash: value.future_transition_ids_hash,
    projection_hash: value.projection_hash,
  })) requireHash(item, `SourceEvent decision observation ${field}`)
  requireUtc(value.as_of_time, "SourceEvent decision observation as_of_time")
  if (!Number.isSafeInteger(value.observation_count) || value.observation_count < 0
      || !Number.isSafeInteger(value.future_transition_count) || value.future_transition_count < 0
      || value.observation_count !== value.observations.length) {
    throw new Error("SourceEvent decision observation cardinality drift")
  }
  const counts = emptySourceCounts()
  for (const [index, observation] of value.observations.entries()) {
    assertReplaySourceEventDecisionObservationRecord(observation)
    if (observation.observation_ordinal !== index
        || Date.parse(observation.availability_at) > Date.parse(value.as_of_time)) {
      throw new Error("SourceEvent decision observation is not a causal sequence")
    }
    counts[observation.source_kind] += 1
  }
  if (canonicalHash(counts) !== canonicalHash(value.source_observation_counts)) {
    throw new Error("SourceEvent decision observation source count drift")
  }
  if (value.observations_hash !== canonicalHash(value.observations)
      || value.observation_values_hash !== canonicalHash(value.observations.map((item) => item.observation))) {
    throw new Error("SourceEvent decision observation projection hash drift")
  }
  const { projection_hash: projectionHash, ...body } = value
  if (projectionHash !== canonicalHash(body)) throw new Error("SourceEvent decision observation hash mismatch")
}

export function assertReplaySourceEventDecisionObservationRecord(
  value: ReplaySourceEventDecisionObservationRecord,
): void {
  if (value.schema_version !== REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_RECORD_SCHEMA_VERSION
      || value.projection_effect !== "read_only_observation"
      || value.execution_effect !== "none") {
    throw new Error("unsupported SourceEvent decision observation effect")
  }
  for (const item of [value.observation_id, value.payload_record_id, value.transition_id, value.wire_event_id]) {
    requireText(item, "SourceEvent decision observation record identity")
  }
  for (const [field, item] of Object.entries({
    payload_record_hash: value.payload_record_hash,
    observation_hash: value.observation_hash,
    payload_hash: value.payload_hash,
    source_envelope_hash: value.source_envelope_hash,
  })) requireHash(item, `SourceEvent decision observation record ${field}`)
  requireUtc(value.effective_time, "SourceEvent decision observation effective_time")
  requireUtc(value.availability_at, "SourceEvent decision observation availability_at")
  if (!Number.isSafeInteger(value.observation_ordinal) || value.observation_ordinal < 0
      || Date.parse(value.availability_at) < Date.parse(value.effective_time)) {
    throw new Error("SourceEvent decision observation chronology drift")
  }
  assertObservationFields(value.observation_type, value.observation)
  if (value.observation_hash !== canonicalHash(value.observation)
      || value.observation_id !== `source-event-decision-observation-${value.wire_event_id}`) {
    throw new Error("SourceEvent decision observation identity or value hash drift")
  }
}

export function projectReplaySourceEventDecisionObservation(
  record: ReplaySourceEventPitPayloadRecord,
): Pick<ReplaySourceEventDecisionObservationRecord, "observation_type" | "observation"> {
  assertReplaySourceEventPitPayloadRecord(record)
  if (record.kind === "instrument_halted" || record.kind === "instrument_resumed") {
    const payload = record.payload as ReplayInstrumentStatusSnapshot
    if (payload.effective_at !== record.effective_time || payload.observed_at !== record.availability_at) {
      throw new Error("SourceEvent status observation chronology does not bind payload visibility")
    }
    return {
      observation_type: "instrument_status",
      observation: {
        snapshot_id: payload.snapshot_id,
        venue_id: payload.venue_id,
        symbol: payload.symbol,
        status: payload.status,
        effective_at: payload.effective_at,
        valid_until: payload.valid_until,
        observed_at: payload.observed_at,
        source_ref: payload.source_ref,
        source_hash: payload.source_hash,
      },
    }
  }
  if (record.kind === "funding") {
    const payload = record.payload as ReplayFundingEvent
    if (payload.timestamp !== record.effective_time) throw new Error("SourceEvent funding observation time drift")
    return {
      observation_type: "funding_settlement",
      observation: { event_time: payload.timestamp, rate: payload.rate, mark_price: payload.mark_price },
    }
  }
  if (record.kind === "aggregate_trade") {
    const payload = record.payload as ReplayAggregateTradeEvent
    if (payload.trade_time !== record.effective_time || payload.available_at !== record.availability_at) {
      throw new Error("SourceEvent aggregate trade observation chronology drift")
    }
    return {
      observation_type: "aggregate_trade",
      observation: {
        symbol: payload.symbol,
        aggregate_trade_id: payload.aggregate_trade_id,
        first_trade_id: payload.first_trade_id,
        last_trade_id: payload.last_trade_id,
        trade_time: payload.trade_time,
        price: payload.price,
        quantity: payload.quantity,
        buyer_is_maker: payload.buyer_is_maker,
      },
    }
  }
  if (record.kind === "bar_open") {
    const payload = record.payload as ReplaySourceEventBarOpenPayload
    if (payload.open_time !== record.effective_time) throw new Error("SourceEvent bar-open observation time drift")
    return { observation_type: "bar_open", observation: { open_time: payload.open_time, open: payload.open } }
  }
  const payload = record.payload as ReplayMarketBar
  if (payload.closed !== true || payload.close_time !== record.effective_time) {
    throw new Error("SourceEvent closed-bar observation requires a closed payload at effective time")
  }
  return {
    observation_type: "closed_bar",
    observation: {
      open_time: payload.open_time,
      close_time: payload.close_time,
      open: payload.open,
      high: payload.high,
      low: payload.low,
      close: payload.close,
      volume: payload.volume,
      closed: true,
    },
  }
}

export function assertReplaySourceEventDecisionObservationBindings(
  projection: ReplaySourceEventDecisionObservationProjection,
  view: ReplaySourceEventPitPayloadView,
): void {
  assertReplaySourceEventDecisionObservationProjection(projection)
  assertReplaySourceEventPitPayloadView(view)
  if (projection.payload_view_id !== view.view_id
      || projection.payload_view_hash !== view.view_hash
      || projection.wire_manifest_id !== view.wire_manifest_id
      || projection.wire_manifest_hash !== view.wire_manifest_hash
      || projection.cut_id !== view.cut_id
      || projection.cut_hash !== view.cut_hash
      || projection.as_of_time !== view.as_of_time
      || projection.observation_count !== view.visible_record_count
      || projection.future_transition_count !== view.future_transition_count
      || projection.future_transition_ids_hash !== view.future_transition_ids_hash) {
    throw new Error("SourceEvent decision observation payload-view authority lineage drift")
  }
  for (const [index, payloadRecord] of view.records.entries()) {
    const observation = projection.observations[index]
    const expected = projectReplaySourceEventDecisionObservation(payloadRecord)
    if (!observation
        || observation.payload_record_id !== payloadRecord.record_id
        || observation.payload_record_hash !== canonicalHash(payloadRecord)
        || observation.transition_id !== payloadRecord.transition_id
        || observation.wire_event_id !== payloadRecord.wire_event_id
        || observation.source_kind !== payloadRecord.source_kind
        || observation.effective_time !== payloadRecord.effective_time
        || observation.availability_at !== payloadRecord.availability_at
        || observation.payload_hash !== payloadRecord.payload_hash
        || observation.source_envelope_hash !== payloadRecord.source_envelope_hash
        || observation.observation_type !== expected.observation_type
        || canonicalHash(observation.observation) !== canonicalHash(expected.observation)) {
      throw new Error("SourceEvent decision observation payload record lineage drift")
    }
  }
}

export function replaySourceEventDecisionObservationCounts(
  observations: Array<{ source_kind: ReplayCrossSourceKind }>,
): Record<ReplayCrossSourceKind, number> {
  const counts = emptySourceCounts()
  for (const observation of observations) counts[observation.source_kind] += 1
  return counts
}

function assertObservationFields(
  type: ReplaySourceEventDecisionObservationType,
  observation: ReplaySourceEventDecisionObservation,
): void {
  const expectedKeys: Record<ReplaySourceEventDecisionObservationType, string[]> = {
    instrument_status: ["effective_at", "observed_at", "snapshot_id", "source_hash", "source_ref", "status", "symbol", "valid_until", "venue_id"],
    funding_settlement: ["event_time", "mark_price", "rate"],
    aggregate_trade: ["aggregate_trade_id", "buyer_is_maker", "first_trade_id", "last_trade_id", "price", "quantity", "symbol", "trade_time"],
    bar_open: ["open", "open_time"],
    closed_bar: ["close", "close_time", "closed", "high", "low", "open", "open_time", "volume"],
  }
  const actualKeys = Object.keys(observation).sort()
  if (canonicalHash(actualKeys) !== canonicalHash(expectedKeys[type])) {
    throw new Error("SourceEvent decision observation field whitelist drift")
  }
  const fields = observation as unknown as Record<string, unknown>
  for (const [field, value] of Object.entries(fields)) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error(`SourceEvent decision observation ${field} must be finite`)
    }
  }
  if (type === "instrument_status") {
    requireUtc(fields.effective_at, "SourceEvent status observation effective_at")
    requireUtc(fields.observed_at, "SourceEvent status observation observed_at")
    if (fields.valid_until !== null) requireUtc(fields.valid_until, "SourceEvent status observation valid_until")
    for (const field of ["snapshot_id", "venue_id", "symbol", "source_ref"] as const) {
      requireText(fields[field], `SourceEvent status observation ${field}`)
    }
    requireHash(fields.source_hash, "SourceEvent status observation source_hash")
    if (fields.status !== "trading" && fields.status !== "halted") {
      throw new Error("SourceEvent status observation status is invalid")
    }
  } else if (type === "funding_settlement") {
    requireUtc(fields.event_time, "SourceEvent funding observation event_time")
  } else if (type === "aggregate_trade") {
    requireUtc(fields.trade_time, "SourceEvent aggregate trade observation trade_time")
  } else if (type === "bar_open") {
    requireUtc(fields.open_time, "SourceEvent bar-open observation open_time")
  } else {
    requireUtc(fields.open_time, "SourceEvent closed-bar observation open_time")
    requireUtc(fields.close_time, "SourceEvent closed-bar observation close_time")
    if (fields.closed !== true) throw new Error("SourceEvent closed-bar observation must be closed")
  }
}

function emptySourceCounts(): Record<ReplayCrossSourceKind, number> {
  return { instrument_status: 0, funding: 0, aggregate_trade: 0, ohlcv: 0 }
}
