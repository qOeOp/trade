import {
  REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_DECISION_MARKET_INPUT_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION,
  assertReplayDecisionInputSnapshot,
  assertReplayDecisionMarketInputSnapshot,
  canonicalHash,
  type ReplayDecisionInputSnapshot,
  type ReplayDecisionMarketInputSnapshot,
} from "./replay-contracts"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_INPUT_MATERIALIZATION_SCHEMA_VERSION = "trade.rd-replay-source-event-decision-observation-input-materialization.v1" as const
export const REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_INPUT_MATERIALIZATION_ENTRY_SCHEMA_VERSION = "trade.rd-replay-source-event-decision-observation-input-materialization-entry.v1" as const
export const REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_INPUT_MATERIALIZATION_POLICY_VERSION = "rd-replay-source-event-decision-observation-input-materialization-v1" as const

export interface ReplaySourceEventDecisionObservationInputMaterializationEntry {
  schema_version: typeof REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_INPUT_MATERIALIZATION_ENTRY_SCHEMA_VERSION
  decision_sequence: number
  decision_time: string
  decision_phase: "pre_entry" | "initial_entry" | "pending_entry" | "position_open"
  harness_context_binding_entry_hash: string
  observation_projection_id: string
  observation_projection_hash: string
  supplemental_input_status: "materialized_empty_no_requirements"
  decision_input_snapshot: ReplayDecisionInputSnapshot
  decision_input_snapshot_hash: string
  market_input_status: "materialized_empty_no_requirement" | "materialized_closed_bar_lookback"
  decision_market_input_snapshot: ReplayDecisionMarketInputSnapshot
  decision_market_input_snapshot_hash: string
  state_input_status: "not_applicable_non_position_phase" | "runtime_state_required_not_materialized"
  decision_state_snapshot: null
  worker_request_compatibility: "not_bound"
  harness_invocation: "forbidden"
  execution_effect: "none"
  entry_hash: string
}

export type ReplaySourceEventDecisionObservationInputMaterializationEntryBody = Omit<
  ReplaySourceEventDecisionObservationInputMaterializationEntry,
  "entry_hash"
>

export interface ReplaySourceEventDecisionObservationInputMaterialization {
  schema_version: typeof REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_INPUT_MATERIALIZATION_SCHEMA_VERSION
  materialization_id: string
  materialization_hash: string
  materialization_policy_version: typeof REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_INPUT_MATERIALIZATION_POLICY_VERSION
  scope: "pre_worker_non_economic_decision_input_materialization"
  materialization_purpose: "materialize_formal_supplemental_and_market_snapshots_from_admitted_observations"
  authority_source: "decision_observation_harness_context_binding"
  parent_context_binding_validation: "full_rebuild_against_request_bundle_and_derivation_admission"
  dataset_manifest_validation: "schema_and_request_identity_only"
  observation_source_validation: "admitted_bundle_projection_and_context_binding_lineage"
  raw_dataset_revalidation: "not_performed"
  supplemental_input_materialization: "certified_empty_requirement_set_only"
  market_input_materialization: "certified_from_admitted_closed_bar_observations"
  state_input_materialization: "not_materialized_runtime_state_required"
  worker_request_materialization: "forbidden"
  harness_invocation: "forbidden"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  runner_compatibility: "not_bound"
  request_schema_version: "trade.rd-replay-execution-request.v36"
  request_hash: string
  run_id: string
  experiment_id: string
  trial_group_id: string
  trial_id: string
  candidate_id: string
  candidate_hash: string
  reservation_ref: string
  reservation_hash: string
  dataset_manifest_ref: string
  dataset_hash: string
  dataset_manifest_hash: string
  derivation_admission_id: string
  derivation_admission_hash: string
  bundle_id: string
  bundle_hash: string
  harness_context_binding_id: string
  harness_context_binding_hash: string
  supplemental_requirement_set_hash: string
  decision_market_input_requirement_hash: string
  decision_input_snapshot_schema_version: typeof REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION
  decision_market_input_snapshot_schema_version: typeof REPLAY_DECISION_MARKET_INPUT_SNAPSHOT_SCHEMA_VERSION
  decision_state_snapshot_schema_version: typeof REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION
  entry_count: number
  entries: ReplaySourceEventDecisionObservationInputMaterializationEntry[]
  entries_hash: string
  entry_hashes_hash: string
  decision_input_snapshot_hashes_hash: string
  decision_market_input_snapshot_hashes_hash: string
  materialized_state_snapshot_count: 0
  runtime_state_required_count: number
  first_decision_time: string
  last_decision_time: string
}

export type ReplaySourceEventDecisionObservationInputMaterializationBody = Omit<
  ReplaySourceEventDecisionObservationInputMaterialization,
  "materialization_hash"
>

export function createReplaySourceEventDecisionObservationInputMaterializationEntry(
  body: ReplaySourceEventDecisionObservationInputMaterializationEntryBody,
): ReplaySourceEventDecisionObservationInputMaterializationEntry {
  const value = { ...structuredClone(body), entry_hash: canonicalHash(body) }
  assertReplaySourceEventDecisionObservationInputMaterializationEntry(value)
  return value
}

export function createReplaySourceEventDecisionObservationInputMaterialization(
  body: ReplaySourceEventDecisionObservationInputMaterializationBody,
): ReplaySourceEventDecisionObservationInputMaterialization {
  const value = { ...structuredClone(body), materialization_hash: canonicalHash(body) }
  assertReplaySourceEventDecisionObservationInputMaterialization(value)
  return value
}

export function assertReplaySourceEventDecisionObservationInputMaterializationEntry(
  value: ReplaySourceEventDecisionObservationInputMaterializationEntry,
): void {
  if (value.schema_version !== REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_INPUT_MATERIALIZATION_ENTRY_SCHEMA_VERSION
      || value.supplemental_input_status !== "materialized_empty_no_requirements"
      || !["materialized_empty_no_requirement", "materialized_closed_bar_lookback"].includes(value.market_input_status)
      || !["not_applicable_non_position_phase", "runtime_state_required_not_materialized"].includes(value.state_input_status)
      || value.decision_state_snapshot !== null
      || value.worker_request_compatibility !== "not_bound"
      || value.harness_invocation !== "forbidden"
      || value.execution_effect !== "none") {
    throw new Error("unsupported decision observation input materialization entry authority")
  }
  assertExactFields(value, ENTRY_FIELDS, "decision observation input materialization entry")
  requireText(value.observation_projection_id, "decision observation input materialization projection identity")
  for (const [field, item] of Object.entries({
    harness_context_binding_entry_hash: value.harness_context_binding_entry_hash,
    observation_projection_hash: value.observation_projection_hash,
    decision_input_snapshot_hash: value.decision_input_snapshot_hash,
    decision_market_input_snapshot_hash: value.decision_market_input_snapshot_hash,
    entry_hash: value.entry_hash,
  })) requireHash(item, `decision observation input materialization entry ${field}`)
  requireUtc(value.decision_time, "decision observation input materialization decision time")
  if (!Number.isSafeInteger(value.decision_sequence) || value.decision_sequence < 1
      || !["pre_entry", "initial_entry", "pending_entry", "position_open"].includes(value.decision_phase)) {
    throw new Error("decision observation input materialization sequence or phase is invalid")
  }
  assertReplayDecisionInputSnapshot(value.decision_input_snapshot)
  assertReplayDecisionMarketInputSnapshot(value.decision_market_input_snapshot)
  const decisionTime = Date.parse(value.decision_time)
  for (const [index, bar] of value.decision_market_input_snapshot.bars.entries()) {
    if (Date.parse(bar.close_time) > decisionTime
        || Date.parse(bar.close_time) - Date.parse(bar.open_time)
          !== value.decision_market_input_snapshot.interval_ms
        || (index > 0
          && bar.open_time !== value.decision_market_input_snapshot.bars[index - 1]!.close_time)) {
      throw new Error("decision observation input materialization contains future or discontinuous market input")
    }
  }
  if (value.decision_market_input_snapshot.bars.length > 0
      && value.decision_market_input_snapshot.bars.at(-1)!.close_time !== value.decision_time) {
    throw new Error("decision observation input materialization terminal market input is not decision-time closed")
  }
  if (value.decision_input_snapshot.run_id !== value.decision_market_input_snapshot.run_id
      || value.decision_input_snapshot.decision_time !== value.decision_time
      || value.decision_market_input_snapshot.decision_time !== value.decision_time
      || value.decision_input_snapshot.selected_records.length !== 0
      || value.decision_input_snapshot.snapshot_hash !== value.decision_input_snapshot_hash
      || value.decision_market_input_snapshot.snapshot_hash !== value.decision_market_input_snapshot_hash
      || (value.market_input_status === "materialized_empty_no_requirement"
        && value.decision_market_input_snapshot.bars.length !== 0)
      || (value.market_input_status === "materialized_closed_bar_lookback"
        && value.decision_market_input_snapshot.bars.length === 0)
      || (value.decision_phase === "position_open")
        !== (value.state_input_status === "runtime_state_required_not_materialized")) {
    throw new Error("decision observation input materialization entry snapshot drift")
  }
  const { entry_hash: entryHash, ...body } = value
  if (entryHash !== canonicalHash(body)) {
    throw new Error("decision observation input materialization entry hash mismatch")
  }
}

export function assertReplaySourceEventDecisionObservationInputMaterialization(
  value: ReplaySourceEventDecisionObservationInputMaterialization,
): void {
  if (value.schema_version !== REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_INPUT_MATERIALIZATION_SCHEMA_VERSION
      || value.materialization_policy_version !== REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_INPUT_MATERIALIZATION_POLICY_VERSION
      || value.scope !== "pre_worker_non_economic_decision_input_materialization"
      || value.materialization_purpose !== "materialize_formal_supplemental_and_market_snapshots_from_admitted_observations"
      || value.authority_source !== "decision_observation_harness_context_binding"
      || value.parent_context_binding_validation !== "full_rebuild_against_request_bundle_and_derivation_admission"
      || value.dataset_manifest_validation !== "schema_and_request_identity_only"
      || value.observation_source_validation !== "admitted_bundle_projection_and_context_binding_lineage"
      || value.raw_dataset_revalidation !== "not_performed"
      || value.supplemental_input_materialization !== "certified_empty_requirement_set_only"
      || value.market_input_materialization !== "certified_from_admitted_closed_bar_observations"
      || value.state_input_materialization !== "not_materialized_runtime_state_required"
      || value.worker_request_materialization !== "forbidden"
      || value.harness_invocation !== "forbidden"
      || value.decision_output_authority !== "none"
      || value.signal_authority !== "none"
      || value.order_authority !== "none"
      || value.economic_authority !== "none"
      || value.runner_compatibility !== "not_bound"
      || value.request_schema_version !== "trade.rd-replay-execution-request.v36"
      || value.decision_input_snapshot_schema_version !== REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION
      || value.decision_market_input_snapshot_schema_version !== REPLAY_DECISION_MARKET_INPUT_SNAPSHOT_SCHEMA_VERSION
      || value.decision_state_snapshot_schema_version !== REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION
      || value.materialized_state_snapshot_count !== 0) {
    throw new Error("unsupported decision observation input materialization authority")
  }
  assertExactFields(value, MATERIALIZATION_FIELDS, "decision observation input materialization")
  for (const item of [
    value.materialization_id, value.run_id, value.experiment_id, value.trial_group_id,
    value.trial_id, value.candidate_id, value.reservation_ref, value.dataset_manifest_ref,
    value.derivation_admission_id, value.bundle_id, value.harness_context_binding_id,
  ]) requireText(item, "decision observation input materialization identity")
  for (const [field, item] of Object.entries({
    materialization_hash: value.materialization_hash,
    request_hash: value.request_hash,
    candidate_hash: value.candidate_hash,
    reservation_hash: value.reservation_hash,
    dataset_hash: value.dataset_hash,
    dataset_manifest_hash: value.dataset_manifest_hash,
    derivation_admission_hash: value.derivation_admission_hash,
    bundle_hash: value.bundle_hash,
    harness_context_binding_hash: value.harness_context_binding_hash,
    supplemental_requirement_set_hash: value.supplemental_requirement_set_hash,
    decision_market_input_requirement_hash: value.decision_market_input_requirement_hash,
    entries_hash: value.entries_hash,
    entry_hashes_hash: value.entry_hashes_hash,
    decision_input_snapshot_hashes_hash: value.decision_input_snapshot_hashes_hash,
    decision_market_input_snapshot_hashes_hash: value.decision_market_input_snapshot_hashes_hash,
  })) requireHash(item, `decision observation input materialization ${field}`)
  requireUtc(value.first_decision_time, "decision observation input materialization first decision time")
  requireUtc(value.last_decision_time, "decision observation input materialization last decision time")
  if (!Number.isSafeInteger(value.entry_count) || value.entry_count < 1
      || value.entry_count !== value.entries.length
      || !Number.isSafeInteger(value.runtime_state_required_count)
      || value.runtime_state_required_count < 0) {
    throw new Error("decision observation input materialization cardinality drift")
  }
  let priorTime = Number.NEGATIVE_INFINITY
  let runtimeStateRequiredCount = 0
  for (const [index, entry] of value.entries.entries()) {
    assertReplaySourceEventDecisionObservationInputMaterializationEntry(entry)
    const decisionTime = Date.parse(entry.decision_time)
    if (entry.decision_sequence !== index + 1
        || decisionTime <= priorTime
        || entry.decision_input_snapshot.run_id !== value.run_id
        || entry.decision_input_snapshot.supplemental_requirement_set_hash
          !== value.supplemental_requirement_set_hash
        || entry.decision_market_input_snapshot.requirement_hash
          !== value.decision_market_input_requirement_hash) {
      throw new Error("decision observation input materialization member drift")
    }
    if (entry.state_input_status === "runtime_state_required_not_materialized") runtimeStateRequiredCount += 1
    priorTime = decisionTime
  }
  if (runtimeStateRequiredCount !== value.runtime_state_required_count
      || value.first_decision_time !== value.entries[0]!.decision_time
      || value.last_decision_time !== value.entries.at(-1)!.decision_time
      || value.entries_hash !== canonicalHash(value.entries)
      || value.entry_hashes_hash !== canonicalHash(value.entries.map((item) => item.entry_hash))
      || value.decision_input_snapshot_hashes_hash
        !== canonicalHash(value.entries.map((item) => item.decision_input_snapshot_hash))
      || value.decision_market_input_snapshot_hashes_hash
        !== canonicalHash(value.entries.map((item) => item.decision_market_input_snapshot_hash))) {
    throw new Error("decision observation input materialization fold drift")
  }
  const { materialization_hash: materializationHash, ...body } = value
  const { materialization_id: materializationId, ...bodyWithoutId } = body
  if (materializationId !== `source-event-decision-input-${canonicalHash(bodyWithoutId).slice(0, 24)}`) {
    throw new Error("decision observation input materialization identity mismatch")
  }
  if (materializationHash !== canonicalHash(body)) {
    throw new Error("decision observation input materialization hash mismatch")
  }
}

const ENTRY_FIELDS = [
  "decision_input_snapshot", "decision_input_snapshot_hash", "decision_market_input_snapshot",
  "decision_market_input_snapshot_hash", "decision_phase", "decision_sequence",
  "decision_state_snapshot", "decision_time", "entry_hash", "execution_effect",
  "harness_context_binding_entry_hash", "harness_invocation", "market_input_status",
  "observation_projection_hash", "observation_projection_id", "schema_version",
  "state_input_status", "supplemental_input_status", "worker_request_compatibility",
].sort()

const MATERIALIZATION_FIELDS = [
  "authority_source", "bundle_hash", "bundle_id", "candidate_hash", "candidate_id",
  "dataset_hash", "dataset_manifest_hash", "dataset_manifest_ref", "dataset_manifest_validation",
  "decision_input_snapshot_hashes_hash", "decision_input_snapshot_schema_version",
  "decision_market_input_requirement_hash", "decision_market_input_snapshot_hashes_hash",
  "decision_market_input_snapshot_schema_version", "decision_output_authority",
  "decision_state_snapshot_schema_version", "derivation_admission_hash", "derivation_admission_id",
  "economic_authority", "entries", "entries_hash", "entry_count", "entry_hashes_hash",
  "experiment_id", "first_decision_time", "harness_context_binding_hash",
  "harness_context_binding_id", "harness_invocation", "last_decision_time",
  "market_input_materialization", "materialization_hash", "materialization_id",
  "materialization_policy_version", "materialization_purpose", "materialized_state_snapshot_count",
  "observation_source_validation", "order_authority", "parent_context_binding_validation",
  "raw_dataset_revalidation", "request_hash", "request_schema_version", "reservation_hash",
  "reservation_ref", "run_id", "runner_compatibility", "runtime_state_required_count",
  "schema_version", "scope", "signal_authority", "state_input_materialization",
  "supplemental_input_materialization", "supplemental_requirement_set_hash", "trial_group_id",
  "trial_id", "worker_request_materialization",
].sort()

function assertExactFields(value: object, expected: string[], label: string): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(expected)) {
    throw new Error(`${label} field whitelist drift`)
  }
}
