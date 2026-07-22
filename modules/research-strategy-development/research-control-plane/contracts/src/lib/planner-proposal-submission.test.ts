import { expect, test } from "bun:test"
import {
  PLANNER_PROPOSAL_ADMISSION_SCHEMA_VERSION,
  PLANNER_PROPOSAL_INTAKE_POLICY_VERSION,
  PLANNER_PROPOSAL_SUBMISSION_SCHEMA_VERSION,
  assertPlannerProposalSubmission,
  createPlannerProposalAdmission,
  createPlannerProposalSubmission,
} from "./planner-proposal-submission"

function submission() {
  return createPlannerProposalSubmission({
    schema_version: PLANNER_PROPOSAL_SUBMISSION_SCHEMA_VERSION,
    revision: 2,
    proposal_id: "proposal-1",
    hypothesis_id: "hypothesis-1",
    universe_node_id: "canonical-1",
    objective: "Test one bounded mechanism",
    dataset_requirements: ["ohlcv"],
    candidate_space: { lookback: [20, 40] },
    trial_budget: 2,
    evaluation_protocol_ref: "protocol://historical-v1",
    control_plane_context_hash: "1".repeat(64),
    created_at: "2026-07-22T12:00:00Z",
  })
}

test("Planner Proposal submission is canonical and self-hashed", () => {
  const value = submission()
  expect(value.proposal_hash).toHaveLength(64)
  expect(() => assertPlannerProposalSubmission(value)).not.toThrow()
  expect(() => assertPlannerProposalSubmission({ ...value, objective: "drift" }))
    .toThrow("hash-drifted")
})

test("Planner Proposal admission is an accepted-only self-hashed receipt", () => {
  const proposal = submission()
  const admission = createPlannerProposalAdmission({
    schema_version: PLANNER_PROPOSAL_ADMISSION_SCHEMA_VERSION,
    proposal_id: proposal.proposal_id,
    proposal_revision: 1,
    proposal_hash: proposal.proposal_hash,
    planner_run_id: "planner-run-1",
    hypothesis_id: proposal.hypothesis_id,
    universe_node_id: proposal.universe_node_id,
    control_plane_context_hash: proposal.control_plane_context_hash,
    intake_policy_version: PLANNER_PROPOSAL_INTAKE_POLICY_VERSION,
    status: "accepted",
    recorded_at: "2026-07-22T12:01:00Z",
  })
  expect(admission.admission_hash).toHaveLength(64)
})

test("Planner Proposal boundary assertions reject incomplete objects cleanly", () => {
  expect(() => assertPlannerProposalSubmission(undefined as never)).toThrow("must be an object")
})
