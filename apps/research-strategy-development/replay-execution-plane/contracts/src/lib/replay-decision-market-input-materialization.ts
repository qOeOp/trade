import {
  REPLAY_DECISION_MARKET_INPUT_SNAPSHOT_SCHEMA_VERSION,
  assertReplayDecisionMarketInputSnapshot,
  canonicalHash,
  type ReplayDecisionMarketInputSnapshot,
} from "./replay-contracts"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_MARKET_INPUT_MATERIALIZATION_SCHEMA_VERSION = "trade.rd-replay-decision-market-input-materialization.v1" as const
export const REPLAY_DECISION_MARKET_INPUT_MATERIALIZATION_ENTRY_SCHEMA_VERSION = "trade.rd-replay-decision-market-input-materialization-entry.v1" as const
export const REPLAY_DECISION_MARKET_INPUT_MATERIALIZATION_POLICY_VERSION = "rd-replay-decision-market-input-materialization-v1" as const

export interface ReplayDecisionMarketInputMaterializationEntry {
  schema_version: typeof REPLAY_DECISION_MARKET_INPUT_MATERIALIZATION_ENTRY_SCHEMA_VERSION
  decision_sequence: number
  decision_time: string
  decision_phase: "pre_entry" | "initial_entry" | "pending_entry" | "position_open"
  harness_context_binding_entry_hash: string
  observation_projection_id: string
  observation_projection_hash: string
  market_input_status: "materialized_empty_no_requirement" | "materialized_closed_bar_lookback"
  decision_market_input_snapshot: ReplayDecisionMarketInputSnapshot
  decision_market_input_snapshot_hash: string
  worker_request_compatibility: "not_bound"
  harness_invocation: "forbidden"
  execution_effect: "none"
  entry_hash: string
}

export type ReplayDecisionMarketInputMaterializationEntryBody = Omit<
  ReplayDecisionMarketInputMaterializationEntry, "entry_hash"
>

export interface ReplayDecisionMarketInputMaterialization {
  schema_version: typeof REPLAY_DECISION_MARKET_INPUT_MATERIALIZATION_SCHEMA_VERSION
  materialization_id: string
  materialization_hash: string
  materialization_policy_version: typeof REPLAY_DECISION_MARKET_INPUT_MATERIALIZATION_POLICY_VERSION
  scope: "pre_worker_non_economic_market_input_materialization"
  purpose: "materialize_formal_market_snapshots_from_admitted_closed_bar_observations"
  authority_source: "decision_observation_harness_context_binding"
  parent_context_binding_validation: "full_rebuild_against_request_bundle_and_derivation_admission"
  dataset_manifest_validation: "schema_and_request_market_identity_only"
  supplemental_binding_validation: "not_inspected_outside_market_responsibility"
  raw_dataset_revalidation: "not_performed"
  worker_request_materialization: "forbidden"
  harness_invocation: "forbidden"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  runner_compatibility: "not_bound"
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
  dataset_manifest_ref: string
  dataset_hash: string
  dataset_manifest_hash: string
  derivation_admission_id: string
  derivation_admission_hash: string
  bundle_id: string
  bundle_hash: string
  harness_context_binding_id: string
  harness_context_binding_hash: string
  decision_market_input_requirement_hash: string
  decision_market_input_snapshot_schema_version: typeof REPLAY_DECISION_MARKET_INPUT_SNAPSHOT_SCHEMA_VERSION
  entry_count: number
  entries: ReplayDecisionMarketInputMaterializationEntry[]
  entries_hash: string
  entry_hashes_hash: string
  snapshot_hashes_hash: string
  first_decision_time: string
  last_decision_time: string
}

export type ReplayDecisionMarketInputMaterializationBody = Omit<
  ReplayDecisionMarketInputMaterialization, "materialization_hash"
>

export function createReplayDecisionMarketInputMaterializationEntry(
  body: ReplayDecisionMarketInputMaterializationEntryBody,
): ReplayDecisionMarketInputMaterializationEntry {
  const value = { ...structuredClone(body), entry_hash: canonicalHash(body) }
  assertReplayDecisionMarketInputMaterializationEntry(value)
  return value
}

export function createReplayDecisionMarketInputMaterialization(
  body: ReplayDecisionMarketInputMaterializationBody,
): ReplayDecisionMarketInputMaterialization {
  const value = { ...structuredClone(body), materialization_hash: canonicalHash(body) }
  assertReplayDecisionMarketInputMaterialization(value)
  return value
}

export function assertReplayDecisionMarketInputMaterializationEntry(
  value: ReplayDecisionMarketInputMaterializationEntry,
): void {
  if (value.schema_version !== REPLAY_DECISION_MARKET_INPUT_MATERIALIZATION_ENTRY_SCHEMA_VERSION
      || !["materialized_empty_no_requirement", "materialized_closed_bar_lookback"].includes(value.market_input_status)
      || value.worker_request_compatibility !== "not_bound"
      || value.harness_invocation !== "forbidden" || value.execution_effect !== "none") {
    throw new Error("unsupported decision Market input materialization entry authority")
  }
  assertFields(value, ENTRY_FIELDS, "decision Market input materialization entry")
  requireText(value.observation_projection_id, "decision Market input materialization projection identity")
  requireUtc(value.decision_time, "decision Market input materialization decision time")
  for (const item of [value.harness_context_binding_entry_hash, value.observation_projection_hash,
    value.decision_market_input_snapshot_hash, value.entry_hash]) {
    requireHash(item, "decision Market input materialization entry hash")
  }
  if (!Number.isSafeInteger(value.decision_sequence) || value.decision_sequence < 1
      || !["pre_entry", "initial_entry", "pending_entry", "position_open"].includes(value.decision_phase)) {
    throw new Error("decision Market input materialization sequence or phase is invalid")
  }
  assertReplayDecisionMarketInputSnapshot(value.decision_market_input_snapshot)
  const snapshot = value.decision_market_input_snapshot
  if (snapshot.decision_time !== value.decision_time || snapshot.snapshot_hash !== value.decision_market_input_snapshot_hash
      || (value.market_input_status === "materialized_empty_no_requirement") !== (snapshot.bars.length === 0)) {
    throw new Error("decision Market input materialization entry snapshot drift")
  }
  const { entry_hash: entryHash, ...body } = value
  if (entryHash !== canonicalHash(body)) throw new Error("decision Market input materialization entry hash mismatch")
}

export function assertReplayDecisionMarketInputMaterialization(
  value: ReplayDecisionMarketInputMaterialization,
): void {
  if (value.schema_version !== REPLAY_DECISION_MARKET_INPUT_MATERIALIZATION_SCHEMA_VERSION
      || value.materialization_policy_version !== REPLAY_DECISION_MARKET_INPUT_MATERIALIZATION_POLICY_VERSION
      || value.scope !== "pre_worker_non_economic_market_input_materialization"
      || value.purpose !== "materialize_formal_market_snapshots_from_admitted_closed_bar_observations"
      || value.authority_source !== "decision_observation_harness_context_binding"
      || value.parent_context_binding_validation !== "full_rebuild_against_request_bundle_and_derivation_admission"
      || value.dataset_manifest_validation !== "schema_and_request_market_identity_only"
      || value.supplemental_binding_validation !== "not_inspected_outside_market_responsibility"
      || value.raw_dataset_revalidation !== "not_performed"
      || value.worker_request_materialization !== "forbidden" || value.harness_invocation !== "forbidden"
      || value.decision_output_authority !== "none" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.runner_compatibility !== "not_bound"
      || value.request_schema_version !== "trade.rd-replay-execution-request.v38"
      || value.decision_market_input_snapshot_schema_version !== REPLAY_DECISION_MARKET_INPUT_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error("unsupported decision Market input materialization authority")
  }
  assertFields(value, MATERIALIZATION_FIELDS, "decision Market input materialization")
  for (const item of [value.materialization_id, value.run_id, value.experiment_id, value.trial_group_id,
    value.trial_id, value.candidate_id, value.reservation_ref, value.dataset_manifest_ref,
    value.derivation_admission_id, value.bundle_id, value.harness_context_binding_id]) {
    requireText(item, "decision Market input materialization identity")
  }
  for (const item of [value.materialization_hash, value.request_hash, value.candidate_hash,
    value.reservation_hash, value.dataset_hash, value.dataset_manifest_hash, value.derivation_admission_hash,
    value.bundle_hash, value.harness_context_binding_hash, value.decision_market_input_requirement_hash,
    value.entries_hash, value.entry_hashes_hash, value.snapshot_hashes_hash]) {
    requireHash(item, "decision Market input materialization hash")
  }
  requireUtc(value.first_decision_time, "decision Market input materialization first decision time")
  requireUtc(value.last_decision_time, "decision Market input materialization last decision time")
  let priorTime = Number.NEGATIVE_INFINITY
  for (const [index, entry] of value.entries.entries()) {
    assertReplayDecisionMarketInputMaterializationEntry(entry)
    const decisionTime = Date.parse(entry.decision_time)
    if (entry.decision_sequence !== index + 1 || decisionTime <= priorTime
        || entry.decision_market_input_snapshot.run_id !== value.run_id
        || entry.decision_market_input_snapshot.requirement_hash !== value.decision_market_input_requirement_hash) {
      throw new Error("decision Market input materialization member drift")
    }
    priorTime = decisionTime
  }
  if (!Number.isSafeInteger(value.entry_count) || value.entry_count < 1 || value.entry_count !== value.entries.length
      || value.first_decision_time !== value.entries[0]!.decision_time
      || value.last_decision_time !== value.entries.at(-1)!.decision_time
      || value.entries_hash !== canonicalHash(value.entries)
      || value.entry_hashes_hash !== canonicalHash(value.entries.map((entry) => entry.entry_hash))
      || value.snapshot_hashes_hash !== canonicalHash(value.entries.map((entry) => entry.decision_market_input_snapshot_hash))) {
    throw new Error("decision Market input materialization fold drift")
  }
  const { materialization_hash: materializationHash, ...body } = value
  const { materialization_id: materializationId, ...bodyWithoutId } = body
  if (materializationId !== `decision-market-input-${canonicalHash(bodyWithoutId).slice(0, 24)}`
      || materializationHash !== canonicalHash(body)) {
    throw new Error("decision Market input materialization identity or hash mismatch")
  }
}

const ENTRY_FIELDS = ["decision_market_input_snapshot", "decision_market_input_snapshot_hash", "decision_phase",
  "decision_sequence", "decision_time", "entry_hash", "execution_effect", "harness_context_binding_entry_hash",
  "harness_invocation", "market_input_status", "observation_projection_hash", "observation_projection_id",
  "schema_version", "worker_request_compatibility"].sort()
const MATERIALIZATION_FIELDS = ["authority_source", "bundle_hash", "bundle_id", "candidate_hash", "candidate_id",
  "dataset_hash", "dataset_manifest_hash", "dataset_manifest_ref", "dataset_manifest_validation",
  "decision_market_input_requirement_hash", "decision_market_input_snapshot_schema_version",
  "decision_output_authority", "derivation_admission_hash", "derivation_admission_id", "economic_authority",
  "entries", "entries_hash", "entry_count", "entry_hashes_hash", "experiment_id", "first_decision_time",
  "harness_context_binding_hash", "harness_context_binding_id", "harness_invocation", "last_decision_time",
  "materialization_hash", "materialization_id", "materialization_policy_version", "order_authority",
  "parent_context_binding_validation", "purpose", "raw_dataset_revalidation", "request_hash",
  "request_schema_version", "reservation_hash", "reservation_ref", "run_id", "runner_compatibility",
  "schema_version", "scope", "signal_authority", "snapshot_hashes_hash", "supplemental_binding_validation",
  "trial_group_id", "trial_id", "worker_request_materialization"].sort()

function assertFields(value: object, expected: string[], label: string): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(expected)) throw new Error(`${label} field whitelist drift`)
}
