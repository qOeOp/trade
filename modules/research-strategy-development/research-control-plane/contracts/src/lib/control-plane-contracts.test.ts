import { expect, test } from "bun:test"
import {
  CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
  DRAFT_AUTHORIZATION_SCHEMA_VERSION,
  assertDraftStrategyAuthorization,
  type DraftStrategyAuthorization,
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

test("draft authorization binds the selected Trial and Candidate", () => {
  expect(() => assertDraftStrategyAuthorization(authorization())).not.toThrow()
  expect(() => assertDraftStrategyAuthorization({ ...authorization(), selected_trial_id: "trial-2" })).toThrow()
})

test("draft authorization requires accept_for_draft and content hashes", () => {
  const value = authorization()
  expect(() => assertDraftStrategyAuthorization({ ...value, primary_result_hash: "weak" })).toThrow()
})
