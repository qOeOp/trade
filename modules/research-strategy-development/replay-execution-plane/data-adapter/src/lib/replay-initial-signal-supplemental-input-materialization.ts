import {
  REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION,
  assertReplayDatasetManifest,
  assertReplayExecutionRequest,
  canonicalHash,
  createReplayDecisionInputSnapshot,
  replayAuthorizedInitialDecisionScheduleEntry,
  replayDatasetManifestHash,
  type ReplayDatasetManifest,
  type ReplayExecutionRequest,
  type ReplaySupplementalFact,
} from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_INITIAL_SIGNAL_SUPPLEMENTAL_INPUT_MATERIALIZATION_POLICY_VERSION,
  REPLAY_INITIAL_SIGNAL_SUPPLEMENTAL_INPUT_MATERIALIZATION_SCHEMA_VERSION,
  assertReplayInitialSignalSupplementalInputMaterialization,
  createReplayInitialSignalSupplementalInputMaterialization,
  type ReplayInitialSignalSupplementalInputMaterialization,
  type ReplayInitialSignalSupplementalInputMaterializationBody,
} from "../../../contracts/src/lib/replay-initial-signal-supplemental-input-materialization"
import {
  selectReplaySupplementalFactsAt,
  validateReplaySupplementalFacts,
} from "./replay-data-adapter"

export interface ReplayInitialSignalSupplementalInputMaterializationInput {
  request: ReplayExecutionRequest
  dataset_manifest: ReplayDatasetManifest
  supplemental_facts: ReplaySupplementalFact[]
}

export function buildReplayInitialSignalSupplementalInputMaterialization(
  input: ReplayInitialSignalSupplementalInputMaterializationInput,
): ReplayInitialSignalSupplementalInputMaterialization {
  assertInputAuthority(input)
  const bodyWithoutId = buildBodyWithoutId(input)
  const value = createReplayInitialSignalSupplementalInputMaterialization({
    ...bodyWithoutId,
    materialization_id: `initial-signal-supplemental-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  assertReplayInitialSignalSupplementalInputMaterializationLineage(value, input)
  return value
}

export function assertReplayInitialSignalSupplementalInputMaterializationLineage(
  value: ReplayInitialSignalSupplementalInputMaterialization,
  input: ReplayInitialSignalSupplementalInputMaterializationInput,
): void {
  assertReplayInitialSignalSupplementalInputMaterialization(value)
  assertInputAuthority(input)
  const bodyWithoutId = buildBodyWithoutId(input)
  const expected = createReplayInitialSignalSupplementalInputMaterialization({
    ...bodyWithoutId,
    materialization_id: `initial-signal-supplemental-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  if (canonicalHash(value) !== canonicalHash(expected)) {
    throw new Error("initial-signal supplemental input materialization parent lineage drift")
  }
}

function buildBodyWithoutId(
  input: ReplayInitialSignalSupplementalInputMaterializationInput,
): Omit<ReplayInitialSignalSupplementalInputMaterializationBody, "materialization_id"> {
  const scheduleEntry = replayAuthorizedInitialDecisionScheduleEntry(input.request)
  const records = validateReplaySupplementalFacts(input.supplemental_facts)
  const selected = selectReplaySupplementalFactsAt(records, scheduleEntry.decision_time)
  const futureRecordIds = records
    .filter((fact) => Date.parse(fact.availability_at) > Date.parse(scheduleEntry.decision_time))
    .map((fact) => fact.record_id)
  const requirementEvaluations = input.request.supplemental_requirement_set.requirements.map((requirement) => {
    const visible = selected.filter((fact) => {
      const eventTime = Date.parse(fact.event_time)
      return fact.source_id === requirement.source_id
        && fact.entity_key === requirement.entity_key
        && fact.fact_key === requirement.fact_key
        && eventTime >= Date.parse(requirement.event_time_start_inclusive)
        && eventTime <= Date.parse(requirement.event_time_end_inclusive)
    })
    if (visible.length < requirement.minimum_visible_event_count) {
      throw new Error(`supplemental requirement ${requirement.requirement_id} has insufficient visible events`)
    }
    const latestEventTime = visible.reduce((latest, fact) => (
      Date.parse(fact.event_time) > Date.parse(latest) ? fact.event_time : latest
    ), visible[0]!.event_time)
    const latestEventAge = Date.parse(scheduleEntry.decision_time) - Date.parse(latestEventTime)
    if (latestEventAge > requirement.maximum_latest_event_age_ms) {
      throw new Error(`supplemental requirement ${requirement.requirement_id} is stale at decision time`)
    }
    return {
      requirement_id: requirement.requirement_id,
      selected_event_count: visible.length,
      latest_event_time: latestEventTime,
      latest_event_age_ms: latestEventAge,
      status: "satisfied" as const,
    }
  })
  const snapshot = createReplayDecisionInputSnapshot(input.request, selected, scheduleEntry.decision_time)
  const sourceIds = [...new Set(records.map((fact) => fact.source_id))].sort()
  return {
    schema_version: REPLAY_INITIAL_SIGNAL_SUPPLEMENTAL_INPUT_MATERIALIZATION_SCHEMA_VERSION,
    materialization_policy_version: REPLAY_INITIAL_SIGNAL_SUPPLEMENTAL_INPUT_MATERIALIZATION_POLICY_VERSION,
    scope: "pre_worker_non_economic_initial_signal_supplemental_materialization",
    input_channel: "dataset_manifest_bound_supplemental_revision_stream",
    market_wire_relationship: "separate_input_channel_not_market_wire_source",
    decision_scope: "authorized_initial_order_signal_time_only",
    visibility_policy: "availability_at_lte_decision_time",
    revision_selection_policy: "latest_visible_revision_per_fact_group",
    requirement_policy: "exactly_one_frozen_requirement_per_supplied_fact",
    raw_supplemental_validation: "full_stream_content_and_manifest_binding",
    rolling_decision_compatibility: "not_certified",
    worker_request_materialization: "forbidden",
    harness_invocation: "forbidden",
    runner_compatibility: "not_bound",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    request_schema_version: input.request.schema_version,
    request_hash: canonicalHash(input.request),
    run_id: input.request.run_id,
    experiment_id: input.request.experiment_id,
    trial_group_id: input.request.trial_group_id,
    trial_id: input.request.trial_id,
    candidate_id: input.request.candidate_id,
    candidate_hash: input.request.candidate_hash,
    reservation_ref: input.request.trial_reservation_ref,
    reservation_hash: input.request.trial_reservation_hash,
    dataset_manifest_schema_version: input.dataset_manifest.schema_version,
    dataset_manifest_ref: input.dataset_manifest.manifest_ref,
    dataset_hash: input.dataset_manifest.data_hash,
    dataset_manifest_hash: replayDatasetManifestHash(input.dataset_manifest),
    manifest_observed_through: input.dataset_manifest.observed_through,
    decision_sequence: scheduleEntry.decision_sequence,
    decision_time: scheduleEntry.decision_time,
    decision_schedule_entry_hash: canonicalHash(scheduleEntry),
    supplemental_requirement_set: structuredClone(input.request.supplemental_requirement_set),
    supplemental_requirement_set_hash: input.request.supplemental_requirement_set_hash,
    supplied_record_count: records.length,
    supplied_records: records,
    supplied_records_hash: canonicalHash(records),
    source_ids: sourceIds,
    source_ids_hash: canonicalHash(sourceIds),
    selected_record_ids: selected.map((fact) => fact.record_id),
    selected_records_hash: canonicalHash(selected),
    future_record_ids: futureRecordIds,
    future_record_ids_hash: canonicalHash(futureRecordIds),
    requirement_evaluations: requirementEvaluations,
    requirement_evaluations_hash: canonicalHash(requirementEvaluations),
    decision_input_snapshot_schema_version: REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION,
    decision_input_snapshot: snapshot,
    decision_input_snapshot_hash: snapshot.snapshot_hash,
  }
}

function assertInputAuthority(input: ReplayInitialSignalSupplementalInputMaterializationInput): void {
  assertReplayExecutionRequest(input.request)
  assertReplayDatasetManifest(input.dataset_manifest)
  const records = validateReplaySupplementalFacts(input.supplemental_facts)
  const declaration = input.dataset_manifest.supplemental_facts
  if (input.request.supplemental_requirement_set.mode !== "signal_time_complete"
      || declaration.coverage !== "signal_time_snapshot"
      || records.length === 0
      || declaration.record_count !== records.length
      || declaration.content_hash !== canonicalHash(records)
      || input.request.supplemental_facts_hash !== canonicalHash(records)
      || declaration.requirement_set_hash !== input.request.supplemental_requirement_set_hash
      || declaration.source_ids.join("\u0000") !== [...new Set(records.map((fact) => fact.source_id))].sort().join("\u0000")) {
    throw new Error("initial-signal supplemental stream does not match Request and Dataset Manifest")
  }
  if (input.dataset_manifest.manifest_ref !== input.request.dataset_manifest_ref
      || input.dataset_manifest.data_hash !== input.request.dataset_hash
      || input.dataset_manifest.symbol !== input.request.symbol
      || input.dataset_manifest.timeframe !== input.request.timeframe) {
    throw new Error("initial-signal supplemental Dataset Manifest does not match Request")
  }
  for (const fact of records) {
    const matches = input.request.supplemental_requirement_set.requirements.filter((requirement) => {
      const eventTime = Date.parse(fact.event_time)
      return fact.source_id === requirement.source_id
        && fact.entity_key === requirement.entity_key
        && fact.fact_key === requirement.fact_key
        && eventTime >= Date.parse(requirement.event_time_start_inclusive)
        && eventTime <= Date.parse(requirement.event_time_end_inclusive)
    })
    if (matches.length !== 1) throw new Error(`supplemental fact ${fact.record_id} must match exactly one frozen requirement`)
    if (Date.parse(fact.received_at) > Date.parse(input.dataset_manifest.observed_through)) {
      throw new Error(`supplemental fact ${fact.record_id} was received after Dataset Manifest observation`)
    }
  }
}
