import {
  REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
  canonicalHash,
  type ReplayDecisionSchedule,
} from "./replay-contracts"
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
  assertReplaySourceEventDecisionScheduleObservationBinding,
  assertReplaySourceEventDecisionScheduleObservationLineage,
  assertReplaySourceEventDecisionScheduleReference,
  type ReplaySourceEventDecisionScheduleObservationBinding,
} from "./replay-source-event-decision-schedule-observation-binding"

export const REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_SET_SCHEMA_VERSION = "trade.rd-replay-source-event-decision-schedule-observation-binding-set.v1" as const
export const REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_SET_POLICY_VERSION = "rd-replay-source-event-decision-schedule-observation-binding-set-v1" as const

export interface ReplaySourceEventDecisionScheduleObservationBindingSet {
  schema_version: typeof REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_SET_SCHEMA_VERSION
  binding_set_id: string
  binding_set_policy_version: typeof REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_SET_POLICY_VERSION
  scope: "pre_integration_non_economic_schedule_observation_binding_set"
  set_purpose: "prove_complete_frozen_schedule_observation_coverage"
  schedule_authority: "external_frozen_reference_only"
  schedule_validation: "structural_hash_and_member_lineage_only"
  completeness_rule: "exactly_one_binding_per_schedule_entry"
  ordering_rule: "decision_sequence_ascending"
  duplicate_binding_policy: "reject"
  cross_schedule_binding_policy: "forbidden"
  selected_effect_handling: "opaque_frozen_label_not_executed"
  harness_invocation: "forbidden"
  decision_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  runner_compatibility: "not_bound"
  decision_schedule_schema_version: typeof REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION
  decision_schedule_hash: string
  decision_schedule_entry_count: number
  binding_count: number
  bindings: ReplaySourceEventDecisionScheduleObservationBinding[]
  bindings_hash: string
  binding_hashes_hash: string
  observation_projection_hashes_hash: string
  first_decision_time: string
  last_decision_time: string
  binding_set_hash: string
}

export type ReplaySourceEventDecisionScheduleObservationBindingSetBody = Omit<
  ReplaySourceEventDecisionScheduleObservationBindingSet,
  "binding_set_hash"
>

export function createReplaySourceEventDecisionScheduleObservationBindingSet(
  body: ReplaySourceEventDecisionScheduleObservationBindingSetBody,
): ReplaySourceEventDecisionScheduleObservationBindingSet {
  const value: ReplaySourceEventDecisionScheduleObservationBindingSet = {
    ...structuredClone(body),
    binding_set_hash: canonicalHash(body),
  }
  assertReplaySourceEventDecisionScheduleObservationBindingSet(value)
  return value
}

export function assertReplaySourceEventDecisionScheduleObservationBindingSet(
  value: ReplaySourceEventDecisionScheduleObservationBindingSet,
): void {
  if (value.schema_version !== REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_SET_SCHEMA_VERSION
      || value.binding_set_policy_version !== REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_SET_POLICY_VERSION
      || value.scope !== "pre_integration_non_economic_schedule_observation_binding_set"
      || value.set_purpose !== "prove_complete_frozen_schedule_observation_coverage"
      || value.schedule_authority !== "external_frozen_reference_only"
      || value.schedule_validation !== "structural_hash_and_member_lineage_only"
      || value.completeness_rule !== "exactly_one_binding_per_schedule_entry"
      || value.ordering_rule !== "decision_sequence_ascending"
      || value.duplicate_binding_policy !== "reject"
      || value.cross_schedule_binding_policy !== "forbidden"
      || value.selected_effect_handling !== "opaque_frozen_label_not_executed"
      || value.harness_invocation !== "forbidden"
      || value.decision_authority !== "none"
      || value.signal_authority !== "none"
      || value.order_authority !== "none"
      || value.economic_authority !== "none"
      || value.runner_compatibility !== "not_bound"
      || value.decision_schedule_schema_version !== REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION) {
    throw new Error("unsupported SourceEvent decision schedule observation binding set authority")
  }
  assertExactBindingSetFields(value)
  requireText(value.binding_set_id, "SourceEvent decision schedule observation binding set identity")
  for (const [field, item] of Object.entries({
    decision_schedule_hash: value.decision_schedule_hash,
    bindings_hash: value.bindings_hash,
    binding_hashes_hash: value.binding_hashes_hash,
    observation_projection_hashes_hash: value.observation_projection_hashes_hash,
    binding_set_hash: value.binding_set_hash,
  })) requireHash(item, `SourceEvent decision schedule observation binding set ${field}`)
  requireUtc(value.first_decision_time, "SourceEvent binding set first decision time")
  requireUtc(value.last_decision_time, "SourceEvent binding set last decision time")
  if (!Number.isSafeInteger(value.decision_schedule_entry_count) || value.decision_schedule_entry_count < 1
      || !Number.isSafeInteger(value.binding_count) || value.binding_count < 1
      || value.binding_count !== value.bindings.length
      || value.binding_count !== value.decision_schedule_entry_count) {
    throw new Error("SourceEvent decision schedule observation binding set cardinality drift")
  }
  const bindingIds = new Set<string>()
  const bindingHashes = new Set<string>()
  const projectionHashes = new Set<string>()
  let priorTime = Number.NEGATIVE_INFINITY
  for (const [index, binding] of value.bindings.entries()) {
    assertReplaySourceEventDecisionScheduleObservationBinding(binding)
    const decisionTime = Date.parse(binding.selected_decision_time)
    if (binding.selected_decision_sequence !== index + 1
        || binding.decision_schedule_hash !== value.decision_schedule_hash
        || binding.decision_schedule_entry_count !== value.decision_schedule_entry_count
        || decisionTime <= priorTime) {
      throw new Error("SourceEvent decision schedule observation binding set order or schedule drift")
    }
    if (bindingIds.has(binding.binding_id)
        || bindingHashes.has(binding.binding_hash)
        || projectionHashes.has(binding.observation_projection_hash)) {
      throw new Error("SourceEvent decision schedule observation binding set duplicate member")
    }
    bindingIds.add(binding.binding_id)
    bindingHashes.add(binding.binding_hash)
    projectionHashes.add(binding.observation_projection_hash)
    priorTime = decisionTime
  }
  if (value.first_decision_time !== value.bindings[0]!.selected_decision_time
      || value.last_decision_time !== value.bindings.at(-1)!.selected_decision_time
      || value.bindings_hash !== canonicalHash(value.bindings)
      || value.binding_hashes_hash !== canonicalHash(value.bindings.map((item) => item.binding_hash))
      || value.observation_projection_hashes_hash
        !== canonicalHash(value.bindings.map((item) => item.observation_projection_hash))) {
    throw new Error("SourceEvent decision schedule observation binding set fold drift")
  }
  const { binding_set_hash: bindingSetHash, ...body } = value
  const { binding_set_id: bindingSetId, ...bodyWithoutId } = body
  if (bindingSetId !== `source-event-decision-schedule-observation-set-${canonicalHash(bodyWithoutId).slice(0, 24)}`) {
    throw new Error("SourceEvent decision schedule observation binding set identity mismatch")
  }
  if (bindingSetHash !== canonicalHash(body)) {
    throw new Error("SourceEvent decision schedule observation binding set hash mismatch")
  }
}

export function assertReplaySourceEventDecisionScheduleObservationBindingSetLineage(
  value: ReplaySourceEventDecisionScheduleObservationBindingSet,
  schedule: ReplayDecisionSchedule,
  frozenScheduleHash: string,
  projections: ReplaySourceEventDecisionObservationProjection[],
): void {
  assertReplaySourceEventDecisionScheduleObservationBindingSet(value)
  assertReplaySourceEventDecisionScheduleReference(schedule, frozenScheduleHash)
  if (value.decision_schedule_hash !== frozenScheduleHash
      || value.decision_schedule_entry_count !== schedule.entries.length
      || projections.length !== schedule.entries.length
      || value.bindings.length !== schedule.entries.length) {
    throw new Error("SourceEvent decision schedule observation binding set closed-world lineage drift")
  }
  for (const [index, binding] of value.bindings.entries()) {
    const projection = projections[index]
    if (!projection) {
      throw new Error("SourceEvent decision schedule observation binding set missing projection lineage")
    }
    assertReplaySourceEventDecisionObservationProjection(projection)
    assertReplaySourceEventDecisionScheduleObservationLineage(
      binding,
      schedule,
      frozenScheduleHash,
      projection,
    )
  }
}

const BINDING_SET_FIELDS = [
  "binding_count", "binding_hashes_hash", "binding_set_hash", "binding_set_id",
  "binding_set_policy_version", "bindings", "bindings_hash", "completeness_rule",
  "cross_schedule_binding_policy", "decision_authority", "decision_schedule_entry_count",
  "decision_schedule_hash", "decision_schedule_schema_version", "duplicate_binding_policy",
  "economic_authority", "first_decision_time", "harness_invocation", "last_decision_time",
  "observation_projection_hashes_hash", "order_authority", "ordering_rule",
  "runner_compatibility", "schedule_authority", "schedule_validation", "schema_version",
  "scope", "selected_effect_handling", "set_purpose", "signal_authority",
].sort()

function assertExactBindingSetFields(
  value: ReplaySourceEventDecisionScheduleObservationBindingSet,
): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(BINDING_SET_FIELDS)) {
    throw new Error("SourceEvent decision schedule observation binding set field whitelist drift")
  }
}
