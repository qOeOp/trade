import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_SOURCE_EVENT_VISIBILITY_CUT_POLICY_VERSION,
  REPLAY_SOURCE_EVENT_VISIBILITY_CUT_SCHEMA_VERSION,
  assertReplaySourceEventVisibilityCutCursorBinding,
  createReplaySourceEventVisibilityCut,
  replaySourceEventVisibilityCutSummary,
  type ReplaySourceEventVisibilityCut,
} from "../../../contracts/src/lib/replay-source-event-visibility-cut"
import {
  assertReplaySourceEventAvailabilityCursorLineage,
  replaySourceEventTransitionsVisibleAt,
  type ReplaySourceEventAvailabilityCursorInput,
} from "./replay-source-event-availability-cursor"
import type { ReplaySourceEventAvailabilityCursor } from "../../../contracts/src/lib/replay-source-event-availability-cursor"

export interface ReplaySourceEventVisibilityCutInput extends ReplaySourceEventAvailabilityCursorInput {
  availability_cursor: ReplaySourceEventAvailabilityCursor
  as_of_time: string
}

export function buildReplaySourceEventVisibilityCut(
  input: ReplaySourceEventVisibilityCutInput,
): ReplaySourceEventVisibilityCut {
  assertReplaySourceEventAvailabilityCursorLineage(input.availability_cursor, input)
  const visibleTransitions = replaySourceEventTransitionsVisibleAt(input.availability_cursor, input.as_of_time)
  const futureTransitions = input.availability_cursor.visibility_transitions.slice(visibleTransitions.length)
  const summary = replaySourceEventVisibilityCutSummary(visibleTransitions)
  const bodyWithoutId = {
    schema_version: REPLAY_SOURCE_EVENT_VISIBILITY_CUT_SCHEMA_VERSION,
    cut_policy_version: REPLAY_SOURCE_EVENT_VISIBILITY_CUT_POLICY_VERSION,
    scope: "pre_integration_non_economic_visibility_cut" as const,
    view_purpose: "decision_time_visibility_evidence_only" as const,
    payload_view: "identity_lineage_only_no_payload" as const,
    decision_authority: "none" as const,
    economic_authority: "none" as const,
    execution_effects: "forbidden" as const,
    runner_compatibility: "not_bound" as const,
    cursor_id: input.availability_cursor.cursor_id,
    cursor_hash: input.availability_cursor.cursor_hash,
    trace_id: input.availability_cursor.trace_id,
    trace_hash: input.availability_cursor.trace_hash,
    as_of_time: input.as_of_time,
    inclusion_rule: "availability_at_lte_as_of_time" as const,
    cursor_transition_count: input.availability_cursor.visibility_transitions.length,
    visible_prefix_length: visibleTransitions.length,
    visible_transitions: visibleTransitions,
    visible_transitions_hash: canonicalHash(visibleTransitions),
    future_transition_count: futureTransitions.length,
    future_transition_ids_hash: canonicalHash(futureTransitions.map((item) => item.transition_id)),
    ...summary,
  }
  const body = {
    ...bodyWithoutId,
    cut_id: `source-event-visibility-cut-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  }
  const value = createReplaySourceEventVisibilityCut(body)
  assertReplaySourceEventVisibilityCutLineage(value, input)
  return value
}

export function assertReplaySourceEventVisibilityCutLineage(
  cut: ReplaySourceEventVisibilityCut,
  input: ReplaySourceEventVisibilityCutInput,
): void {
  assertReplaySourceEventAvailabilityCursorLineage(input.availability_cursor, input)
  assertReplaySourceEventVisibilityCutCursorBinding(cut, input.availability_cursor)
  if (cut.as_of_time !== input.as_of_time) {
    throw new Error("SourceEvent visibility cut requested time lineage drift")
  }
}
