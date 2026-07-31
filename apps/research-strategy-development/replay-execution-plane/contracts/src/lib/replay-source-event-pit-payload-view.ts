import { canonicalHash } from "./replay-contracts"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
  type ReplayCrossSourceKind,
} from "./replay-cross-source-ordering"
import {
  assertReplaySourceEventAvailabilityCursor,
  type ReplaySourceEventAvailabilityCursor,
} from "./replay-source-event-availability-cursor"
import {
  assertReplaySourceEventVisibilityCut,
  type ReplaySourceEventVisibilityCut,
} from "./replay-source-event-visibility-cut"
import {
  assertReplaySourceEventWireManifest,
  type ReplaySourceEventWireKind,
  type ReplaySourceEventWireManifest,
  type ReplaySourceEventWirePayload,
} from "./replay-source-event-wire"

export const REPLAY_SOURCE_EVENT_PIT_PAYLOAD_VIEW_SCHEMA_VERSION = "trade.rd-replay-source-event-pit-payload-view.v1" as const
export const REPLAY_SOURCE_EVENT_PIT_PAYLOAD_RECORD_SCHEMA_VERSION = "trade.rd-replay-source-event-pit-payload-record.v1" as const
export const REPLAY_SOURCE_EVENT_PIT_PAYLOAD_VIEW_POLICY_VERSION = "rd-replay-source-event-pit-payload-view-v1" as const

export interface ReplaySourceEventPitPayloadRecord {
  schema_version: typeof REPLAY_SOURCE_EVENT_PIT_PAYLOAD_RECORD_SCHEMA_VERSION
  record_id: string
  view_ordinal: number
  transition_id: string
  wire_event_id: string
  source_kind: ReplayCrossSourceKind
  kind: ReplaySourceEventWireKind
  effective_time: string
  availability_at: string
  visibility_class: "effective_immediate" | "delayed_historical_fact"
  ordering_evidence: "declared_timestamp_unique" | "deterministic_tie_break_only"
  ambiguity_group_hash: string | null
  payload: ReplaySourceEventWirePayload
  payload_hash: string
  source_envelope_hash: string
  payload_access: "visible_at_cut"
  execution_effect: "none"
}

export interface ReplaySourceEventPitPayloadView {
  schema_version: typeof REPLAY_SOURCE_EVENT_PIT_PAYLOAD_VIEW_SCHEMA_VERSION
  view_id: string
  view_policy_version: typeof REPLAY_SOURCE_EVENT_PIT_PAYLOAD_VIEW_POLICY_VERSION
  scope: "pre_integration_non_economic_pit_payload_view"
  materialization_rule: "exact_visibility_cut_members_only"
  decision_authority: "none"
  economic_authority: "none"
  execution_effects: "forbidden"
  harness_compatibility: "not_bound"
  runner_compatibility: "not_bound"
  future_payload_materialization: "forbidden"
  wire_manifest_id: string
  wire_manifest_hash: string
  cut_id: string
  cut_hash: string
  cursor_id: string
  cursor_hash: string
  trace_id: string
  trace_hash: string
  as_of_time: string
  visible_record_count: number
  records: ReplaySourceEventPitPayloadRecord[]
  records_hash: string
  payloads_hash: string
  source_payload_counts: Record<ReplayCrossSourceKind, number>
  future_transition_count: number
  future_transition_ids_hash: string
  view_hash: string
}

export type ReplaySourceEventPitPayloadViewBody = Omit<ReplaySourceEventPitPayloadView, "view_hash">

export function createReplaySourceEventPitPayloadView(
  body: ReplaySourceEventPitPayloadViewBody,
): ReplaySourceEventPitPayloadView {
  const value: ReplaySourceEventPitPayloadView = {
    ...structuredClone(body),
    view_hash: canonicalHash(body),
  }
  assertReplaySourceEventPitPayloadView(value)
  return value
}

export function assertReplaySourceEventPitPayloadView(value: ReplaySourceEventPitPayloadView): void {
  if (value.schema_version !== REPLAY_SOURCE_EVENT_PIT_PAYLOAD_VIEW_SCHEMA_VERSION
      || value.view_policy_version !== REPLAY_SOURCE_EVENT_PIT_PAYLOAD_VIEW_POLICY_VERSION
      || value.scope !== "pre_integration_non_economic_pit_payload_view"
      || value.materialization_rule !== "exact_visibility_cut_members_only"
      || value.decision_authority !== "none"
      || value.economic_authority !== "none"
      || value.execution_effects !== "forbidden"
      || value.harness_compatibility !== "not_bound"
      || value.runner_compatibility !== "not_bound"
      || value.future_payload_materialization !== "forbidden") {
    throw new Error("unsupported SourceEvent PIT payload view authority")
  }
  for (const item of [value.view_id, value.wire_manifest_id, value.cut_id, value.cursor_id, value.trace_id]) {
    requireText(item, "SourceEvent PIT payload view identity")
  }
  for (const [field, item] of Object.entries({
    wire_manifest_hash: value.wire_manifest_hash,
    cut_hash: value.cut_hash,
    cursor_hash: value.cursor_hash,
    trace_hash: value.trace_hash,
    records_hash: value.records_hash,
    payloads_hash: value.payloads_hash,
    future_transition_ids_hash: value.future_transition_ids_hash,
    view_hash: value.view_hash,
  })) requireHash(item, `SourceEvent PIT payload view ${field}`)
  requireUtc(value.as_of_time, "SourceEvent PIT payload view as_of_time")
  if (!Number.isSafeInteger(value.visible_record_count) || value.visible_record_count < 0
      || !Number.isSafeInteger(value.future_transition_count) || value.future_transition_count < 0
      || value.visible_record_count !== value.records.length) {
    throw new Error("SourceEvent PIT payload view cardinality drift")
  }
  const counts = emptySourceCounts()
  const wireIds = new Set<string>()
  for (const [index, record] of value.records.entries()) {
    assertReplaySourceEventPitPayloadRecord(record)
    if (record.view_ordinal !== index || Date.parse(record.availability_at) > Date.parse(value.as_of_time)) {
      throw new Error("SourceEvent PIT payload view is not a causal visible sequence")
    }
    if (wireIds.has(record.wire_event_id)) throw new Error("SourceEvent PIT payload view Wire event must be unique")
    wireIds.add(record.wire_event_id)
    counts[record.source_kind] += 1
  }
  if (canonicalHash(counts) !== canonicalHash(value.source_payload_counts)) {
    throw new Error("SourceEvent PIT payload view source count drift")
  }
  if (value.records_hash !== canonicalHash(value.records)
      || value.payloads_hash !== canonicalHash(value.records.map((record) => record.payload))) {
    throw new Error("SourceEvent PIT payload view materialization hash mismatch")
  }
  const { view_hash: viewHash, ...body } = value
  if (viewHash !== canonicalHash(body)) throw new Error("SourceEvent PIT payload view hash mismatch")
}

export function assertReplaySourceEventPitPayloadRecord(value: ReplaySourceEventPitPayloadRecord): void {
  if (value.schema_version !== REPLAY_SOURCE_EVENT_PIT_PAYLOAD_RECORD_SCHEMA_VERSION
      || value.payload_access !== "visible_at_cut"
      || value.execution_effect !== "none") {
    throw new Error("unsupported SourceEvent PIT payload record effect")
  }
  for (const item of [value.record_id, value.transition_id, value.wire_event_id]) {
    requireText(item, "SourceEvent PIT payload record identity")
  }
  requireUtc(value.effective_time, "SourceEvent PIT payload record effective_time")
  requireUtc(value.availability_at, "SourceEvent PIT payload record availability_at")
  requireHash(value.payload_hash, "SourceEvent PIT payload record payload_hash")
  requireHash(value.source_envelope_hash, "SourceEvent PIT payload record source_envelope_hash")
  if (!Number.isSafeInteger(value.view_ordinal) || value.view_ordinal < 0
      || Date.parse(value.availability_at) < Date.parse(value.effective_time)) {
    throw new Error("SourceEvent PIT payload record chronology is invalid")
  }
  if (value.payload_hash !== canonicalHash(value.payload)
      || value.record_id !== `source-event-pit-payload-${value.wire_event_id}`) {
    throw new Error("SourceEvent PIT payload record identity or payload hash drift")
  }
  if (!kindBelongsToSource(value.source_kind, value.kind)) {
    throw new Error("SourceEvent PIT payload record kind/source drift")
  }
  if (value.ambiguity_group_hash) requireHash(value.ambiguity_group_hash, "SourceEvent PIT payload ambiguity hash")
  if ((value.ambiguity_group_hash !== null) !== (value.ordering_evidence === "deterministic_tie_break_only")) {
    throw new Error("SourceEvent PIT payload ordering evidence overclaim")
  }
  const expectedClass = value.effective_time === value.availability_at
    ? "effective_immediate"
    : "delayed_historical_fact"
  if (value.visibility_class !== expectedClass) throw new Error("SourceEvent PIT payload visibility class drift")
}

export function assertReplaySourceEventPitPayloadViewBindings(
  view: ReplaySourceEventPitPayloadView,
  cut: ReplaySourceEventVisibilityCut,
  cursor: ReplaySourceEventAvailabilityCursor,
  wire: ReplaySourceEventWireManifest,
): void {
  assertReplaySourceEventPitPayloadView(view)
  assertReplaySourceEventVisibilityCut(cut)
  assertReplaySourceEventAvailabilityCursor(cursor)
  assertReplaySourceEventWireManifest(wire)
  if (view.wire_manifest_id !== wire.wire_manifest_id
      || view.wire_manifest_hash !== wire.manifest_hash
      || view.cut_id !== cut.cut_id
      || view.cut_hash !== cut.cut_hash
      || view.cursor_id !== cut.cursor_id
      || view.cursor_hash !== cut.cursor_hash
      || view.trace_id !== cut.trace_id
      || view.trace_hash !== cut.trace_hash
      || view.as_of_time !== cut.as_of_time
      || view.visible_record_count !== cut.visible_prefix_length
      || view.future_transition_count !== cut.future_transition_count
      || view.future_transition_ids_hash !== cut.future_transition_ids_hash) {
    throw new Error("SourceEvent PIT payload view authority lineage drift")
  }
  const wireById = new Map(wire.wire_events.map((event) => [event.wire_event_id, event]))
  for (const [index, transition] of cut.visible_transitions.entries()) {
    const record = view.records[index]
    const wireEvent = wireById.get(transition.wire_event_id)
    if (!record || !wireEvent
        || record.transition_id !== transition.transition_id
        || record.wire_event_id !== transition.wire_event_id
        || record.source_kind !== transition.source_kind
        || record.kind !== transition.kind
        || record.effective_time !== transition.effective_time
        || record.availability_at !== transition.availability_at
        || record.visibility_class !== transition.visibility_class
        || record.ordering_evidence !== transition.ordering_evidence
        || record.ambiguity_group_hash !== transition.ambiguity_group_hash
        || record.payload_hash !== wireEvent.payload_hash
        || record.source_envelope_hash !== wireEvent.source_envelope_hash
        || canonicalHash(record.payload) !== canonicalHash(wireEvent.payload)) {
      throw new Error("SourceEvent PIT payload record Cut/Wire lineage drift")
    }
  }
  if (cursor.cursor_id !== cut.cursor_id || cursor.cursor_hash !== cut.cursor_hash) {
    throw new Error("SourceEvent PIT payload view cursor lineage drift")
  }
}

export function replaySourceEventPitPayloadCounts(
  records: Array<{ source_kind: ReplayCrossSourceKind }>,
): Record<ReplayCrossSourceKind, number> {
  const counts = emptySourceCounts()
  for (const record of records) counts[record.source_kind] += 1
  return counts
}

function kindBelongsToSource(source: ReplayCrossSourceKind, kind: ReplaySourceEventWireKind): boolean {
  return (source === "instrument_status" && ["instrument_halted", "instrument_resumed"].includes(kind))
    || (source === "funding" && kind === "funding")
    || (source === "aggregate_trade" && kind === "aggregate_trade")
    || (source === "ohlcv" && ["bar_open", "bar_range"].includes(kind))
}

function emptySourceCounts(): Record<ReplayCrossSourceKind, number> {
  return { instrument_status: 0, funding: 0, aggregate_trade: 0, ohlcv: 0 }
}
