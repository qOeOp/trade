import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V3_ENTRY_SCHEMA_VERSION,
  REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V3_POLICY_VERSION,
  REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V3_SCHEMA_VERSION,
  assertReplayDecisionWorkerInputAssemblyV3,
  createReplayDecisionWorkerInputAssemblyV3,
  createReplayDecisionWorkerInputAssemblyV3Entry,
  type ReplayDecisionWorkerInputAssemblyV3,
  type ReplayDecisionWorkerInputAssemblyV3Body,
  type ReplayDecisionWorkerInputAssemblyV3Entry,
} from "../../../contracts/src/lib/replay-decision-worker-input-assembly-v3"
import {
  assertReplayDecisionWorkerInputAssemblyV2,
  type ReplayDecisionWorkerInputAssemblyV2,
} from "../../../contracts/src/lib/replay-decision-worker-input-assembly-v2"
import {
  assertReplayPositionOpenStateInputMaterialization,
  type ReplayPositionOpenStateInputMaterialization,
} from "../../../contracts/src/lib/replay-position-open-state-input-materialization"

export interface ReplayDecisionWorkerInputAssemblyV3Input {
  source_assembly_v2: ReplayDecisionWorkerInputAssemblyV2
  state_input_materializations: ReplayPositionOpenStateInputMaterialization[]
}

export function buildReplayDecisionWorkerInputAssemblyV3(
  input: ReplayDecisionWorkerInputAssemblyV3Input,
): ReplayDecisionWorkerInputAssemblyV3 {
  assertInputAuthority(input)
  const bodyWithoutId = buildBodyWithoutId(input)
  const value = createReplayDecisionWorkerInputAssemblyV3({
    ...bodyWithoutId,
    assembly_id: `decision-worker-input-v3-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  assertReplayDecisionWorkerInputAssemblyV3Lineage(value, input)
  return value
}

export function assertReplayDecisionWorkerInputAssemblyV3Lineage(
  value: ReplayDecisionWorkerInputAssemblyV3,
  input: ReplayDecisionWorkerInputAssemblyV3Input,
): void {
  assertReplayDecisionWorkerInputAssemblyV3(value)
  assertInputAuthority(input)
  const bodyWithoutId = buildBodyWithoutId(input)
  const expected = createReplayDecisionWorkerInputAssemblyV3({
    ...bodyWithoutId,
    assembly_id: `decision-worker-input-v3-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  if (canonicalHash(value) !== canonicalHash(expected)) {
    throw new Error("decision Worker input assembly v3 parent lineage drift")
  }
}

function buildBodyWithoutId(
  input: ReplayDecisionWorkerInputAssemblyV3Input,
): Omit<ReplayDecisionWorkerInputAssemblyV3Body, "assembly_id"> {
  const entries = buildEntries(input)
  const stateIds = input.state_input_materializations.map((item) => item.materialization_id)
  const stateHashes = input.state_input_materializations.map((item) => item.materialization_hash)
  return {
    schema_version: REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V3_SCHEMA_VERSION,
    assembly_policy_version: REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V3_POLICY_VERSION,
    scope: "pre_worker_non_economic_runtime_state_complete_input_tuple_assembly",
    owner: "replay_engine_runtime",
    purpose: "compose_r4_101_static_inputs_and_r4_102_runtime_state_without_creating_worker_request",
    composition_policy: "embed_validated_r4_101_v2_and_exact_position_open_r4_102_parents",
    parent_validation: "embedded_parent_schema_hash_and_cross_object_binding_only",
    upstream_lineage_revalidation: "requires_external_r4_101_and_r4_102_upstream_parents",
    source_prefix_revalidation: "r4_102_parent_requires_external_complete_source_prefix",
    source_bundle_binding: "not_bound",
    build_attestation_binding: "not_bound",
    invocation_identity_materialization: "forbidden",
    worker_request_materialization: "forbidden",
    harness_invocation: "forbidden",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    runner_compatibility: "not_bound",
    source_assembly_v2_id: input.source_assembly_v2.assembly_id,
    source_assembly_v2_hash: input.source_assembly_v2.assembly_hash,
    source_assembly_v2: structuredClone(input.source_assembly_v2),
    state_parent_policy: "exactly_one_r4_102_parent_per_position_open_entry_in_schedule_order",
    entry_count: entries.length,
    entries,
    entries_hash: canonicalHash(entries),
    entry_hashes_hash: canonicalHash(entries.map((entry) => entry.entry_hash)),
    state_materialization_count: input.state_input_materializations.length,
    state_materialization_ids_hash: canonicalHash(stateIds),
    state_materialization_hashes_hash: canonicalHash(stateHashes),
    complete_entry_count: entries.length,
    incomplete_state_entry_count: 0,
    worker_request_count: 0,
  }
}

function buildEntries(input: ReplayDecisionWorkerInputAssemblyV3Input): ReplayDecisionWorkerInputAssemblyV3Entry[] {
  let stateIndex = 0
  return input.source_assembly_v2.entries.map((sourceEntry) => {
    const needsState = sourceEntry.decision_phase === "position_open"
    const state = needsState ? input.state_input_materializations[stateIndex++]! : null
    return createReplayDecisionWorkerInputAssemblyV3Entry({
      schema_version: REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V3_ENTRY_SCHEMA_VERSION,
      decision_sequence: sourceEntry.decision_sequence,
      decision_time: sourceEntry.decision_time,
      decision_phase: sourceEntry.decision_phase,
      source_assembly_v2_entry_hash: sourceEntry.entry_hash,
      input_tuple_projection: "r4_101_v2_entry_plus_optional_embedded_r4_102_state",
      state_input_source: needsState
        ? "r4_102_position_open_state_materialization" : "not_applicable_non_position_phase",
      state_input_materialization: state ? structuredClone(state) : null,
      state_input_materialization_hash: state?.materialization_hash ?? null,
      input_tuple_status: "complete_non_executable_build_unbound",
      worker_request: null,
      harness_invocation: "forbidden",
      execution_effect: "none",
    })
  })
}

function assertInputAuthority(input: ReplayDecisionWorkerInputAssemblyV3Input): void {
  assertReplayDecisionWorkerInputAssemblyV2(input.source_assembly_v2)
  const positionEntries = input.source_assembly_v2.entries.filter((entry) => entry.decision_phase === "position_open")
  if (positionEntries.length < 1
      || input.source_assembly_v2.incomplete_state_entry_count !== positionEntries.length
      || input.state_input_materializations.length !== positionEntries.length) {
    throw new Error("decision Worker input assembly v3 requires exactly one State parent per position-open entry")
  }
  for (const [index, state] of input.state_input_materializations.entries()) {
    assertReplayPositionOpenStateInputMaterialization(state)
    const sourceEntry = positionEntries[index]!
    if (state.decision_sequence !== sourceEntry.decision_sequence
        || state.decision_time !== sourceEntry.decision_time
        || state.request_hash !== input.source_assembly_v2.request_hash
        || state.run_id !== input.source_assembly_v2.run_id
        || state.experiment_id !== input.source_assembly_v2.experiment_id
        || state.trial_group_id !== input.source_assembly_v2.trial_group_id
        || state.trial_id !== input.source_assembly_v2.trial_id
        || state.candidate_id !== input.source_assembly_v2.candidate_id
        || state.candidate_hash !== input.source_assembly_v2.candidate_hash
        || state.harness_context_binding_id !== input.source_assembly_v2.harness_context_binding_id
        || state.harness_context_binding_hash !== input.source_assembly_v2.harness_context_binding_hash
        || state.harness_context_binding_entry_hash !== sourceEntry.harness_context_binding_entry_hash
        || state.harness_context_hash !== sourceEntry.harness_context_hash) {
      throw new Error("decision Worker input assembly v3 R4.102 parent binding drift")
    }
  }
}
