import { canonicalNfcJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import { canonicalControlPlaneHash } from "./control-plane-contracts"
import { digest, isRecord, required, utc } from "./developer-contract-draft"

export const REPLAY_REQUEST_REGISTRATION_REQUEST_SCHEMA_VERSION =
  "trade.rd-replay-request-registration-request.v1" as const
export const REPLAY_REQUEST_REGISTRATION_RECORD_SCHEMA_VERSION =
  "trade.rd-replay-request-registration-record.v1" as const
export const REPLAY_REQUEST_REGISTRATION_POLICY_VERSION =
  "rd-replay-request-registration-v1" as const

export interface ReplayRequestRegistrationRequest {
  schema_version: typeof REPLAY_REQUEST_REGISTRATION_REQUEST_SCHEMA_VERSION
  registration_id: string
  reservation_admission_id: string
  reservation_admission_hash: string
  idempotency_key: string
  registered_at: string
}

export interface ReplayRequestRegistrationRecordBody {
  schema_version: typeof REPLAY_REQUEST_REGISTRATION_RECORD_SCHEMA_VERSION
  registration_id: string
  status: "registered"
  reservation_admission_id: string
  reservation_admission_hash: string
  trial_id: string
  run_id: string
  reservation_ref: string
  reservation_hash: string
  execution_spec_hash: string
  request_idempotency_key: string
  request_hash: string
  replay_request: object
  dataset_manifest_hash: string
  registration_policy_version: typeof REPLAY_REQUEST_REGISTRATION_POLICY_VERSION
  authority_scope: "immutable_replay_request"
  assembly_policy: "exact_admitted_spec_plus_admitted_reservation_only"
  replay_attempt_authority: "none_until_attempt_admission"
  registered_at: string
}

export interface ReplayRequestRegistrationRecord extends ReplayRequestRegistrationRecordBody {
  registration_hash: string
}

export function assertReplayRequestRegistrationRequest(
  value: ReplayRequestRegistrationRequest,
): void {
  if (!isRecord(value)) throw new Error("Replay Request Registration request must be an object")
  if (value.schema_version !== REPLAY_REQUEST_REGISTRATION_REQUEST_SCHEMA_VERSION) {
    throw new Error("unsupported Replay Request Registration request")
  }
  required(value.registration_id, "registration_id")
  required(value.reservation_admission_id, "reservation_admission_id")
  digest(value.reservation_admission_hash, "reservation_admission_hash")
  required(value.idempotency_key, "idempotency_key")
  utc(value.registered_at, "registered_at")
  const expectedKeys = [
    "idempotency_key", "registered_at", "registration_id", "reservation_admission_hash",
    "reservation_admission_id", "schema_version",
  ]
  if (canonicalNfcJson(Object.keys(value).sort()) !== canonicalNfcJson(expectedKeys)) {
    throw new Error("Replay Request Registration request carries unsupported fields")
  }
}

export function createReplayRequestRegistrationRecord(
  input: Omit<ReplayRequestRegistrationRecordBody, "status" | "registration_policy_version" |
    "authority_scope" | "assembly_policy" | "replay_attempt_authority">,
): ReplayRequestRegistrationRecord {
  if (!isRecord(input.replay_request)) throw new Error("registered Replay Request must be an object")
  const body: ReplayRequestRegistrationRecordBody = {
    schema_version: REPLAY_REQUEST_REGISTRATION_RECORD_SCHEMA_VERSION,
    registration_id: required(input.registration_id, "registration_id"),
    status: "registered",
    reservation_admission_id: required(input.reservation_admission_id, "reservation_admission_id"),
    reservation_admission_hash: digest(input.reservation_admission_hash, "reservation_admission_hash"),
    trial_id: required(input.trial_id, "trial_id"),
    run_id: required(input.run_id, "run_id"),
    reservation_ref: required(input.reservation_ref, "reservation_ref"),
    reservation_hash: digest(input.reservation_hash, "reservation_hash"),
    execution_spec_hash: digest(input.execution_spec_hash, "execution_spec_hash"),
    request_idempotency_key: required(input.request_idempotency_key, "request_idempotency_key"),
    request_hash: digest(input.request_hash, "request_hash"),
    replay_request: structuredClone(input.replay_request),
    dataset_manifest_hash: digest(input.dataset_manifest_hash, "dataset_manifest_hash"),
    registration_policy_version: REPLAY_REQUEST_REGISTRATION_POLICY_VERSION,
    authority_scope: "immutable_replay_request",
    assembly_policy: "exact_admitted_spec_plus_admitted_reservation_only",
    replay_attempt_authority: "none_until_attempt_admission",
    registered_at: utc(input.registered_at, "registered_at"),
  }
  return { ...body, registration_hash: canonicalControlPlaneHash(body) }
}

export function assertReplayRequestRegistrationRecord(
  value: ReplayRequestRegistrationRecord,
): void {
  if (!isRecord(value)) throw new Error("Replay Request Registration Record must be an object")
  const { registration_hash: _hash, status: _status, registration_policy_version: _policy,
    authority_scope: _scope, assembly_policy: _assembly,
    replay_attempt_authority: _attempt, ...input } = value
  const expected = createReplayRequestRegistrationRecord(input)
  if (canonicalNfcJson(value) !== canonicalNfcJson(expected)) {
    throw new Error("Replay Request Registration Record is non-canonical or hash-drifted")
  }
}
