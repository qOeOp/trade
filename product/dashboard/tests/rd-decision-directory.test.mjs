import assert from "node:assert/strict";
import test from "node:test";

import { projectRdDecisionDirectoryV1 } from "../lib/rd-decision-directory.ts";

function family(identity, requestIdentity, consumed = 1, budget = 3) {
  return {
    trialFamilyIdentity: identity,
    research: {
      requestIdentity,
      receiptIdentity: `receipt-${identity}`,
      intentIdentity: `intent-${identity}`,
      committedAtEpochMs: 100,
      viewAvailability: "AVAILABLE",
      nextLegalAction: "VIEW_EXPLORATORY_RUN",
      trialBudget: budget,
      consumedTrialBudget: consumed,
    },
    attemptHistory: [],
  };
}

function decision(familyIdentity, suffix, committedAtEpochMs, outcome) {
  return {
    decisionIdentity: `decision-${suffix}`,
    decisionDigest: `sha256:${suffix.repeat(64).slice(0, 64)}`,
    roundOrdinal: 1,
    trialFamilyIdentity: familyIdentity,
    censusFrontierIdentity: `frontier-${familyIdentity}`,
    censusFrontierDigest: `sha256:${"c".repeat(64)}`,
    requestIdentity: `replay-request-${suffix}`,
    resultIdentity: `result-${suffix}`,
    attemptIdentity: `attempt-${suffix}`,
    outcome,
    nextLegalAction: outcome.outcome === "REPAIR_INPUTS" ? "SUBMIT_REPAIR_REQUEST"
      : outcome.outcome === "SUCCESSOR_EXPERIMENT" ? "CREATE_SUCCESSOR_INTENT"
        : outcome.outcome === "READY_FOR_SELECTION" ? "SUBMIT_SELECTED_CANDIDATE_TO_QUALIFICATION"
          : "STOP_ON_COMMITTED_DECISION",
    committedAtEpochMs,
    receiptIdentity: `decision-receipt-${suffix}`,
  };
}

function timeline(familyValue, decisions) {
  return {
    trialFamilyIdentity: familyValue.trialFamilyIdentity,
    censusFrontierIdentity: `frontier-${familyValue.trialFamilyIdentity}`,
    censusFrontierDigest: `sha256:${"c".repeat(64)}`,
    consumedTrialBudget: familyValue.research.consumedTrialBudget,
    trialBudget: familyValue.research.trialBudget,
    state: decisions.length === 0 ? "AWAITING_REPLAY_RESULT" : "TERMINAL",
    decisions,
    observedAtEpochMs: 500,
  };
}

test("Decision directory binds complete Formation families to exact timelines and orders newest first", () => {
  const first = family("family-a", "research-a");
  const second = family("family-b", "research-b");
  const older = decision("family-a", "a", 200, { outcome: "TERMINAL_STOP", reason: "TRIAL_BUDGET_EXHAUSTED" });
  const newer = decision("family-b", "b", 300, { outcome: "TERMINAL_STOP", reason: "LOW_INFORMATION_VALUE" });
  const projection = projectRdDecisionDirectoryV1({
    resolution: "RETRIEVED",
    completeness: "PARTIAL_UNAVAILABLE",
    observedAtEpochMs: 400,
    families: [first, second],
  }, [timeline(first, [older]), timeline(second, [newer])]);

  assert.ok(projection);
  assert.equal(projection.familyCount, 2);
  assert.deepEqual(projection.items.map(({ key }) => key), ["decision-b", "decision-a"]);
  assert.equal(projection.completeness, "PARTIAL_UNAVAILABLE");
  assert.equal(projection.observedAtEpochMs, 500);
});

test("Decision directory accepts an exact zero-family cut without inventing a row", () => {
  assert.deepEqual(projectRdDecisionDirectoryV1({
    resolution: "RETRIEVED",
    completeness: "PARTIAL_UNAVAILABLE",
    observedAtEpochMs: 400,
    families: [],
  }, []), {
    completeness: "PARTIAL_UNAVAILABLE",
    sourceObservedAtEpochMs: 400,
    observedAtEpochMs: 400,
    familyCount: 0,
    items: [],
  });
});

test("Decision directory fails closed on missing timelines, budget drift, and cross-family identity reuse", () => {
  const first = family("family-a", "research-a");
  const second = family("family-b", "research-b");
  const catalog = {
    resolution: "RETRIEVED",
    completeness: "PARTIAL_UNAVAILABLE",
    observedAtEpochMs: 400,
    families: [first, second],
  };
  const firstDecision = decision("family-a", "a", 200, { outcome: "TERMINAL_STOP", reason: "INPUT_UNAVAILABLE" });
  const secondDecision = decision("family-b", "b", 300, { outcome: "TERMINAL_STOP", reason: "LOW_INFORMATION_VALUE" });
  assert.equal(projectRdDecisionDirectoryV1(catalog, [timeline(first, [firstDecision])]), null);

  const drifted = timeline(first, [firstDecision]);
  drifted.trialBudget += 1;
  assert.equal(projectRdDecisionDirectoryV1(catalog, [drifted, timeline(second, [secondDecision])]), null);

  const duplicate = { ...secondDecision, resultIdentity: firstDecision.resultIdentity };
  assert.equal(projectRdDecisionDirectoryV1(catalog, [
    timeline(first, [firstDecision]), timeline(second, [duplicate]),
  ]), null);
});
