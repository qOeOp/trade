import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_ENTRY_SCHEMA_VERSION,
  REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_POLICY_VERSION,
  REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_SCHEMA_VERSION,
  assertReplayDecisionWorkerInputAssembly,
  createReplayDecisionWorkerInputAssembly,
  createReplayDecisionWorkerInputAssemblyEntry,
  type ReplayDecisionWorkerInputAssembly,
  type ReplayDecisionWorkerInputAssemblyBody,
  type ReplayDecisionWorkerInputAssemblyEntry,
} from "../../../contracts/src/lib/replay-decision-worker-input-assembly"
import {
  assertReplayInitialSignalSupplementalInputMaterialization,
  type ReplayInitialSignalSupplementalInputMaterialization,
} from "../../../contracts/src/lib/replay-initial-signal-supplemental-input-materialization"
import {
  assertReplaySourceEventDecisionObservationHarnessContextBinding,
  type ReplaySourceEventDecisionObservationHarnessContextBinding,
} from "../../../contracts/src/lib/replay-source-event-decision-observation-harness-context-binding"
import {
  assertReplaySourceEventDecisionObservationInputMaterialization,
  type ReplaySourceEventDecisionObservationInputMaterialization,
} from "../../../contracts/src/lib/replay-source-event-decision-observation-input-materialization"

export interface ReplayDecisionWorkerInputAssemblyInput {
  harness_context_binding: ReplaySourceEventDecisionObservationHarnessContextBinding
  observation_input_materialization: ReplaySourceEventDecisionObservationInputMaterialization | null
  initial_signal_supplemental_materialization: ReplayInitialSignalSupplementalInputMaterialization | null
}

export function buildReplayDecisionWorkerInputAssembly(
  input: ReplayDecisionWorkerInputAssemblyInput,
): ReplayDecisionWorkerInputAssembly {
  assertInputAuthority(input)
  const bodyWithoutId = buildBodyWithoutId(input)
  const value = createReplayDecisionWorkerInputAssembly({
    ...bodyWithoutId,
    assembly_id: `decision-worker-input-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  assertReplayDecisionWorkerInputAssemblyLineage(value, input)
  return value
}

export function assertReplayDecisionWorkerInputAssemblyLineage(
  value: ReplayDecisionWorkerInputAssembly,
  input: ReplayDecisionWorkerInputAssemblyInput,
): void {
  assertReplayDecisionWorkerInputAssembly(value)
  assertInputAuthority(input)
  const bodyWithoutId = buildBodyWithoutId(input)
  const expected = createReplayDecisionWorkerInputAssembly({
    ...bodyWithoutId,
    assembly_id: `decision-worker-input-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  if (canonicalHash(value) !== canonicalHash(expected)) {
    throw new Error("decision Worker input assembly parent lineage drift")
  }
}

function buildBodyWithoutId(
  input: ReplayDecisionWorkerInputAssemblyInput,
): Omit<ReplayDecisionWorkerInputAssemblyBody, "assembly_id"> {
  const contextBinding = input.harness_context_binding
  const entries = input.observation_input_materialization
    ? buildEmptySupplementalEntries(contextBinding, input.observation_input_materialization)
    : buildInitialSupplementalEntry(contextBinding, input.initial_signal_supplemental_materialization!)
  return {
    schema_version: REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_SCHEMA_VERSION,
    assembly_policy_version: REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_POLICY_VERSION,
    scope: "pre_worker_non_economic_input_tuple_assembly",
    purpose: "bind_context_and_available_formal_snapshots_without_creating_worker_request",
    parent_validation: "self_hash_and_cross_object_binding_only",
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
    request_hash: contextBinding.request_hash,
    run_id: contextBinding.run_id,
    experiment_id: contextBinding.experiment_id,
    trial_group_id: contextBinding.trial_group_id,
    trial_id: contextBinding.trial_id,
    candidate_id: contextBinding.candidate_id,
    candidate_hash: contextBinding.candidate_hash,
    harness_context_binding_id: contextBinding.binding_id,
    harness_context_binding_hash: contextBinding.binding_hash,
    observation_input_materialization_id: input.observation_input_materialization?.materialization_id ?? null,
    observation_input_materialization_hash: input.observation_input_materialization?.materialization_hash ?? null,
    initial_signal_supplemental_materialization_id:
      input.initial_signal_supplemental_materialization?.materialization_id ?? null,
    initial_signal_supplemental_materialization_hash:
      input.initial_signal_supplemental_materialization?.materialization_hash ?? null,
    supplemental_source_policy: "exactly_one_request_bound_materialization",
    entry_count: entries.length,
    entries,
    entries_hash: canonicalHash(entries),
    entry_hashes_hash: canonicalHash(entries.map((entry) => entry.entry_hash)),
    complete_entry_count: entries.filter((entry) => entry.input_tuple_status === "complete_non_executable_build_unbound").length,
    incomplete_market_entry_count: entries.filter((entry) => entry.input_tuple_status === "incomplete_market_snapshot").length,
    incomplete_state_entry_count: entries.filter((entry) => entry.input_tuple_status === "incomplete_runtime_state_snapshot").length,
    worker_request_count: 0,
  }
}

function buildEmptySupplementalEntries(
  contextBinding: ReplaySourceEventDecisionObservationHarnessContextBinding,
  materialization: ReplaySourceEventDecisionObservationInputMaterialization,
): ReplayDecisionWorkerInputAssemblyEntry[] {
  return contextBinding.entries.map((contextEntry, index) => {
    const inputEntry = materialization.entries[index]!
    const stateMissing = contextEntry.harness_context.decision_phase === "position_open"
    return createReplayDecisionWorkerInputAssemblyEntry({
      schema_version: REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_ENTRY_SCHEMA_VERSION,
      decision_sequence: contextEntry.decision_sequence,
      decision_time: contextEntry.decision_time,
      decision_phase: contextEntry.harness_context.decision_phase,
      harness_context_binding_entry_hash: contextEntry.entry_hash,
      harness_context: structuredClone(contextEntry.harness_context),
      harness_context_hash: contextEntry.harness_context_hash,
      supplemental_input_source: "r4_97_empty_input_materialization",
      decision_input_snapshot: structuredClone(inputEntry.decision_input_snapshot),
      decision_input_snapshot_hash: inputEntry.decision_input_snapshot_hash,
      market_input_source: "r4_97_observation_input_materialization",
      decision_market_input_snapshot: structuredClone(inputEntry.decision_market_input_snapshot),
      decision_market_input_snapshot_hash: inputEntry.decision_market_input_snapshot_hash,
      state_input_status: stateMissing ? "runtime_state_required_not_materialized" : "not_applicable_non_position_phase",
      decision_state_snapshot: null,
      input_tuple_status: stateMissing
        ? "incomplete_runtime_state_snapshot" : "complete_non_executable_build_unbound",
      worker_request: null,
      harness_invocation: "forbidden",
      execution_effect: "none",
    })
  })
}

function buildInitialSupplementalEntry(
  contextBinding: ReplaySourceEventDecisionObservationHarnessContextBinding,
  materialization: ReplayInitialSignalSupplementalInputMaterialization,
): ReplayDecisionWorkerInputAssemblyEntry[] {
  const contextEntry = contextBinding.entries[0]!
  return [createReplayDecisionWorkerInputAssemblyEntry({
    schema_version: REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_ENTRY_SCHEMA_VERSION,
    decision_sequence: contextEntry.decision_sequence,
    decision_time: contextEntry.decision_time,
    decision_phase: contextEntry.harness_context.decision_phase,
    harness_context_binding_entry_hash: contextEntry.entry_hash,
    harness_context: structuredClone(contextEntry.harness_context),
    harness_context_hash: contextEntry.harness_context_hash,
    supplemental_input_source: "r4_98_initial_signal_materialization",
    decision_input_snapshot: structuredClone(materialization.decision_input_snapshot),
    decision_input_snapshot_hash: materialization.decision_input_snapshot_hash,
    market_input_source: "not_materialized_for_nonempty_request",
    decision_market_input_snapshot: null,
    decision_market_input_snapshot_hash: null,
    state_input_status: "not_applicable_non_position_phase",
    decision_state_snapshot: null,
    input_tuple_status: "incomplete_market_snapshot",
    worker_request: null,
    harness_invocation: "forbidden",
    execution_effect: "none",
  })]
}

function assertInputAuthority(input: ReplayDecisionWorkerInputAssemblyInput): void {
  const context = input.harness_context_binding
  assertReplaySourceEventDecisionObservationHarnessContextBinding(context)
  const hasObservation = input.observation_input_materialization !== null
  const hasSupplemental = input.initial_signal_supplemental_materialization !== null
  if (hasObservation === hasSupplemental) {
    throw new Error("decision Worker input assembly requires exactly one materialization source")
  }
  if (input.observation_input_materialization) {
    const materialization = input.observation_input_materialization
    assertReplaySourceEventDecisionObservationInputMaterialization(materialization)
    if (materialization.request_hash !== context.request_hash
        || materialization.harness_context_binding_id !== context.binding_id
        || materialization.harness_context_binding_hash !== context.binding_hash
        || materialization.entry_count !== context.entry_count) {
      throw new Error("decision Worker input assembly R4.97 parent binding drift")
    }
    for (const [index, contextEntry] of context.entries.entries()) {
      const inputEntry = materialization.entries[index]
      if (!inputEntry || inputEntry.decision_sequence !== contextEntry.decision_sequence
          || inputEntry.decision_time !== contextEntry.decision_time
          || inputEntry.harness_context_binding_entry_hash !== contextEntry.entry_hash) {
        throw new Error("decision Worker input assembly R4.97 entry binding drift")
      }
    }
    return
  }
  const materialization = input.initial_signal_supplemental_materialization!
  assertReplayInitialSignalSupplementalInputMaterialization(materialization)
  const contextEntry = context.entries[0]
  if (context.entry_count !== 1 || !contextEntry
      || materialization.request_hash !== context.request_hash
      || materialization.run_id !== context.run_id
      || materialization.experiment_id !== context.experiment_id
      || materialization.trial_group_id !== context.trial_group_id
      || materialization.trial_id !== context.trial_id
      || materialization.candidate_id !== context.candidate_id
      || materialization.candidate_hash !== context.candidate_hash
      || materialization.decision_sequence !== contextEntry.decision_sequence
      || materialization.decision_time !== contextEntry.decision_time
      || contextEntry.harness_context.decision_phase === "position_open") {
    throw new Error("decision Worker input assembly R4.98 parent binding drift")
  }
}
