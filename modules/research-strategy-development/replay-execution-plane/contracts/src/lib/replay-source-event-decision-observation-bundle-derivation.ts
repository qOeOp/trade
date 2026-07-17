import { canonicalHash } from "./replay-contracts"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_DERIVATION_SCHEMA_VERSION = "trade.rd-replay-source-event-decision-observation-bundle-derivation-attestation.v1" as const
export const REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_DERIVATION_BOUNDARY_SCHEMA_VERSION = "trade.rd-replay-source-event-decision-observation-bundle-derivation-boundary.v1" as const
export const REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_DERIVATION_POLICY_VERSION = "rd-replay-source-event-decision-observation-bundle-derivation-v1" as const

export interface ReplaySourceEventDecisionObservationBundleDerivationBoundary {
  schema_version: typeof REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_DERIVATION_BOUNDARY_SCHEMA_VERSION
  decision_sequence: number
  decision_time: string
  visibility_cut_id: string
  visibility_cut_hash: string
  pit_payload_view_id: string
  pit_payload_view_hash: string
  observation_projection_id: string
  observation_projection_hash: string
  schedule_binding_id: string
  schedule_binding_hash: string
  visible_transition_count: number
  observation_count: number
  observations_hash: string
  observation_values_hash: string
  future_transition_count: number
  future_transition_ids_hash: string
  boundary_hash: string
}

export type ReplaySourceEventDecisionObservationBundleDerivationBoundaryBody = Omit<
  ReplaySourceEventDecisionObservationBundleDerivationBoundary,
  "boundary_hash"
>

export interface ReplaySourceEventDecisionObservationBundleDerivationAttestation {
  schema_version: typeof REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_DERIVATION_SCHEMA_VERSION
  attestation_id: string
  derivation_policy_version: typeof REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_DERIVATION_POLICY_VERSION
  scope: "pre_integration_non_economic_observation_bundle_derivation"
  attestation_purpose: "prove_bundle_rebuild_from_complete_parent_chain"
  derivation_chain: "wire_gate_trace_cursor_cut_view_projection_binding_bundle"
  certification_result: "certified_against_supplied_parent_chain"
  common_parent_rule: "one_wire_gate_trace_cursor_for_all_boundaries"
  independent_verification: "external_parent_replay_required"
  portability: "hash_summary_without_parent_payload_duplication"
  control_plane_admission_compatibility: "not_bound"
  decision_input_compatibility: "not_asserted"
  harness_compatibility: "not_bound"
  harness_invocation: "forbidden"
  runner_compatibility: "not_bound"
  decision_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  wire_manifest_id: string
  wire_manifest_hash: string
  ordering_attestation_id: string
  ordering_attestation_hash: string
  pre_execution_gate_id: string
  pre_execution_gate_hash: string
  candidate_trace_id: string
  candidate_trace_hash: string
  availability_cursor_id: string
  availability_cursor_hash: string
  decision_schedule_hash: string
  bundle_id: string
  bundle_hash: string
  binding_set_id: string
  binding_set_hash: string
  boundary_count: number
  boundaries: ReplaySourceEventDecisionObservationBundleDerivationBoundary[]
  boundaries_hash: string
  cut_hashes_hash: string
  payload_view_hashes_hash: string
  projection_hashes_hash: string
  binding_hashes_hash: string
  first_decision_time: string
  last_decision_time: string
  attestation_hash: string
}

export type ReplaySourceEventDecisionObservationBundleDerivationAttestationBody = Omit<
  ReplaySourceEventDecisionObservationBundleDerivationAttestation,
  "attestation_hash"
>

export function createReplaySourceEventDecisionObservationBundleDerivationBoundary(
  body: ReplaySourceEventDecisionObservationBundleDerivationBoundaryBody,
): ReplaySourceEventDecisionObservationBundleDerivationBoundary {
  const value = { ...structuredClone(body), boundary_hash: canonicalHash(body) }
  assertReplaySourceEventDecisionObservationBundleDerivationBoundary(value)
  return value
}

export function createReplaySourceEventDecisionObservationBundleDerivationAttestation(
  body: ReplaySourceEventDecisionObservationBundleDerivationAttestationBody,
): ReplaySourceEventDecisionObservationBundleDerivationAttestation {
  const value = { ...structuredClone(body), attestation_hash: canonicalHash(body) }
  assertReplaySourceEventDecisionObservationBundleDerivationAttestation(value)
  return value
}

export function assertReplaySourceEventDecisionObservationBundleDerivationBoundary(
  value: ReplaySourceEventDecisionObservationBundleDerivationBoundary,
): void {
  if (value.schema_version !== REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_DERIVATION_BOUNDARY_SCHEMA_VERSION) {
    throw new Error("unsupported SourceEvent observation Bundle derivation boundary schema")
  }
  assertExactFields(value, BOUNDARY_FIELDS, "SourceEvent observation Bundle derivation boundary")
  for (const item of [
    value.visibility_cut_id,
    value.pit_payload_view_id,
    value.observation_projection_id,
    value.schedule_binding_id,
  ]) requireText(item, "SourceEvent observation Bundle derivation boundary identity")
  for (const [field, item] of Object.entries({
    visibility_cut_hash: value.visibility_cut_hash,
    pit_payload_view_hash: value.pit_payload_view_hash,
    observation_projection_hash: value.observation_projection_hash,
    schedule_binding_hash: value.schedule_binding_hash,
    observations_hash: value.observations_hash,
    observation_values_hash: value.observation_values_hash,
    future_transition_ids_hash: value.future_transition_ids_hash,
    boundary_hash: value.boundary_hash,
  })) requireHash(item, `SourceEvent observation Bundle derivation boundary ${field}`)
  requireUtc(value.decision_time, "SourceEvent observation Bundle derivation boundary decision time")
  if (!Number.isSafeInteger(value.decision_sequence) || value.decision_sequence < 1) {
    throw new Error("SourceEvent observation Bundle derivation boundary sequence is invalid")
  }
  for (const count of [value.visible_transition_count, value.observation_count, value.future_transition_count]) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("SourceEvent observation Bundle derivation boundary count is invalid")
    }
  }
  if (value.visible_transition_count !== value.observation_count) {
    throw new Error("SourceEvent observation Bundle derivation boundary visible/observation cardinality drift")
  }
  const { boundary_hash: boundaryHash, ...body } = value
  if (boundaryHash !== canonicalHash(body)) {
    throw new Error("SourceEvent observation Bundle derivation boundary hash mismatch")
  }
}

export function assertReplaySourceEventDecisionObservationBundleDerivationAttestation(
  value: ReplaySourceEventDecisionObservationBundleDerivationAttestation,
): void {
  if (value.schema_version !== REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_DERIVATION_SCHEMA_VERSION
      || value.derivation_policy_version !== REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_BUNDLE_DERIVATION_POLICY_VERSION
      || value.scope !== "pre_integration_non_economic_observation_bundle_derivation"
      || value.attestation_purpose !== "prove_bundle_rebuild_from_complete_parent_chain"
      || value.derivation_chain !== "wire_gate_trace_cursor_cut_view_projection_binding_bundle"
      || value.certification_result !== "certified_against_supplied_parent_chain"
      || value.common_parent_rule !== "one_wire_gate_trace_cursor_for_all_boundaries"
      || value.independent_verification !== "external_parent_replay_required"
      || value.portability !== "hash_summary_without_parent_payload_duplication"
      || value.control_plane_admission_compatibility !== "not_bound"
      || value.decision_input_compatibility !== "not_asserted"
      || value.harness_compatibility !== "not_bound"
      || value.harness_invocation !== "forbidden"
      || value.runner_compatibility !== "not_bound"
      || value.decision_authority !== "none"
      || value.signal_authority !== "none"
      || value.order_authority !== "none"
      || value.economic_authority !== "none") {
    throw new Error("unsupported SourceEvent observation Bundle derivation authority")
  }
  assertExactFields(value, ATTESTATION_FIELDS, "SourceEvent observation Bundle derivation attestation")
  for (const item of [
    value.attestation_id,
    value.wire_manifest_id,
    value.ordering_attestation_id,
    value.pre_execution_gate_id,
    value.candidate_trace_id,
    value.availability_cursor_id,
    value.bundle_id,
    value.binding_set_id,
  ]) requireText(item, "SourceEvent observation Bundle derivation identity")
  for (const [field, item] of Object.entries({
    wire_manifest_hash: value.wire_manifest_hash,
    ordering_attestation_hash: value.ordering_attestation_hash,
    pre_execution_gate_hash: value.pre_execution_gate_hash,
    candidate_trace_hash: value.candidate_trace_hash,
    availability_cursor_hash: value.availability_cursor_hash,
    decision_schedule_hash: value.decision_schedule_hash,
    bundle_hash: value.bundle_hash,
    binding_set_hash: value.binding_set_hash,
    boundaries_hash: value.boundaries_hash,
    cut_hashes_hash: value.cut_hashes_hash,
    payload_view_hashes_hash: value.payload_view_hashes_hash,
    projection_hashes_hash: value.projection_hashes_hash,
    binding_hashes_hash: value.binding_hashes_hash,
    attestation_hash: value.attestation_hash,
  })) requireHash(item, `SourceEvent observation Bundle derivation ${field}`)
  requireUtc(value.first_decision_time, "SourceEvent observation Bundle derivation first decision time")
  requireUtc(value.last_decision_time, "SourceEvent observation Bundle derivation last decision time")
  if (!Number.isSafeInteger(value.boundary_count)
      || value.boundary_count < 1
      || value.boundary_count !== value.boundaries.length) {
    throw new Error("SourceEvent observation Bundle derivation boundary cardinality drift")
  }
  let priorTime = Number.NEGATIVE_INFINITY
  for (const [index, boundary] of value.boundaries.entries()) {
    assertReplaySourceEventDecisionObservationBundleDerivationBoundary(boundary)
    const decisionTime = Date.parse(boundary.decision_time)
    if (boundary.decision_sequence !== index + 1 || decisionTime <= priorTime) {
      throw new Error("SourceEvent observation Bundle derivation boundary order drift")
    }
    priorTime = decisionTime
  }
  if (value.first_decision_time !== value.boundaries[0]!.decision_time
      || value.last_decision_time !== value.boundaries.at(-1)!.decision_time
      || value.boundaries_hash !== canonicalHash(value.boundaries)
      || value.cut_hashes_hash !== canonicalHash(value.boundaries.map((item) => item.visibility_cut_hash))
      || value.payload_view_hashes_hash !== canonicalHash(value.boundaries.map((item) => item.pit_payload_view_hash))
      || value.projection_hashes_hash !== canonicalHash(value.boundaries.map((item) => item.observation_projection_hash))
      || value.binding_hashes_hash !== canonicalHash(value.boundaries.map((item) => item.schedule_binding_hash))) {
    throw new Error("SourceEvent observation Bundle derivation fold drift")
  }
  const { attestation_hash: attestationHash, ...body } = value
  const { attestation_id: attestationId, ...bodyWithoutId } = body
  if (attestationId !== `source-event-decision-observation-derivation-${canonicalHash(bodyWithoutId).slice(0, 24)}`) {
    throw new Error("SourceEvent observation Bundle derivation identity mismatch")
  }
  if (attestationHash !== canonicalHash(body)) {
    throw new Error("SourceEvent observation Bundle derivation hash mismatch")
  }
}

const BOUNDARY_FIELDS = [
  "boundary_hash", "decision_sequence", "decision_time", "future_transition_count",
  "future_transition_ids_hash", "observation_count", "observation_projection_hash",
  "observation_projection_id", "observation_values_hash", "observations_hash",
  "pit_payload_view_hash", "pit_payload_view_id", "schedule_binding_hash",
  "schedule_binding_id", "schema_version", "visibility_cut_hash", "visibility_cut_id",
  "visible_transition_count",
].sort()

const ATTESTATION_FIELDS = [
  "attestation_hash", "attestation_id", "attestation_purpose", "availability_cursor_hash",
  "availability_cursor_id", "binding_hashes_hash", "binding_set_hash", "binding_set_id",
  "boundaries", "boundaries_hash", "boundary_count", "bundle_hash", "bundle_id",
  "candidate_trace_hash", "candidate_trace_id", "certification_result", "common_parent_rule",
  "control_plane_admission_compatibility", "cut_hashes_hash", "decision_authority",
  "decision_input_compatibility", "decision_schedule_hash", "derivation_chain",
  "derivation_policy_version", "economic_authority", "first_decision_time",
  "harness_compatibility", "harness_invocation", "independent_verification",
  "last_decision_time", "order_authority", "ordering_attestation_hash",
  "ordering_attestation_id", "payload_view_hashes_hash", "portability",
  "pre_execution_gate_hash", "pre_execution_gate_id", "projection_hashes_hash",
  "runner_compatibility", "schema_version", "scope", "signal_authority",
  "wire_manifest_hash", "wire_manifest_id",
].sort()

function assertExactFields(value: object, expected: string[], label: string): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(expected)) {
    throw new Error(`${label} field whitelist drift`)
  }
}
