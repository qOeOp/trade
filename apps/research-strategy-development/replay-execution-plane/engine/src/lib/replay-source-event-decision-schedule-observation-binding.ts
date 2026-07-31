import {
  canonicalHash,
  type ReplayDecisionSchedule,
} from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_POLICY_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_SCHEMA_VERSION,
  assertReplaySourceEventDecisionScheduleObservationLineage as assertBindingLineage,
  assertReplaySourceEventDecisionScheduleReference,
  createReplaySourceEventDecisionScheduleObservationBinding,
  type ReplaySourceEventDecisionScheduleObservationBinding,
} from "../../../contracts/src/lib/replay-source-event-decision-schedule-observation-binding"
import {
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_FIELD_POLICY_VERSION,
  type ReplaySourceEventDecisionObservationProjection,
} from "../../../contracts/src/lib/replay-source-event-decision-observation"
import {
  assertReplaySourceEventDecisionObservationLineage,
  type ReplaySourceEventDecisionObservationInput,
} from "./replay-source-event-decision-observation"

export interface ReplaySourceEventDecisionScheduleObservationBindingInput
  extends ReplaySourceEventDecisionObservationInput {
  decision_schedule: ReplayDecisionSchedule
  decision_schedule_hash: string
  selected_decision_sequence: number
  decision_observation_projection: ReplaySourceEventDecisionObservationProjection
}

export function buildReplaySourceEventDecisionScheduleObservationBinding(
  input: ReplaySourceEventDecisionScheduleObservationBindingInput,
): ReplaySourceEventDecisionScheduleObservationBinding {
  assertReplaySourceEventDecisionObservationLineage(input.decision_observation_projection, input)
  assertReplaySourceEventDecisionScheduleReference(input.decision_schedule, input.decision_schedule_hash)
  const selected = input.decision_schedule.entries[input.selected_decision_sequence - 1]
  if (!selected) throw new Error("SourceEvent selected decision schedule entry is missing")
  if (selected.decision_time !== input.decision_observation_projection.as_of_time) {
    throw new Error("SourceEvent selected decision time does not match observation as-of time")
  }
  const projection = input.decision_observation_projection
  const bodyWithoutId = {
    schema_version: REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_SCHEMA_VERSION,
    binding_policy_version: REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_POLICY_VERSION,
    scope: "pre_integration_non_economic_schedule_observation_binding" as const,
    binding_purpose: "prove_frozen_decision_time_equals_observation_as_of_time" as const,
    schedule_authority: "external_frozen_reference_only" as const,
    schedule_validation: "structural_hash_and_selected_entry_only" as const,
    selected_effect_handling: "opaque_frozen_label_not_executed" as const,
    observation_authority: "whitelisted_non_economic_projection_only" as const,
    time_binding_rule: "observation_as_of_time_equals_selected_decision_time" as const,
    harness_invocation: "forbidden" as const,
    decision_authority: "none" as const,
    signal_authority: "none" as const,
    order_authority: "none" as const,
    economic_authority: "none" as const,
    runner_compatibility: "not_bound" as const,
    decision_schedule_schema_version: input.decision_schedule.schema_version,
    decision_schedule_hash: input.decision_schedule_hash,
    decision_schedule_entry_count: input.decision_schedule.entries.length,
    selected_decision_sequence: selected.decision_sequence,
    selected_decision_time: selected.decision_time,
    selected_expected_effect: selected.expected_effect,
    selected_schedule_entry_hash: canonicalHash(selected),
    observation_projection_id: projection.projection_id,
    observation_projection_hash: projection.projection_hash,
    observation_field_policy_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_FIELD_POLICY_VERSION,
    observation_as_of_time: projection.as_of_time,
    observation_count: projection.observation_count,
    payload_view_hash: projection.payload_view_hash,
    cut_hash: projection.cut_hash,
  }
  const body = {
    ...bodyWithoutId,
    binding_id: `source-event-decision-schedule-observation-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  }
  const value = createReplaySourceEventDecisionScheduleObservationBinding(body)
  assertReplaySourceEventDecisionScheduleObservationBindingLineage(value, input)
  return value
}

export function assertReplaySourceEventDecisionScheduleObservationBindingLineage(
  binding: ReplaySourceEventDecisionScheduleObservationBinding,
  input: ReplaySourceEventDecisionScheduleObservationBindingInput,
): void {
  assertReplaySourceEventDecisionObservationLineage(input.decision_observation_projection, input)
  assertBindingLineage(
    binding,
    input.decision_schedule,
    input.decision_schedule_hash,
    input.decision_observation_projection,
  )
  if (binding.selected_decision_sequence !== input.selected_decision_sequence) {
    throw new Error("SourceEvent selected decision sequence lineage drift")
  }
}
