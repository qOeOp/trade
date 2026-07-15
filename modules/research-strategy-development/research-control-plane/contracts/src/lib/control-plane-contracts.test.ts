import { expect, test } from "bun:test"
import {
  CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
  REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
  DRAFT_AUTHORIZATION_SCHEMA_VERSION,
  TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION,
  assertDraftStrategyAuthorization,
  assertTrialReservationSnapshot,
  hashTrialReservationSnapshot,
  hashReplayAttemptLeaseSnapshot,
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
    reservation_id: "reservation-1", reservation_ref: "reservation://trial-1", issued_at: "2026-07-14T00:00:00Z", status: "reserved",
    identity: authorization().identity, trial_ordinal: 1, run_id: "run-1", counts_against_budget: true,
    trial_accounting_policy_version: "count-all-v1", candidate_assignment_hash: HASH,
    bindings: {
      replay_idempotency_key: "replay-1", execution_spec_hash: HASH, dataset_manifest_ref: "dataset://fixture", dataset_hash: HASH,
      venue_risk_policy_snapshot_hash: HASH, instrument_spec_snapshot_hash: HASH, harness_hash: HASH, assumptions_hash: HASH,
      cost_policy_hash: HASH, margin_policy_hash: HASH, simulator_policy_version: "rd-replay-simulator-v6", execution_mode: "step",
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
