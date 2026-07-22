import { canonicalNfcJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import { digest, isRecord, required, utc } from "./developer-contract-draft"

export const REPLAY_ATTEMPT_ADMISSION_REQUEST_SCHEMA_VERSION =
  "trade.rd-replay-attempt-admission-request.v2" as const

export interface ReplayAttemptAdmissionRequest {
  schema_version: typeof REPLAY_ATTEMPT_ADMISSION_REQUEST_SCHEMA_VERSION
  attempt_id: string
  worker_id: string
  idempotency_key: string
  request_registration_id: string
  request_registration_hash: string
  claimed_at: string
  lease_expires_at: string
}

export function assertReplayAttemptAdmissionRequest(
  value: ReplayAttemptAdmissionRequest,
): void {
  if (!isRecord(value)) throw new Error("Replay Attempt Admission request must be an object")
  if (value.schema_version !== REPLAY_ATTEMPT_ADMISSION_REQUEST_SCHEMA_VERSION) {
    throw new Error("unsupported Replay Attempt Admission request")
  }
  required(value.attempt_id, "attempt_id")
  required(value.worker_id, "worker_id")
  required(value.idempotency_key, "idempotency_key")
  required(value.request_registration_id, "request_registration_id")
  digest(value.request_registration_hash, "request_registration_hash")
  utc(value.claimed_at, "claimed_at")
  utc(value.lease_expires_at, "lease_expires_at")
  if (Date.parse(value.lease_expires_at) <= Date.parse(value.claimed_at)) {
    throw new Error("Replay Attempt lease must expire after claim")
  }
  const expectedKeys = [
    "attempt_id", "claimed_at", "idempotency_key", "lease_expires_at",
    "request_registration_hash", "request_registration_id", "schema_version", "worker_id",
  ]
  if (canonicalNfcJson(Object.keys(value).sort()) !== canonicalNfcJson(expectedKeys)) {
    throw new Error("Replay Attempt Admission request carries unsupported fields")
  }
}
