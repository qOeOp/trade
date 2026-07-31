import {
  assertReplayDecisionObservationBundleDerivationAdmissionSnapshot,
  type ReplayDecisionObservationBundleDerivationAdmissionSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  assertReplayExecutionRequest,
  canonicalHash,
  createReplayDecisionHarnessContext,
  type ReplayExecutionRequest,
} from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplaySourceEventDecisionObservationBundle,
  type ReplaySourceEventDecisionObservationBundle,
} from "../../../contracts/src/lib/replay-source-event-decision-observation-bundle"
import {
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_ENTRY_SCHEMA_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_POLICY_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_SCHEMA_VERSION,
  assertReplaySourceEventDecisionObservationHarnessContextBinding,
  createReplaySourceEventDecisionObservationHarnessContextBinding,
  createReplaySourceEventDecisionObservationHarnessContextBindingEntry,
  type ReplaySourceEventDecisionObservationHarnessContextBinding,
  type ReplaySourceEventDecisionObservationHarnessContextBindingBody,
} from "../../../contracts/src/lib/replay-source-event-decision-observation-harness-context-binding"

export interface ReplaySourceEventDecisionObservationHarnessContextBindingInput {
  request: ReplayExecutionRequest
  bundle: ReplaySourceEventDecisionObservationBundle
  derivation_admission: ReplayDecisionObservationBundleDerivationAdmissionSnapshot
}

export function buildReplaySourceEventDecisionObservationHarnessContextBinding(
  input: ReplaySourceEventDecisionObservationHarnessContextBindingInput,
): ReplaySourceEventDecisionObservationHarnessContextBinding {
  assertInputAuthority(input)
  const bodyWithoutId = buildBodyWithoutId(input)
  const value = createReplaySourceEventDecisionObservationHarnessContextBinding({
    ...bodyWithoutId,
    binding_id: `source-event-observation-harness-context-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  assertReplaySourceEventDecisionObservationHarnessContextBindingLineage(value, input)
  return value
}

export function assertReplaySourceEventDecisionObservationHarnessContextBindingLineage(
  value: ReplaySourceEventDecisionObservationHarnessContextBinding,
  input: ReplaySourceEventDecisionObservationHarnessContextBindingInput,
): void {
  assertReplaySourceEventDecisionObservationHarnessContextBinding(value)
  assertInputAuthority(input)
  const bodyWithoutId = buildBodyWithoutId(input)
  const expected = createReplaySourceEventDecisionObservationHarnessContextBinding({
    ...bodyWithoutId,
    binding_id: `source-event-observation-harness-context-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  if (canonicalHash(value) !== canonicalHash(expected)) {
    throw new Error("observation Harness Context binding parent lineage drift")
  }
}

function buildBodyWithoutId(
  input: ReplaySourceEventDecisionObservationHarnessContextBindingInput,
): Omit<ReplaySourceEventDecisionObservationHarnessContextBindingBody, "binding_id"> {
  const entries = input.request.decision_schedule.entries.map((scheduleEntry, index) => {
    const scheduleBinding = input.bundle.binding_set.bindings[index]!
    const projection = input.bundle.projections[index]!
    const harnessContext = createReplayDecisionHarnessContext(input.request, scheduleEntry)
    return createReplaySourceEventDecisionObservationHarnessContextBindingEntry({
      schema_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_ENTRY_SCHEMA_VERSION,
      decision_sequence: scheduleEntry.decision_sequence,
      decision_time: scheduleEntry.decision_time,
      selected_expected_effect: scheduleEntry.expected_effect,
      selected_schedule_entry_hash: canonicalHash(scheduleEntry),
      schedule_binding_id: scheduleBinding.binding_id,
      schedule_binding_hash: scheduleBinding.binding_hash,
      observation_projection_id: projection.projection_id,
      observation_projection_hash: projection.projection_hash,
      observation_as_of_time: projection.as_of_time,
      observation_count: projection.observation_count,
      observations_hash: projection.observations_hash,
      observation_values_hash: projection.observation_values_hash,
      visibility_cut_hash: projection.cut_hash,
      pit_payload_view_hash: projection.payload_view_hash,
      harness_hash: input.request.harness_hash,
      harness_context: harnessContext,
      harness_context_hash: canonicalHash(harnessContext),
    })
  })
  return {
    schema_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_SCHEMA_VERSION,
    binding_policy_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_POLICY_VERSION,
    scope: "pre_integration_non_economic_observation_harness_context_binding",
    binding_purpose: "bind_admitted_observation_boundaries_to_frozen_harness_context_identity",
    authority_source: "control_plane_derivation_admission",
    context_derivation: "canonical_request_and_schedule_entry",
    observation_binding: "admitted_bundle_member_identity_only",
    decision_input_materialization: "not_certified",
    supplemental_input_compatibility: "not_bound",
    market_input_compatibility: "not_bound",
    state_input_compatibility: "not_bound",
    worker_request_compatibility: "not_bound",
    harness_invocation: "forbidden",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    runner_compatibility: "not_bound",
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
    dataset_manifest_ref: input.request.dataset_manifest_ref,
    dataset_hash: input.request.dataset_hash,
    derivation_admission_id: input.derivation_admission.admission_id,
    derivation_admission_ref: input.derivation_admission.admission_ref,
    derivation_admission_hash: input.derivation_admission.admission_hash,
    bundle_id: input.bundle.bundle_id,
    bundle_hash: input.bundle.bundle_hash,
    decision_schedule_hash: input.request.decision_schedule_hash,
    harness_hash: input.request.harness_hash,
    harness_context_schema_version: entries[0]!.harness_context.schema_version,
    entry_count: entries.length,
    entries,
    entries_hash: canonicalHash(entries),
    entry_hashes_hash: canonicalHash(entries.map((item) => item.entry_hash)),
    harness_context_hashes_hash: canonicalHash(entries.map((item) => item.harness_context_hash)),
    observation_projection_hashes_hash:
      canonicalHash(entries.map((item) => item.observation_projection_hash)),
    first_decision_time: entries[0]!.decision_time,
    last_decision_time: entries.at(-1)!.decision_time,
  }
}

function assertInputAuthority(input: ReplaySourceEventDecisionObservationHarnessContextBindingInput): void {
  assertReplayExecutionRequest(input.request)
  assertReplaySourceEventDecisionObservationBundle(input.bundle)
  assertReplayDecisionObservationBundleDerivationAdmissionSnapshot(input.derivation_admission)
  const admission = input.derivation_admission
  if (admission.request_hash !== canonicalHash(input.request)
      || admission.run_id !== input.request.run_id
      || admission.trial_id !== input.request.trial_id
      || admission.reservation_ref !== input.request.trial_reservation_ref
      || admission.reservation_hash !== input.request.trial_reservation_hash
      || admission.dataset_manifest_ref !== input.request.dataset_manifest_ref
      || admission.dataset_hash !== input.request.dataset_hash
      || admission.decision_schedule_hash !== input.request.decision_schedule_hash) {
    throw new Error("observation Harness Context binding Request does not match Derivation Admission")
  }
  if (admission.bundle_id !== input.bundle.bundle_id
      || admission.bundle_hash !== input.bundle.bundle_hash
      || admission.binding_set_id !== input.bundle.binding_set_id
      || admission.binding_set_hash !== input.bundle.binding_set_hash
      || admission.decision_schedule_hash !== input.bundle.decision_schedule_hash
      || admission.boundary_count !== input.bundle.projection_count
      || input.request.decision_schedule.entries.length !== input.bundle.projection_count) {
    throw new Error("observation Harness Context binding Bundle does not match Derivation Admission")
  }
}
