import {
  REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
  canonicalHash,
  type ReplayDecisionSchedule,
  type ReplayDecisionScheduleEntry,
} from "./replay-contracts"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"
import {
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_FIELD_POLICY_VERSION,
  assertReplaySourceEventDecisionObservationProjection,
  type ReplaySourceEventDecisionObservationProjection,
} from "./replay-source-event-decision-observation"

export const REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_SCHEMA_VERSION = "trade.rd-replay-source-event-decision-schedule-observation-binding.v1" as const
export const REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_POLICY_VERSION = "rd-replay-source-event-decision-schedule-observation-binding-v1" as const

export interface ReplaySourceEventDecisionScheduleObservationBinding {
  schema_version: typeof REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_SCHEMA_VERSION
  binding_id: string
  binding_policy_version: typeof REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_POLICY_VERSION
  scope: "pre_integration_non_economic_schedule_observation_binding"
  binding_purpose: "prove_frozen_decision_time_equals_observation_as_of_time"
  schedule_authority: "external_frozen_reference_only"
  schedule_validation: "structural_hash_and_selected_entry_only"
  selected_effect_handling: "opaque_frozen_label_not_executed"
  observation_authority: "whitelisted_non_economic_projection_only"
  time_binding_rule: "observation_as_of_time_equals_selected_decision_time"
  harness_invocation: "forbidden"
  decision_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  runner_compatibility: "not_bound"
  decision_schedule_schema_version: typeof REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION
  decision_schedule_hash: string
  decision_schedule_entry_count: number
  selected_decision_sequence: number
  selected_decision_time: string
  selected_expected_effect: ReplayDecisionScheduleEntry["expected_effect"]
  selected_schedule_entry_hash: string
  observation_projection_id: string
  observation_projection_hash: string
  observation_field_policy_version: typeof REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_FIELD_POLICY_VERSION
  observation_as_of_time: string
  observation_count: number
  payload_view_hash: string
  cut_hash: string
  binding_hash: string
}

export type ReplaySourceEventDecisionScheduleObservationBindingBody = Omit<
  ReplaySourceEventDecisionScheduleObservationBinding,
  "binding_hash"
>

export function createReplaySourceEventDecisionScheduleObservationBinding(
  body: ReplaySourceEventDecisionScheduleObservationBindingBody,
): ReplaySourceEventDecisionScheduleObservationBinding {
  const value: ReplaySourceEventDecisionScheduleObservationBinding = {
    ...structuredClone(body),
    binding_hash: canonicalHash(body),
  }
  assertReplaySourceEventDecisionScheduleObservationBinding(value)
  return value
}

export function assertReplaySourceEventDecisionScheduleObservationBinding(
  value: ReplaySourceEventDecisionScheduleObservationBinding,
): void {
  if (value.schema_version !== REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_SCHEMA_VERSION
      || value.binding_policy_version !== REPLAY_SOURCE_EVENT_DECISION_SCHEDULE_OBSERVATION_BINDING_POLICY_VERSION
      || value.scope !== "pre_integration_non_economic_schedule_observation_binding"
      || value.binding_purpose !== "prove_frozen_decision_time_equals_observation_as_of_time"
      || value.schedule_authority !== "external_frozen_reference_only"
      || value.schedule_validation !== "structural_hash_and_selected_entry_only"
      || value.selected_effect_handling !== "opaque_frozen_label_not_executed"
      || value.observation_authority !== "whitelisted_non_economic_projection_only"
      || value.time_binding_rule !== "observation_as_of_time_equals_selected_decision_time"
      || value.harness_invocation !== "forbidden"
      || value.decision_authority !== "none"
      || value.signal_authority !== "none"
      || value.order_authority !== "none"
      || value.economic_authority !== "none"
      || value.runner_compatibility !== "not_bound"
      || value.decision_schedule_schema_version !== REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION
      || value.observation_field_policy_version !== REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_FIELD_POLICY_VERSION) {
    throw new Error("unsupported SourceEvent decision schedule observation binding authority")
  }
  assertExactBindingFields(value)
  for (const item of [value.binding_id, value.observation_projection_id]) {
    requireText(item, "SourceEvent decision schedule observation binding identity")
  }
  for (const [field, item] of Object.entries({
    decision_schedule_hash: value.decision_schedule_hash,
    selected_schedule_entry_hash: value.selected_schedule_entry_hash,
    observation_projection_hash: value.observation_projection_hash,
    payload_view_hash: value.payload_view_hash,
    cut_hash: value.cut_hash,
    binding_hash: value.binding_hash,
  })) requireHash(item, `SourceEvent decision schedule observation binding ${field}`)
  requireUtc(value.selected_decision_time, "SourceEvent selected decision time")
  requireUtc(value.observation_as_of_time, "SourceEvent observation as-of time")
  if (value.selected_decision_time !== value.observation_as_of_time) {
    throw new Error("SourceEvent decision schedule observation time binding drift")
  }
  if (!Number.isSafeInteger(value.decision_schedule_entry_count) || value.decision_schedule_entry_count < 1
      || !Number.isSafeInteger(value.selected_decision_sequence) || value.selected_decision_sequence < 1
      || value.selected_decision_sequence > value.decision_schedule_entry_count
      || !Number.isSafeInteger(value.observation_count) || value.observation_count < 0) {
    throw new Error("SourceEvent decision schedule observation binding cardinality drift")
  }
  if (!DECISION_EFFECTS.has(value.selected_expected_effect)) {
    throw new Error("SourceEvent decision schedule observation binding effect label drift")
  }
  const { binding_hash: bindingHash, ...body } = value
  const { binding_id: bindingId, ...bodyWithoutId } = body
  if (bindingId !== `source-event-decision-schedule-observation-${canonicalHash(bodyWithoutId).slice(0, 24)}`) {
    throw new Error("SourceEvent decision schedule observation binding identity mismatch")
  }
  if (bindingHash !== canonicalHash(body)) {
    throw new Error("SourceEvent decision schedule observation binding hash mismatch")
  }
}

export function assertReplaySourceEventDecisionScheduleObservationLineage(
  binding: ReplaySourceEventDecisionScheduleObservationBinding,
  schedule: ReplayDecisionSchedule,
  frozenScheduleHash: string,
  projection: ReplaySourceEventDecisionObservationProjection,
): void {
  assertReplaySourceEventDecisionScheduleObservationBinding(binding)
  assertReplaySourceEventDecisionScheduleReference(schedule, frozenScheduleHash)
  assertReplaySourceEventDecisionObservationProjection(projection)
  const selected = schedule.entries[binding.selected_decision_sequence - 1]
  if (!selected
      || binding.decision_schedule_hash !== frozenScheduleHash
      || binding.decision_schedule_entry_count !== schedule.entries.length
      || binding.selected_decision_time !== selected.decision_time
      || binding.selected_expected_effect !== selected.expected_effect
      || binding.selected_schedule_entry_hash !== canonicalHash(selected)
      || binding.observation_projection_id !== projection.projection_id
      || binding.observation_projection_hash !== projection.projection_hash
      || binding.observation_as_of_time !== projection.as_of_time
      || binding.observation_count !== projection.observation_count
      || binding.payload_view_hash !== projection.payload_view_hash
      || binding.cut_hash !== projection.cut_hash
      || selected.decision_time !== projection.as_of_time) {
    throw new Error("SourceEvent decision schedule observation lineage drift")
  }
}

export function assertReplaySourceEventDecisionScheduleReference(
  schedule: ReplayDecisionSchedule,
  frozenScheduleHash: string,
): void {
  requireHash(frozenScheduleHash, "SourceEvent frozen decision schedule hash")
  if (schedule.schema_version !== REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION
      || schedule.schedule_policy !== "frozen_closed_bar_schedule"
      || !Array.isArray(schedule.entries)
      || schedule.entries.length === 0) {
    throw new Error("unsupported SourceEvent frozen decision schedule reference")
  }
  let priorTime = Number.NEGATIVE_INFINITY
  for (const [index, entry] of schedule.entries.entries()) {
    requireUtc(entry.decision_time, `SourceEvent decision schedule entry ${index + 1} time`)
    const decisionTime = Date.parse(entry.decision_time)
    if (entry.decision_sequence !== index + 1 || decisionTime <= priorTime
        || !DECISION_EFFECTS.has(entry.expected_effect)) {
      throw new Error("SourceEvent frozen decision schedule reference structure or ordering drift")
    }
    priorTime = decisionTime
  }
  if (canonicalHash(schedule) !== frozenScheduleHash) {
    throw new Error("SourceEvent frozen decision schedule reference hash mismatch")
  }
}

const DECISION_EFFECTS = new Set<ReplayDecisionScheduleEntry["expected_effect"]>([
  "no_action",
  "authorized_initial_order",
  "authorized_entry_cancel",
  "authorized_protective_stop_replace",
  "authorized_take_profit_replace",
  "authorized_partial_reduce",
  "authorized_reduce_only_exit",
  "authorized_strategy_exit_cancel",
  "authorized_take_profit_cancel",
  "authorized_protective_stop_cancel",
])

const BINDING_FIELDS = [
  "binding_hash", "binding_id", "binding_policy_version", "binding_purpose", "cut_hash",
  "decision_authority", "decision_schedule_entry_count", "decision_schedule_hash",
  "decision_schedule_schema_version", "economic_authority", "harness_invocation",
  "observation_as_of_time", "observation_authority", "observation_count",
  "observation_field_policy_version", "observation_projection_hash", "observation_projection_id",
  "order_authority", "payload_view_hash", "runner_compatibility", "schedule_authority",
  "schedule_validation", "schema_version", "scope", "selected_decision_sequence",
  "selected_decision_time", "selected_effect_handling", "selected_expected_effect",
  "selected_schedule_entry_hash", "signal_authority", "time_binding_rule",
].sort()

function assertExactBindingFields(value: ReplaySourceEventDecisionScheduleObservationBinding): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(BINDING_FIELDS)) {
    throw new Error("SourceEvent decision schedule observation binding field whitelist drift")
  }
}
