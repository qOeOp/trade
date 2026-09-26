import assert from "node:assert/strict";
import test from "node:test";

import {
  validResearchGoalExecutionInputV3,
  validSourceResearchOperationRequestV1,
  validSourceResearchSubmissionV1,
} from "../lib/source-research-input-contract.ts";
import { sourceResearchRunInputCustodyV1 } from "../lib/source-research-run-input-custody.ts";

const researchV2 = {
  request_identity: "request-1",
  goal: {
    hypothesis: "One bounded hypothesis.",
    mechanism: "One bounded mechanism.",
    falsification_question: "One bounded falsification question.",
    expected_observation: "One bounded expected observation.",
    required_data: ["One bounded dataset."],
    cost_assumption: "One bounded cost assumption.",
    capacity_assumption: "One bounded capacity assumption.",
  },
  trial_family_proposal: {
    trial_budget: 1,
    stop_rule: "Stop after one admitted trial.",
    pit_rule_identity: "pit-rule-v1",
    cost_model_identity: "cost-model-v1",
    slippage_model_identity: "slippage-model-v1",
    capacity_model_identity: "capacity-model-v1",
    independence_rationale: "One bounded independence rationale.",
  },
};
const scope = { schema_version: 1, identities: ["BTCUSDT-PERP.BINANCE"] };
const researchV3 = { ...researchV2, instrument_scope: scope };
const source = {
  request_identity: "source-request-1",
  normalized_doi: "10.5555/dashboard-test",
  interpretation: {
    bounded_explanation: "One bounded source interpretation.",
    plausible_alternatives: ["One bounded alternative."],
    differentiating_prediction: "One differentiating prediction.",
    falsifier: "One falsifier.",
  },
};
const runV2 = { action: "RUN", source, research: researchV2 };
const runV3 = { action: "RUN", source, research: researchV3 };
const resolve = { action: "RESOLVE", source_request_identity: "source-request-1", research_request_identity: "request-1" };

test("a new submission must state its instrument; custody still reads a run recorded as V2", () => {
  assert.equal(validSourceResearchSubmissionV1(runV3), true);
  assert.equal(validSourceResearchSubmissionV1(resolve), true);
  assert.equal(validSourceResearchSubmissionV1(runV2), false);
  assert.equal(validSourceResearchOperationRequestV1(runV2), true);
  assert.equal(validSourceResearchOperationRequestV1(runV3), true);
});

test("a V3 input holds exactly one valid identity in R&D's scope wire form", () => {
  assert.equal(validResearchGoalExecutionInputV3(researchV3), true);
  for (const [name, instrumentScope] of [
    ["no identity", { schema_version: 1, identities: [] }],
    ["two identities", { schema_version: 1, identities: ["A", "B"] }],
    ["another schema", { schema_version: 2, identities: ["BTCUSDT-PERP.BINANCE"] }],
    ["an unknown key", { ...scope, selection: "FIXED" }],
    ["a surrounding space", { schema_version: 1, identities: [" BTCUSDT-PERP.BINANCE"] }],
    ["not a list", { schema_version: 1, identities: "BTCUSDT-PERP.BINANCE" }],
  ]) {
    assert.equal(validResearchGoalExecutionInputV3({ ...researchV2, instrument_scope: instrumentScope }), false, name);
  }
  assert.equal(validResearchGoalExecutionInputV3({ ...researchV3, smuggled: true }), false, "an unknown top-level key");
});

test("a run recorded as V2 keeps its custody bytes; a V3 run's custody holds its scope", () => {
  // Measured on origin/main 246ba0799, before V3 existed: the same V2 request's custody digest.
  // Request schema 1 now holds V3 too, so a V2 run recorded before must still read back as itself.
  assert.equal(
    sourceResearchRunInputCustodyV1(runV2)?.request_digest,
    "sha256:a04e3d20fcded3b0c6eb4761205ec6eeb7cf938bcdfb608d462a099779cef960",
  );
  const v3 = sourceResearchRunInputCustodyV1(runV3);
  assert.deepEqual(v3?.request.research.instrument_scope, scope);
  assert.notEqual(v3?.request_digest, sourceResearchRunInputCustodyV1(runV2)?.request_digest);
  assert.equal(v3?.request_schema_version, 1);
});
