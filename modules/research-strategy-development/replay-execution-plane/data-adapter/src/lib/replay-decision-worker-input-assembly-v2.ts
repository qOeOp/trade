import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_ENTRY_SCHEMA_VERSION,
  REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_POLICY_VERSION,
  REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_SCHEMA_VERSION,
  assertReplayDecisionWorkerInputAssemblyV2,
  createReplayDecisionWorkerInputAssemblyV2,
  createReplayDecisionWorkerInputAssemblyV2Entry,
  type ReplayDecisionWorkerInputAssemblyV2,
  type ReplayDecisionWorkerInputAssemblyV2Body,
  type ReplayDecisionWorkerInputAssemblyV2Entry,
} from "../../../contracts/src/lib/replay-decision-worker-input-assembly-v2"
import {
  assertReplayDecisionMarketInputMaterialization,
  type ReplayDecisionMarketInputMaterialization,
} from "../../../contracts/src/lib/replay-decision-market-input-materialization"
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

export interface ReplayDecisionWorkerInputAssemblyV2Input {
  harness_context_binding: ReplaySourceEventDecisionObservationHarnessContextBinding
  observation_input_materialization: ReplaySourceEventDecisionObservationInputMaterialization | null
  initial_signal_supplemental_materialization: ReplayInitialSignalSupplementalInputMaterialization | null
  market_input_materialization: ReplayDecisionMarketInputMaterialization
}

export function buildReplayDecisionWorkerInputAssemblyV2(
  input: ReplayDecisionWorkerInputAssemblyV2Input,
): ReplayDecisionWorkerInputAssemblyV2 {
  assertInputAuthority(input)
  const bodyWithoutId = buildBodyWithoutId(input)
  const value = createReplayDecisionWorkerInputAssemblyV2({
    ...bodyWithoutId,
    assembly_id: `decision-worker-input-v2-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  assertReplayDecisionWorkerInputAssemblyV2Lineage(value, input)
  return value
}

export function assertReplayDecisionWorkerInputAssemblyV2Lineage(
  value: ReplayDecisionWorkerInputAssemblyV2,
  input: ReplayDecisionWorkerInputAssemblyV2Input,
): void {
  assertReplayDecisionWorkerInputAssemblyV2(value)
  assertInputAuthority(input)
  const bodyWithoutId = buildBodyWithoutId(input)
  const expected = createReplayDecisionWorkerInputAssemblyV2({
    ...bodyWithoutId,
    assembly_id: `decision-worker-input-v2-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  if (canonicalHash(value) !== canonicalHash(expected)) {
    throw new Error("decision Worker input assembly v2 parent lineage drift")
  }
}

function buildBodyWithoutId(
  input: ReplayDecisionWorkerInputAssemblyV2Input,
): Omit<ReplayDecisionWorkerInputAssemblyV2Body, "assembly_id"> {
  const context = input.harness_context_binding
  const entries = buildEntries(input)
  return {
    schema_version: REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_SCHEMA_VERSION,
    assembly_policy_version: REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_POLICY_VERSION,
    scope: "pre_worker_non_economic_complete_input_tuple_assembly",
    purpose: "bind_context_supplemental_and_market_snapshots_without_creating_worker_request",
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
    request_hash: context.request_hash,
    run_id: context.run_id,
    experiment_id: context.experiment_id,
    trial_group_id: context.trial_group_id,
    trial_id: context.trial_id,
    candidate_id: context.candidate_id,
    candidate_hash: context.candidate_hash,
    harness_context_binding_id: context.binding_id,
    harness_context_binding_hash: context.binding_hash,
    observation_input_materialization_id: input.observation_input_materialization?.materialization_id ?? null,
    observation_input_materialization_hash: input.observation_input_materialization?.materialization_hash ?? null,
    initial_signal_supplemental_materialization_id:
      input.initial_signal_supplemental_materialization?.materialization_id ?? null,
    initial_signal_supplemental_materialization_hash:
      input.initial_signal_supplemental_materialization?.materialization_hash ?? null,
    market_input_materialization_id: input.market_input_materialization.materialization_id,
    market_input_materialization_hash: input.market_input_materialization.materialization_hash,
    supplemental_source_policy: "exactly_one_request_bound_r4_97_or_r4_98_materialization",
    market_source_policy: "required_same_request_context_bound_r4_100_materialization",
    r4_97_embedded_market_policy: "require_exact_match_then_use_r4_100",
    entry_count: entries.length,
    entries,
    entries_hash: canonicalHash(entries),
    entry_hashes_hash: canonicalHash(entries.map((entry) => entry.entry_hash)),
    complete_entry_count: entries.filter((entry) => entry.input_tuple_status === "complete_non_executable_build_unbound").length,
    incomplete_state_entry_count:
      entries.filter((entry) => entry.input_tuple_status === "incomplete_runtime_state_snapshot").length,
    missing_market_entry_count: 0,
    worker_request_count: 0,
  }
}

function buildEntries(input: ReplayDecisionWorkerInputAssemblyV2Input): ReplayDecisionWorkerInputAssemblyV2Entry[] {
  const context = input.harness_context_binding
  const market = input.market_input_materialization
  return context.entries.map((contextEntry, index) => {
    const observationEntry = input.observation_input_materialization?.entries[index]
    const decisionInput = observationEntry?.decision_input_snapshot
      ?? input.initial_signal_supplemental_materialization!.decision_input_snapshot
    const decisionInputHash = observationEntry?.decision_input_snapshot_hash
      ?? input.initial_signal_supplemental_materialization!.decision_input_snapshot_hash
    const marketEntry = market.entries[index]!
    const stateMissing = contextEntry.harness_context.decision_phase === "position_open"
    return createReplayDecisionWorkerInputAssemblyV2Entry({
      schema_version: REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_ENTRY_SCHEMA_VERSION,
      decision_sequence: contextEntry.decision_sequence,
      decision_time: contextEntry.decision_time,
      decision_phase: contextEntry.harness_context.decision_phase,
      harness_context_binding_entry_hash: contextEntry.entry_hash,
      harness_context: structuredClone(contextEntry.harness_context),
      harness_context_hash: contextEntry.harness_context_hash,
      supplemental_input_source: observationEntry
        ? "r4_97_empty_input_materialization" : "r4_98_initial_signal_materialization",
      decision_input_snapshot: structuredClone(decisionInput),
      decision_input_snapshot_hash: decisionInputHash,
      market_input_source: "r4_100_market_input_materialization",
      decision_market_input_snapshot: structuredClone(marketEntry.decision_market_input_snapshot),
      decision_market_input_snapshot_hash: marketEntry.decision_market_input_snapshot_hash,
      r4_97_embedded_market_compatibility: observationEntry
        ? "exact_snapshot_match" : "not_applicable_nonempty_supplemental",
      state_input_status: stateMissing
        ? "runtime_state_required_not_materialized" : "not_applicable_non_position_phase",
      decision_state_snapshot: null,
      input_tuple_status: stateMissing
        ? "incomplete_runtime_state_snapshot" : "complete_non_executable_build_unbound",
      worker_request: null,
      harness_invocation: "forbidden",
      execution_effect: "none",
    })
  })
}

function assertInputAuthority(input: ReplayDecisionWorkerInputAssemblyV2Input): void {
  const context = input.harness_context_binding
  assertReplaySourceEventDecisionObservationHarnessContextBinding(context)
  assertReplayDecisionMarketInputMaterialization(input.market_input_materialization)
  const hasR497 = input.observation_input_materialization !== null
  const hasR498 = input.initial_signal_supplemental_materialization !== null
  if (hasR497 === hasR498) {
    throw new Error("decision Worker input assembly v2 requires exactly one supplemental materialization")
  }
  assertMarketParent(context, input.market_input_materialization)
  if (input.observation_input_materialization) {
    assertR497Parent(context, input.observation_input_materialization, input.market_input_materialization)
    return
  }
  assertR498Parent(context, input.initial_signal_supplemental_materialization!)
}

function assertMarketParent(
  context: ReplaySourceEventDecisionObservationHarnessContextBinding,
  market: ReplayDecisionMarketInputMaterialization,
): void {
  if (market.request_hash !== context.request_hash
      || market.harness_context_binding_id !== context.binding_id
      || market.harness_context_binding_hash !== context.binding_hash
      || market.entry_count !== context.entry_count) {
    throw new Error("decision Worker input assembly v2 R4.100 parent binding drift")
  }
  for (const [index, contextEntry] of context.entries.entries()) {
    const marketEntry = market.entries[index]
    if (!marketEntry || marketEntry.decision_sequence !== contextEntry.decision_sequence
        || marketEntry.decision_time !== contextEntry.decision_time
        || marketEntry.decision_phase !== contextEntry.harness_context.decision_phase
        || marketEntry.harness_context_binding_entry_hash !== contextEntry.entry_hash) {
      throw new Error("decision Worker input assembly v2 R4.100 entry binding drift")
    }
  }
}

function assertR497Parent(
  context: ReplaySourceEventDecisionObservationHarnessContextBinding,
  supplemental: ReplaySourceEventDecisionObservationInputMaterialization,
  market: ReplayDecisionMarketInputMaterialization,
): void {
  assertReplaySourceEventDecisionObservationInputMaterialization(supplemental)
  if (supplemental.request_hash !== context.request_hash
      || supplemental.harness_context_binding_id !== context.binding_id
      || supplemental.harness_context_binding_hash !== context.binding_hash
      || supplemental.entry_count !== context.entry_count) {
    throw new Error("decision Worker input assembly v2 R4.97 parent binding drift")
  }
  for (const [index, contextEntry] of context.entries.entries()) {
    const supplementalEntry = supplemental.entries[index]
    const marketEntry = market.entries[index]!
    if (!supplementalEntry || supplementalEntry.decision_sequence !== contextEntry.decision_sequence
        || supplementalEntry.decision_time !== contextEntry.decision_time
        || supplementalEntry.harness_context_binding_entry_hash !== contextEntry.entry_hash
        || supplementalEntry.decision_market_input_snapshot_hash !== marketEntry.decision_market_input_snapshot_hash
        || canonicalHash(supplementalEntry.decision_market_input_snapshot)
          !== canonicalHash(marketEntry.decision_market_input_snapshot)) {
      throw new Error("decision Worker input assembly v2 R4.97 compatibility drift")
    }
  }
}

function assertR498Parent(
  context: ReplaySourceEventDecisionObservationHarnessContextBinding,
  supplemental: ReplayInitialSignalSupplementalInputMaterialization,
): void {
  assertReplayInitialSignalSupplementalInputMaterialization(supplemental)
  const contextEntry = context.entries[0]
  if (context.entry_count !== 1 || !contextEntry
      || supplemental.request_hash !== context.request_hash || supplemental.run_id !== context.run_id
      || supplemental.experiment_id !== context.experiment_id
      || supplemental.trial_group_id !== context.trial_group_id || supplemental.trial_id !== context.trial_id
      || supplemental.candidate_id !== context.candidate_id || supplemental.candidate_hash !== context.candidate_hash
      || supplemental.decision_sequence !== contextEntry.decision_sequence
      || supplemental.decision_time !== contextEntry.decision_time
      || contextEntry.harness_context.decision_phase === "position_open") {
    throw new Error("decision Worker input assembly v2 R4.98 parent binding drift")
  }
}
