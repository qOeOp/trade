import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DASHBOARD_OVERVIEW_RUN_FILTER_V1,
  projectDashboardOverviewV1,
} from "../lib/dashboard-overview.ts";
import { exactBlueprints, maturityFor } from "../lib/navigation.js";

const custody = {
  resolution: "RETRIEVED",
  completeness: "COMPLETE",
  observedAtEpochMs: 1_800_000_000_000,
  researchTotal: 2,
  artifactAttemptTotal: 1,
  bindingTotal: 1,
  research: [
    { requestIdentity: "research-request-0001", committedAtEpochMs: 1, projectionState: "POINT_READ_REQUIRED" },
    { requestIdentity: "research-request-0002", committedAtEpochMs: 2, projectionState: "POINT_READ_REQUIRED" },
  ],
  artifactAttempts: [{
    buildRequestIdentity: "artifact-build-request-0001",
    attemptIdentity: "artifact-attempt-0001",
    preparedAtEpochMs: 3,
    projectionState: "POINT_READ_REQUIRED",
  }],
  bindings: [{
    bindingIdentity: "binding-identity-0001",
    trialFamilyIdentity: "trial-family-identity-0001",
    committedAtEpochMs: 4,
    projectionState: "POINT_READ_REQUIRED",
  }],
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
    { requestIdentity: "research-request-0001", status: "outcome_ready", resolution: "quarantined", historicalDisposition: "accepted", reason: null },
    { requestIdentity: "research-request-0002", status: "awaiting_outcome", resolution: null, historicalDisposition: null, reason: null },
  ],
  reason: null,
};

const artifactReviews = {
  availability: "available",
  observedAt: "2027-01-15T08:00:01.000Z",
  sourceObservedAt: "2027-01-15T07:59:59.000Z",
  completeness: "complete",
  candidateTotal: 1,
  scannedCandidateCount: 1,
  reviewableTotal: 1,
  unavailableTotal: 0,
  items: [{
    buildRequestIdentity: "artifact-build-request-0001",
    attemptIdentity: "artifact-attempt-0001",
    availability: "reviewable",
    disposition: "rejected",
    reason: null,
  }],
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
  summary: { queued: 1, running: 2, unknown: 1, succeeded: 3, cancelled: 1, completed: 4, failed: 2 },
  filtered_total: 10,
  total_pages: 1,
  runs: [],
};

test("Overview projects only identity-bound queue summaries", () => {
  const projection = projectDashboardOverviewV1({ custody, researchOutcomes, artifactReviews, runs });
  assert.deepEqual(projection.research, { requests: 2, resultsReady: 1, waiting: 1, unavailable: 0 });
  assert.deepEqual(projection.builds, { attempts: 1, reviewable: 1, unavailable: 0 });
  assert.deepEqual(projection.families, { bindings: 1 });
  assert.equal(projection.operations.recorded, 10);
  assert.equal(projection.operations.active, 3);
  assert.equal(projection.operations.attention, 3);
});

test("an inventory mismatch withdraws only its dependent positive values", () => {
  const mismatched = { ...researchOutcomes, items: researchOutcomes.items.slice(0, 1) };
  const projection = projectDashboardOverviewV1({ custody, researchOutcomes: mismatched, artifactReviews, runs });
  assert.equal(projection.research.requests, 2);
  assert.equal(projection.research.resultsReady, null);
  assert.equal(projection.research.waiting, null);
  assert.equal(projection.builds.reviewable, 1);
  assert.equal(projection.operations.active, 3);
});

test("the admitted Overview remains a read-only independent-source consumer", async () => {
  const [component, runHook, route, en, zh] = await Promise.all([
    readFile(new URL("../components/dashboard-overview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/use-dashboard-overview-runs.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/dashboard-route-content.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../docs/guide/dashboard.md", import.meta.url), "utf8"),
    readFile(new URL("../../../docs/guide/dashboard.zh.md", import.meta.url), "utf8"),
  ]);
  assert.equal(maturityFor("/dashboard"), "DRAWABLE_EXACT");
  assert.equal(exactBlueprints["/dashboard"].primary, "DashboardOverview");
  assert.match(route, /dashboardOverview \? <DashboardOverview \/>/u);
  for (const token of ["CompactStatusBar", "PanelFrame", "Each section is observed independently", "useDashboardOverviewRuns"]) {
    assert.ok(component.includes(token), `Overview missing ${token}`);
  }
  for (const token of ["custodyPending", "researchPending", "buildsPending", "runsPending"]) {
    assert.ok(component.includes(token), `Overview missing independent loading boundary ${token}`);
  }
  assert.doesNotMatch(component, /custody: pending \? null|runs: pending \? null/u);
  assert.match(component, /queueCards\.length > 0 \? <div className=\{styles\.queueGrid\}>/u);
  assert.match(runHook, /useRunListView\(enabled, DASHBOARD_OVERVIEW_RUN_FILTER_V1\)/u);
  assert.equal(DASHBOARD_OVERVIEW_RUN_FILTER_V1.page_size, 50);
  assert.doesNotMatch(component, /GlobalStatusMatrix|global health|Resolve same identity|Submit|Run strategy/u);
  for (const doc of [en, zh]) {
    assert.match(doc, /IMPLEMENTATION_ADMITTED \/ CURRENT_PARTIAL/u);
    assert.match(doc, /runs\/all\/any\/pageSize=50\/page=1/u);
    assert.match(doc, /sections are read independently|各 section 独立读取/u);
    assert.match(doc, /DetailSheet/u);
    assert.match(doc, /canonical route/u);
    assert.match(doc, /presentation state, never Owner evidence|展示状态，绝不是 Owner evidence/u);
  }
});
