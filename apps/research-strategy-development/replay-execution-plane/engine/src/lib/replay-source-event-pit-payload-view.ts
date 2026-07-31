import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_SOURCE_EVENT_PIT_PAYLOAD_RECORD_SCHEMA_VERSION,
  REPLAY_SOURCE_EVENT_PIT_PAYLOAD_VIEW_POLICY_VERSION,
  REPLAY_SOURCE_EVENT_PIT_PAYLOAD_VIEW_SCHEMA_VERSION,
  assertReplaySourceEventPitPayloadViewBindings,
  createReplaySourceEventPitPayloadView,
  replaySourceEventPitPayloadCounts,
  type ReplaySourceEventPitPayloadRecord,
  type ReplaySourceEventPitPayloadView,
} from "../../../contracts/src/lib/replay-source-event-pit-payload-view"
import type { ReplaySourceEventVisibilityCut } from "../../../contracts/src/lib/replay-source-event-visibility-cut"
import {
  assertReplaySourceEventVisibilityCutLineage,
  type ReplaySourceEventVisibilityCutInput,
} from "./replay-source-event-visibility-cut"

export interface ReplaySourceEventPitPayloadViewInput extends ReplaySourceEventVisibilityCutInput {
  visibility_cut: ReplaySourceEventVisibilityCut
}

export function buildReplaySourceEventPitPayloadView(
  input: ReplaySourceEventPitPayloadViewInput,
): ReplaySourceEventPitPayloadView {
  assertReplaySourceEventVisibilityCutLineage(input.visibility_cut, input)
  const wireById = new Map(input.wire_manifest.wire_events.map((event) => [event.wire_event_id, event]))
  const records = input.visibility_cut.visible_transitions.map((transition, index): ReplaySourceEventPitPayloadRecord => {
    const wireEvent = wireById.get(transition.wire_event_id)
    if (!wireEvent) throw new Error("SourceEvent PIT payload view cannot resolve a visible Wire event")
    return {
      schema_version: REPLAY_SOURCE_EVENT_PIT_PAYLOAD_RECORD_SCHEMA_VERSION,
      record_id: `source-event-pit-payload-${wireEvent.wire_event_id}`,
      view_ordinal: index,
      transition_id: transition.transition_id,
      wire_event_id: wireEvent.wire_event_id,
      source_kind: transition.source_kind,
      kind: transition.kind,
      effective_time: transition.effective_time,
      availability_at: transition.availability_at,
      visibility_class: transition.visibility_class,
      ordering_evidence: transition.ordering_evidence,
      ambiguity_group_hash: transition.ambiguity_group_hash,
      payload: structuredClone(wireEvent.payload),
      payload_hash: wireEvent.payload_hash,
      source_envelope_hash: wireEvent.source_envelope_hash,
      payload_access: "visible_at_cut",
      execution_effect: "none",
    }
  })
  const bodyWithoutId = {
    schema_version: REPLAY_SOURCE_EVENT_PIT_PAYLOAD_VIEW_SCHEMA_VERSION,
    view_policy_version: REPLAY_SOURCE_EVENT_PIT_PAYLOAD_VIEW_POLICY_VERSION,
    scope: "pre_integration_non_economic_pit_payload_view" as const,
    materialization_rule: "exact_visibility_cut_members_only" as const,
    decision_authority: "none" as const,
    economic_authority: "none" as const,
    execution_effects: "forbidden" as const,
    harness_compatibility: "not_bound" as const,
    runner_compatibility: "not_bound" as const,
    future_payload_materialization: "forbidden" as const,
    wire_manifest_id: input.wire_manifest.wire_manifest_id,
    wire_manifest_hash: input.wire_manifest.manifest_hash,
    cut_id: input.visibility_cut.cut_id,
    cut_hash: input.visibility_cut.cut_hash,
    cursor_id: input.visibility_cut.cursor_id,
    cursor_hash: input.visibility_cut.cursor_hash,
    trace_id: input.visibility_cut.trace_id,
    trace_hash: input.visibility_cut.trace_hash,
    as_of_time: input.visibility_cut.as_of_time,
    visible_record_count: records.length,
    records,
    records_hash: canonicalHash(records),
    payloads_hash: canonicalHash(records.map((record) => record.payload)),
    source_payload_counts: replaySourceEventPitPayloadCounts(records),
    future_transition_count: input.visibility_cut.future_transition_count,
    future_transition_ids_hash: input.visibility_cut.future_transition_ids_hash,
  }
  const body = {
    ...bodyWithoutId,
    view_id: `source-event-pit-payload-view-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  }
  const value = createReplaySourceEventPitPayloadView(body)
  assertReplaySourceEventPitPayloadViewLineage(value, input)
  return value
}

export function assertReplaySourceEventPitPayloadViewLineage(
  view: ReplaySourceEventPitPayloadView,
  input: ReplaySourceEventPitPayloadViewInput,
): void {
  assertReplaySourceEventVisibilityCutLineage(input.visibility_cut, input)
  assertReplaySourceEventPitPayloadViewBindings(
    view,
    input.visibility_cut,
    input.availability_cursor,
    input.wire_manifest,
  )
}
