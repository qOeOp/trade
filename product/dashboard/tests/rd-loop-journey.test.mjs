import assert from "node:assert/strict";
import test from "node:test";

import { projectRdLoopJourneyV1 } from "../lib/rd-loop-journey.ts";

const family = {
  trialFamilyIdentity: "family-1",
  research: {},
  attemptHistory: [],
};
const timeline = {
  trialFamilyIdentity: "family-1",
  state: "AWAITING_REPLAY_RESULT",
  decisions: [],
};

test("R&D loop is derived only from identity-consistent Owner projections", () => {
  assert.equal(projectRdLoopJourneyV1(family, { ...timeline, trialFamilyIdentity: "other" }), null);
  const projected = projectRdLoopJourneyV1(family, timeline);
  assert.equal(projected?.summary, "Intent is ready for Artifact formation");
  assert.equal(projected?.stages[1].state, "current");
});

test("a verified Decision drives the exact next stage", () => {
  const projected = projectRdLoopJourneyV1(
    { ...family, attemptHistory: [{}] },
    { ...timeline, state: "SUCCESSOR_REQUIRED", decisions: [{}] },
  );
  assert.equal(projected?.summary, "Author the next experiment");
  assert.equal(projected?.stages.at(-1).state, "current");
});
