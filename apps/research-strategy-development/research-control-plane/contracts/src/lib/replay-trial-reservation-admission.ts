import { canonicalNfcJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import {
  assertTrialReservationSnapshot,
  canonicalControlPlaneHash,
  hashTrialReservationSnapshot,
  type TrialReservationSnapshot,
} from "./control-plane-contracts"
import { digest, isRecord, required, utc } from "./developer-contract-draft"

export const REPLAY_TRIAL_RESERVATION_ADMISSION_REQUEST_SCHEMA_VERSION =
  "trade.rd-replay-trial-reservation-admission-request.v1" as const
export const REPLAY_TRIAL_RESERVATION_ADMISSION_RECORD_SCHEMA_VERSION =
  "trade.rd-replay-trial-reservation-admission-record.v1" as const
export const REPLAY_TRIAL_RESERVATION_ADMISSION_POLICY_VERSION =
  "rd-replay-trial-reservation-admission-v1" as const

export type ReplayPreReservationExecutionSpec = object

export interface ReplayTrialReservationAdmissionRequest {
  schema_version: typeof REPLAY_TRIAL_RESERVATION_ADMISSION_REQUEST_SCHEMA_VERSION
  admission_id: string
  plan_id: string
  plan_hash: string
  trial_id: string
  reservation_id: string
  reservation_ref: string
  execution_spec: ReplayPreReservationExecutionSpec
  dataset_manifest: object
  idempotency_key: string
  issued_at: string
  expires_at: string
}

export interface ReplayTrialReservationAdmissionRecordBody {
  schema_version: typeof REPLAY_TRIAL_RESERVATION_ADMISSION_RECORD_SCHEMA_VERSION
  admission_id: string
  status: "admitted"
  plan_id: string
  plan_hash: string
  trial_id: string
  reservation_id: string
  reservation_ref: string
  reservation_hash: string
  execution_spec_hash: string
  dataset_manifest_ref: string
  dataset_hash: string
  dataset_manifest_hash: string
  provider_certification_hash: string
  reservation_snapshot: TrialReservationSnapshot
  admission_policy_version: typeof REPLAY_TRIAL_RESERVATION_ADMISSION_POLICY_VERSION
  authority_scope: "immutable_replay_trial_reservation_only"
  replay_request_authority: "none_until_exact_reservation_binding"
  replay_attempt_authority: "none"
  admitted_at: string
}

export interface ReplayTrialReservationAdmissionRecord
  extends ReplayTrialReservationAdmissionRecordBody {
  admission_hash: string
}

const PRE_RESERVATION_SPEC_KEYS = [
  "schema_version", "run_id", "idempotency_key", "experiment_id", "trial_group_id",
  "trial_group_hash", "trial_id", "candidate_id", "candidate_hash",
  "identity_hash_policy_version", "experiment_contract_hash", "dataset_manifest_ref",
  "dataset_hash", "supplemental_facts_hash", "supplemental_requirement_set",
  "supplemental_requirement_set_hash", "decision_market_input_requirement",
  "decision_market_input_requirement_hash", "decision_schedule", "decision_schedule_hash",
  "venue_risk_policy_schedule_hash", "instrument_spec_schedule_hash",
  "instrument_status_schedule_hash", "instrument_status_provenance_hash",
  "instrument_status_provider_capability_hash",
  "instrument_status_provider_certification_hash", "harness_hash", "assumptions_hash",
  "strategy_policy_hash", "symbol", "timeframe", "initial_cash", "order", "cost_policy",
  "simulator_policy", "margin_policy", "random_seed",
] as const

export function assertReplayTrialReservationAdmissionRequest(
  value: ReplayTrialReservationAdmissionRequest,
): void {
  if (!isRecord(value)) throw new Error("Replay Trial Reservation Admission request must be an object")
  if (value.schema_version !== REPLAY_TRIAL_RESERVATION_ADMISSION_REQUEST_SCHEMA_VERSION) {
    throw new Error("unsupported Replay Trial Reservation Admission request")
  }
  for (const [field, item] of Object.entries({
    admission_id: value.admission_id,
    plan_id: value.plan_id,
    trial_id: value.trial_id,
    reservation_id: value.reservation_id,
    reservation_ref: value.reservation_ref,
    idempotency_key: value.idempotency_key,
  })) required(item, field)
  digest(value.plan_hash, "plan_hash")
  const issuedAt = utc(value.issued_at, "issued_at")
  const expiresAt = utc(value.expires_at, "expires_at")
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    throw new Error("Replay Trial Reservation must expire after issuance")
  }
  if (!isRecord(value.dataset_manifest)) throw new Error("Replay Dataset Manifest must be an object")
  assertPreReservationExecutionSpec(value.execution_spec)
  const expectedKeys = [
    "admission_id", "dataset_manifest", "execution_spec", "expires_at", "idempotency_key",
    "issued_at", "plan_hash", "plan_id", "reservation_id",
    "reservation_ref", "schema_version", "trial_id",
  ]
  if (canonicalNfcJson(Object.keys(value).sort()) !== canonicalNfcJson(expectedKeys)) {
    throw new Error("Replay Trial Reservation Admission request carries unsupported fields")
  }
}

export function assertPreReservationExecutionSpec(value: ReplayPreReservationExecutionSpec): void {
  if (!isRecord(value)) throw new Error("Replay pre-reservation execution spec must be an object")
  if ("trial_reservation_ref" in value || "trial_reservation_hash" in value) {
    throw new Error("Replay pre-reservation execution spec cannot self-authorize a Reservation")
  }
  const allowed = new Set<string>(PRE_RESERVATION_SPEC_KEYS)
  const actualKeys = Object.keys(value)
  if (actualKeys.some((key) => !allowed.has(key))
      || PRE_RESERVATION_SPEC_KEYS.some((key) => key !== "strategy_policy_hash" && !(key in value))) {
    throw new Error("Replay pre-reservation execution spec carries unsupported or missing fields")
  }
}

export function createReplayTrialReservationAdmissionRecord(
  input: Omit<ReplayTrialReservationAdmissionRecordBody, "status" | "admission_policy_version" |
    "authority_scope" | "replay_request_authority" | "replay_attempt_authority">,
): ReplayTrialReservationAdmissionRecord {
  assertTrialReservationSnapshot(input.reservation_snapshot)
  const reservationHash = hashTrialReservationSnapshot(input.reservation_snapshot)
  if (reservationHash !== input.reservation_hash) {
    throw new Error("Replay Trial Reservation Admission reservation hash drifted")
  }
  const body: ReplayTrialReservationAdmissionRecordBody = {
    schema_version: REPLAY_TRIAL_RESERVATION_ADMISSION_RECORD_SCHEMA_VERSION,
    admission_id: required(input.admission_id, "admission_id"),
    status: "admitted",
    plan_id: required(input.plan_id, "plan_id"),
    plan_hash: digest(input.plan_hash, "plan_hash"),
    trial_id: required(input.trial_id, "trial_id"),
    reservation_id: required(input.reservation_id, "reservation_id"),
    reservation_ref: required(input.reservation_ref, "reservation_ref"),
    reservation_hash: digest(input.reservation_hash, "reservation_hash"),
    execution_spec_hash: digest(input.execution_spec_hash, "execution_spec_hash"),
    dataset_manifest_ref: required(input.dataset_manifest_ref, "dataset_manifest_ref"),
    dataset_hash: digest(input.dataset_hash, "dataset_hash"),
    dataset_manifest_hash: digest(input.dataset_manifest_hash, "dataset_manifest_hash"),
    provider_certification_hash: digest(input.provider_certification_hash, "provider_certification_hash"),
    reservation_snapshot: structuredClone(input.reservation_snapshot),
    admission_policy_version: REPLAY_TRIAL_RESERVATION_ADMISSION_POLICY_VERSION,
    authority_scope: "immutable_replay_trial_reservation_only",
    replay_request_authority: "none_until_exact_reservation_binding",
    replay_attempt_authority: "none",
    admitted_at: utc(input.admitted_at, "admitted_at"),
  }
  return { ...body, admission_hash: canonicalControlPlaneHash(body) }
}

export function assertReplayTrialReservationAdmissionRecord(
  value: ReplayTrialReservationAdmissionRecord,
): void {
  if (!isRecord(value)) throw new Error("Replay Trial Reservation Admission Record must be an object")
  const { admission_hash: _hash, status: _status, admission_policy_version: _policy,
    authority_scope: _scope, replay_request_authority: _requestAuthority,
    replay_attempt_authority: _attemptAuthority, ...input } = value
  const expected = createReplayTrialReservationAdmissionRecord(input)
  if (canonicalNfcJson(value) !== canonicalNfcJson(expected)) {
    throw new Error("Replay Trial Reservation Admission Record is non-canonical or hash-drifted")
  }
}
