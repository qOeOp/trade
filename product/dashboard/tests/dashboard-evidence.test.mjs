import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { projectDashboardEvidenceV1 } from "../lib/dashboard-evidence.ts";
import { DASHBOARD_OVERVIEW_RUN_FILTER_V1 } from "../lib/dashboard-overview.ts";
import { exactBlueprints, maturityFor } from "../lib/navigation.js";

const custody = {
  resolution: "RETRIEVED",
  completeness: "COMPLETE",
  observedAtEpochMs: 1_800_000_000_000,
  researchTotal: 2,
  artifactAttemptTotal: 2,
  bindingTotal: 1,
  research: [
    { requestIdentity: "research-request-0001", committedAtEpochMs: 1, projectionState: "POINT_READ_REQUIRED" },
    { requestIdentity: "research-request-0002", committedAtEpochMs: 2, projectionState: "POINT_READ_REQUIRED" },
  ],
  artifactAttempts: [
    { buildRequestIdentity: "artifact-build-request-0001", attemptIdentity: "artifact-attempt-0001",
      preparedAtEpochMs: 3, projectionState: "POINT_READ_REQUIRED" },
    { buildRequestIdentity: "artifact-build-request-0002", attemptIdentity: "artifact-attempt-0002",
      preparedAtEpochMs: 4, projectionState: "POINT_READ_REQUIRED" },
  ],
  bindings: [{ bindingIdentity: "binding-identity-0001", trialFamilyIdentity: "trial-family-identity-0001",
    committedAtEpochMs: 5, projectionState: "POINT_READ_REQUIRED" }],
};

const researchOutcomes = {
  availability: "available",
  observedAt: "2027-01-15T08:00:00.000Z",
  sourceObservedAt: "2027-01-15T07:59:59.000Z",
  completeness: "complete",
  candidateTotal: 2,
  scannedCandidateCount: 2,
  outcomeReadyTotal: 1,
  awaitingOutcomeTotal: 1,
  unavailableTotal: 0,
  items: [
    { requestIdentity: "research-request-0001", status: "outcome_ready", resolution: "accepted",
      historicalDisposition: null, reason: null },
    { requestIdentity: "research-request-0002", status: "awaiting_outcome", resolution: null,
      historicalDisposition: null, reason: null },
  ],
  reason: null,
};

const artifactReviews = {
  availability: "available",
  observedAt: "2027-01-15T08:00:01.000Z",
  sourceObservedAt: "2027-01-15T07:59:59.000Z",
  completeness: "complete",
  candidateTotal: 2,
  scannedCandidateCount: 2,
  reviewableTotal: 1,
  unavailableTotal: 1,
  items: [
    { buildRequestIdentity: "artifact-build-request-0001", attemptIdentity: "artifact-attempt-0001",
      availability: "reviewable", disposition: "rejected", reason: null },
    { buildRequestIdentity: "artifact-build-request-0002", attemptIdentity: "artifact-attempt-0002",
      availability: "unavailable", disposition: null, reason: "ARTIFACT_RESULT_UNAVAILABLE" },
  ],
  reason: null,
};

const runs = {
  schema_version: 1,
  projection_version: 2,
  operation: "dashboard.run_store.list.v2",
  availability: "available",
  unavailable_reason: null,
  completeness: "complete",
  observed_at: "2027-01-15T08:00:02.000Z",
  retention_limit: 512,
  source_cut: `sha256:${"1".repeat(64)}`,
  snapshot: "overview-snapshot-value-that-is-long-enough",
  filter_cut: DASHBOARD_OVERVIEW_RUN_FILTER_V1,
  summary: { queued: 0, running: 0, unknown: 0, succeeded: 3, cancelled: 1, completed: 4, failed: 0 },
  filtered_total: 4,
  total_pages: 1,
  runs: [],
};

test("Evidence projects business coverage without aggregating heterogeneous records", () => {
  const projection = projectDashboardEvidenceV1({ custody, researchOutcomes, artifactReviews, runs });
  assert.equal(projection.availability, "available");
  assert.deepEqual(
    [projection.readyCount, projection.limitedCount, projection.unavailableCount],
    [3, 1, 0],
  );
  assert.deepEqual(projection.rows.map((row) => [row.key, row.state]), [
    ["custody", "ready"],
    ["research", "ready"],
    ["builds", "limited"],
    ["operations", "ready"],
  ]);
  const builds = projection.rows.find((row) => row.key === "builds");
  assert.equal(builds?.currentValue, 1);
  assert.equal(builds?.currentLabel, "reviewable");
  assert.equal(builds?.followUpValue, 1);
  assert.equal(builds?.followUpLabel, "unavailable");
});

test("an identity mismatch withdraws only the dependent evidence row", () => {
  const projection = projectDashboardEvidenceV1({
    custody,
    researchOutcomes: { ...researchOutcomes, items: researchOutcomes.items.slice(0, 1) },
    artifactReviews,
    runs,
  });
  const research = projection.rows.find((row) => row.key === "research");
  assert.equal(research?.state, "unavailable");
  assert.equal(research?.currentValue, null);
  assert.equal(projection.rows.find((row) => row.key === "builds")?.state, "limited");
  assert.equal(projection.rows.find((row) => row.key === "operations")?.state, "ready");
});

test("Evidence is an admitted same-page read-only coverage workspace", async () => {
  const [component, route, en, zh] = await Promise.all([
    readFile(new URL("../components/dashboard-evidence.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/dashboard-route-content.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../docs/guide/dashboard.md", import.meta.url), "utf8"),
    readFile(new URL("../../../docs/guide/dashboard.zh.md", import.meta.url), "utf8"),
  ]);
  assert.equal(maturityFor("/dashboard/evidence"), "DRAWABLE_EXACT");
  assert.equal(exactBlueprints["/dashboard/evidence"].primary, "DashboardEvidence");
  assert.match(route, /dashboardEvidence \? <DashboardEvidence \/>/u);
  for (const token of ["DataWorkspaceTable", "rowDisclosure", "PanelFrameInfo", "CompactStatusBar",
    "useHistoricalCustodyDirectory", "useResearchOutcomeInventory", "useArtifactReviewInventory",
    "useDashboardOverviewRuns"]) {
    assert.ok(component.includes(token), `Dashboard evidence missing ${token}`);
  }
  assert.doesNotMatch(component, /Resolve same identity|Rebuild evidence|Submit|Run strategy|Delete evidence/u);
  for (const doc of [en, zh]) {
    assert.match(doc, /DashboardEvidence/u);
    assert.match(doc, /same-page inline|同页原位/u);
    assert.match(doc, /read coverage|read-coverage/u);
  }
});
