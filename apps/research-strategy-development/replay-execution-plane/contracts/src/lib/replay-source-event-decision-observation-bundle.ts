import { canonicalHash } from "./replay-contracts"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"
import {
  assertReplaySourceEventDecisionObservationProjection,
  type ReplaySourceEventDecisionObservationProjection,
} from "./replay-source-event-decision-observation"
import {
  assertReplaySourceEventDecisionScheduleObservationBindingSet,
  type ReplaySourceEventDecisionScheduleObservationBindingSet,
} from "./replay-source-event-decision-schedule-observation-binding-set"

export const REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_SCHEMA_VERSION = "trade.rd-replay-source-event-decision-observation-bundle.v1" as const
export const REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_POLICY_VERSION = "rd-replay-source-event-decision-observation-bundle-v1" as const

export interface ReplaySourceEventDecisionObservationBundle {
  schema_version: typeof REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_SCHEMA_VERSION
  bundle_id: string
  bundle_policy_version: typeof REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_POLICY_VERSION
  scope: "pre_integration_non_economic_decision_observation_bundle"
  bundle_purpose: "portable_schedule_bound_observation_payloads"
  projection_payload_rule: "exactly_one_projection_per_binding"
  ordering_rule: "binding_sequence_ascending"
  payload_portability: "projection_payloads_embedded_with_external_parent_lineage"
  parent_lineage_requirement: "mandatory_for_authoritative_rebuild"
  decision_input_compatibility: "not_asserted"
  harness_compatibility: "not_bound"
  harness_invocation: "forbidden"
  decision_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  artifact_compatibility: "not_bound"
  runner_compatibility: "not_bound"
  decision_schedule_hash: string
  decision_schedule_entry_count: number
  binding_set_id: string
  binding_set_hash: string
  binding_set: ReplaySourceEventDecisionScheduleObservationBindingSet
  projection_count: number
  projections: ReplaySourceEventDecisionObservationProjection[]
  projections_hash: string
  projection_ids_hash: string
  projection_hashes_hash: string
  observation_values_hashes_hash: string
  first_as_of_time: string
  last_as_of_time: string
  bundle_hash: string
}

export type ReplaySourceEventDecisionObservationBundleBody = Omit<
  ReplaySourceEventDecisionObservationBundle,
  "bundle_hash"
>

export function createReplaySourceEventDecisionObservationBundle(
  body: ReplaySourceEventDecisionObservationBundleBody,
): ReplaySourceEventDecisionObservationBundle {
  const value: ReplaySourceEventDecisionObservationBundle = {
    ...structuredClone(body),
    bundle_hash: canonicalHash(body),
  }
  assertReplaySourceEventDecisionObservationBundle(value)
  return value
}

export function assertReplaySourceEventDecisionObservationBundle(
  value: ReplaySourceEventDecisionObservationBundle,
): void {
  if (value.schema_version !== REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_SCHEMA_VERSION
      || value.bundle_policy_version !== REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_POLICY_VERSION
      || value.scope !== "pre_integration_non_economic_decision_observation_bundle"
      || value.bundle_purpose !== "portable_schedule_bound_observation_payloads"
      || value.projection_payload_rule !== "exactly_one_projection_per_binding"
      || value.ordering_rule !== "binding_sequence_ascending"
      || value.payload_portability !== "projection_payloads_embedded_with_external_parent_lineage"
      || value.parent_lineage_requirement !== "mandatory_for_authoritative_rebuild"
      || value.decision_input_compatibility !== "not_asserted"
      || value.harness_compatibility !== "not_bound"
      || value.harness_invocation !== "forbidden"
      || value.decision_authority !== "none"
      || value.signal_authority !== "none"
      || value.order_authority !== "none"
      || value.economic_authority !== "none"
      || value.artifact_compatibility !== "not_bound"
      || value.runner_compatibility !== "not_bound") {
    throw new Error("unsupported SourceEvent decision observation bundle authority")
  }
  assertExactBundleFields(value)
  requireText(value.bundle_id, "SourceEvent decision observation bundle identity")
  for (const [field, item] of Object.entries({
    decision_schedule_hash: value.decision_schedule_hash,
    binding_set_hash: value.binding_set_hash,
    projections_hash: value.projections_hash,
    projection_ids_hash: value.projection_ids_hash,
    projection_hashes_hash: value.projection_hashes_hash,
    observation_values_hashes_hash: value.observation_values_hashes_hash,
    bundle_hash: value.bundle_hash,
  })) requireHash(item, `SourceEvent decision observation bundle ${field}`)
  requireText(value.binding_set_id, "SourceEvent decision observation bundle binding set identity")
  requireUtc(value.first_as_of_time, "SourceEvent decision observation bundle first as-of time")
  requireUtc(value.last_as_of_time, "SourceEvent decision observation bundle last as-of time")
  assertReplaySourceEventDecisionScheduleObservationBindingSet(value.binding_set)
  if (!Number.isSafeInteger(value.decision_schedule_entry_count)
      || value.decision_schedule_entry_count < 1
      || !Number.isSafeInteger(value.projection_count)
      || value.projection_count < 1
      || value.projection_count !== value.projections.length
      || value.projection_count !== value.decision_schedule_entry_count
      || value.projection_count !== value.binding_set.binding_count) {
    throw new Error("SourceEvent decision observation bundle cardinality drift")
  }
  if (value.binding_set_id !== value.binding_set.binding_set_id
      || value.binding_set_hash !== value.binding_set.binding_set_hash
      || value.decision_schedule_hash !== value.binding_set.decision_schedule_hash
      || value.decision_schedule_entry_count !== value.binding_set.decision_schedule_entry_count) {
    throw new Error("SourceEvent decision observation bundle binding set drift")
  }
  const projectionIds = new Set<string>()
  const projectionHashes = new Set<string>()
  let priorTime = Number.NEGATIVE_INFINITY
  for (const [index, projection] of value.projections.entries()) {
    assertReplaySourceEventDecisionObservationProjection(projection)
    const binding = value.binding_set.bindings[index]
    const asOfTime = Date.parse(projection.as_of_time)
    if (!binding
        || binding.selected_decision_sequence !== index + 1
        || binding.observation_projection_id !== projection.projection_id
        || binding.observation_projection_hash !== projection.projection_hash
        || binding.observation_as_of_time !== projection.as_of_time
        || binding.observation_count !== projection.observation_count
        || binding.payload_view_hash !== projection.payload_view_hash
        || binding.cut_hash !== projection.cut_hash
        || asOfTime <= priorTime) {
      throw new Error("SourceEvent decision observation bundle projection binding drift")
    }
    if (projectionIds.has(projection.projection_id)
        || projectionHashes.has(projection.projection_hash)) {
      throw new Error("SourceEvent decision observation bundle duplicate projection")
    }
    projectionIds.add(projection.projection_id)
    projectionHashes.add(projection.projection_hash)
    priorTime = asOfTime
  }
  if (value.first_as_of_time !== value.projections[0]!.as_of_time
      || value.last_as_of_time !== value.projections.at(-1)!.as_of_time
      || value.projections_hash !== canonicalHash(value.projections)
      || value.projection_ids_hash !== canonicalHash(value.projections.map((item) => item.projection_id))
      || value.projection_hashes_hash !== canonicalHash(value.projections.map((item) => item.projection_hash))
      || value.observation_values_hashes_hash
        !== canonicalHash(value.projections.map((item) => item.observation_values_hash))) {
    throw new Error("SourceEvent decision observation bundle fold drift")
  }
  const { bundle_hash: bundleHash, ...body } = value
  const { bundle_id: bundleId, ...bodyWithoutId } = body
  if (bundleId !== `source-event-decision-observation-bundle-${canonicalHash(bodyWithoutId).slice(0, 24)}`) {
    throw new Error("SourceEvent decision observation bundle identity mismatch")
  }
  if (bundleHash !== canonicalHash(body)) {
    throw new Error("SourceEvent decision observation bundle hash mismatch")
  }
}

export function assertReplaySourceEventDecisionObservationBundleLineage(
  bundle: ReplaySourceEventDecisionObservationBundle,
  bindingSet: ReplaySourceEventDecisionScheduleObservationBindingSet,
  projections: ReplaySourceEventDecisionObservationProjection[],
): void {
  assertReplaySourceEventDecisionObservationBundle(bundle)
  assertReplaySourceEventDecisionScheduleObservationBindingSet(bindingSet)
  if (bundle.binding_set_id !== bindingSet.binding_set_id
      || bundle.binding_set_hash !== bindingSet.binding_set_hash
      || canonicalHash(bundle.binding_set) !== canonicalHash(bindingSet)
      || bundle.projection_count !== projections.length
      || bundle.projections_hash !== canonicalHash(projections)) {
    throw new Error("SourceEvent decision observation bundle external lineage drift")
  }
  for (const [index, projection] of projections.entries()) {
    assertReplaySourceEventDecisionObservationProjection(projection)
    if (canonicalHash(bundle.projections[index]) !== canonicalHash(projection)) {
      throw new Error("SourceEvent decision observation bundle projection payload lineage drift")
    }
  }
}

const BUNDLE_FIELDS = [
  "artifact_compatibility", "binding_set", "binding_set_hash", "binding_set_id",
  "bundle_hash", "bundle_id", "bundle_policy_version", "bundle_purpose",
  "decision_authority", "decision_input_compatibility", "decision_schedule_entry_count",
  "decision_schedule_hash", "economic_authority", "first_as_of_time", "harness_compatibility",
  "harness_invocation", "last_as_of_time", "observation_values_hashes_hash",
  "order_authority", "ordering_rule", "parent_lineage_requirement", "payload_portability",
  "projection_count", "projection_hashes_hash", "projection_ids_hash",
  "projection_payload_rule", "projections", "projections_hash", "runner_compatibility",
  "schema_version", "scope", "signal_authority",
].sort()

function assertExactBundleFields(value: ReplaySourceEventDecisionObservationBundle): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(BUNDLE_FIELDS)) {
    throw new Error("SourceEvent decision observation bundle field whitelist drift")
  }
}
