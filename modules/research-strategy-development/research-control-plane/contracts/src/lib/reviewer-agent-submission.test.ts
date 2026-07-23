import assert from "node:assert/strict"
import test from "node:test"
import {
  REVIEWER_AGENT_SUBMISSION_SCHEMA,
  assertReviewerAgentSubmission,
  createReviewerAgentSubmission,
} from "./reviewer-agent-submission"

test("Reviewer Agent submission is self-hashed and cannot select a Trial for the wrong decision", () => {
  const submission = createReviewerAgentSubmission({
    schema_version: REVIEWER_AGENT_SUBMISSION_SCHEMA,
    reviewer_run_id: "reviewer-run-1",
    experiment_id: "experiment-1",
    expected_version: 2,
    stage_id: "historical_validation",
    decision: "accept_for_draft",
    evidence: [{ result_id: "result-1", evidence_role: "primary" }],
    selected_trial_id: "trial-1",
    rationale: "The frozen mechanical result passes the declared rejection criteria.",
    created_at: "2026-07-23T11:00:00.000Z",
  })
  assertReviewerAgentSubmission(submission)
  assert.throws(() => createReviewerAgentSubmission({
    ...submission,
    decision: "modify",
  }), /required only/)
})
