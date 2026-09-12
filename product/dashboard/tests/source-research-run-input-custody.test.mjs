import assert from "node:assert/strict";
import test from "node:test";

import {
  readSourceResearchRunInputCustodyV1,
  sourceResearchRunInputCustodyV1,
} from "../lib/source-research-run-input-custody.ts";

const request = {
  action: "RUN",
  source: {
    request_identity: "source-request-custody-1",
    normalized_doi: "10.5555/custody-test",
    interpretation: {
      bounded_explanation: "A bounded explanation.",
      plausible_alternatives: ["Alternative A.", "Alternative B."],
      differentiating_prediction: "A differentiating prediction.",
      falsifier: "A falsifier.",
    },
  },
  research: {
    request_identity: "research-request-custody-1",
    goal: {
      hypothesis: "A bounded hypothesis.",
      mechanism: "A bounded mechanism.",
      falsification_question: "A bounded falsification question.",
      expected_observation: "A bounded observation.",
      required_data: ["dataset-a", "dataset-b"],
      cost_assumption: "A bounded cost assumption.",
      capacity_assumption: "A bounded capacity assumption.",
    },
    trial_family_proposal: {
      trial_budget: 2,
      stop_rule: "Stop after two trials.",
      pit_rule_identity: "pit-rule-v1",
      cost_model_identity: "cost-model-v1",
      slippage_model_identity: "slippage-model-v1",
      capacity_model_identity: "capacity-model-v1",
      independence_rationale: "A bounded independence rationale.",
    },
  },
};

test("Source-to-Research input custody is typed, copied and content addressed", () => {
  const custody = sourceResearchRunInputCustodyV1(request);
  assert.ok(custody);
  assert.match(custody.request_digest, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(custody.request, request);
  assert.notEqual(custody.request.source.interpretation.plausible_alternatives,
    request.source.interpretation.plausible_alternatives);
  assert.notEqual(custody.request.research.goal.required_data, request.research.goal.required_data);
  assert.deepEqual(readSourceResearchRunInputCustodyV1({
    state: "AVAILABLE",
    requestSchemaVersion: 1,
    request: custody.request,
    requestDigest: custody.request_digest,
  }), custody);
});

test("Source-to-Research input custody rejects changed or malformed retained bytes", () => {
  const custody = sourceResearchRunInputCustodyV1(request);
  assert.ok(custody);
  const changed = structuredClone(custody.request);
  changed.research.goal.hypothesis = "Changed hypothesis.";
  assert.equal(readSourceResearchRunInputCustodyV1({
    state: "AVAILABLE",
    requestSchemaVersion: 1,
    request: changed,
    requestDigest: custody.request_digest,
  }).unavailable_reason, "INVALID");
  assert.equal(readSourceResearchRunInputCustodyV1({
    state: "AVAILABLE",
    requestSchemaVersion: 2,
    request: custody.request,
    requestDigest: custody.request_digest,
  }).unavailable_reason, "INVALID");
});

test("legacy and non-applicable rows remain explicit unavailable states", () => {
  for (const [state, reason] of [
    ["LEGACY_UNAVAILABLE", "LEGACY_UNAVAILABLE"],
    ["NOT_APPLICABLE", "NOT_APPLICABLE"],
  ]) {
    const readback = readSourceResearchRunInputCustodyV1({
      state,
      requestSchemaVersion: null,
      request: null,
      requestDigest: null,
    });
    assert.equal(readback.availability, "unavailable");
    assert.equal(readback.unavailable_reason, reason);
  }
  for (const malformed of [
    { state: "UNKNOWN", requestSchemaVersion: null, request: null, requestDigest: null },
    { state: "LEGACY_UNAVAILABLE", requestSchemaVersion: 1, request: null, requestDigest: null },
  ]) {
    assert.equal(readSourceResearchRunInputCustodyV1(malformed).unavailable_reason, "INVALID");
  }
});
