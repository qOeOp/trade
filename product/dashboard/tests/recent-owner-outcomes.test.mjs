import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { expectBonded } from "./doc-contract.mjs";

import { projectRecentOwnerOutcomesV1 } from "../lib/recent-owner-outcomes.ts";
import { exactBlueprints, maturityFor } from "../lib/navigation.js";

const researchRequest = "research-request-000000000001";
const waitingRequest = "research-request-000000000002";
const buildRequest = "artifact-build-request-000000001";
const attempt = "artifact-attempt-000000000001";
const custody = {
  resolution: "RETRIEVED",
  completeness: "COMPLETE",
  observedAtEpochMs: 4_000,
  researchTotal: 2,
  artifactAttemptTotal: 1,
  bindingTotal: 0,
  research: [
    { requestIdentity: researchRequest, committedAtEpochMs: 1_000, projectionState: "POINT_READ_REQUIRED" },
    { requestIdentity: waitingRequest, committedAtEpochMs: 2_000, projectionState: "POINT_READ_REQUIRED" },
  ],
  artifactAttempts: [{ buildRequestIdentity: buildRequest, attemptIdentity: attempt,
    preparedAtEpochMs: 3_000, projectionState: "POINT_READ_REQUIRED" }],
  bindings: [],
};
const researchOutcomes = {
  availability: "available",
  observedAt: "1970-01-01T00:00:05.000Z",
  sourceObservedAt: "1970-01-01T00:00:04.000Z",
  completeness: "complete",
  candidateTotal: 2,
  scannedCandidateCount: 2,
  outcomeReadyTotal: 1,
  awaitingOutcomeTotal: 1,
  unavailableTotal: 0,
  items: [
    { requestIdentity: researchRequest, status: "outcome_ready", resolution: "accepted",
      historicalDisposition: null, reason: null },
    { requestIdentity: waitingRequest, status: "awaiting_outcome", resolution: null,
      historicalDisposition: null, reason: null },
  ],
  reason: null,
};
const questions = {
  observedAtEpochMs: 4_000,
  total: 2,
  items: [
    { requestIdentity: researchRequest, semanticDigest: `sha256:${"a".repeat(64)}`,
      committedAtEpochMs: 1_000, availability: "available", unavailableReason: null,
      question: { hypothesis: "Momentum survives modeled costs.",
        falsificationQuestion: "Does net continuation disappear?",
        expectedObservation: "Net continuation remains positive." } },
    { requestIdentity: waitingRequest, semanticDigest: `sha256:${"b".repeat(64)}`,
      committedAtEpochMs: 2_000, availability: "available", unavailableReason: null,
      question: { hypothesis: "Reversal persists after the spread.",
        falsificationQuestion: "Does reversal disappear?",
        expectedObservation: "Net reversal remains positive." } },
  ],
};
const buildReviews = {
  availability: "available",
  observedAt: "1970-01-01T00:00:06.000Z",
  sourceObservedAt: "1970-01-01T00:00:04.000Z",
  completeness: "complete",
  candidateTotal: 1,
  scannedCandidateCount: 1,
  reviewableTotal: 1,
  unavailableTotal: 0,
  items: [{ buildRequestIdentity: buildRequest, attemptIdentity: attempt,
    availability: "reviewable", disposition: "rejected", reason: null }],
  reason: null,
};

test("Recent outcomes merges only verified positive Owner outcomes in time order", () => {
  const projection = projectRecentOwnerOutcomesV1({ custody, researchOutcomes, questions, buildReviews });
  assert.equal(projection.availability, "available");
  assert.equal(projection.completeness, "complete");
  assert.equal(projection.researchCount, 1);
  assert.equal(projection.buildCount, 1);
  assert.equal(projection.totalCount, 2);
  assert.deepEqual(projection.rows.map((row) => [row.kind, row.result]), [
    ["build", "rejected"],
    ["research", "accepted"],
  ]);
  assert.equal(projection.rows.some((row) => row.key.includes(waitingRequest)), false);
  assert.equal(projection.rows[1].title, "Momentum survives modeled costs.");
});

test("a mismatched source withdraws only its rows and count", () => {
  const projection = projectRecentOwnerOutcomesV1({
    custody,
    researchOutcomes: { ...researchOutcomes, items: researchOutcomes.items.slice(0, 1) },
    questions,
    buildReviews,
  });
  assert.equal(projection.availability, "available");
  assert.equal(projection.completeness, "partial");
  assert.equal(projection.researchCount, null);
  assert.equal(projection.buildCount, 1);
  assert.equal(projection.totalCount, null);
  assert.deepEqual(projection.rows.map((row) => row.kind), ["build"]);
});

test("Recent is an admitted same-page read-only outcome workspace", async () => {
  const [component, route, en, zh] = await Promise.all([
    readFile(new URL("../components/recent-owner-outcomes.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/dashboard-route-content.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../docs/guide/dashboard.md", import.meta.url), "utf8"),
    readFile(new URL("../../../docs/guide/dashboard.zh.md", import.meta.url), "utf8"),
  ]);
  assert.equal(maturityFor("/dashboard/recent"), "DRAWABLE_EXACT");
  assert.equal(exactBlueprints["/dashboard/recent"].primary, "RecentOwnerOutcomes");
  assert.match(route, /dashboardRecent \? <RecentOwnerOutcomes \/>/u);
  for (const token of ["DataWorkspaceTable", "rowDisclosure", "ResearchRequestPreview",
    "ArtifactAttemptPreview", "PanelFrameInfo", "CompactStatusBar"]) {
    assert.ok(component.includes(token), `Recent outcomes missing ${token}`);
  }
  for (const token of ["custodyPending", "researchPending", "buildsPending"]) {
    assert.ok(component.includes(token), `Recent outcomes missing independent loading boundary ${token}`);
  }
  assert.doesNotMatch(component, /custody: pending \? null|buildReviews: pending \? null/u);
  assert.doesNotMatch(component, /Resolve same identity|Submit|Run strategy|Delete/u);
  expectBonded({ en, zh }, component, ["RecentOwnerOutcomes"], "Recent outcomes");
});
