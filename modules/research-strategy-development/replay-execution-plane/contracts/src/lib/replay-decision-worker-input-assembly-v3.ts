import { canonicalHash } from "./replay-contracts"
import {
  assertReplayDecisionWorkerInputAssemblyV2,
  type ReplayDecisionWorkerInputAssemblyV2,
} from "./replay-decision-worker-input-assembly-v2"
import {
  assertReplayPositionOpenStateInputMaterialization,
  type ReplayPositionOpenStateInputMaterialization,
} from "./replay-position-open-state-input-materialization"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V3_SCHEMA_VERSION = "trade.rd-replay-decision-worker-input-assembly.v3" as const
export const REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V3_ENTRY_SCHEMA_VERSION = "trade.rd-replay-decision-worker-input-assembly-entry.v3" as const
export const REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V3_POLICY_VERSION = "rd-replay-decision-worker-input-assembly-v3" as const

export interface ReplayDecisionWorkerInputAssemblyV3Entry {
  schema_version: typeof REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V3_ENTRY_SCHEMA_VERSION
  decision_sequence: number
  decision_time: string
  decision_phase: "pre_entry" | "initial_entry" | "pending_entry" | "position_open"
  source_assembly_v2_entry_hash: string
  input_tuple_projection: "r4_101_v2_entry_plus_optional_embedded_r4_102_state"
  state_input_source: "not_applicable_non_position_phase" | "r4_102_position_open_state_materialization"
  state_input_materialization: ReplayPositionOpenStateInputMaterialization | null
  state_input_materialization_hash: string | null
  input_tuple_status: "complete_non_executable_build_unbound"
  worker_request: null
  harness_invocation: "forbidden"
  execution_effect: "none"
  entry_hash: string
}

export type ReplayDecisionWorkerInputAssemblyV3EntryBody = Omit<ReplayDecisionWorkerInputAssemblyV3Entry, "entry_hash">

export interface ReplayDecisionWorkerInputAssemblyV3 {
  schema_version: typeof REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V3_SCHEMA_VERSION
  assembly_id: string
  assembly_hash: string
  assembly_policy_version: typeof REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V3_POLICY_VERSION
  scope: "pre_worker_non_economic_runtime_state_complete_input_tuple_assembly"
  owner: "replay_engine_runtime"
  purpose: "compose_r4_101_static_inputs_and_r4_102_runtime_state_without_creating_worker_request"
  composition_policy: "embed_validated_r4_101_v2_and_exact_position_open_r4_102_parents"
  parent_validation: "embedded_parent_schema_hash_and_cross_object_binding_only"
  upstream_lineage_revalidation: "requires_external_r4_101_and_r4_102_upstream_parents"
  source_prefix_revalidation: "r4_102_parent_requires_external_complete_source_prefix"
  source_bundle_binding: "not_bound"
  build_attestation_binding: "not_bound"
  invocation_identity_materialization: "forbidden"
  worker_request_materialization: "forbidden"
  harness_invocation: "forbidden"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  runner_compatibility: "not_bound"
  source_assembly_v2_id: string
  source_assembly_v2_hash: string
  source_assembly_v2: ReplayDecisionWorkerInputAssemblyV2
  state_parent_policy: "exactly_one_r4_102_parent_per_position_open_entry_in_schedule_order"
  entry_count: number
  entries: ReplayDecisionWorkerInputAssemblyV3Entry[]
  entries_hash: string
  entry_hashes_hash: string
  state_materialization_count: number
  state_materialization_ids_hash: string
  state_materialization_hashes_hash: string
  complete_entry_count: number
  incomplete_state_entry_count: 0
  worker_request_count: 0
}

export type ReplayDecisionWorkerInputAssemblyV3Body = Omit<ReplayDecisionWorkerInputAssemblyV3, "assembly_hash">

export function createReplayDecisionWorkerInputAssemblyV3Entry(
  body: ReplayDecisionWorkerInputAssemblyV3EntryBody,
): ReplayDecisionWorkerInputAssemblyV3Entry {
  const value = { ...structuredClone(body), entry_hash: canonicalHash(body) }
  assertReplayDecisionWorkerInputAssemblyV3Entry(value)
  return value
}

export function createReplayDecisionWorkerInputAssemblyV3(
  body: ReplayDecisionWorkerInputAssemblyV3Body,
): ReplayDecisionWorkerInputAssemblyV3 {
  const value = { ...structuredClone(body), assembly_hash: canonicalHash(body) }
  assertReplayDecisionWorkerInputAssemblyV3(value)
  return value
}

export function assertReplayDecisionWorkerInputAssemblyV3Entry(
  value: ReplayDecisionWorkerInputAssemblyV3Entry,
): void {
  assertFields(value, ENTRY_FIELDS, "decision Worker input assembly v3 entry")
  if (value.schema_version !== REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V3_ENTRY_SCHEMA_VERSION
      || value.input_tuple_projection !== "r4_101_v2_entry_plus_optional_embedded_r4_102_state"
      || value.input_tuple_status !== "complete_non_executable_build_unbound"
      || value.worker_request !== null || value.harness_invocation !== "forbidden"
      || value.execution_effect !== "none") {
    throw new Error("unsupported decision Worker input assembly v3 entry authority")
  }
  requireUtc(value.decision_time, "decision Worker input assembly v3 decision time")
  requireHash(value.source_assembly_v2_entry_hash, "decision Worker input assembly v3 source entry hash")
  requireHash(value.entry_hash, "decision Worker input assembly v3 entry hash")
  if (!Number.isSafeInteger(value.decision_sequence) || value.decision_sequence < 1
      || !["pre_entry", "initial_entry", "pending_entry", "position_open"].includes(value.decision_phase)) {
    throw new Error("decision Worker input assembly v3 sequence or phase is invalid")
  }
  const needsState = value.decision_phase === "position_open"
  if (needsState) {
    if (value.state_input_source !== "r4_102_position_open_state_materialization"
        || value.state_input_materialization === null || value.state_input_materialization_hash === null) {
      throw new Error("decision Worker input assembly v3 position-open State parent is missing")
    }
    assertReplayPositionOpenStateInputMaterialization(value.state_input_materialization)
    requireHash(value.state_input_materialization_hash, "decision Worker input assembly v3 State parent hash")
    if (value.state_input_materialization.materialization_hash !== value.state_input_materialization_hash
        || value.state_input_materialization.decision_sequence !== value.decision_sequence
        || value.state_input_materialization.decision_time !== value.decision_time) {
      throw new Error("decision Worker input assembly v3 State parent semantic drift")
    }
  } else if (value.state_input_source !== "not_applicable_non_position_phase"
      || value.state_input_materialization !== null || value.state_input_materialization_hash !== null) {
    throw new Error("decision Worker input assembly v3 non-position entry cannot carry State")
  }
  const { entry_hash: entryHash, ...body } = value
  if (entryHash !== canonicalHash(body)) throw new Error("decision Worker input assembly v3 entry hash mismatch")
}

export function assertReplayDecisionWorkerInputAssemblyV3(value: ReplayDecisionWorkerInputAssemblyV3): void {
  assertFields(value, ASSEMBLY_FIELDS, "decision Worker input assembly v3")
  if (value.schema_version !== REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V3_SCHEMA_VERSION
      || value.assembly_policy_version !== REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V3_POLICY_VERSION
      || value.scope !== "pre_worker_non_economic_runtime_state_complete_input_tuple_assembly"
      || value.owner !== "replay_engine_runtime"
      || value.purpose !== "compose_r4_101_static_inputs_and_r4_102_runtime_state_without_creating_worker_request"
      || value.composition_policy !== "embed_validated_r4_101_v2_and_exact_position_open_r4_102_parents"
      || value.parent_validation !== "embedded_parent_schema_hash_and_cross_object_binding_only"
      || value.upstream_lineage_revalidation !== "requires_external_r4_101_and_r4_102_upstream_parents"
      || value.source_prefix_revalidation !== "r4_102_parent_requires_external_complete_source_prefix"
      || value.state_parent_policy !== "exactly_one_r4_102_parent_per_position_open_entry_in_schedule_order"
      || value.source_bundle_binding !== "not_bound" || value.build_attestation_binding !== "not_bound"
      || value.invocation_identity_materialization !== "forbidden"
      || value.worker_request_materialization !== "forbidden" || value.harness_invocation !== "forbidden"
      || value.decision_output_authority !== "none" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.runner_compatibility !== "not_bound" || value.incomplete_state_entry_count !== 0
      || value.worker_request_count !== 0) {
    throw new Error("unsupported decision Worker input assembly v3 authority")
  }
  requireText(value.assembly_id, "decision Worker input assembly v3 identity")
  requireText(value.source_assembly_v2_id, "decision Worker input assembly v3 source identity")
  for (const item of [value.assembly_hash, value.source_assembly_v2_hash, value.entries_hash,
    value.entry_hashes_hash, value.state_materialization_ids_hash, value.state_materialization_hashes_hash]) {
    requireHash(item, "decision Worker input assembly v3 hash")
  }
  assertReplayDecisionWorkerInputAssemblyV2(value.source_assembly_v2)
  if (value.source_assembly_v2_id !== value.source_assembly_v2.assembly_id
      || value.source_assembly_v2_hash !== value.source_assembly_v2.assembly_hash
      || value.source_assembly_v2.incomplete_state_entry_count < 1) {
    throw new Error("decision Worker input assembly v3 requires an incomplete position-open v2 parent")
  }
  const stateParents: ReplayPositionOpenStateInputMaterialization[] = []
  for (const [index, entry] of value.entries.entries()) {
    assertReplayDecisionWorkerInputAssemblyV3Entry(entry)
    const sourceEntry = value.source_assembly_v2.entries[index]
    if (!sourceEntry || entry.decision_sequence !== sourceEntry.decision_sequence
        || entry.decision_time !== sourceEntry.decision_time || entry.decision_phase !== sourceEntry.decision_phase
        || entry.source_assembly_v2_entry_hash !== sourceEntry.entry_hash) {
      throw new Error("decision Worker input assembly v3 source entry binding drift")
    }
    const state = entry.state_input_materialization
    if (state) {
      if (sourceEntry.input_tuple_status !== "incomplete_runtime_state_snapshot"
          || state.request_hash !== value.source_assembly_v2.request_hash
          || state.run_id !== value.source_assembly_v2.run_id
          || state.experiment_id !== value.source_assembly_v2.experiment_id
          || state.trial_group_id !== value.source_assembly_v2.trial_group_id
          || state.trial_id !== value.source_assembly_v2.trial_id
          || state.candidate_id !== value.source_assembly_v2.candidate_id
          || state.candidate_hash !== value.source_assembly_v2.candidate_hash
          || state.harness_context_binding_id !== value.source_assembly_v2.harness_context_binding_id
          || state.harness_context_binding_hash !== value.source_assembly_v2.harness_context_binding_hash
          || state.harness_context_binding_entry_hash !== sourceEntry.harness_context_binding_entry_hash
          || state.harness_context_hash !== sourceEntry.harness_context_hash) {
        throw new Error("decision Worker input assembly v3 State parent binding drift")
      }
      stateParents.push(state)
    } else if (sourceEntry.input_tuple_status !== "complete_non_executable_build_unbound") {
      throw new Error("decision Worker input assembly v3 cannot leave an incomplete v2 entry unresolved")
    }
  }
  const stateIds = stateParents.map((item) => item.materialization_id)
  const stateHashes = stateParents.map((item) => item.materialization_hash)
  if (!Number.isSafeInteger(value.entry_count) || value.entry_count < 1
      || value.entry_count !== value.entries.length || value.entry_count !== value.source_assembly_v2.entry_count
      || value.complete_entry_count !== value.entry_count
      || value.state_materialization_count !== stateParents.length
      || value.state_materialization_count !== value.source_assembly_v2.incomplete_state_entry_count
      || new Set(stateIds).size !== stateIds.length || new Set(stateHashes).size !== stateHashes.length
      || value.entries_hash !== canonicalHash(value.entries)
      || value.entry_hashes_hash !== canonicalHash(value.entries.map((entry) => entry.entry_hash))
      || value.state_materialization_ids_hash !== canonicalHash(stateIds)
      || value.state_materialization_hashes_hash !== canonicalHash(stateHashes)) {
    throw new Error("decision Worker input assembly v3 fold drift")
  }
  const { assembly_hash: assemblyHash, ...body } = value
  const { assembly_id: assemblyId, ...bodyWithoutId } = body
  if (assemblyId !== `decision-worker-input-v3-${canonicalHash(bodyWithoutId).slice(0, 24)}`
      || assemblyHash !== canonicalHash(body)) {
    throw new Error("decision Worker input assembly v3 identity or hash mismatch")
  }
}

const ENTRY_FIELDS = ["decision_phase", "decision_sequence", "decision_time", "entry_hash", "execution_effect",
  "harness_invocation", "input_tuple_projection", "input_tuple_status", "schema_version",
  "source_assembly_v2_entry_hash", "state_input_materialization", "state_input_materialization_hash",
  "state_input_source", "worker_request"].sort()
const ASSEMBLY_FIELDS = ["assembly_hash", "assembly_id", "assembly_policy_version", "build_attestation_binding",
  "complete_entry_count", "composition_policy", "decision_output_authority", "economic_authority", "entries",
  "entries_hash", "entry_count", "entry_hashes_hash", "harness_invocation", "incomplete_state_entry_count",
  "invocation_identity_materialization", "order_authority", "owner", "purpose", "runner_compatibility",
  "parent_validation", "schema_version", "scope", "signal_authority", "source_assembly_v2", "source_assembly_v2_hash",
  "source_assembly_v2_id", "source_bundle_binding", "source_prefix_revalidation", "state_materialization_count",
  "state_materialization_hashes_hash", "state_materialization_ids_hash", "state_parent_policy",
  "upstream_lineage_revalidation", "worker_request_count", "worker_request_materialization"].sort()

function assertFields(value: object, expected: string[], label: string): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(expected)) throw new Error(`${label} field whitelist drift`)
}
