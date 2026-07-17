import {
  canonicalHash,
  type ReplayDecisionSchedule,
} from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_SET_POLICY_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_SET_SCHEMA_VERSION,
  assertReplaySourceEventDecisionScheduleObservationBindingSetLineage as assertBindingSetLineage,
  createReplaySourceEventDecisionScheduleObservationBindingSet,
  type ReplaySourceEventDecisionScheduleObservationBindingSet,
} from "../../../contracts/src/lib/replay-source-event-decision-schedule-observation-binding-set"
import { assertReplaySourceEventDecisionScheduleReference } from "../../../contracts/src/lib/replay-source-event-decision-schedule-observation-binding"
import {
  assertReplaySourceEventDecisionScheduleObservationBindingLineage,
  buildReplaySourceEventDecisionScheduleObservationBinding,
  type ReplaySourceEventDecisionScheduleObservationBindingInput,
} from "./replay-source-event-decision-schedule-observation-binding"

export interface ReplaySourceEventDecisionScheduleObservationBindingSetInput {
  decision_schedule: ReplayDecisionSchedule
  decision_schedule_hash: string
  binding_inputs: ReplaySourceEventDecisionScheduleObservationBindingInput[]
}

export function buildReplaySourceEventDecisionScheduleObservationBindingSet(
  input: ReplaySourceEventDecisionScheduleObservationBindingSetInput,
): ReplaySourceEventDecisionScheduleObservationBindingSet {
  assertReplaySourceEventDecisionScheduleReference(input.decision_schedule, input.decision_schedule_hash)
  if (input.binding_inputs.length !== input.decision_schedule.entries.length) {
    throw new Error("SourceEvent decision schedule observation binding inputs are not closed-world complete")
  }
  const bindings = input.binding_inputs.map((bindingInput, index) => {
    if (bindingInput.decision_schedule_hash !== input.decision_schedule_hash
        || canonicalHash(bindingInput.decision_schedule) !== input.decision_schedule_hash
        || bindingInput.selected_decision_sequence !== index + 1) {
      throw new Error("SourceEvent decision schedule observation binding input order or schedule drift")
    }
    return buildReplaySourceEventDecisionScheduleObservationBinding(bindingInput)
  })
  const bodyWithoutId = {
    schema_version: REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_SET_SCHEMA_VERSION,
    binding_set_policy_version: REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_SET_POLICY_VERSION,
    scope: "pre_integration_non_economic_schedule_observation_binding_set" as const,
    set_purpose: "prove_complete_frozen_schedule_observation_coverage" as const,
    schedule_authority: "external_frozen_reference_only" as const,
    schedule_validation: "structural_hash_and_member_lineage_only" as const,
    completeness_rule: "exactly_one_binding_per_schedule_entry" as const,
    ordering_rule: "decision_sequence_ascending" as const,
    duplicate_binding_policy: "reject" as const,
    cross_schedule_binding_policy: "forbidden" as const,
    selected_effect_handling: "opaque_frozen_label_not_executed" as const,
    harness_invocation: "forbidden" as const,
    decision_authority: "none" as const,
    signal_authority: "none" as const,
    order_authority: "none" as const,
    economic_authority: "none" as const,
    runner_compatibility: "not_bound" as const,
    decision_schedule_schema_version: input.decision_schedule.schema_version,
    decision_schedule_hash: input.decision_schedule_hash,
    decision_schedule_entry_count: input.decision_schedule.entries.length,
    binding_count: bindings.length,
    bindings,
    bindings_hash: canonicalHash(bindings),
    binding_hashes_hash: canonicalHash(bindings.map((item) => item.binding_hash)),
    observation_projection_hashes_hash: canonicalHash(
      bindings.map((item) => item.observation_projection_hash),
    ),
    first_decision_time: bindings[0]!.selected_decision_time,
    last_decision_time: bindings.at(-1)!.selected_decision_time,
  }
  const body = {
    ...bodyWithoutId,
    binding_set_id: `source-event-decision-schedule-observation-set-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  }
  const value = createReplaySourceEventDecisionScheduleObservationBindingSet(body)
  assertReplaySourceEventDecisionScheduleObservationBindingSetLineage(value, input)
  return value
}

export function assertReplaySourceEventDecisionScheduleObservationBindingSetLineage(
  value: ReplaySourceEventDecisionScheduleObservationBindingSet,
  input: ReplaySourceEventDecisionScheduleObservationBindingSetInput,
): void {
  assertBindingSetLineage(
    value,
    input.decision_schedule,
    input.decision_schedule_hash,
    input.binding_inputs.map((item) => item.decision_observation_projection),
  )
  for (const [index, binding] of value.bindings.entries()) {
    const bindingInput = input.binding_inputs[index]
    if (!bindingInput) {
      throw new Error("SourceEvent decision schedule observation binding set input lineage is incomplete")
    }
    assertReplaySourceEventDecisionScheduleObservationBindingLineage(binding, bindingInput)
  }
}
