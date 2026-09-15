import assert from "node:assert/strict";
import test from "node:test";

import { projectArtifactJourneyV1 } from "../lib/artifact-journey.ts";

function projection(disposition) {
  return {
    availability: "available",
    buildRequestIdentity: "build-1",
    attemptIdentity: "attempt-1",
    observedAt: "2026-09-15T00:00:00.000Z",
    outcome: {
      resolution: "quarantined",
      historicalDisposition: disposition,
      failureCode: "BUILD_FAILED",
      committedAt: "2026-09-14T00:00:00.000Z",
    },
    technical: { ownerReceiptIdentity: "receipt-1" },
    reason: null,
  };
}

test("failed and rejected outcomes stop before Artifact creation", () => {
  for (const disposition of ["failed", "rejected"]) {
    const journey = projectArtifactJourneyV1(projection(disposition));
    assert.deepEqual(journey?.stages.map((stage) => stage.state), ["complete", "blocked", "pending"]);
    assert.deepEqual(journey?.stages.map((stage) => stage.label), ["Attempt", "Result", "Artifact"]);
    assert.equal(journey?.stages[2].detail, "Not created");
  }
});

test("unknown outcome warns without claiming an Artifact", () => {
  const journey = projectArtifactJourneyV1(projection("unknown"));
  assert.equal(journey?.summary, "Build result needs review");
  assert.deepEqual(journey?.stages.map((stage) => stage.state), ["complete", "warning", "pending"]);
  assert.equal(journey?.stages[2].detail, "Not verified");
});

test("unavailable projection never renders a journey", () => {
  assert.equal(projectArtifactJourneyV1({
    availability: "unavailable",
    buildRequestIdentity: "build-1",
    attemptIdentity: "attempt-1",
    observedAt: null,
    outcome: null,
    technical: null,
    reason: "OWNER_RESPONSE_UNAVAILABLE",
  }), null);
});
