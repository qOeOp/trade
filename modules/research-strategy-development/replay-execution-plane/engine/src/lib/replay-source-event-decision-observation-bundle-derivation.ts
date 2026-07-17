import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_DERIVATION_BOUNDARY_SCHEMA_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_DERIVATION_POLICY_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_DERIVATION_SCHEMA_VERSION,
  assertReplaySourceEventDecisionObservationBundleDerivationAttestation as assertAttestation,
  createReplaySourceEventDecisionObservationBundleDerivationAttestation,
  createReplaySourceEventDecisionObservationBundleDerivationBoundary,
  type ReplaySourceEventDecisionObservationBundleDerivationAttestation,
  type ReplaySourceEventDecisionObservationBundleDerivationAttestationBody,
  type ReplaySourceEventDecisionObservationBundleDerivationBoundary,
} from "../../../contracts/src/lib/replay-source-event-decision-observation-bundle-derivation"
import type { ReplaySourceEventDecisionObservationBundle } from "../../../contracts/src/lib/replay-source-event-decision-observation-bundle"
import {
  assertReplaySourceEventDecisionObservationBundleLineage,
  type ReplaySourceEventDecisionObservationBundleInput,
} from "./replay-source-event-decision-observation-bundle"

export function certifyReplaySourceEventDecisionObservationBundleDerivation(
  bundle: ReplaySourceEventDecisionObservationBundle,
  input: ReplaySourceEventDecisionObservationBundleInput,
): ReplaySourceEventDecisionObservationBundleDerivationAttestation {
  assertReplaySourceEventDecisionObservationBundleLineage(bundle, input)
  assertCommonParentChain(input)
  const bodyWithoutId = buildAttestationBodyWithoutId(bundle, input)
  const value = createReplaySourceEventDecisionObservationBundleDerivationAttestation({
    ...bodyWithoutId,
    attestation_id: `source-event-decision-observation-derivation-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  assertReplaySourceEventDecisionObservationBundleDerivationLineage(value, bundle, input)
  return value
}

export function assertReplaySourceEventDecisionObservationBundleDerivationLineage(
  attestation: ReplaySourceEventDecisionObservationBundleDerivationAttestation,
  bundle: ReplaySourceEventDecisionObservationBundle,
  input: ReplaySourceEventDecisionObservationBundleInput,
): void {
  assertAttestation(attestation)
  assertReplaySourceEventDecisionObservationBundleLineage(bundle, input)
  assertCommonParentChain(input)
  const bodyWithoutId = buildAttestationBodyWithoutId(bundle, input)
  const expected = createReplaySourceEventDecisionObservationBundleDerivationAttestation({
    ...bodyWithoutId,
    attestation_id: `source-event-decision-observation-derivation-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  if (canonicalHash(attestation) !== canonicalHash(expected)) {
    throw new Error("SourceEvent observation Bundle derivation parent lineage drift")
  }
}

function buildAttestationBodyWithoutId(
  bundle: ReplaySourceEventDecisionObservationBundle,
  input: ReplaySourceEventDecisionObservationBundleInput,
): Omit<ReplaySourceEventDecisionObservationBundleDerivationAttestationBody, "attestation_id"> {
  const root = input.binding_inputs[0]!
  const boundaries = deriveBoundaries(bundle, input)
  return {
    schema_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_DERIVATION_SCHEMA_VERSION,
    derivation_policy_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_DERIVATION_POLICY_VERSION,
    scope: "pre_integration_non_economic_observation_bundle_derivation",
    attestation_purpose: "prove_bundle_rebuild_from_complete_parent_chain",
    derivation_chain: "wire_gate_trace_cursor_cut_view_projection_binding_bundle",
    certification_result: "certified_against_supplied_parent_chain",
    common_parent_rule: "one_wire_gate_trace_cursor_for_all_boundaries",
    independent_verification: "external_parent_replay_required",
    portability: "hash_summary_without_parent_payload_duplication",
    control_plane_admission_compatibility: "not_bound",
    decision_input_compatibility: "not_asserted",
    harness_compatibility: "not_bound",
    harness_invocation: "forbidden",
    runner_compatibility: "not_bound",
    decision_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    wire_manifest_id: root.wire_manifest.wire_manifest_id,
    wire_manifest_hash: root.wire_manifest.manifest_hash,
    ordering_attestation_id: root.ordering_attestation.attestation_id,
    ordering_attestation_hash: root.ordering_attestation.attestation_hash,
    pre_execution_gate_id: root.pre_execution_gate.gate_id,
    pre_execution_gate_hash: root.pre_execution_gate.gate_hash,
    candidate_trace_id: root.candidate_trace.trace_id,
    candidate_trace_hash: root.candidate_trace.trace_hash,
    availability_cursor_id: root.availability_cursor.cursor_id,
    availability_cursor_hash: root.availability_cursor.cursor_hash,
    decision_schedule_hash: input.decision_schedule_hash,
    bundle_id: bundle.bundle_id,
    bundle_hash: bundle.bundle_hash,
    binding_set_id: bundle.binding_set_id,
    binding_set_hash: bundle.binding_set_hash,
    boundary_count: boundaries.length,
    boundaries,
    boundaries_hash: canonicalHash(boundaries),
    cut_hashes_hash: canonicalHash(boundaries.map((item) => item.visibility_cut_hash)),
    payload_view_hashes_hash: canonicalHash(boundaries.map((item) => item.pit_payload_view_hash)),
    projection_hashes_hash: canonicalHash(boundaries.map((item) => item.observation_projection_hash)),
    binding_hashes_hash: canonicalHash(boundaries.map((item) => item.schedule_binding_hash)),
    first_decision_time: boundaries[0]!.decision_time,
    last_decision_time: boundaries.at(-1)!.decision_time,
  }
}

function deriveBoundaries(
  bundle: ReplaySourceEventDecisionObservationBundle,
  input: ReplaySourceEventDecisionObservationBundleInput,
): ReplaySourceEventDecisionObservationBundleDerivationBoundary[] {
  return input.binding_inputs.map((boundaryInput, index) => {
    const binding = bundle.binding_set.bindings[index]!
    const projection = bundle.projections[index]!
    const cut = boundaryInput.visibility_cut
    const view = boundaryInput.pit_payload_view
    return createReplaySourceEventDecisionObservationBundleDerivationBoundary({
      schema_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_DERIVATION_BOUNDARY_SCHEMA_VERSION,
      decision_sequence: binding.selected_decision_sequence,
      decision_time: binding.selected_decision_time,
      visibility_cut_id: cut.cut_id,
      visibility_cut_hash: cut.cut_hash,
      pit_payload_view_id: view.view_id,
      pit_payload_view_hash: view.view_hash,
      observation_projection_id: projection.projection_id,
      observation_projection_hash: projection.projection_hash,
      schedule_binding_id: binding.binding_id,
      schedule_binding_hash: binding.binding_hash,
      visible_transition_count: cut.visible_prefix_length,
      observation_count: projection.observation_count,
      observations_hash: projection.observations_hash,
      observation_values_hash: projection.observation_values_hash,
      future_transition_count: cut.future_transition_count,
      future_transition_ids_hash: cut.future_transition_ids_hash,
    })
  })
}

function assertCommonParentChain(input: ReplaySourceEventDecisionObservationBundleInput): void {
  const root = input.binding_inputs[0]
  if (!root) throw new Error("SourceEvent observation Bundle derivation requires parent inputs")
  const rootIdentity = canonicalHash({
    wire_manifest_id: root.wire_manifest.wire_manifest_id,
    wire_manifest_hash: root.wire_manifest.manifest_hash,
    ordering_attestation_id: root.ordering_attestation.attestation_id,
    ordering_attestation_hash: root.ordering_attestation.attestation_hash,
    pre_execution_gate_id: root.pre_execution_gate.gate_id,
    pre_execution_gate_hash: root.pre_execution_gate.gate_hash,
    candidate_trace_id: root.candidate_trace.trace_id,
    candidate_trace_hash: root.candidate_trace.trace_hash,
    availability_cursor_id: root.availability_cursor.cursor_id,
    availability_cursor_hash: root.availability_cursor.cursor_hash,
  })
  for (const boundary of input.binding_inputs) {
    const identity = canonicalHash({
      wire_manifest_id: boundary.wire_manifest.wire_manifest_id,
      wire_manifest_hash: boundary.wire_manifest.manifest_hash,
      ordering_attestation_id: boundary.ordering_attestation.attestation_id,
      ordering_attestation_hash: boundary.ordering_attestation.attestation_hash,
      pre_execution_gate_id: boundary.pre_execution_gate.gate_id,
      pre_execution_gate_hash: boundary.pre_execution_gate.gate_hash,
      candidate_trace_id: boundary.candidate_trace.trace_id,
      candidate_trace_hash: boundary.candidate_trace.trace_hash,
      availability_cursor_id: boundary.availability_cursor.cursor_id,
      availability_cursor_hash: boundary.availability_cursor.cursor_hash,
    })
    if (identity !== rootIdentity) {
      throw new Error("SourceEvent observation Bundle derivation mixes parent chains")
    }
  }
}
