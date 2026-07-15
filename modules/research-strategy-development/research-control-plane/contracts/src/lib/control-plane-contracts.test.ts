import { expect, test } from "bun:test"
import {
  CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
  REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
  REPLAY_CHECKPOINT_RECEIPT_SCHEMA_VERSION,
  REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION,
  REPLAY_RESUME_AUTHORIZATION_SCHEMA_VERSION,
  DRAFT_AUTHORIZATION_SCHEMA_VERSION,
  TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION,
  assertDraftStrategyAuthorization,
  assertTrialReservationSnapshot,
  createReplayCheckpointReceiptSnapshot,
  createReplayResumeAuthorizationSnapshot,
  hashReplayResumeAuthorizationSnapshot,
  hashTrialReservationSnapshot,
  hashReplayAttemptLeaseSnapshot,
  hashReplayCheckpointReceiptSnapshot,
  type DraftStrategyAuthorization,
  type TrialReservationSnapshot,
} from "./control-plane-contracts"

const HASH = "a".repeat(64)

function authorization(): DraftStrategyAuthorization {
  return {
    schema_version: DRAFT_AUTHORIZATION_SCHEMA_VERSION,
    decision: "accept_for_draft",
    decision_id: "decision-1",
    reviewer_run_id: "reviewer-1",
    primary_result_id: "result-1",
    primary_result_hash: HASH,
    selected_trial_id: "trial-1",
    selected_candidate_id: "candidate-1",
    candidate_frozen_at: "2026-07-14T08:00:00Z",
    identity: {
      schema_version: CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
      experiment_id: "experiment-1",
      trial_group_id: "group-1",
      trial_group_hash: HASH,
      trial_id: "trial-1",
      candidate_id: "candidate-1",
      candidate_hash: HASH,
      identity_hash_policy_version: "rd-identity-v1",
      experiment_contract_hash: HASH,
    },
  }
}

function reservation(): TrialReservationSnapshot {
  return {
    schema_version: TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION,
    reservation_id: "reservation-1", reservation_ref: "reservation://trial-1", issued_at: "2026-07-14T00:00:00Z", expires_at: "2026-07-15T00:00:00Z", status: "reserved",
    identity: authorization().identity, trial_ordinal: 1, run_id: "run-1", counts_against_budget: true,
    trial_accounting_policy_version: "count-all-v1", candidate_assignment_hash: HASH,
    bindings: {
      replay_idempotency_key: "replay-1", execution_spec_hash: HASH, dataset_manifest_ref: "dataset://fixture", dataset_hash: HASH,
      venue_risk_policy_schedule_hash: HASH, instrument_spec_schedule_hash: HASH, harness_hash: HASH, assumptions_hash: HASH,
      cost_policy_hash: HASH, margin_policy_hash: HASH, simulator_policy_version: "rd-replay-simulator-v7", execution_mode: "step",
    },
    required_capabilities: ["closed-candle", "step"],
  }
}

test("draft authorization binds the selected Trial and Candidate", () => {
  expect(() => assertDraftStrategyAuthorization(authorization())).not.toThrow()
  expect(() => assertDraftStrategyAuthorization({ ...authorization(), selected_trial_id: "trial-2" })).toThrow()
})

test("draft authorization requires accept_for_draft and content hashes", () => {
  const value = authorization()
  expect(() => assertDraftStrategyAuthorization({ ...value, primary_result_hash: "weak" })).toThrow()
})

test("Trial Reservation snapshot is immutable-hashable and capability order is canonical", () => {
  const value = reservation()
  expect(() => assertTrialReservationSnapshot(value)).not.toThrow()
  expect(hashTrialReservationSnapshot(value)).toHaveLength(64)
  expect(hashTrialReservationSnapshot(structuredClone(value))).toBe(hashTrialReservationSnapshot(value))
  expect(() => assertTrialReservationSnapshot({ ...value, required_capabilities: ["step", "closed-candle"] })).toThrow("unique and sorted")
  expect(() => assertTrialReservationSnapshot({ ...value, expires_at: value.issued_at })).toThrow("issued_at < expires_at")
})

test("Replay Attempt Lease snapshot carries a monotonic fencing generation", () => {
  const lease = {
    schema_version: REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
    attempt_id: "attempt-1", attempt_ordinal: 1, worker_id: "worker-1",
    trial_id: "trial-1", run_id: "run-1", reservation_ref: "reservation://trial-1",
    reservation_hash: HASH, request_hash: "b".repeat(64), status: "running" as const,
    lease_generation: 2, claimed_at: "2026-07-15T00:00:00Z",
    heartbeat_at: "2026-07-15T00:01:00Z", lease_expires_at: "2026-07-15T00:06:00Z",
  }
  expect(hashReplayAttemptLeaseSnapshot(lease)).toHaveLength(64)
  expect(() => hashReplayAttemptLeaseSnapshot({ ...lease, lease_expires_at: lease.heartbeat_at })).toThrow(/timestamps/)
})

test("Replay Resume Authorization binds a later target Attempt and detects mutation", () => {
  const value = createReplayResumeAuthorizationSnapshot({
    schema_version: REPLAY_RESUME_AUTHORIZATION_SCHEMA_VERSION,
    authorization_id: "resume-1", authorization_ref: "resume://attempt-2", issued_at: "2026-07-15T00:02:00Z", status: "authorized",
    trial_id: "trial-1", run_id: "run-1", request_hash: "b".repeat(64),
    reservation_ref: "reservation://trial-1", reservation_hash: HASH,
    source_attempt_id: "attempt-1", source_attempt_ordinal: 1, source_attempt_status: "cancelled",
    diagnostic_checkpoint_ref: "artifact://attempt-1/diagnostic-checkpoint-commit-2-2-ffffffffffffffff.json",
    diagnostic_checkpoint_hash: "c".repeat(64),
    target_attempt_id: "attempt-2", target_attempt_ordinal: 2, target_worker_id: "worker-2",
    target_claimed_at: "2026-07-15T00:01:00Z", target_lease_generation_floor: 1,
    target_attempt_lease_hash: "d".repeat(64),
  })
  expect(hashReplayResumeAuthorizationSnapshot(value)).toBe(value.authorization_hash)
  expect(() => hashReplayResumeAuthorizationSnapshot({ ...value, target_worker_id: "worker-3" })).toThrow("hash mismatch")
  const { authorization_hash: _, ...body } = value
  expect(() => createReplayResumeAuthorizationSnapshot({ ...body, target_attempt_ordinal: 1 })).toThrow("later Attempt")
})

test("Replay Checkpoint Receipt binds fenced producer authority and monotonic progress", () => {
  const receipt = createReplayCheckpointReceiptSnapshot({
    schema_version: REPLAY_CHECKPOINT_RECEIPT_SCHEMA_VERSION,
    receipt_id: "receipt-1", receipt_ref: "receipt://attempt-1/2", recorded_at: "2026-07-15T00:02:00Z", status: "recorded",
    trial_id: "trial-1", run_id: "run-1", request_hash: "b".repeat(64),
    reservation_ref: "reservation://trial-1", reservation_hash: HASH,
    attempt_id: "attempt-1", attempt_ordinal: 1, worker_id: "worker-1", lease_generation: 2,
    attempt_lease_hash: "c".repeat(64),
    diagnostic_checkpoint_ref: "artifact://attempt-1/diagnostic-checkpoint-commit-2-2-ffffffffffffffff.json",
    diagnostic_checkpoint_hash: "d".repeat(64),
    engine_checkpoint_ref: "artifact://attempt-1/diagnostic-checkpoint-2-2-ffffffffffffffff.json",
    engine_checkpoint_payload_hash: "e".repeat(64), engine_checkpoint_hash: "f".repeat(64),
    storage_policy_version: REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION,
    next_source_offset: 2,
  })
  expect(hashReplayCheckpointReceiptSnapshot(receipt)).toBe(receipt.receipt_hash)
  expect(() => hashReplayCheckpointReceiptSnapshot({ ...receipt, next_source_offset: 3 })).toThrow("hash mismatch")
  const { receipt_hash: _, ...body } = receipt
  expect(() => createReplayCheckpointReceiptSnapshot({
    ...body,
    storage_policy_version: "unsupported-storage-policy" as typeof REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION,
  })).toThrow("storage policy is not supported")
})
