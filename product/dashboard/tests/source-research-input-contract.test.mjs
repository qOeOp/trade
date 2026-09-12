import assert from "node:assert/strict";
import test from "node:test";

import { validSourceResearchOperationRequestV1 } from "../lib/source-research-input-contract.ts";

const request = {
  action: "RUN",
  source: {
    request_identity: "dashboard-source-request-v1-1",
    normalized_doi: "10.5555/dashboard",
    interpretation: {
      bounded_explanation: "A bounded explanation.",
      plausible_alternatives: ["Alternative A.", "Alternative B."],
      differentiating_prediction: "A differentiating prediction.",
      falsifier: "A source falsifier.",
    },
  },
  research: {
    request_identity: "dashboard-research-request-v2-1",
    goal: {
      hypothesis: "A bounded hypothesis.",
      mechanism: "A bounded mechanism.",
      falsification_question: "A falsification question.",
      expected_observation: "An expected observation.",
      required_data: ["A required dataset."],
      cost_assumption: "A cost assumption.",
      capacity_assumption: "A capacity assumption.",
    },
    trial_family_proposal: {
      trial_budget: 1,
      stop_rule: "Stop after one admitted trial.",
      pit_rule_identity: "pit-rule-v1",
      cost_model_identity: "cost-model-v1",
      slippage_model_identity: "slippage-model-v1",
      capacity_model_identity: "capacity-model-v1",
      independence_rationale: "An independence rationale.",
    },
  },
};

test("the shared browser/server input contract accepts one exact public proposal", () => {
  assert.equal(validSourceResearchOperationRequestV1(request), true);
  assert.equal(validSourceResearchOperationRequestV1({ ...request, action: "RESOLVE" }), true);
});

test("the shared input contract rejects unordered alternatives and incomplete authority fields", () => {
  assert.equal(validSourceResearchOperationRequestV1({
    ...request,
    source: {
      ...request.source,
      interpretation: { ...request.source.interpretation, plausible_alternatives: ["B", "A"] },
    },
  }), false);
  assert.equal(validSourceResearchOperationRequestV1({
    ...request,
    research: {
      ...request.research,
      trial_family_proposal: { ...request.research.trial_family_proposal, pit_rule_identity: "" },
    },
  }), false);
});
