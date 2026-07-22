import {
  canonicalHash,
  createReplayDecisionHarnessContext,
  createReplayDecisionInputSnapshot,
  createReplayDecisionMarketInputSnapshot,
  type ReplayDecisionScheduleEntry,
  type ReplayExecutionRequest,
} from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_ENTRY_SCHEMA_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_POLICY_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_SCHEMA_VERSION,
  createReplaySourceEventDecisionObservationHarnessContextBinding,
  createReplaySourceEventDecisionObservationHarnessContextBindingEntry,
  type ReplaySourceEventDecisionObservationHarnessContextBindingBody,
} from "../../../contracts/src/lib/replay-source-event-decision-observation-harness-context-binding"
import {
  REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_ENTRY_SCHEMA_VERSION,
  REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_POLICY_VERSION,
  REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_SCHEMA_VERSION,
  createReplayDecisionWorkerInputAssemblyV2,
  createReplayDecisionWorkerInputAssemblyV2Entry,
  type ReplayDecisionWorkerInputAssemblyV2Body,
} from "../../../contracts/src/lib/replay-decision-worker-input-assembly-v2"
import { HASH } from "./replay-worker-v10-market-fixture"

export function contextBinding(requestValue: ReplayExecutionRequest) {
  const entries = requestValue.decision_schedule.entries.map((scheduleEntry: ReplayDecisionScheduleEntry) => {
    const context = createReplayDecisionHarnessContext(requestValue, scheduleEntry)
    return createReplaySourceEventDecisionObservationHarnessContextBindingEntry({
      schema_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_ENTRY_SCHEMA_VERSION,
      decision_sequence: scheduleEntry.decision_sequence, decision_time: scheduleEntry.decision_time,
      selected_expected_effect: scheduleEntry.expected_effect,
      selected_schedule_entry_hash: canonicalHash(scheduleEntry),
      schedule_binding_id: `fixture-schedule-binding-${scheduleEntry.decision_sequence}`,
      schedule_binding_hash: HASH,
      observation_projection_id: `fixture-observation-projection-${scheduleEntry.decision_sequence}`,
      observation_projection_hash: HASH, observation_as_of_time: scheduleEntry.decision_time,
      observation_count: 1, observations_hash: HASH, observation_values_hash: HASH,
      visibility_cut_hash: HASH, pit_payload_view_hash: HASH, harness_hash: requestValue.harness_hash,
      harness_context: context, harness_context_hash: canonicalHash(context),
    })
  })
  const bodyWithoutId: Omit<ReplaySourceEventDecisionObservationHarnessContextBindingBody, "binding_id"> = {
    schema_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_SCHEMA_VERSION,
    binding_policy_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_POLICY_VERSION,
    scope: "pre_integration_non_economic_observation_harness_context_binding",
    binding_purpose: "bind_admitted_observation_boundaries_to_frozen_harness_context_identity",
    authority_source: "control_plane_derivation_admission", context_derivation: "canonical_request_and_schedule_entry",
    observation_binding: "admitted_bundle_member_identity_only", decision_input_materialization: "not_certified",
    supplemental_input_compatibility: "not_bound", market_input_compatibility: "not_bound",
    state_input_compatibility: "not_bound", worker_request_compatibility: "not_bound",
    harness_invocation: "forbidden", decision_output_authority: "none", signal_authority: "none",
    order_authority: "none", economic_authority: "none", runner_compatibility: "not_bound",
    request_schema_version: requestValue.schema_version, request_hash: canonicalHash(requestValue),
    run_id: requestValue.run_id, experiment_id: requestValue.experiment_id,
    trial_group_id: requestValue.trial_group_id, trial_id: requestValue.trial_id,
    candidate_id: requestValue.candidate_id, candidate_hash: requestValue.candidate_hash,
    reservation_ref: requestValue.trial_reservation_ref, reservation_hash: requestValue.trial_reservation_hash,
    dataset_manifest_ref: requestValue.dataset_manifest_ref, dataset_hash: requestValue.dataset_hash,
    derivation_admission_id: "fixture-derivation-admission-1",
    derivation_admission_ref: "admission://fixture/derivation-1", derivation_admission_hash: HASH,
    bundle_id: "fixture-observation-bundle-1", bundle_hash: HASH,
    decision_schedule_hash: requestValue.decision_schedule_hash, harness_hash: requestValue.harness_hash,
    harness_context_schema_version: entries[0]!.harness_context.schema_version,
    entry_count: entries.length, entries, entries_hash: canonicalHash(entries),
    entry_hashes_hash: canonicalHash(entries.map((entry) => entry.entry_hash)),
    harness_context_hashes_hash: canonicalHash(entries.map((entry) => entry.harness_context_hash)),
    observation_projection_hashes_hash: canonicalHash(entries.map((entry) => entry.observation_projection_hash)),
    first_decision_time: entries[0]!.decision_time, last_decision_time: entries.at(-1)!.decision_time,
  }
  return createReplaySourceEventDecisionObservationHarnessContextBinding({
    ...bodyWithoutId,
    binding_id: `source-event-observation-harness-context-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
}

export function workerInputAssemblyV2(requestValue: ReplayExecutionRequest, binding: ReturnType<typeof contextBinding>) {
  const entries = binding.entries.map((contextEntry) => {
    const decisionTime = contextEntry.decision_time
    const close = Date.parse(decisionTime)
    const decisionInput = createReplayDecisionInputSnapshot(requestValue, [], decisionTime)
    const marketInput = createReplayDecisionMarketInputSnapshot({
      request: requestValue,
      decision_time: decisionTime,
      interval_ms: 14_400_000,
      bars: [{
        open_time: new Date(close - 14_400_000).toISOString(), close_time: decisionTime,
        open: 100, high: 103, low: 99, close: 102, volume: 10, closed: true,
      }],
    })
    const needsState = contextEntry.harness_context.decision_phase === "position_open"
    return createReplayDecisionWorkerInputAssemblyV2Entry({
      schema_version: REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_ENTRY_SCHEMA_VERSION,
      decision_sequence: contextEntry.decision_sequence,
      decision_time: decisionTime,
      decision_phase: contextEntry.harness_context.decision_phase,
      harness_context_binding_entry_hash: contextEntry.entry_hash,
      harness_context: structuredClone(contextEntry.harness_context),
      harness_context_hash: contextEntry.harness_context_hash,
      supplemental_input_source: "r4_97_empty_input_materialization",
      decision_input_snapshot: decisionInput,
      decision_input_snapshot_hash: decisionInput.snapshot_hash,
      market_input_source: "r4_100_market_input_materialization",
      decision_market_input_snapshot: marketInput,
      decision_market_input_snapshot_hash: marketInput.snapshot_hash,
      r4_97_embedded_market_compatibility: "exact_snapshot_match",
      state_input_status: needsState
        ? "runtime_state_required_not_materialized" : "not_applicable_non_position_phase",
      decision_state_snapshot: null,
      input_tuple_status: needsState
        ? "incomplete_runtime_state_snapshot" : "complete_non_executable_build_unbound",
      worker_request: null,
      harness_invocation: "forbidden",
      execution_effect: "none",
    })
  })
  const bodyWithoutId: Omit<ReplayDecisionWorkerInputAssemblyV2Body, "assembly_id"> = {
    schema_version: REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_SCHEMA_VERSION,
    assembly_policy_version: REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_POLICY_VERSION,
    scope: "pre_worker_non_economic_complete_input_tuple_assembly",
    purpose: "bind_context_supplemental_and_market_snapshots_without_creating_worker_request",
    parent_validation: "self_hash_and_cross_object_binding_only",
    source_bundle_binding: "not_bound", build_attestation_binding: "not_bound",
    invocation_identity_materialization: "forbidden", worker_request_materialization: "forbidden",
    harness_invocation: "forbidden", decision_output_authority: "none", signal_authority: "none",
    order_authority: "none", economic_authority: "none", runner_compatibility: "not_bound",
    request_hash: canonicalHash(requestValue), run_id: requestValue.run_id,
    experiment_id: requestValue.experiment_id, trial_group_id: requestValue.trial_group_id,
    trial_id: requestValue.trial_id, candidate_id: requestValue.candidate_id,
    candidate_hash: requestValue.candidate_hash, harness_context_binding_id: binding.binding_id,
    harness_context_binding_hash: binding.binding_hash,
    observation_input_materialization_id: "fixture-r4-97-materialization",
    observation_input_materialization_hash: HASH,
    initial_signal_supplemental_materialization_id: null,
    initial_signal_supplemental_materialization_hash: null,
    market_input_materialization_id: "fixture-r4-100-materialization",
    market_input_materialization_hash: HASH,
    supplemental_source_policy: "exactly_one_request_bound_r4_97_or_r4_98_materialization",
    market_source_policy: "required_same_request_context_bound_r4_100_materialization",
    r4_97_embedded_market_policy: "require_exact_match_then_use_r4_100",
    entry_count: entries.length, entries, entries_hash: canonicalHash(entries),
    entry_hashes_hash: canonicalHash(entries.map((entry) => entry.entry_hash)),
    complete_entry_count: 1, incomplete_state_entry_count: 1, missing_market_entry_count: 0,
    worker_request_count: 0,
  }
  return createReplayDecisionWorkerInputAssemblyV2({
    ...bodyWithoutId,
    assembly_id: `decision-worker-input-v2-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
}

