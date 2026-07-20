import {
  REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION,
  assertReplayDecisionStateSnapshot,
  assertReplayEventKey,
  canonicalHash,
  type ReplayDecisionStateSnapshot,
  type ReplayEventKey,
} from "./replay-contracts"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_POSITION_OPEN_STATE_INPUT_MATERIALIZATION_SCHEMA_VERSION = "trade.rd-replay-position-open-state-input-materialization.v1" as const
export const REPLAY_POSITION_OPEN_STATE_INPUT_MATERIALIZATION_POLICY_VERSION = "rd-replay-position-open-state-input-materialization-v1" as const

export interface ReplayPositionOpenStateInputMaterialization {
  schema_version: typeof REPLAY_POSITION_OPEN_STATE_INPUT_MATERIALIZATION_SCHEMA_VERSION
  materialization_id: string
  materialization_hash: string
  materialization_policy_version: typeof REPLAY_POSITION_OPEN_STATE_INPUT_MATERIALIZATION_POLICY_VERSION
  scope: "pre_worker_non_economic_position_open_state_input_materialization"
  owner: "replay_engine_runtime"
  decision_scope: "one_position_open_closed_bar_boundary"
  state_source: "existing_formal_decision_state_snapshot_v3"
  runtime_boundary_validation: "request_schedule_context_and_source_prefix"
  economic_recomputation: "not_performed"
  source_prefix_storage: "hash_count_and_terminal_event_identity_only"
  independent_revalidation: "requires_external_complete_source_prefix"
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
  decision_schedule_hash: string
  harness_hash: string
  harness_context_binding_id: string
  harness_context_binding_hash: string
  harness_context_binding_entry_hash: string
  harness_context_hash: string
  decision_sequence: number
  decision_time: string
  decision_phase: "position_open"
  selected_schedule_entry_hash: string
  source_event_count: number
  source_prefix_hash: string
  terminal_source_event_key: ReplayEventKey
  state_snapshot_schema_version: typeof REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION
  decision_state_snapshot: ReplayDecisionStateSnapshot
  decision_state_snapshot_hash: string
}

export type ReplayPositionOpenStateInputMaterializationBody = Omit<
  ReplayPositionOpenStateInputMaterialization, "materialization_hash"
>

export function createReplayPositionOpenStateInputMaterialization(
  body: ReplayPositionOpenStateInputMaterializationBody,
): ReplayPositionOpenStateInputMaterialization {
  const value = { ...structuredClone(body), materialization_hash: canonicalHash(body) }
  assertReplayPositionOpenStateInputMaterialization(value)
  return value
}

export function assertReplayPositionOpenStateInputMaterialization(
  value: ReplayPositionOpenStateInputMaterialization,
): void {
  assertFields(value)
  if (value.schema_version !== REPLAY_POSITION_OPEN_STATE_INPUT_MATERIALIZATION_SCHEMA_VERSION
      || value.materialization_policy_version !== REPLAY_POSITION_OPEN_STATE_INPUT_MATERIALIZATION_POLICY_VERSION
      || value.scope !== "pre_worker_non_economic_position_open_state_input_materialization"
      || value.owner !== "replay_engine_runtime"
      || value.decision_scope !== "one_position_open_closed_bar_boundary"
      || value.state_source !== "existing_formal_decision_state_snapshot_v3"
      || value.runtime_boundary_validation !== "request_schedule_context_and_source_prefix"
      || value.economic_recomputation !== "not_performed"
      || value.source_prefix_storage !== "hash_count_and_terminal_event_identity_only"
      || value.independent_revalidation !== "requires_external_complete_source_prefix"
      || value.worker_request_materialization !== "forbidden" || value.harness_invocation !== "forbidden"
      || value.decision_output_authority !== "none" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.runner_compatibility !== "not_bound"
      || value.request_schema_version !== "trade.rd-replay-execution-request.v36"
      || value.decision_phase !== "position_open"
      || value.state_snapshot_schema_version !== REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error("unsupported position-open State input materialization authority")
  }
  for (const item of [value.materialization_id, value.run_id, value.experiment_id, value.trial_group_id,
    value.trial_id, value.candidate_id, value.reservation_ref, value.dataset_manifest_ref,
    value.harness_context_binding_id]) {
    requireText(item, "position-open State input materialization identity")
  }
  for (const item of [value.materialization_hash, value.request_hash, value.candidate_hash,
    value.reservation_hash, value.dataset_hash, value.decision_schedule_hash, value.harness_hash,
    value.harness_context_binding_hash, value.harness_context_binding_entry_hash, value.harness_context_hash,
    value.selected_schedule_entry_hash, value.source_prefix_hash, value.decision_state_snapshot_hash]) {
    requireHash(item, "position-open State input materialization hash")
  }
  requireUtc(value.decision_time, "position-open State input materialization decision time")
  assertReplayEventKey(value.terminal_source_event_key)
  assertReplayDecisionStateSnapshot(value.decision_state_snapshot)
  const snapshot = value.decision_state_snapshot
  if (!Number.isSafeInteger(value.decision_sequence) || value.decision_sequence < 1
      || !Number.isSafeInteger(value.source_event_count) || value.source_event_count < 1
      || snapshot.run_id !== value.run_id || snapshot.decision_sequence !== value.decision_sequence
      || snapshot.decision_time !== value.decision_time
      || snapshot.source_prefix_hash !== value.source_prefix_hash
      || canonicalHash(snapshot.observation_event_key) !== canonicalHash(value.terminal_source_event_key)
      || snapshot.snapshot_hash !== value.decision_state_snapshot_hash) {
    throw new Error("position-open State input materialization semantic drift")
  }
  const { materialization_hash: materializationHash, ...body } = value
  const { materialization_id: materializationId, ...bodyWithoutId } = body
  if (materializationId !== `position-open-state-input-${canonicalHash(bodyWithoutId).slice(0, 24)}`
      || materializationHash !== canonicalHash(body)) {
    throw new Error("position-open State input materialization identity or hash mismatch")
  }
}

const FIELDS = ["candidate_hash", "candidate_id", "dataset_hash", "dataset_manifest_ref", "decision_output_authority",
  "decision_phase", "decision_schedule_hash", "decision_scope", "decision_sequence", "decision_state_snapshot",
  "decision_state_snapshot_hash", "decision_time", "economic_authority", "economic_recomputation", "experiment_id",
  "harness_context_binding_entry_hash", "harness_context_binding_hash", "harness_context_binding_id",
  "harness_context_hash", "harness_hash", "harness_invocation", "independent_revalidation", "materialization_hash",
  "materialization_id", "materialization_policy_version", "order_authority", "owner", "request_hash",
  "request_schema_version", "reservation_hash", "reservation_ref", "run_id", "runner_compatibility", "schema_version",
  "scope", "selected_schedule_entry_hash", "signal_authority", "source_event_count", "source_prefix_hash",
  "source_prefix_storage", "state_snapshot_schema_version", "state_source", "terminal_source_event_key", "trial_group_id",
  "trial_id", "runtime_boundary_validation", "worker_request_materialization"].sort()

function assertFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(FIELDS)) {
    throw new Error("position-open State input materialization field whitelist drift")
  }
}
