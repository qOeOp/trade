import assert from "node:assert/strict";
import test from "node:test";

import { projectResearchJourneyV1 } from "../lib/research-journey.ts";

const observedAt = "2026-09-15T01:00:00.000Z";
const accepted = {
  availability: "available",
  requestIdentity: "research-request-v2-example",
  observedAt,
  outcome: {
    resolution: "accepted",
    historicalDisposition: null,
    intentIdentity: "research-intent-v1-example",
    rejectionCode: null,
    committedAt: "2026-09-14T01:00:00.000Z",
  },
  view: {
    availability: "available",
    phase: "intent_frozen",
    observedAt,
    validThrough: "2026-09-16T01:00:00.000Z",
    nextStep: "wait_for_r_and_d_execution",
  },
  technical: {
    ownerReceiptIdentity: "receipt-example",
    semanticDigest: `sha256:${"a".repeat(64)}`,
    projectionIdentity: "projection-example",
    sourceCut: "source-cut-example",
    trialFamilyIdentity: "trial-family-example",
  },
  reason: null,
};

test("Research journey projects the exact typed Owner state without advancing missing stages", () => {
  const waiting = projectResearchJourneyV1({
    ...accepted,
    outcome: null,
    view: null,
    technical: null,
  });
  assert.equal(waiting.summary, "Waiting for a research result");
  assert.deepEqual(waiting.stages.map(({ state }) => state), ["current", "pending", "pending"]);

  const intentFrozen = projectResearchJourneyV1(accepted);
  assert.equal(intentFrozen.summary, "Strategy is ready for build");
  assert.deepEqual(intentFrozen.stages.map(({ state }) => state), ["complete", "complete", "current"]);

  const artifactReady = projectResearchJourneyV1({
    ...accepted,
    view: { ...accepted.view, phase: "artifact_available", nextStep: "review_artifact" },
  });
  assert.equal(artifactReady.summary, "Artifact is ready for review");
  assert.deepEqual(artifactReady.stages.map(({ state }) => state), ["complete", "complete", "complete"]);
});

test("Research journey keeps rejection, historical custody, and stale views fail closed", () => {
  const rejected = projectResearchJourneyV1({
    ...accepted,
    outcome: {
      ...accepted.outcome,
      resolution: "rejected",
      intentIdentity: null,
      rejectionCode: "INVALID_SOURCE",
    },
    view: null,
  });
  assert.deepEqual(rejected.stages.map(({ state }) => state), ["blocked", "pending", "pending"]);

  const quarantined = projectResearchJourneyV1({
    ...accepted,
    outcome: {
      ...accepted.outcome,
      resolution: "quarantined",
      historicalDisposition: "accepted",
      intentIdentity: null,
    },
    view: null,
  });
  assert.equal(quarantined.summary, "Saved result needs a current review");
  assert.deepEqual(quarantined.stages.map(({ label }) => label), ["Request", "Strategy", "Artifact"]);
  assert.deepEqual(quarantined.stages.map(({ state }) => state), ["warning", "pending", "pending"]);

  const stale = projectResearchJourneyV1({
    ...accepted,
    view: { ...accepted.view, availability: "stale", nextStep: "refresh_same_request" },
  });
  assert.equal(stale.summary, "Update this request before continuing");
  assert.deepEqual(stale.stages.map(({ state }) => state), ["complete", "warning", "pending"]);
});
