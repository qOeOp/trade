import {
  REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_SUPPLEMENTAL_REQUIREMENT_SET_SCHEMA_VERSION,
  assertReplayDecisionInputSnapshot,
  assertReplaySupplementalFact,
  assertReplaySupplementalRequirementSet,
  canonicalHash,
  type ReplayDecisionInputSnapshot,
  type ReplaySupplementalFact,
  type ReplaySupplementalRequirement,
  type ReplaySupplementalRequirementEvaluation,
  type ReplaySupplementalRequirementSet,
} from "./replay-contracts"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_INITIAL_SIGNAL_SUPPLEMENTAL_INPUT_MATERIALIZATION_SCHEMA_VERSION = "trade.rd-replay-initial-signal-supplemental-input-materialization.v1" as const
export const REPLAY_INITIAL_SIGNAL_SUPPLEMENTAL_INPUT_MATERIALIZATION_POLICY_VERSION = "rd-replay-initial-signal-supplemental-input-materialization-v1" as const

export interface ReplayInitialSignalSupplementalInputMaterialization {
  schema_version: typeof REPLAY_INITIAL_SIGNAL_SUPPLEMENTAL_INPUT_MATERIALIZATION_SCHEMA_VERSION
  materialization_id: string
  materialization_hash: string
  materialization_policy_version: typeof REPLAY_INITIAL_SIGNAL_SUPPLEMENTAL_INPUT_MATERIALIZATION_POLICY_VERSION
  scope: "pre_worker_non_economic_initial_signal_supplemental_materialization"
  input_channel: "dataset_manifest_bound_supplemental_revision_stream"
  market_wire_relationship: "separate_input_channel_not_market_wire_source"
  decision_scope: "authorized_initial_order_signal_time_only"
  visibility_policy: "availability_at_lte_decision_time"
  revision_selection_policy: "latest_visible_revision_per_fact_group"
  requirement_policy: "exactly_one_frozen_requirement_per_supplied_fact"
  raw_supplemental_validation: "full_stream_content_and_manifest_binding"
  rolling_decision_compatibility: "not_certified"
  worker_request_materialization: "forbidden"
  harness_invocation: "forbidden"
  runner_compatibility: "not_bound"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  request_schema_version: "trade.rd-replay-execution-request.v38"
  request_hash: string
  run_id: string
  experiment_id: string
  trial_group_id: string
  trial_id: string
  candidate_id: string
  candidate_hash: string
  reservation_ref: string
  reservation_hash: string
  dataset_manifest_schema_version: "trade.rd-replay-dataset-manifest.v11"
  dataset_manifest_ref: string
  dataset_hash: string
  dataset_manifest_hash: string
  manifest_observed_through: string
  decision_sequence: number
  decision_time: string
  decision_schedule_entry_hash: string
  supplemental_requirement_set: ReplaySupplementalRequirementSet
  supplemental_requirement_set_hash: string
  supplied_record_count: number
  supplied_records: ReplaySupplementalFact[]
  supplied_records_hash: string
  source_ids: string[]
  source_ids_hash: string
  selected_record_ids: string[]
  selected_records_hash: string
  future_record_ids: string[]
  future_record_ids_hash: string
  requirement_evaluations: ReplaySupplementalRequirementEvaluation[]
  requirement_evaluations_hash: string
  decision_input_snapshot_schema_version: typeof REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION
  decision_input_snapshot: ReplayDecisionInputSnapshot
  decision_input_snapshot_hash: string
}

export type ReplayInitialSignalSupplementalInputMaterializationBody = Omit<
  ReplayInitialSignalSupplementalInputMaterialization,
  "materialization_hash"
>

export function createReplayInitialSignalSupplementalInputMaterialization(
  body: ReplayInitialSignalSupplementalInputMaterializationBody,
): ReplayInitialSignalSupplementalInputMaterialization {
  const value = { ...structuredClone(body), materialization_hash: canonicalHash(body) }
  assertReplayInitialSignalSupplementalInputMaterialization(value)
  return value
}

export function assertReplayInitialSignalSupplementalInputMaterialization(
  value: ReplayInitialSignalSupplementalInputMaterialization,
): void {
  if (value.schema_version !== REPLAY_INITIAL_SIGNAL_SUPPLEMENTAL_INPUT_MATERIALIZATION_SCHEMA_VERSION
      || value.materialization_policy_version !== REPLAY_INITIAL_SIGNAL_SUPPLEMENTAL_INPUT_MATERIALIZATION_POLICY_VERSION
      || value.scope !== "pre_worker_non_economic_initial_signal_supplemental_materialization"
      || value.input_channel !== "dataset_manifest_bound_supplemental_revision_stream"
      || value.market_wire_relationship !== "separate_input_channel_not_market_wire_source"
      || value.decision_scope !== "authorized_initial_order_signal_time_only"
      || value.visibility_policy !== "availability_at_lte_decision_time"
      || value.revision_selection_policy !== "latest_visible_revision_per_fact_group"
      || value.requirement_policy !== "exactly_one_frozen_requirement_per_supplied_fact"
      || value.raw_supplemental_validation !== "full_stream_content_and_manifest_binding"
      || value.rolling_decision_compatibility !== "not_certified"
      || value.worker_request_materialization !== "forbidden"
      || value.harness_invocation !== "forbidden"
      || value.runner_compatibility !== "not_bound"
      || value.decision_output_authority !== "none"
      || value.signal_authority !== "none"
      || value.order_authority !== "none"
      || value.economic_authority !== "none"
      || value.request_schema_version !== "trade.rd-replay-execution-request.v38"
      || value.dataset_manifest_schema_version !== "trade.rd-replay-dataset-manifest.v11"
      || value.decision_input_snapshot_schema_version !== REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error("unsupported initial-signal supplemental input materialization authority")
  }
  assertExactFields(value)
  for (const item of [
    value.materialization_id, value.run_id, value.experiment_id, value.trial_group_id,
    value.trial_id, value.candidate_id, value.reservation_ref, value.dataset_manifest_ref,
  ]) requireText(item, "initial-signal supplemental input materialization identity")
  for (const [field, item] of Object.entries({
    materialization_hash: value.materialization_hash,
    request_hash: value.request_hash,
    candidate_hash: value.candidate_hash,
    reservation_hash: value.reservation_hash,
    dataset_hash: value.dataset_hash,
    dataset_manifest_hash: value.dataset_manifest_hash,
    decision_schedule_entry_hash: value.decision_schedule_entry_hash,
    supplemental_requirement_set_hash: value.supplemental_requirement_set_hash,
    supplied_records_hash: value.supplied_records_hash,
    source_ids_hash: value.source_ids_hash,
    selected_records_hash: value.selected_records_hash,
    future_record_ids_hash: value.future_record_ids_hash,
    requirement_evaluations_hash: value.requirement_evaluations_hash,
    decision_input_snapshot_hash: value.decision_input_snapshot_hash,
  })) requireHash(item, `initial-signal supplemental input materialization ${field}`)
  requireUtc(value.decision_time, "initial-signal supplemental input materialization decision time")
  requireUtc(value.manifest_observed_through, "initial-signal supplemental input materialization observed through")
  if (!Number.isSafeInteger(value.decision_sequence) || value.decision_sequence < 1
      || !Number.isSafeInteger(value.supplied_record_count) || value.supplied_record_count < 1
      || value.supplied_record_count !== value.supplied_records.length) {
    throw new Error("initial-signal supplemental input materialization cardinality drift")
  }
  assertReplaySupplementalRequirementSet(value.supplemental_requirement_set, value.decision_time)
  if (value.supplemental_requirement_set.schema_version !== REPLAY_SUPPLEMENTAL_REQUIREMENT_SET_SCHEMA_VERSION
      || value.supplemental_requirement_set.mode !== "signal_time_complete") {
    throw new Error("initial-signal supplemental input materialization requires signal-time-complete requirements")
  }
  validateSuppliedRecords(value)
  const selected = selectVisibleRecords(value.supplied_records, value.decision_time)
  const futureRecordIds = value.supplied_records
    .filter((fact) => Date.parse(fact.availability_at) > Date.parse(value.decision_time))
    .map((fact) => fact.record_id)
  const evaluations = evaluateRequirements(
    value.supplemental_requirement_set.requirements, value.supplied_records, selected, value.decision_time,
  )
  assertReplayDecisionInputSnapshot(value.decision_input_snapshot)
  if (value.supplemental_requirement_set_hash !== canonicalHash(value.supplemental_requirement_set)
      || value.supplied_records_hash !== canonicalHash(value.supplied_records)
      || value.source_ids_hash !== canonicalHash(value.source_ids)
      || value.source_ids.join("\u0000") !== [...new Set(value.supplied_records.map((fact) => fact.source_id))].sort().join("\u0000")
      || value.selected_record_ids.join("\u0000") !== selected.map((fact) => fact.record_id).join("\u0000")
      || value.selected_records_hash !== canonicalHash(selected)
      || value.future_record_ids.join("\u0000") !== futureRecordIds.join("\u0000")
      || value.future_record_ids_hash !== canonicalHash(futureRecordIds)
      || value.requirement_evaluations_hash !== canonicalHash(value.requirement_evaluations)
      || canonicalHash(value.requirement_evaluations) !== canonicalHash(evaluations)
      || value.decision_input_snapshot.run_id !== value.run_id
      || value.decision_input_snapshot.decision_time !== value.decision_time
      || value.decision_input_snapshot.supplemental_requirement_set_hash !== value.supplemental_requirement_set_hash
      || canonicalHash(value.decision_input_snapshot.selected_records) !== canonicalHash(selected)
      || value.decision_input_snapshot_hash !== value.decision_input_snapshot.snapshot_hash) {
    throw new Error("initial-signal supplemental input materialization semantic drift")
  }
  const { materialization_hash: materializationHash, ...body } = value
  const { materialization_id: materializationId, ...bodyWithoutId } = body
  if (materializationId !== `initial-signal-supplemental-${canonicalHash(bodyWithoutId).slice(0, 24)}`) {
    throw new Error("initial-signal supplemental input materialization identity mismatch")
  }
  if (materializationHash !== canonicalHash(body)) {
    throw new Error("initial-signal supplemental input materialization hash mismatch")
  }
}

function validateSuppliedRecords(value: ReplayInitialSignalSupplementalInputMaterialization): void {
  let priorCanonicalKey = ""
  const recordIds = new Set<string>()
  const revisionIds = new Set<string>()
  const priorAvailabilityByGroup = new Map<string, number>()
  for (const fact of value.supplied_records) {
    assertReplaySupplementalFact(fact)
    const canonicalKey = `${fact.source_id}\u0000${String(fact.source_sequence).padStart(16, "0")}`
    const group = factGroupKey(fact)
    if (canonicalKey <= priorCanonicalKey || recordIds.has(fact.record_id)
        || revisionIds.has(`${group}\u0000${fact.revision_id}`)
        || Date.parse(fact.received_at) > Date.parse(value.manifest_observed_through)
        || (priorAvailabilityByGroup.has(group)
          && Date.parse(fact.availability_at) <= priorAvailabilityByGroup.get(group)!)) {
      throw new Error("initial-signal supplemental supplied revision stream is invalid")
    }
    priorCanonicalKey = canonicalKey
    recordIds.add(fact.record_id)
    revisionIds.add(`${group}\u0000${fact.revision_id}`)
    priorAvailabilityByGroup.set(group, Date.parse(fact.availability_at))
  }
}

function selectVisibleRecords(facts: ReplaySupplementalFact[], decisionTime: string): ReplaySupplementalFact[] {
  const selected = new Map<string, ReplaySupplementalFact>()
  for (const fact of facts) {
    if (Date.parse(fact.availability_at) <= Date.parse(decisionTime)) selected.set(factGroupKey(fact), fact)
  }
  return [...selected.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, fact]) => fact)
}

function evaluateRequirements(
  requirements: ReplaySupplementalRequirement[], supplied: ReplaySupplementalFact[],
  selected: ReplaySupplementalFact[], decisionTime: string,
): ReplaySupplementalRequirementEvaluation[] {
  for (const fact of supplied) {
    if (requirements.filter((requirement) => factMatchesRequirement(fact, requirement)).length !== 1) {
      throw new Error("initial-signal supplemental fact must match exactly one requirement")
    }
  }
  return requirements.map((requirement) => {
    const visible = selected.filter((fact) => factMatchesRequirement(fact, requirement))
    if (visible.length < requirement.minimum_visible_event_count) {
      throw new Error("initial-signal supplemental requirement has insufficient visible events")
    }
    const latestEventTime = visible.reduce((latest, fact) => (
      Date.parse(fact.event_time) > Date.parse(latest) ? fact.event_time : latest
    ), visible[0]!.event_time)
    const latestEventAge = Date.parse(decisionTime) - Date.parse(latestEventTime)
    if (latestEventAge > requirement.maximum_latest_event_age_ms) {
      throw new Error("initial-signal supplemental requirement is stale at decision time")
    }
    return {
      requirement_id: requirement.requirement_id,
      selected_event_count: visible.length,
      latest_event_time: latestEventTime,
      latest_event_age_ms: latestEventAge,
      status: "satisfied" as const,
    }
  })
}

function factMatchesRequirement(fact: ReplaySupplementalFact, requirement: ReplaySupplementalRequirement): boolean {
  const eventTime = Date.parse(fact.event_time)
  return fact.source_id === requirement.source_id
    && fact.entity_key === requirement.entity_key
    && fact.fact_key === requirement.fact_key
    && eventTime >= Date.parse(requirement.event_time_start_inclusive)
    && eventTime <= Date.parse(requirement.event_time_end_inclusive)
}

function factGroupKey(fact: ReplaySupplementalFact): string {
  return `${fact.source_id}\u0000${fact.entity_key}\u0000${fact.fact_key}\u0000${fact.event_time}`
}

const MATERIALIZATION_FIELDS = [
  "candidate_hash", "candidate_id", "dataset_hash", "dataset_manifest_hash",
  "dataset_manifest_ref", "dataset_manifest_schema_version", "decision_input_snapshot",
  "decision_input_snapshot_hash", "decision_input_snapshot_schema_version", "decision_output_authority",
  "decision_schedule_entry_hash", "decision_scope", "decision_sequence", "decision_time",
  "economic_authority", "experiment_id", "future_record_ids", "future_record_ids_hash",
  "harness_invocation", "input_channel", "manifest_observed_through", "market_wire_relationship",
  "materialization_hash", "materialization_id", "materialization_policy_version", "order_authority",
  "raw_supplemental_validation", "request_hash", "request_schema_version", "requirement_evaluations",
  "requirement_evaluations_hash", "requirement_policy", "reservation_hash", "reservation_ref",
  "revision_selection_policy", "rolling_decision_compatibility", "run_id", "runner_compatibility",
  "schema_version", "selected_record_ids", "selected_records_hash", "signal_authority", "source_ids",
  "source_ids_hash", "supplied_record_count", "supplied_records", "supplied_records_hash",
  "supplemental_requirement_set", "supplemental_requirement_set_hash", "scope", "trial_group_id",
  "trial_id", "visibility_policy", "worker_request_materialization",
].sort()

function assertExactFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(MATERIALIZATION_FIELDS)) {
    throw new Error("initial-signal supplemental input materialization field whitelist drift")
  }
}
