import type { Database } from "bun:sqlite"
import {
  assertReplaySourceEventDecisionObservationBundle,
  type ReplaySourceEventDecisionObservationBundle,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-source-event-decision-observation-bundle"
import {
  assertReplaySourceEventDecisionObservationBundleDerivationAttestation,
  type ReplaySourceEventDecisionObservationBundleDerivationAttestation,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-source-event-decision-observation-bundle-derivation"
import {
  REPLAY_DECISION_OBSERVATION_BUNDLE_DERIVATION_ADMISSION_SCHEMA_VERSION,
  assertReplayDecisionObservationBundleDerivationAdmissionSnapshot,
  assertTrialReservationSnapshot,
  createReplayDecisionObservationBundleDerivationAdmissionSnapshot,
  hashTrialReservationSnapshot,
  type ReplayDecisionObservationBundleDerivationAdmissionSnapshot,
  type TrialReservationSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"
import { readReplayDecisionObservationBundleAdmission } from "./decision-observation-bundle-admission-registry"

interface AdmissionRow {
  admission_hash: string
  admission_json: string
}

export interface IssueReplayDecisionObservationBundleDerivationAdmissionInput {
  admission_id: string
  admission_ref: string
  issued_at: string
  authority_id: string
  admission_policy_version: string
  reservation: TrialReservationSnapshot
  bundle: ReplaySourceEventDecisionObservationBundle
  derivation_attestation: ReplaySourceEventDecisionObservationBundleDerivationAttestation
}

export function issueReplayDecisionObservationBundleDerivationAdmission(
  db: Database,
  input: IssueReplayDecisionObservationBundleDerivationAdmissionInput,
): ReplayDecisionObservationBundleDerivationAdmissionSnapshot {
  assertTrialReservationSnapshot(input.reservation)
  assertReplaySourceEventDecisionObservationBundle(input.bundle)
  assertReplaySourceEventDecisionObservationBundleDerivationAttestation(input.derivation_attestation)
  const reservationHash = hashTrialReservationSnapshot(input.reservation)
  const issuedAt = Date.parse(input.issued_at)
  if (!Number.isFinite(issuedAt)
      || issuedAt < Date.parse(input.reservation.issued_at)
      || issuedAt >= Date.parse(input.reservation.expires_at)) {
    throw new Error("decision observation derivation admission must fall inside the Trial Reservation window")
  }
  const trial = db.query(`
    SELECT trial_id, run_id, status FROM rd_trial WHERE trial_id = $trial_id
  `).get({ $trial_id: input.reservation.identity.trial_id }) as {
    trial_id: string
    run_id: string
    status: string
  } | null
  if (!trial || trial.run_id !== input.reservation.run_id || trial.status !== "reserved") {
    throw new Error("decision observation derivation admission requires the authoritative reserved Trial")
  }
  const bundleAdmission = readReplayDecisionObservationBundleAdmission(db, reservationHash)
  if (issuedAt < Date.parse(bundleAdmission.issued_at)) {
    throw new Error("decision observation derivation admission cannot predate Bundle Admission")
  }
  assertBundleAdmissionIdentity(input.bundle, bundleAdmission)
  assertDerivationBundleBinding(input.derivation_attestation, input.bundle, bundleAdmission)

  const admission = createReplayDecisionObservationBundleDerivationAdmissionSnapshot({
    schema_version: REPLAY_DECISION_OBSERVATION_BUNDLE_DERIVATION_ADMISSION_SCHEMA_VERSION,
    admission_id: input.admission_id,
    admission_ref: input.admission_ref,
    status: "admitted",
    issued_at: input.issued_at,
    authority_id: input.authority_id,
    admission_policy_version: input.admission_policy_version,
    trial_id: input.reservation.identity.trial_id,
    run_id: input.reservation.run_id,
    reservation_ref: input.reservation.reservation_ref,
    reservation_hash: reservationHash,
    request_hash: bundleAdmission.request_hash,
    dataset_manifest_ref: bundleAdmission.dataset_manifest_ref,
    dataset_hash: bundleAdmission.dataset_hash,
    bundle_admission_ref: bundleAdmission.admission_ref,
    bundle_admission_hash: bundleAdmission.admission_hash,
    ordering_admission_hash: bundleAdmission.ordering_admission_hash,
    wire_manifest_id: bundleAdmission.wire_manifest_id,
    wire_manifest_hash: bundleAdmission.wire_manifest_hash,
    decision_schedule_hash: bundleAdmission.decision_schedule_hash,
    bundle_id: bundleAdmission.bundle_id,
    bundle_hash: bundleAdmission.bundle_hash,
    binding_set_id: bundleAdmission.binding_set_id,
    binding_set_hash: bundleAdmission.binding_set_hash,
    derivation_attestation_id: input.derivation_attestation.attestation_id,
    derivation_attestation_hash: input.derivation_attestation.attestation_hash,
    derivation_policy_version: input.derivation_attestation.derivation_policy_version,
    certification_result: input.derivation_attestation.certification_result,
    common_parent_rule: input.derivation_attestation.common_parent_rule,
    boundary_count: input.derivation_attestation.boundary_count,
    boundaries_hash: input.derivation_attestation.boundaries_hash,
    first_decision_time: input.derivation_attestation.first_decision_time,
    last_decision_time: input.derivation_attestation.last_decision_time,
    consumer_capability: "non_economic_decision_observation_derivation_audit",
    scope: "pre_integration_non_economic_derivation_admission_only",
    control_plane_validation: "attestation_schema_hash_and_admitted_bundle_binding",
    control_plane_parent_replay: "not_performed",
    independent_verification: "external_parent_replay_required",
    decision_input_compatibility: "not_asserted",
    harness_compatibility: "not_bound",
    harness_invocation: "forbidden",
    runner_compatibility: "not_bound",
    decision_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
  })

  return db.transaction(() => {
    const existing = db.query(`
      SELECT admission_hash, admission_json
      FROM rd_replay_decision_observation_bundle_derivation_admission
      WHERE admission_id = $admission_id
        OR admission_ref = $admission_ref
        OR reservation_hash = $reservation_hash
        OR request_hash = $request_hash
        OR bundle_admission_hash = $bundle_admission_hash
        OR bundle_id = $bundle_id
        OR bundle_hash = $bundle_hash
        OR derivation_attestation_id = $derivation_attestation_id
        OR derivation_attestation_hash = $derivation_attestation_hash
    `).get({
      $admission_id: admission.admission_id,
      $admission_ref: admission.admission_ref,
      $reservation_hash: admission.reservation_hash,
      $request_hash: admission.request_hash,
      $bundle_admission_hash: admission.bundle_admission_hash,
      $bundle_id: admission.bundle_id,
      $bundle_hash: admission.bundle_hash,
      $derivation_attestation_id: admission.derivation_attestation_id,
      $derivation_attestation_hash: admission.derivation_attestation_hash,
    }) as AdmissionRow | null
    if (existing) {
      if (existing.admission_hash !== admission.admission_hash) {
        throw new Error("Replay decision observation derivation admission identity already exists with different content")
      }
      return parseAdmissionRow(existing)
    }
    db.query(`
      INSERT INTO rd_replay_decision_observation_bundle_derivation_admission(
        admission_id, admission_ref, admission_hash, status, issued_at,
        authority_id, admission_policy_version, trial_id, run_id,
        reservation_ref, reservation_hash, request_hash,
        dataset_manifest_ref, dataset_hash, bundle_admission_ref,
        bundle_admission_hash, ordering_admission_hash, wire_manifest_id,
        wire_manifest_hash, decision_schedule_hash, bundle_id, bundle_hash,
        binding_set_id, binding_set_hash, derivation_attestation_id,
        derivation_attestation_hash, boundary_count, boundaries_hash,
        consumer_capability, scope, control_plane_parent_replay,
        harness_invocation, economic_authority, admission_json
      ) VALUES (
        $admission_id, $admission_ref, $admission_hash, $status, $issued_at,
        $authority_id, $admission_policy_version, $trial_id, $run_id,
        $reservation_ref, $reservation_hash, $request_hash,
        $dataset_manifest_ref, $dataset_hash, $bundle_admission_ref,
        $bundle_admission_hash, $ordering_admission_hash, $wire_manifest_id,
        $wire_manifest_hash, $decision_schedule_hash, $bundle_id, $bundle_hash,
        $binding_set_id, $binding_set_hash, $derivation_attestation_id,
        $derivation_attestation_hash, $boundary_count, $boundaries_hash,
        $consumer_capability, $scope, $control_plane_parent_replay,
        $harness_invocation, $economic_authority, $admission_json
      )
    `).run({
      $admission_id: admission.admission_id,
      $admission_ref: admission.admission_ref,
      $admission_hash: admission.admission_hash,
      $status: admission.status,
      $issued_at: admission.issued_at,
      $authority_id: admission.authority_id,
      $admission_policy_version: admission.admission_policy_version,
      $trial_id: admission.trial_id,
      $run_id: admission.run_id,
      $reservation_ref: admission.reservation_ref,
      $reservation_hash: admission.reservation_hash,
      $request_hash: admission.request_hash,
      $dataset_manifest_ref: admission.dataset_manifest_ref,
      $dataset_hash: admission.dataset_hash,
      $bundle_admission_ref: admission.bundle_admission_ref,
      $bundle_admission_hash: admission.bundle_admission_hash,
      $ordering_admission_hash: admission.ordering_admission_hash,
      $wire_manifest_id: admission.wire_manifest_id,
      $wire_manifest_hash: admission.wire_manifest_hash,
      $decision_schedule_hash: admission.decision_schedule_hash,
      $bundle_id: admission.bundle_id,
      $bundle_hash: admission.bundle_hash,
      $binding_set_id: admission.binding_set_id,
      $binding_set_hash: admission.binding_set_hash,
      $derivation_attestation_id: admission.derivation_attestation_id,
      $derivation_attestation_hash: admission.derivation_attestation_hash,
      $boundary_count: admission.boundary_count,
      $boundaries_hash: admission.boundaries_hash,
      $consumer_capability: admission.consumer_capability,
      $scope: admission.scope,
      $control_plane_parent_replay: admission.control_plane_parent_replay,
      $harness_invocation: admission.harness_invocation,
      $economic_authority: admission.economic_authority,
      $admission_json: JSON.stringify(admission),
    })
    return structuredClone(admission)
  }).immediate()
}

export function readReplayDecisionObservationBundleDerivationAdmission(
  db: Database,
  reservationHash: string,
): ReplayDecisionObservationBundleDerivationAdmissionSnapshot {
  const row = db.query(`
    SELECT admission_hash, admission_json
    FROM rd_replay_decision_observation_bundle_derivation_admission
    WHERE reservation_hash = $reservation_hash
  `).get({ $reservation_hash: reservationHash }) as AdmissionRow | null
  if (!row) throw new Error("Replay decision observation derivation admission is not registered")
  return parseAdmissionRow(row)
}

function assertBundleAdmissionIdentity(
  bundle: ReplaySourceEventDecisionObservationBundle,
  admission: ReturnType<typeof readReplayDecisionObservationBundleAdmission>,
): void {
  if (bundle.bundle_id !== admission.bundle_id
      || bundle.bundle_hash !== admission.bundle_hash
      || bundle.bundle_policy_version !== admission.bundle_policy_version
      || bundle.decision_schedule_hash !== admission.decision_schedule_hash
      || bundle.decision_schedule_entry_count !== admission.decision_schedule_entry_count
      || bundle.binding_set_id !== admission.binding_set_id
      || bundle.binding_set_hash !== admission.binding_set_hash
      || bundle.projection_count !== admission.projection_count
      || bundle.projections_hash !== admission.projections_hash
      || bundle.observation_values_hashes_hash !== admission.observation_values_hashes_hash
      || bundle.first_as_of_time !== admission.first_as_of_time
      || bundle.last_as_of_time !== admission.last_as_of_time) {
    throw new Error("decision observation derivation admission Bundle does not match prior Admission")
  }
}

function assertDerivationBundleBinding(
  attestation: ReplaySourceEventDecisionObservationBundleDerivationAttestation,
  bundle: ReplaySourceEventDecisionObservationBundle,
  admission: ReturnType<typeof readReplayDecisionObservationBundleAdmission>,
): void {
  if (attestation.control_plane_admission_compatibility !== "not_bound"
      || attestation.bundle_id !== bundle.bundle_id
      || attestation.bundle_hash !== bundle.bundle_hash
      || attestation.binding_set_id !== bundle.binding_set_id
      || attestation.binding_set_hash !== bundle.binding_set_hash
      || attestation.wire_manifest_id !== admission.wire_manifest_id
      || attestation.wire_manifest_hash !== admission.wire_manifest_hash
      || attestation.decision_schedule_hash !== bundle.decision_schedule_hash
      || attestation.boundary_count !== bundle.projection_count
      || attestation.first_decision_time !== bundle.first_as_of_time
      || attestation.last_decision_time !== bundle.last_as_of_time) {
    throw new Error("decision observation derivation attestation does not bind the admitted Bundle")
  }
  for (const [index, boundary] of attestation.boundaries.entries()) {
    const binding = bundle.binding_set.bindings[index]!
    const projection = bundle.projections[index]!
    if (boundary.decision_sequence !== binding.selected_decision_sequence
        || boundary.decision_time !== binding.selected_decision_time
        || boundary.visibility_cut_id !== projection.cut_id
        || boundary.visibility_cut_hash !== projection.cut_hash
        || boundary.pit_payload_view_id !== projection.payload_view_id
        || boundary.pit_payload_view_hash !== projection.payload_view_hash
        || boundary.observation_projection_id !== projection.projection_id
        || boundary.observation_projection_hash !== projection.projection_hash
        || boundary.schedule_binding_id !== binding.binding_id
        || boundary.schedule_binding_hash !== binding.binding_hash
        || boundary.observation_count !== projection.observation_count
        || boundary.observations_hash !== projection.observations_hash
        || boundary.observation_values_hash !== projection.observation_values_hash
        || boundary.future_transition_count !== projection.future_transition_count
        || boundary.future_transition_ids_hash !== projection.future_transition_ids_hash) {
      throw new Error("decision observation derivation boundary does not bind the admitted Bundle")
    }
  }
}

function parseAdmissionRow(row: AdmissionRow): ReplayDecisionObservationBundleDerivationAdmissionSnapshot {
  const admission = JSON.parse(row.admission_json) as ReplayDecisionObservationBundleDerivationAdmissionSnapshot
  assertReplayDecisionObservationBundleDerivationAdmissionSnapshot(admission)
  if (admission.admission_hash !== row.admission_hash) {
    throw new Error("Replay decision observation derivation admission registry row is inconsistent")
  }
  return admission
}
