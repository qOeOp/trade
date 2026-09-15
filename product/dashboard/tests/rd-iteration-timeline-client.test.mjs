import assert from "node:assert/strict";
import test from "node:test";

import { parseRdIterationTimelineOwnerV1 } from "../lib/rd-iteration-timeline-client.ts";

const digest = (digit) => `sha256:${digit.repeat(64)}`;

function decision(disposition, nextLegalAction) {
  return {
    schema_version: 1,
    decision_identity: "decision-1",
    decision_digest: digest("1"),
    trial_family_identity: "family-1",
    round_ordinal: 1,
    predecessor_decision_identity: null,
    intent_identity: "intent-1",
    intent_digest: digest("2"),
    artifact_identity: "artifact-1",
    census_frontier_identity: "frontier-1",
    census_frontier_digest: digest("3"),
    replay_request_identity: "replay-request-1",
    replay_request_meaning_digest: digest("4"),
    replay_result_identity: "replay-result-1",
    replay_result_digest: digest("5"),
    diagnostic_categories: ["NO_EXECUTION_DEFECT"],
    disposition,
    next_legal_action: nextLegalAction,
    committed_at_epoch_ms: 95,
    receipt_identity: "decision-receipt-1",
    receipt_digest: digest("6"),
  };
}

function timeline(state, decisions = []) {
  return {
    schema_version: 1,
    trial_family_identity: "family-1",
    census_frontier_identity: "frontier-1",
    census_frontier_digest: digest("3"),
    consumed_trial_budget: 1,
    trial_budget: 2,
    state,
    decisions,
    observed_at_epoch_ms: 100,
  };
}

const transitions = [
  ["REPLAY_REPAIR_REQUIRED", "RESOLVE_REPLAY_DEFECT", "REPLAY_REPAIR_REQUIRED"],
  ["SUCCESSOR_INPUT_REQUIRED", "AUTHOR_SUCCESSOR_INTENT", "AWAITING_SUCCESSOR_INTENT"],
  ["TERMINAL_STOP", "NONE_TERMINAL", "TERMINAL"],
  ["RESEARCH_REVIEW_REQUIRED", "REVIEW_ECONOMIC_EVIDENCE", "RESEARCH_REVIEW_REQUIRED"],
  ["EVIDENCE_UNRESOLVED", "RESOLVE_EVIDENCE", "EVIDENCE_UNRESOLVED"],
];

test("empty timeline preserves the exact awaiting state", () => {
  const parsed = parseRdIterationTimelineOwnerV1(
    timeline("AWAITING_REPLAY_RESULT"), "family-1", 90, 110,
  );
  assert.equal(parsed?.state, "AWAITING_REPLAY_RESULT");
  assert.deepEqual(parsed?.decisions, []);
});

test("each decision disposition binds one exact action and timeline state", () => {
  for (const [disposition, action, state] of transitions) {
    const parsed = parseRdIterationTimelineOwnerV1(
      timeline(state, [decision(disposition, action)]), "family-1", 90, 110,
    );
    assert.equal(parsed?.state, state);
    assert.equal(parsed?.decisions[0].disposition, disposition);
    assert.equal(parsed?.decisions[0].nextLegalAction, action);
    assert.deepEqual(parsed?.decisions[0].diagnosticCategories, ["NO_EXECUTION_DEFECT"]);
  }
});

test("unknown enum values and cross-transition actions fail closed", () => {
  const invalid = [
    timeline("RUNNING"),
    timeline("TERMINAL", [decision("STOPPED", "NONE_TERMINAL")]),
    timeline("TERMINAL", [decision("TERMINAL_STOP", "RUN_AGAIN")]),
    timeline("TERMINAL", [{
      ...decision("TERMINAL_STOP", "NONE_TERMINAL"),
      diagnostic_categories: ["PROVIDER_GUESS"],
    }]),
    timeline("TERMINAL", [decision("TERMINAL_STOP", "RESOLVE_EVIDENCE")]),
  ];
  for (const value of invalid) {
    assert.equal(parseRdIterationTimelineOwnerV1(value, "family-1", 90, 110), null);
  }
});
