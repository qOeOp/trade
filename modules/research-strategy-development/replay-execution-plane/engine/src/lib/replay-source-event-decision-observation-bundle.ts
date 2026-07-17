import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_POLICY_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_SCHEMA_VERSION,
  assertReplaySourceEventDecisionObservationBundleLineage as assertBundleLineage,
  createReplaySourceEventDecisionObservationBundle,
  type ReplaySourceEventDecisionObservationBundle,
} from "../../../contracts/src/lib/replay-source-event-decision-observation-bundle"
import type { ReplaySourceEventDecisionScheduleObservationBindingSet } from "../../../contracts/src/lib/replay-source-event-decision-schedule-observation-binding-set"
import {
  assertReplaySourceEventDecisionScheduleObservationBindingSetLineage,
  type ReplaySourceEventDecisionScheduleObservationBindingSetInput,
} from "./replay-source-event-decision-schedule-observation-binding-set"

export interface ReplaySourceEventDecisionObservationBundleInput
  extends ReplaySourceEventDecisionScheduleObservationBindingSetInput {
  decision_schedule_observation_binding_set: ReplaySourceEventDecisionScheduleObservationBindingSet
}

export function buildReplaySourceEventDecisionObservationBundle(
  input: ReplaySourceEventDecisionObservationBundleInput,
): ReplaySourceEventDecisionObservationBundle {
  assertReplaySourceEventDecisionScheduleObservationBindingSetLineage(
    input.decision_schedule_observation_binding_set,
    input,
  )
  const bindingSet = input.decision_schedule_observation_binding_set
  const projections = input.binding_inputs.map((item) => item.decision_observation_projection)
  const bodyWithoutId = {
    schema_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_SCHEMA_VERSION,
    bundle_policy_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_POLICY_VERSION,
    scope: "pre_integration_non_economic_decision_observation_bundle" as const,
    bundle_purpose: "portable_schedule_bound_observation_payloads" as const,
    projection_payload_rule: "exactly_one_projection_per_binding" as const,
    ordering_rule: "binding_sequence_ascending" as const,
    payload_portability: "projection_payloads_embedded_with_external_parent_lineage" as const,
    parent_lineage_requirement: "mandatory_for_authoritative_rebuild" as const,
    decision_input_compatibility: "not_asserted" as const,
    harness_compatibility: "not_bound" as const,
    harness_invocation: "forbidden" as const,
    decision_authority: "none" as const,
    signal_authority: "none" as const,
    order_authority: "none" as const,
    economic_authority: "none" as const,
    artifact_compatibility: "not_bound" as const,
    runner_compatibility: "not_bound" as const,
    decision_schedule_hash: bindingSet.decision_schedule_hash,
    decision_schedule_entry_count: bindingSet.decision_schedule_entry_count,
    binding_set_id: bindingSet.binding_set_id,
    binding_set_hash: bindingSet.binding_set_hash,
    binding_set: bindingSet,
    projection_count: projections.length,
    projections,
    projections_hash: canonicalHash(projections),
    projection_ids_hash: canonicalHash(projections.map((item) => item.projection_id)),
    projection_hashes_hash: canonicalHash(projections.map((item) => item.projection_hash)),
    observation_values_hashes_hash: canonicalHash(
      projections.map((item) => item.observation_values_hash),
    ),
    first_as_of_time: projections[0]!.as_of_time,
    last_as_of_time: projections.at(-1)!.as_of_time,
  }
  const body = {
    ...bodyWithoutId,
    bundle_id: `source-event-decision-observation-bundle-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  }
  const value = createReplaySourceEventDecisionObservationBundle(body)
  assertReplaySourceEventDecisionObservationBundleLineage(value, input)
  return value
}

export function assertReplaySourceEventDecisionObservationBundleLineage(
  bundle: ReplaySourceEventDecisionObservationBundle,
  input: ReplaySourceEventDecisionObservationBundleInput,
): void {
  assertReplaySourceEventDecisionScheduleObservationBindingSetLineage(
    input.decision_schedule_observation_binding_set,
    input,
  )
  const projections = input.binding_inputs.map((item) => item.decision_observation_projection)
  assertBundleLineage(
    bundle,
    input.decision_schedule_observation_binding_set,
    projections,
  )
}
