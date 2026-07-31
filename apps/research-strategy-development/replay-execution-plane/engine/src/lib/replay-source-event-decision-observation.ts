import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_FIELD_POLICY_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_POLICY_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_PROJECTION_SCHEMA_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_RECORD_SCHEMA_VERSION,
  assertReplaySourceEventDecisionObservationBindings,
  createReplaySourceEventDecisionObservationProjection,
  projectReplaySourceEventDecisionObservation,
  replaySourceEventDecisionObservationCounts,
  type ReplaySourceEventDecisionObservationProjection,
  type ReplaySourceEventDecisionObservationRecord,
} from "../../../contracts/src/lib/replay-source-event-decision-observation"
import type { ReplaySourceEventPitPayloadView } from "../../../contracts/src/lib/replay-source-event-pit-payload-view"
import {
  assertReplaySourceEventPitPayloadViewLineage,
  type ReplaySourceEventPitPayloadViewInput,
} from "./replay-source-event-pit-payload-view"

export interface ReplaySourceEventDecisionObservationInput extends ReplaySourceEventPitPayloadViewInput {
  pit_payload_view: ReplaySourceEventPitPayloadView
}

export function buildReplaySourceEventDecisionObservationProjection(
  input: ReplaySourceEventDecisionObservationInput,
): ReplaySourceEventDecisionObservationProjection {
  assertReplaySourceEventPitPayloadViewLineage(input.pit_payload_view, input)
  const observations = input.pit_payload_view.records.map((record, index): ReplaySourceEventDecisionObservationRecord => {
    const projected = projectReplaySourceEventDecisionObservation(record)
    return {
      schema_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_RECORD_SCHEMA_VERSION,
      observation_id: `source-event-decision-observation-${record.wire_event_id}`,
      observation_ordinal: index,
      payload_record_id: record.record_id,
      payload_record_hash: canonicalHash(record),
      transition_id: record.transition_id,
      wire_event_id: record.wire_event_id,
      source_kind: record.source_kind,
      effective_time: record.effective_time,
      availability_at: record.availability_at,
      observation_type: projected.observation_type,
      observation: projected.observation,
      observation_hash: canonicalHash(projected.observation),
      payload_hash: record.payload_hash,
      source_envelope_hash: record.source_envelope_hash,
      projection_effect: "read_only_observation",
      execution_effect: "none",
    }
  })
  const bodyWithoutId = {
    schema_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_PROJECTION_SCHEMA_VERSION,
    projection_policy_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_POLICY_VERSION,
    field_policy_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_FIELD_POLICY_VERSION,
    scope: "pre_integration_non_economic_decision_observation_projection" as const,
    projection_purpose: "candidate_decision_input_fields_only" as const,
    decision_input_compatibility: "not_asserted" as const,
    decision_authority: "none" as const,
    signal_authority: "none" as const,
    order_authority: "none" as const,
    economic_authority: "none" as const,
    harness_compatibility: "not_bound" as const,
    runner_compatibility: "not_bound" as const,
    future_payload_access: "forbidden" as const,
    bar_open_visibility: "open_only_no_range_fields" as const,
    closed_bar_visibility: "full_ohlcv_only_when_closed" as const,
    payload_view_id: input.pit_payload_view.view_id,
    payload_view_hash: input.pit_payload_view.view_hash,
    wire_manifest_id: input.pit_payload_view.wire_manifest_id,
    wire_manifest_hash: input.pit_payload_view.wire_manifest_hash,
    cut_id: input.pit_payload_view.cut_id,
    cut_hash: input.pit_payload_view.cut_hash,
    as_of_time: input.pit_payload_view.as_of_time,
    observation_count: observations.length,
    observations,
    observations_hash: canonicalHash(observations),
    observation_values_hash: canonicalHash(observations.map((item) => item.observation)),
    source_observation_counts: replaySourceEventDecisionObservationCounts(observations),
    future_transition_count: input.pit_payload_view.future_transition_count,
    future_transition_ids_hash: input.pit_payload_view.future_transition_ids_hash,
  }
  const body = {
    ...bodyWithoutId,
    projection_id: `source-event-decision-observation-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  }
  const value = createReplaySourceEventDecisionObservationProjection(body)
  assertReplaySourceEventDecisionObservationLineage(value, input)
  return value
}

export function assertReplaySourceEventDecisionObservationLineage(
  projection: ReplaySourceEventDecisionObservationProjection,
  input: ReplaySourceEventDecisionObservationInput,
): void {
  assertReplaySourceEventPitPayloadViewLineage(input.pit_payload_view, input)
  assertReplaySourceEventDecisionObservationBindings(projection, input.pit_payload_view)
}
