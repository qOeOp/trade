import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_SOURCE_EVENT_AVAILABILITY_CURSOR_POLICY_VERSION,
  REPLAY_SOURCE_EVENT_AVAILABILITY_CURSOR_SCHEMA_VERSION,
  REPLAY_SOURCE_EVENT_VISIBILITY_TRANSITION_SCHEMA_VERSION,
  assertReplaySourceEventAvailabilityCursor,
  assertReplaySourceEventAvailabilityCursorTraceBinding,
  compareReplaySourceEventAvailabilityKeys,
  createReplaySourceEventAvailabilityCursor,
  replaySourceEventVisibilityCounts,
  type ReplaySourceEventAvailabilityCursor,
  type ReplaySourceEventVisibilityTransition,
} from "../../../contracts/src/lib/replay-source-event-availability-cursor"
import type { ReplaySourceEventCandidateTrace } from "../../../contracts/src/lib/replay-source-event-wire-gate"
import {
  assertReplaySourceEventWireCandidateReducerLineage,
  type ReplaySourceEventWireCandidateReducerInput,
} from "./replay-source-event-wire-candidate-reducer"

export interface ReplaySourceEventAvailabilityCursorInput extends ReplaySourceEventWireCandidateReducerInput {
  candidate_trace: ReplaySourceEventCandidateTrace
}

export function buildReplaySourceEventAvailabilityCursor(
  input: ReplaySourceEventAvailabilityCursorInput,
): ReplaySourceEventAvailabilityCursor {
  assertReplaySourceEventWireCandidateReducerLineage(input.candidate_trace, input)
  const transitions = input.candidate_trace.trace_events
    .map((event): Omit<ReplaySourceEventVisibilityTransition, "visibility_ordinal"> => {
      const availabilityLag = Date.parse(event.availability_at) - Date.parse(event.effective_time)
      return {
        schema_version: REPLAY_SOURCE_EVENT_VISIBILITY_TRANSITION_SCHEMA_VERSION,
        transition_id: `source-event-visible-${event.wire_event_id}`,
        trace_event_id: event.trace_event_id,
        wire_event_id: event.wire_event_id,
        source_kind: event.source_kind,
        kind: event.kind,
        effective_time: event.effective_time,
        availability_at: event.availability_at,
        availability_lag_ms: availabilityLag,
        visibility_class: availabilityLag === 0 ? "effective_immediate" : "delayed_historical_fact",
        availability_key: {
          visible_at: event.availability_at,
          effective_time: event.effective_time,
          effective_event_ordinal: event.event_ordinal,
          wire_event_id: event.wire_event_id,
        },
        ordering_evidence: event.ordering_evidence,
        ambiguity_group_hash: event.ambiguity_group_hash,
        visibility_effect: "fact_becomes_visible",
        retroactive_execution_effect: "none",
      }
    })
    .sort((left, right) => compareReplaySourceEventAvailabilityKeys(left.availability_key, right.availability_key))
    .map((transition, visibilityOrdinal): ReplaySourceEventVisibilityTransition => ({
      ...transition,
      visibility_ordinal: visibilityOrdinal,
    }))
  const lastIds = lastVisibleWireEventIdBySource(transitions)
  const bodyWithoutId = {
    schema_version: REPLAY_SOURCE_EVENT_AVAILABILITY_CURSOR_SCHEMA_VERSION,
    cursor_policy_version: REPLAY_SOURCE_EVENT_AVAILABILITY_CURSOR_POLICY_VERSION,
    scope: "pre_integration_non_economic_availability_cursor" as const,
    economic_authority: "none" as const,
    execution_effects: "forbidden" as const,
    retroactive_execution: "forbidden" as const,
    runner_compatibility: "not_bound" as const,
    trace_id: input.candidate_trace.trace_id,
    trace_hash: input.candidate_trace.trace_hash,
    wire_manifest_id: input.candidate_trace.wire_manifest_id,
    wire_manifest_hash: input.candidate_trace.wire_manifest_hash,
    gate_id: input.candidate_trace.gate_id,
    gate_hash: input.candidate_trace.gate_hash,
    ordering_attestation_id: input.candidate_trace.ordering_attestation_id,
    ordering_attestation_hash: input.candidate_trace.ordering_attestation_hash,
    effective_timeline_hash: input.candidate_trace.trace_events_hash,
    visibility_transitions: transitions,
    visibility_timeline_hash: canonicalHash(transitions),
    delayed_visibility_count: transitions.filter((item) => item.visibility_class === "delayed_historical_fact").length,
    source_visibility_counts: replaySourceEventVisibilityCounts(transitions),
    last_visible_wire_event_id_by_source: lastIds,
  }
  const body = {
    ...bodyWithoutId,
    cursor_id: `source-event-availability-cursor-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  }
  const value = createReplaySourceEventAvailabilityCursor(body)
  assertReplaySourceEventAvailabilityCursorLineage(value, input)
  return value
}

export function replaySourceEventTransitionsVisibleAt(
  cursor: ReplaySourceEventAvailabilityCursor,
  cursorTime: string,
): ReplaySourceEventVisibilityTransition[] {
  assertReplaySourceEventAvailabilityCursor(cursor)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(cursorTime)
      || !Number.isFinite(Date.parse(cursorTime))) {
    throw new Error("SourceEvent availability cursor time must be an RFC 3339 UTC timestamp")
  }
  const time = Date.parse(cursorTime)
  return structuredClone(cursor.visibility_transitions.filter((transition) =>
    Date.parse(transition.availability_at) <= time))
}

export function assertReplaySourceEventAvailabilityCursorLineage(
  cursor: ReplaySourceEventAvailabilityCursor,
  input: ReplaySourceEventAvailabilityCursorInput,
): void {
  assertReplaySourceEventWireCandidateReducerLineage(input.candidate_trace, input)
  assertReplaySourceEventAvailabilityCursorTraceBinding(cursor, input.candidate_trace)
  const expected = [...cursor.visibility_transitions]
    .sort((left, right) => compareReplaySourceEventAvailabilityKeys(left.availability_key, right.availability_key))
  for (const [index, transition] of cursor.visibility_transitions.entries()) {
    if (transition.visibility_ordinal !== index || transition.transition_id !== expected[index]!.transition_id) {
      throw new Error("SourceEvent availability cursor deterministic order drift")
    }
  }
}

function lastVisibleWireEventIdBySource(
  transitions: ReplaySourceEventVisibilityTransition[],
): ReplaySourceEventAvailabilityCursor["last_visible_wire_event_id_by_source"] {
  const result: ReplaySourceEventAvailabilityCursor["last_visible_wire_event_id_by_source"] = {
    instrument_status: "",
    funding: "",
    aggregate_trade: "",
    ohlcv: "",
  }
  for (const transition of transitions) result[transition.source_kind] = transition.wire_event_id
  return result
}
