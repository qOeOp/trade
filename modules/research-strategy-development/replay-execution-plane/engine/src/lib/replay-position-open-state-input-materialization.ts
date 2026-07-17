import {
  assertReplayDecisionStateSnapshot,
  assertReplayDecisionStateSnapshotSourcePrefix,
  assertReplayExecutionRequest,
  canonicalHash,
  replayDecisionPhaseFor,
  replayDecisionScheduleEntryAt,
  type ReplayDecisionStateSnapshot,
  type ReplayExecutionRequest,
  type ReplaySourceEvent,
} from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_POSITION_OPEN_STATE_INPUT_MATERIALIZATION_POLICY_VERSION,
  REPLAY_POSITION_OPEN_STATE_INPUT_MATERIALIZATION_SCHEMA_VERSION,
  assertReplayPositionOpenStateInputMaterialization,
  createReplayPositionOpenStateInputMaterialization,
  type ReplayPositionOpenStateInputMaterialization,
  type ReplayPositionOpenStateInputMaterializationBody,
} from "../../../contracts/src/lib/replay-position-open-state-input-materialization"
import {
  assertReplaySourceEventDecisionObservationHarnessContextBinding,
  type ReplaySourceEventDecisionObservationHarnessContextBinding,
} from "../../../contracts/src/lib/replay-source-event-decision-observation-harness-context-binding"

export interface ReplayPositionOpenStateInputMaterializationInput {
  request: ReplayExecutionRequest
  harness_context_binding: ReplaySourceEventDecisionObservationHarnessContextBinding
  decision_state_snapshot: ReplayDecisionStateSnapshot
  source_events: ReplaySourceEvent[]
}

export function buildReplayPositionOpenStateInputMaterialization(
  input: ReplayPositionOpenStateInputMaterializationInput,
): ReplayPositionOpenStateInputMaterialization {
  const contextEntry = assertInputAuthority(input)
  const bodyWithoutId = buildBodyWithoutId(input, contextEntry)
  const value = createReplayPositionOpenStateInputMaterialization({
    ...bodyWithoutId,
    materialization_id: `position-open-state-input-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  assertReplayPositionOpenStateInputMaterializationLineage(value, input)
  return value
}

export function assertReplayPositionOpenStateInputMaterializationLineage(
  value: ReplayPositionOpenStateInputMaterialization,
  input: ReplayPositionOpenStateInputMaterializationInput,
): void {
  assertReplayPositionOpenStateInputMaterialization(value)
  const contextEntry = assertInputAuthority(input)
  const bodyWithoutId = buildBodyWithoutId(input, contextEntry)
  const expected = createReplayPositionOpenStateInputMaterialization({
    ...bodyWithoutId,
    materialization_id: `position-open-state-input-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  if (canonicalHash(value) !== canonicalHash(expected)) {
    throw new Error("position-open State input materialization parent lineage drift")
  }
}

function buildBodyWithoutId(
  input: ReplayPositionOpenStateInputMaterializationInput,
  contextEntry: ReplaySourceEventDecisionObservationHarnessContextBinding["entries"][number],
): Omit<ReplayPositionOpenStateInputMaterializationBody, "materialization_id"> {
  const request = input.request
  const snapshot = input.decision_state_snapshot
  const scheduleEntry = replayDecisionScheduleEntryAt(request, snapshot.decision_time)
  return {
    schema_version: REPLAY_POSITION_OPEN_STATE_INPUT_MATERIALIZATION_SCHEMA_VERSION,
    materialization_policy_version: REPLAY_POSITION_OPEN_STATE_INPUT_MATERIALIZATION_POLICY_VERSION,
    scope: "pre_worker_non_economic_position_open_state_input_materialization",
    owner: "replay_engine_runtime",
    decision_scope: "one_position_open_closed_bar_boundary",
    state_source: "existing_formal_decision_state_snapshot_v3",
    runtime_boundary_validation: "request_schedule_context_and_source_prefix",
    economic_recomputation: "not_performed",
    source_prefix_storage: "hash_count_and_terminal_event_identity_only",
    independent_revalidation: "requires_external_complete_source_prefix",
    worker_request_materialization: "forbidden",
    harness_invocation: "forbidden",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    runner_compatibility: "not_bound",
    request_schema_version: request.schema_version,
    request_hash: canonicalHash(request),
    run_id: request.run_id,
    experiment_id: request.experiment_id,
    trial_group_id: request.trial_group_id,
    trial_id: request.trial_id,
    candidate_id: request.candidate_id,
    candidate_hash: request.candidate_hash,
    reservation_ref: request.trial_reservation_ref,
    reservation_hash: request.trial_reservation_hash,
    dataset_manifest_ref: request.dataset_manifest_ref,
    dataset_hash: request.dataset_hash,
    decision_schedule_hash: request.decision_schedule_hash,
    harness_hash: request.harness_hash,
    harness_context_binding_id: input.harness_context_binding.binding_id,
    harness_context_binding_hash: input.harness_context_binding.binding_hash,
    harness_context_binding_entry_hash: contextEntry.entry_hash,
    harness_context_hash: contextEntry.harness_context_hash,
    decision_sequence: snapshot.decision_sequence,
    decision_time: snapshot.decision_time,
    decision_phase: "position_open",
    selected_schedule_entry_hash: canonicalHash(scheduleEntry),
    source_event_count: input.source_events.length,
    source_prefix_hash: snapshot.source_prefix_hash,
    terminal_source_event_key: structuredClone(snapshot.observation_event_key),
    state_snapshot_schema_version: snapshot.schema_version,
    decision_state_snapshot: structuredClone(snapshot),
    decision_state_snapshot_hash: snapshot.snapshot_hash,
  }
}

function assertInputAuthority(
  input: ReplayPositionOpenStateInputMaterializationInput,
): ReplaySourceEventDecisionObservationHarnessContextBinding["entries"][number] {
  assertReplayExecutionRequest(input.request)
  assertReplaySourceEventDecisionObservationHarnessContextBinding(input.harness_context_binding)
  const snapshot = input.decision_state_snapshot
  const scheduleEntry = replayDecisionScheduleEntryAt(input.request, snapshot.decision_time)
  assertReplayDecisionStateSnapshot(snapshot, input.request, scheduleEntry)
  assertReplayDecisionStateSnapshotSourcePrefix(snapshot, input.source_events)
  const terminalSource = input.source_events.at(-1)
  if (!terminalSource
      || canonicalHash(terminalSource.event_key) !== canonicalHash(snapshot.observation_event_key)) {
    throw new Error("position-open State input materialization requires the exact complete source prefix")
  }
  const contextEntry = input.harness_context_binding.entries.find(
    (entry) => entry.decision_sequence === snapshot.decision_sequence,
  )
  if (input.harness_context_binding.request_hash !== canonicalHash(input.request)
      || input.harness_context_binding.run_id !== input.request.run_id
      || input.harness_context_binding.decision_schedule_hash !== input.request.decision_schedule_hash
      || input.harness_context_binding.harness_hash !== input.request.harness_hash
      || !contextEntry || contextEntry.decision_time !== snapshot.decision_time
      || contextEntry.harness_context.decision_phase !== "position_open"
      || replayDecisionPhaseFor(input.request, scheduleEntry) !== "position_open") {
    throw new Error("position-open State input materialization Request/Context binding drift")
  }
  return contextEntry
}
