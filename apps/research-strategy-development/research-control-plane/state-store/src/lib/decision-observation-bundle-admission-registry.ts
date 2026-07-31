import type { Database } from "bun:sqlite"
import {
  assertReplayExecutionRequest,
  canonicalHash,
  type ReplayExecutionRequest,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"
import {
  assertReplaySourceEventDecisionObservationBundle,
  type ReplaySourceEventDecisionObservationBundle,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-source-event-decision-observation-bundle"
import { assertReplaySourceEventDecisionScheduleObservationBindingSetLineage } from "../../../../replay-execution-plane/contracts/src/lib/replay-source-event-decision-schedule-observation-binding-set"
import {
  assertReplaySourceEventWireManifest,
  type ReplaySourceEventWireManifest,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-source-event-wire"
import {
  REPLAY_DECISION_OBSERVATION_BUNDLE_ADMISSION_SCHEMA_VERSION,
  assertReplayDecisionObservationBundleAdmissionSnapshot,
  assertTrialReservationSnapshot,
  createReplayDecisionObservationBundleAdmissionSnapshot,
  hashTrialReservationSnapshot,
  type ReplayDecisionObservationBundleAdmissionSnapshot,
  type TrialReservationSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"
import { readReplayCrossSourceOrderingAdmission } from "./cross-source-ordering-admission-registry"

interface AdmissionRow {
  admission_hash: string
  admission_json: string
}

export interface IssueReplayDecisionObservationBundleAdmissionInput {
  admission_id: string
  admission_ref: string
  issued_at: string
  authority_id: string
  admission_policy_version: string
  reservation: TrialReservationSnapshot
  request: ReplayExecutionRequest
  wire_manifest: ReplaySourceEventWireManifest
  bundle: ReplaySourceEventDecisionObservationBundle
}

export function issueReplayDecisionObservationBundleAdmission(
  db: Database,
  input: IssueReplayDecisionObservationBundleAdmissionInput,
): ReplayDecisionObservationBundleAdmissionSnapshot {
  assertTrialReservationSnapshot(input.reservation)
  assertReplayExecutionRequest(input.request)
  assertReplaySourceEventWireManifest(input.wire_manifest)
  assertReplaySourceEventDecisionObservationBundle(input.bundle)
  const reservationHash = hashTrialReservationSnapshot(input.reservation)
  const issuedAt = Date.parse(input.issued_at)
  if (!Number.isFinite(issuedAt)
      || issuedAt < Date.parse(input.reservation.issued_at)
      || issuedAt >= Date.parse(input.reservation.expires_at)) {
    throw new Error("decision observation bundle admission must fall inside the Trial Reservation window")
  }
  const trial = db.query(`
    SELECT trial_id, run_id, status FROM rd_trial WHERE trial_id = $trial_id
  `).get({ $trial_id: input.reservation.identity.trial_id }) as {
    trial_id: string
    run_id: string
    status: string
  } | null
  if (!trial || trial.run_id !== input.reservation.run_id || trial.status !== "reserved") {
    throw new Error("decision observation bundle admission requires the authoritative reserved Trial")
  }
  assertRequestReservationIdentity(input.request, input.reservation, reservationHash)
  const orderingAdmission = readReplayCrossSourceOrderingAdmission(db, reservationHash)
  if (issuedAt < Date.parse(orderingAdmission.issued_at)) {
    throw new Error("decision observation bundle admission cannot predate cross-source ordering admission")
  }
  assertWireAuthorityLineage(input.wire_manifest, input.request, input.reservation, orderingAdmission)
  assertReplaySourceEventDecisionScheduleObservationBindingSetLineage(
    input.bundle.binding_set,
    input.request.decision_schedule,
    input.request.decision_schedule_hash,
    input.bundle.projections,
  )
  assertBundleWireIdentity(input.bundle, input.wire_manifest)

  const admission = createReplayDecisionObservationBundleAdmissionSnapshot({
    schema_version: REPLAY_DECISION_OBSERVATION_BUNDLE_ADMISSION_SCHEMA_VERSION,
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
    request_schema_version: input.request.schema_version,
    request_hash: canonicalHash(input.request),
    dataset_manifest_ref: input.request.dataset_manifest_ref,
    dataset_hash: input.request.dataset_hash,
    ordering_admission_ref: orderingAdmission.admission_ref,
    ordering_admission_hash: orderingAdmission.admission_hash,
    wire_manifest_id: input.wire_manifest.wire_manifest_id,
    wire_manifest_hash: input.wire_manifest.manifest_hash,
    wire_policy_version: input.wire_manifest.wire_policy_version,
    decision_schedule_hash: input.request.decision_schedule_hash,
    decision_schedule_entry_count: input.bundle.decision_schedule_entry_count,
    bundle_id: input.bundle.bundle_id,
    bundle_hash: input.bundle.bundle_hash,
    bundle_policy_version: input.bundle.bundle_policy_version,
    binding_set_id: input.bundle.binding_set_id,
    binding_set_hash: input.bundle.binding_set_hash,
    projection_count: input.bundle.projection_count,
    projections_hash: input.bundle.projections_hash,
    observation_values_hashes_hash: input.bundle.observation_values_hashes_hash,
    first_as_of_time: input.bundle.first_as_of_time,
    last_as_of_time: input.bundle.last_as_of_time,
    consumer_capability: "non_economic_decision_observation_audit",
    scope: "pre_integration_non_economic_observation_audit_only",
    parent_lineage_validation: "wire_identity_and_schedule_binding_only",
    projection_derivation_compatibility: "not_certified",
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
      FROM rd_replay_decision_observation_bundle_admission
      WHERE admission_id = $admission_id
        OR admission_ref = $admission_ref
        OR reservation_hash = $reservation_hash
        OR request_hash = $request_hash
        OR ordering_admission_hash = $ordering_admission_hash
        OR wire_manifest_hash = $wire_manifest_hash
        OR bundle_id = $bundle_id
        OR bundle_hash = $bundle_hash
    `).get({
      $admission_id: admission.admission_id,
      $admission_ref: admission.admission_ref,
      $reservation_hash: admission.reservation_hash,
      $request_hash: admission.request_hash,
      $ordering_admission_hash: admission.ordering_admission_hash,
      $wire_manifest_hash: admission.wire_manifest_hash,
      $bundle_id: admission.bundle_id,
      $bundle_hash: admission.bundle_hash,
    }) as AdmissionRow | null
    if (existing) {
      if (existing.admission_hash !== admission.admission_hash) {
        throw new Error("Replay decision observation bundle admission identity already exists with different content")
      }
      return parseAdmissionRow(existing)
    }
    db.query(`
      INSERT INTO rd_replay_decision_observation_bundle_admission(
        admission_id, admission_ref, admission_hash, status, issued_at,
        authority_id, admission_policy_version, trial_id, run_id,
        reservation_ref, reservation_hash, request_hash,
        dataset_manifest_ref, dataset_hash, ordering_admission_ref,
        ordering_admission_hash, wire_manifest_id, wire_manifest_hash,
        decision_schedule_hash, bundle_id, bundle_hash, binding_set_hash,
        projection_count, projections_hash, observation_values_hashes_hash,
        consumer_capability, scope, harness_invocation, economic_authority,
        admission_json
      ) VALUES (
        $admission_id, $admission_ref, $admission_hash, $status, $issued_at,
        $authority_id, $admission_policy_version, $trial_id, $run_id,
        $reservation_ref, $reservation_hash, $request_hash,
        $dataset_manifest_ref, $dataset_hash, $ordering_admission_ref,
        $ordering_admission_hash, $wire_manifest_id, $wire_manifest_hash,
        $decision_schedule_hash, $bundle_id, $bundle_hash, $binding_set_hash,
        $projection_count, $projections_hash, $observation_values_hashes_hash,
        $consumer_capability, $scope, $harness_invocation, $economic_authority,
        $admission_json
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
      $ordering_admission_ref: admission.ordering_admission_ref,
      $ordering_admission_hash: admission.ordering_admission_hash,
      $wire_manifest_id: admission.wire_manifest_id,
      $wire_manifest_hash: admission.wire_manifest_hash,
      $decision_schedule_hash: admission.decision_schedule_hash,
      $bundle_id: admission.bundle_id,
      $bundle_hash: admission.bundle_hash,
      $binding_set_hash: admission.binding_set_hash,
      $projection_count: admission.projection_count,
      $projections_hash: admission.projections_hash,
      $observation_values_hashes_hash: admission.observation_values_hashes_hash,
      $consumer_capability: admission.consumer_capability,
      $scope: admission.scope,
      $harness_invocation: admission.harness_invocation,
      $economic_authority: admission.economic_authority,
      $admission_json: JSON.stringify(admission),
    })
    return structuredClone(admission)
  }).immediate()
}

export function readReplayDecisionObservationBundleAdmission(
  db: Database,
  reservationHash: string,
): ReplayDecisionObservationBundleAdmissionSnapshot {
  const row = db.query(`
    SELECT admission_hash, admission_json
    FROM rd_replay_decision_observation_bundle_admission
    WHERE reservation_hash = $reservation_hash
  `).get({ $reservation_hash: reservationHash }) as AdmissionRow | null
  if (!row) throw new Error("Replay decision observation bundle admission is not registered")
  return parseAdmissionRow(row)
}

function assertRequestReservationIdentity(
  request: ReplayExecutionRequest,
  reservation: TrialReservationSnapshot,
  reservationHash: string,
): void {
  if (request.trial_reservation_ref !== reservation.reservation_ref
      || request.trial_reservation_hash !== reservationHash
      || request.run_id !== reservation.run_id) {
    throw new Error("decision observation bundle request does not bind the Trial Reservation")
  }
  for (const field of [
    "experiment_id", "trial_group_id", "trial_group_hash", "trial_id", "candidate_id",
    "candidate_hash", "identity_hash_policy_version", "experiment_contract_hash",
  ] as const) {
    if (request[field] !== reservation.identity[field]) {
      throw new Error(`decision observation bundle request identity mismatch: ${field}`)
    }
  }
  if (request.idempotency_key !== reservation.bindings.replay_idempotency_key
      || request.dataset_manifest_ref !== reservation.bindings.dataset_manifest_ref
      || request.dataset_hash !== reservation.bindings.dataset_hash
      || request.instrument_status_schedule_hash !== reservation.bindings.instrument_status_schedule_hash
      || request.instrument_status_provenance_hash !== reservation.bindings.instrument_status_provenance_hash) {
    throw new Error("decision observation bundle request data bindings do not match the Trial Reservation")
  }
}

function assertWireAuthorityLineage(
  wire: ReplaySourceEventWireManifest,
  request: ReplayExecutionRequest,
  reservation: TrialReservationSnapshot,
  orderingAdmission: ReturnType<typeof readReplayCrossSourceOrderingAdmission>,
): void {
  if (wire.ordering_admission_ref !== orderingAdmission.admission_ref
      || wire.ordering_admission_hash !== orderingAdmission.admission_hash
      || wire.ordering_attestation_id !== orderingAdmission.ordering_attestation_id
      || wire.ordering_attestation_hash !== orderingAdmission.ordering_attestation_hash
      || wire.reservation_ref !== reservation.reservation_ref
      || wire.reservation_hash !== hashTrialReservationSnapshot(reservation)
      || wire.dataset_manifest_ref !== request.dataset_manifest_ref
      || wire.dataset_hash !== request.dataset_hash
      || wire.symbol !== request.symbol
      || wire.timeframe !== request.timeframe) {
    throw new Error("decision observation bundle Wire does not bind Request/Reservation authority")
  }
}

function assertBundleWireIdentity(
  bundle: ReplaySourceEventDecisionObservationBundle,
  wire: ReplaySourceEventWireManifest,
): void {
  for (const projection of bundle.projections) {
    if (projection.wire_manifest_id !== wire.wire_manifest_id
        || projection.wire_manifest_hash !== wire.manifest_hash
        || Date.parse(projection.as_of_time) < Date.parse(wire.window_start_inclusive)
        || Date.parse(projection.as_of_time) >= Date.parse(wire.window_end_exclusive)) {
      throw new Error("decision observation bundle projection does not bind one admitted Wire window")
    }
  }
}

function parseAdmissionRow(row: AdmissionRow): ReplayDecisionObservationBundleAdmissionSnapshot {
  const admission = JSON.parse(row.admission_json) as ReplayDecisionObservationBundleAdmissionSnapshot
  assertReplayDecisionObservationBundleAdmissionSnapshot(admission)
  if (admission.admission_hash !== row.admission_hash) {
    throw new Error("Replay decision observation bundle admission registry row is inconsistent")
  }
  return admission
}
