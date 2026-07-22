import type { Database } from "bun:sqlite"
import {
  REPLAY_REQUEST_SCHEMA_VERSION,
  assertReplayDatasetManifest,
  assertReplayExecutionRequest,
  canonicalHash,
  replayDatasetManifestHash,
  replayExecutionSpecHash,
  type ReplayDatasetManifest,
  type ReplayExecutionRequest,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"
import {
  REPLAY_REQUEST_REGISTRATION_RECORD_SCHEMA_VERSION,
  assertReplayRequestRegistrationRecord,
  assertReplayRequestRegistrationRequest,
  createReplayRequestRegistrationRecord,
  type ReplayRequestRegistrationRecord,
  type ReplayRequestRegistrationRequest,
} from "../../../contracts/src/lib/replay-request-registration"
import {
  assertReplayTrialReservationAdmissionRecord,
  type ReplayTrialReservationAdmissionRecord,
} from "../../../contracts/src/lib/replay-trial-reservation-admission"
import {
  assertTrialReservationSnapshot,
  canonicalControlPlaneHash,
  hashTrialReservationSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"
import { assertReplayReservationClaimNotCancelled } from "./replay-cancellation-authority"

interface SourceRow {
  admission_hash: string
  admission_json: string
  execution_spec_hash: string
  execution_spec_json: string
  dataset_manifest_hash: string
  dataset_manifest_json: string
  reservation_hash: string
  reservation_snapshot_json: string
  issued_at: string
  expires_at: string
  trial_status: string
  group_status: string
  lifecycle_state: string
}

interface RegistrationRow {
  registration_request_hash: string
  registration_json: string
}

export function registerReplayExecutionRequest(
  db: Database,
  request: ReplayRequestRegistrationRequest,
): ReplayRequestRegistrationRecord {
  assertReplayRequestRegistrationRequest(request)
  const register = db.transaction(() => {
    const registrationRequestHash = canonicalControlPlaneHash(request)
    const replay = db.query(`
      SELECT registration_request_hash, registration_json
      FROM rd_replay_request_registration WHERE idempotency_key=$idempotency_key
    `).get({ $idempotency_key: request.idempotency_key }) as RegistrationRow | null
    if (replay) {
      if (replay.registration_request_hash !== registrationRequestHash) {
        throw new Error("Replay Request Registration idempotency key already exists with different content")
      }
      return parseRegistrationRecord(replay.registration_json)
    }

    const source = readSource(db, request.reservation_admission_id)
    const admission = parseAdmissionRecord(source.admission_json)
    assertSourceBindings(request, admission, source)
    assertRegistrationTime(request.registered_at, admission)
    assertReplayReservationClaimNotCancelled(db, admission.reservation_hash, request.registered_at)

    const spec = JSON.parse(source.execution_spec_json) as Omit<
      ReplayExecutionRequest,
      "trial_reservation_ref" | "trial_reservation_hash"
    >
    const replayRequest: ReplayExecutionRequest = {
      ...spec,
      schema_version: REPLAY_REQUEST_SCHEMA_VERSION,
      trial_reservation_ref: admission.reservation_ref,
      trial_reservation_hash: admission.reservation_hash,
    }
    assertReplayExecutionRequest(replayRequest)
    const manifest = JSON.parse(source.dataset_manifest_json) as ReplayDatasetManifest
    assertReplayDatasetManifest(manifest)
    assertAssembledRequest(replayRequest, manifest, admission, source)
    const requestHash = canonicalHash(replayRequest)
    const record = createReplayRequestRegistrationRecord({
      schema_version: REPLAY_REQUEST_REGISTRATION_RECORD_SCHEMA_VERSION,
      registration_id: request.registration_id,
      reservation_admission_id: admission.admission_id,
      reservation_admission_hash: admission.admission_hash,
      trial_id: admission.trial_id,
      run_id: admission.reservation_snapshot.run_id,
      reservation_ref: admission.reservation_ref,
      reservation_hash: admission.reservation_hash,
      execution_spec_hash: admission.execution_spec_hash,
      request_idempotency_key: replayRequest.idempotency_key,
      request_hash: requestHash,
      replay_request: replayRequest,
      dataset_manifest_hash: admission.dataset_manifest_hash,
      registered_at: request.registered_at,
    })
    db.query(`
      INSERT INTO rd_replay_request_registration(
        registration_id, reservation_admission_id, idempotency_key,
        registration_request_hash, trial_id, run_id, reservation_ref, reservation_hash,
        execution_spec_hash, request_idempotency_key, request_hash, replay_request_json,
        dataset_manifest_hash, registration_hash, registration_json, registered_at
      ) VALUES (
        $registration_id, $reservation_admission_id, $idempotency_key,
        $registration_request_hash, $trial_id, $run_id, $reservation_ref, $reservation_hash,
        $execution_spec_hash, $request_idempotency_key, $request_hash, $replay_request_json,
        $dataset_manifest_hash, $registration_hash, $registration_json, $registered_at
      )
    `).run({
      $registration_id: record.registration_id,
      $reservation_admission_id: record.reservation_admission_id,
      $idempotency_key: request.idempotency_key,
      $registration_request_hash: registrationRequestHash,
      $trial_id: record.trial_id,
      $run_id: record.run_id,
      $reservation_ref: record.reservation_ref,
      $reservation_hash: record.reservation_hash,
      $execution_spec_hash: record.execution_spec_hash,
      $request_idempotency_key: record.request_idempotency_key,
      $request_hash: record.request_hash,
      $replay_request_json: JSON.stringify(replayRequest),
      $dataset_manifest_hash: record.dataset_manifest_hash,
      $registration_hash: record.registration_hash,
      $registration_json: JSON.stringify(record),
      $registered_at: record.registered_at,
    })
    return record
  })
  return register.immediate()
}

export function readReplayRequestRegistration(
  db: Database,
  registrationId: string,
): ReplayRequestRegistrationRecord {
  if (!registrationId.trim()) throw new Error("registration_id is required")
  const row = db.query(`
    SELECT registration_json FROM rd_replay_request_registration WHERE registration_id=$registration_id
  `).get({ $registration_id: registrationId }) as { registration_json: string } | null
  if (!row) throw new Error("Replay Request Registration Record is missing")
  return parseRegistrationRecord(row.registration_json)
}

export function readRegisteredReplayExecutionRequest(
  db: Database,
  registrationId: string,
): ReplayExecutionRequest {
  const record = readReplayRequestRegistration(db, registrationId)
  const value = structuredClone(record.replay_request) as ReplayExecutionRequest
  assertReplayExecutionRequest(value)
  if (canonicalHash(value) !== record.request_hash) {
    throw new Error("registered Replay Request hash drifted")
  }
  return value
}

function readSource(db: Database, admissionId: string): SourceRow {
  const row = db.query(`
    SELECT a.admission_hash, a.admission_json, a.execution_spec_hash, a.execution_spec_json,
           a.dataset_manifest_hash, a.dataset_manifest_json, a.reservation_hash,
           a.reservation_snapshot_json, a.issued_at, a.expires_at,
           t.status AS trial_status, g.status AS group_status, e.lifecycle_state
    FROM rd_replay_trial_reservation_admission a
    JOIN rd_trial t ON t.trial_id=a.trial_id
    JOIN rd_trial_group g ON g.trial_group_id=t.trial_group_id
    JOIN rd_experiment_contract e ON e.experiment_id=t.experiment_id
    WHERE a.admission_id=$admission_id
  `).get({ $admission_id: admissionId }) as SourceRow | null
  if (!row) throw new Error("Replay Request Registration requires an authoritative Reservation Admission")
  return row
}

function assertSourceBindings(
  request: ReplayRequestRegistrationRequest,
  admission: ReplayTrialReservationAdmissionRecord,
  source: SourceRow,
): void {
  if (request.reservation_admission_hash !== admission.admission_hash
      || source.admission_hash !== admission.admission_hash
      || source.execution_spec_hash !== admission.execution_spec_hash
      || source.dataset_manifest_hash !== admission.dataset_manifest_hash
      || source.reservation_hash !== admission.reservation_hash
      || source.issued_at !== admission.reservation_snapshot.issued_at
      || source.expires_at !== admission.reservation_snapshot.expires_at) {
    throw new Error("Replay Request Registration source drifted from Reservation Admission")
  }
  if (source.trial_status !== "reserved" || source.group_status !== "running"
      || source.lifecycle_state !== "discovery") {
    throw new Error("Replay Request Registration requires an active reserved Trial")
  }
  const snapshot = JSON.parse(source.reservation_snapshot_json)
  assertTrialReservationSnapshot(snapshot)
  if (hashTrialReservationSnapshot(snapshot) !== admission.reservation_hash
      || canonicalControlPlaneHash(snapshot) !== canonicalControlPlaneHash(admission.reservation_snapshot)) {
    throw new Error("Replay Request Registration Reservation Snapshot drifted")
  }
}

function assertRegistrationTime(
  registeredAt: string,
  admission: ReplayTrialReservationAdmissionRecord,
): void {
  const time = Date.parse(registeredAt)
  if (time < Date.parse(admission.admitted_at)
      || time < Date.parse(admission.reservation_snapshot.issued_at)
      || time >= Date.parse(admission.reservation_snapshot.expires_at)) {
    throw new Error("Replay Request Registration must occur inside the admitted Reservation window")
  }
}

function assertAssembledRequest(
  request: ReplayExecutionRequest,
  manifest: ReplayDatasetManifest,
  admission: ReplayTrialReservationAdmissionRecord,
  source: SourceRow,
): void {
  const snapshot = admission.reservation_snapshot
  const bindings = snapshot.bindings
  if (replayExecutionSpecHash(request) !== admission.execution_spec_hash
      || replayExecutionSpecHash(request) !== source.execution_spec_hash
      || replayDatasetManifestHash(manifest) !== admission.dataset_manifest_hash
      || request.trial_reservation_ref !== admission.reservation_ref
      || request.trial_reservation_hash !== admission.reservation_hash
      || request.run_id !== snapshot.run_id
      || request.experiment_id !== snapshot.identity.experiment_id
      || request.trial_group_id !== snapshot.identity.trial_group_id
      || request.trial_group_hash !== snapshot.identity.trial_group_hash
      || request.trial_id !== snapshot.identity.trial_id
      || request.candidate_id !== snapshot.identity.candidate_id
      || request.candidate_hash !== snapshot.identity.candidate_hash
      || request.identity_hash_policy_version !== snapshot.identity.identity_hash_policy_version
      || request.experiment_contract_hash !== snapshot.identity.experiment_contract_hash
      || request.idempotency_key !== bindings.replay_idempotency_key
      || request.dataset_manifest_ref !== bindings.dataset_manifest_ref
      || request.dataset_hash !== bindings.dataset_hash
      || request.supplemental_facts_hash !== bindings.supplemental_facts_hash
      || request.supplemental_requirement_set_hash !== bindings.supplemental_requirement_set_hash
      || request.venue_risk_policy_schedule_hash !== bindings.venue_risk_policy_schedule_hash
      || request.instrument_spec_schedule_hash !== bindings.instrument_spec_schedule_hash
      || request.instrument_status_schedule_hash !== bindings.instrument_status_schedule_hash
      || request.instrument_status_provenance_hash !== bindings.instrument_status_provenance_hash
      || request.instrument_status_provider_capability_hash
        !== bindings.instrument_status_provider_capability_hash
      || request.instrument_status_provider_certification_hash
        !== bindings.instrument_status_provider_certification_hash
      || request.harness_hash !== bindings.harness_hash
      || request.assumptions_hash !== bindings.assumptions_hash
      || canonicalHash(request.cost_policy) !== bindings.cost_policy_hash
      || canonicalHash(request.margin_policy) !== bindings.margin_policy_hash
      || request.simulator_policy.version !== bindings.simulator_policy_version
      || manifest.manifest_ref !== request.dataset_manifest_ref
      || manifest.data_hash !== request.dataset_hash) {
    throw new Error("assembled Replay Request does not exactly match its admitted authority")
  }
  const liquidityHash = request.order.entry_execution.order_type === "market"
    ? null
    : request.order.entry_execution.liquidity_capacity_attestation_hash
  if (liquidityHash !== bindings.liquidity_capacity_attestation_hash) {
    throw new Error("assembled Replay Request liquidity binding drifted")
  }
}

function parseAdmissionRecord(json: string): ReplayTrialReservationAdmissionRecord {
  const value = JSON.parse(json) as ReplayTrialReservationAdmissionRecord
  assertReplayTrialReservationAdmissionRecord(value)
  return value
}

function parseRegistrationRecord(json: string): ReplayRequestRegistrationRecord {
  const value = JSON.parse(json) as ReplayRequestRegistrationRecord
  assertReplayRequestRegistrationRecord(value)
  const request = structuredClone(value.replay_request) as ReplayExecutionRequest
  assertReplayExecutionRequest(request)
  if (canonicalHash(request) !== value.request_hash) {
    throw new Error("Replay Request Registration Record request hash drifted")
  }
  return value
}
