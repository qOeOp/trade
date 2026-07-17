import { canonicalHash } from "./replay-contracts"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
  type ReplayCrossSourceKind,
} from "./replay-cross-source-ordering"
import {
  assertReplaySourceEventCandidateTrace,
  type ReplaySourceEventCandidateTrace,
} from "./replay-source-event-wire-gate"

export const REPLAY_SOURCE_EVENT_AVAILABILITY_CURSOR_SCHEMA_VERSION = "trade.rd-replay-source-event-availability-cursor.v1" as const
export const REPLAY_SOURCE_EVENT_VISIBILITY_TRANSITION_SCHEMA_VERSION = "trade.rd-replay-source-event-visibility-transition.v1" as const
export const REPLAY_SOURCE_EVENT_AVAILABILITY_CURSOR_POLICY_VERSION = "rd-replay-source-event-availability-cursor-v1" as const

export interface ReplaySourceEventAvailabilityKey {
  visible_at: string
  effective_time: string
  effective_event_ordinal: number
  wire_event_id: string
}

export interface ReplaySourceEventVisibilityTransition {
  schema_version: typeof REPLAY_SOURCE_EVENT_VISIBILITY_TRANSITION_SCHEMA_VERSION
  transition_id: string
  visibility_ordinal: number
  trace_event_id: string
  wire_event_id: string
  source_kind: ReplayCrossSourceKind
  kind: ReplaySourceEventCandidateTrace["trace_events"][number]["kind"]
  effective_time: string
  availability_at: string
  availability_lag_ms: number
  visibility_class: "effective_immediate" | "delayed_historical_fact"
  availability_key: ReplaySourceEventAvailabilityKey
  ordering_evidence: ReplaySourceEventCandidateTrace["trace_events"][number]["ordering_evidence"]
  ambiguity_group_hash: string | null
  visibility_effect: "fact_becomes_visible"
  retroactive_execution_effect: "none"
}

export interface ReplaySourceEventAvailabilityCursor {
  schema_version: typeof REPLAY_SOURCE_EVENT_AVAILABILITY_CURSOR_SCHEMA_VERSION
  cursor_id: string
  cursor_policy_version: typeof REPLAY_SOURCE_EVENT_AVAILABILITY_CURSOR_POLICY_VERSION
  scope: "pre_integration_non_economic_availability_cursor"
  economic_authority: "none"
  execution_effects: "forbidden"
  retroactive_execution: "forbidden"
  runner_compatibility: "not_bound"
  trace_id: string
  trace_hash: string
  wire_manifest_id: string
  wire_manifest_hash: string
  gate_id: string
  gate_hash: string
  ordering_attestation_id: string
  ordering_attestation_hash: string
  effective_timeline_hash: string
  visibility_transitions: ReplaySourceEventVisibilityTransition[]
  visibility_timeline_hash: string
  delayed_visibility_count: number
  source_visibility_counts: Record<ReplayCrossSourceKind, number>
  last_visible_wire_event_id_by_source: Record<ReplayCrossSourceKind, string>
  cursor_hash: string
}

export type ReplaySourceEventAvailabilityCursorBody = Omit<ReplaySourceEventAvailabilityCursor, "cursor_hash">

export function createReplaySourceEventAvailabilityCursor(
  body: ReplaySourceEventAvailabilityCursorBody,
): ReplaySourceEventAvailabilityCursor {
  const value: ReplaySourceEventAvailabilityCursor = {
    ...structuredClone(body),
    cursor_hash: canonicalHash(body),
  }
  assertReplaySourceEventAvailabilityCursor(value)
  return value
}

export function compareReplaySourceEventAvailabilityKeys(
  left: ReplaySourceEventAvailabilityKey,
  right: ReplaySourceEventAvailabilityKey,
): number {
  assertReplaySourceEventAvailabilityKey(left)
  assertReplaySourceEventAvailabilityKey(right)
  for (const field of ["visible_at", "effective_time"] as const) {
    const leftTime = Date.parse(left[field])
    const rightTime = Date.parse(right[field])
    if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1
  }
  if (left.effective_event_ordinal !== right.effective_event_ordinal) {
    return left.effective_event_ordinal < right.effective_event_ordinal ? -1 : 1
  }
  if (left.wire_event_id === right.wire_event_id) return 0
  return left.wire_event_id < right.wire_event_id ? -1 : 1
}

export function assertReplaySourceEventAvailabilityCursor(
  value: ReplaySourceEventAvailabilityCursor,
): void {
  if (value.schema_version !== REPLAY_SOURCE_EVENT_AVAILABILITY_CURSOR_SCHEMA_VERSION
      || value.cursor_policy_version !== REPLAY_SOURCE_EVENT_AVAILABILITY_CURSOR_POLICY_VERSION
      || value.scope !== "pre_integration_non_economic_availability_cursor"
      || value.economic_authority !== "none"
      || value.execution_effects !== "forbidden"
      || value.retroactive_execution !== "forbidden"
      || value.runner_compatibility !== "not_bound") {
    throw new Error("unsupported SourceEvent availability cursor authority")
  }
  for (const item of [value.cursor_id, value.trace_id, value.wire_manifest_id, value.gate_id, value.ordering_attestation_id]) {
    requireText(item, "SourceEvent availability cursor identity")
  }
  for (const [field, item] of Object.entries({
    trace_hash: value.trace_hash,
    wire_manifest_hash: value.wire_manifest_hash,
    gate_hash: value.gate_hash,
    ordering_attestation_hash: value.ordering_attestation_hash,
    effective_timeline_hash: value.effective_timeline_hash,
    visibility_timeline_hash: value.visibility_timeline_hash,
    cursor_hash: value.cursor_hash,
  })) requireHash(item, `SourceEvent availability cursor ${field}`)
  if (value.visibility_transitions.length === 0) {
    throw new Error("SourceEvent availability cursor requires transitions")
  }
  const counts = emptySourceCounts()
  const lastIds = emptyLastSourceIds()
  let previousKey: ReplaySourceEventAvailabilityKey | null = null
  let delayedCount = 0
  for (const [index, transition] of value.visibility_transitions.entries()) {
    assertReplaySourceEventVisibilityTransition(transition)
    if (transition.visibility_ordinal !== index) {
      throw new Error("SourceEvent visibility transition ordinal drift")
    }
    if (previousKey && compareReplaySourceEventAvailabilityKeys(previousKey, transition.availability_key) >= 0) {
      throw new Error("SourceEvent visibility timeline ordering drift")
    }
    previousKey = transition.availability_key
    counts[transition.source_kind] += 1
    lastIds[transition.source_kind] = transition.wire_event_id
    if (transition.visibility_class === "delayed_historical_fact") delayedCount += 1
  }
  if (delayedCount !== value.delayed_visibility_count
      || canonicalHash(counts) !== canonicalHash(value.source_visibility_counts)
      || canonicalHash(lastIds) !== canonicalHash(value.last_visible_wire_event_id_by_source)) {
    throw new Error("SourceEvent availability cursor fold summary drift")
  }
  if (value.visibility_timeline_hash !== canonicalHash(value.visibility_transitions)) {
    throw new Error("SourceEvent availability cursor timeline hash mismatch")
  }
  const { cursor_hash: cursorHash, ...body } = value
  if (cursorHash !== canonicalHash(body)) throw new Error("SourceEvent availability cursor hash mismatch")
}

export function assertReplaySourceEventVisibilityTransition(
  value: ReplaySourceEventVisibilityTransition,
): void {
  if (value.schema_version !== REPLAY_SOURCE_EVENT_VISIBILITY_TRANSITION_SCHEMA_VERSION
      || value.visibility_effect !== "fact_becomes_visible"
      || value.retroactive_execution_effect !== "none") {
    throw new Error("unsupported SourceEvent visibility transition effect")
  }
  requireText(value.transition_id, "SourceEvent visibility transition id")
  requireText(value.trace_event_id, "SourceEvent visibility trace event id")
  requireText(value.wire_event_id, "SourceEvent visibility Wire event id")
  requireUtc(value.effective_time, "SourceEvent visibility effective time")
  requireUtc(value.availability_at, "SourceEvent visibility availability time")
  if (!Number.isSafeInteger(value.visibility_ordinal) || value.visibility_ordinal < 0
      || !Number.isSafeInteger(value.availability_lag_ms) || value.availability_lag_ms < 0) {
    throw new Error("SourceEvent visibility ordinal or lag is invalid")
  }
  const expectedLag = Date.parse(value.availability_at) - Date.parse(value.effective_time)
  const expectedClass = expectedLag === 0 ? "effective_immediate" : "delayed_historical_fact"
  if (value.availability_lag_ms !== expectedLag || value.visibility_class !== expectedClass) {
    throw new Error("SourceEvent visibility delay claim drift")
  }
  assertReplaySourceEventAvailabilityKey(value.availability_key)
  if (value.availability_key.visible_at !== value.availability_at
      || value.availability_key.effective_time !== value.effective_time
      || value.availability_key.wire_event_id !== value.wire_event_id
      || value.transition_id !== `source-event-visible-${value.wire_event_id}`) {
    throw new Error("SourceEvent visibility transition key lineage drift")
  }
  if (value.ambiguity_group_hash) requireHash(value.ambiguity_group_hash, "SourceEvent visibility ambiguity hash")
  if ((value.ambiguity_group_hash !== null) !== (value.ordering_evidence === "deterministic_tie_break_only")) {
    throw new Error("SourceEvent visibility ordering evidence overclaim")
  }
}

export function assertReplaySourceEventAvailabilityKey(value: ReplaySourceEventAvailabilityKey): void {
  requireUtc(value.visible_at, "SourceEvent availability key visible_at")
  requireUtc(value.effective_time, "SourceEvent availability key effective_time")
  if (Date.parse(value.visible_at) < Date.parse(value.effective_time)) {
    throw new Error("SourceEvent availability key cannot reveal a fact before effective time")
  }
  if (!Number.isSafeInteger(value.effective_event_ordinal) || value.effective_event_ordinal < 0) {
    throw new Error("SourceEvent availability key effective ordinal is invalid")
  }
  requireText(value.wire_event_id, "SourceEvent availability key Wire event id")
}

export function replaySourceEventVisibilityCounts(
  transitions: Array<{ source_kind: ReplayCrossSourceKind }>,
): Record<ReplayCrossSourceKind, number> {
  const counts = emptySourceCounts()
  for (const transition of transitions) counts[transition.source_kind] += 1
  return counts
}

export function assertReplaySourceEventAvailabilityCursorTraceBinding(
  cursor: ReplaySourceEventAvailabilityCursor,
  trace: ReplaySourceEventCandidateTrace,
): void {
  assertReplaySourceEventAvailabilityCursor(cursor)
  assertReplaySourceEventCandidateTrace(trace)
  if (cursor.trace_id !== trace.trace_id
      || cursor.trace_hash !== trace.trace_hash
      || cursor.wire_manifest_id !== trace.wire_manifest_id
      || cursor.wire_manifest_hash !== trace.wire_manifest_hash
      || cursor.gate_id !== trace.gate_id
      || cursor.gate_hash !== trace.gate_hash
      || cursor.ordering_attestation_id !== trace.ordering_attestation_id
      || cursor.ordering_attestation_hash !== trace.ordering_attestation_hash
      || cursor.effective_timeline_hash !== trace.trace_events_hash
      || cursor.visibility_transitions.length !== trace.trace_events.length) {
    throw new Error("SourceEvent availability cursor trace authority lineage drift")
  }
  const sourceByWireId = new Map(trace.trace_events.map((event) => [event.wire_event_id, event]))
  for (const transition of cursor.visibility_transitions) {
    const source = sourceByWireId.get(transition.wire_event_id)
    if (!source
        || transition.trace_event_id !== source.trace_event_id
        || transition.source_kind !== source.source_kind
        || transition.kind !== source.kind
        || transition.effective_time !== source.effective_time
        || transition.availability_at !== source.availability_at
        || transition.availability_key.effective_event_ordinal !== source.event_ordinal
        || transition.ordering_evidence !== source.ordering_evidence
        || transition.ambiguity_group_hash !== source.ambiguity_group_hash) {
      throw new Error("SourceEvent availability cursor transition lineage drift")
    }
  }
}

function emptySourceCounts(): Record<ReplayCrossSourceKind, number> {
  return { instrument_status: 0, funding: 0, aggregate_trade: 0, ohlcv: 0 }
}

function emptyLastSourceIds(): Record<ReplayCrossSourceKind, string> {
  return { instrument_status: "", funding: "", aggregate_trade: "", ohlcv: "" }
}
