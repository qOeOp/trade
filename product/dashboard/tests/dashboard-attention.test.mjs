import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { expectBonded } from "./doc-contract.mjs";

import {
  DASHBOARD_ATTENTION_FAILED_RUN_FILTER_V1,
  DASHBOARD_ATTENTION_UNKNOWN_RUN_FILTER_V1,
  projectDashboardAttentionV1,
} from "../lib/dashboard-attention.ts";
import { exactBlueprints, maturityFor } from "../lib/navigation.js";

const readyResearch = "research-request-000000000001";
const waitingResearch = "research-request-000000000002";
const unavailableResearch = "research-request-000000000003";
const buildRequest = "artifact-build-request-000000001";
const attempt = "artifact-attempt-000000000001";
const custody = {
  resolution: "RETRIEVED",
  completeness: "COMPLETE",
  observedAtEpochMs: 8_000,
  researchTotal: 3,
  artifactAttemptTotal: 1,
  bindingTotal: 0,
  research: [
    { requestIdentity: readyResearch, committedAtEpochMs: 1_000, projectionState: "POINT_READ_REQUIRED" },
    { requestIdentity: waitingResearch, committedAtEpochMs: 2_000, projectionState: "POINT_READ_REQUIRED" },
    { requestIdentity: unavailableResearch, committedAtEpochMs: 3_000, projectionState: "POINT_READ_REQUIRED" },
  ],
  artifactAttempts: [{ buildRequestIdentity: buildRequest, attemptIdentity: attempt,
    preparedAtEpochMs: 4_000, projectionState: "POINT_READ_REQUIRED" }],
  bindings: [],
};
const researchOutcomes = {
  availability: "available",
  observedAt: "1970-01-01T00:00:09.000Z",
  sourceObservedAt: "1970-01-01T00:00:08.000Z",
  completeness: "complete",
  candidateTotal: 3,
  scannedCandidateCount: 3,
  outcomeReadyTotal: 1,
  awaitingOutcomeTotal: 1,
  unavailableTotal: 1,
  items: [
    { requestIdentity: readyResearch, status: "outcome_ready", resolution: "accepted",
      historicalDisposition: null, reason: null },
    { requestIdentity: waitingResearch, status: "awaiting_outcome", resolution: null,
      historicalDisposition: null, reason: null },
    { requestIdentity: unavailableResearch, status: "unavailable", resolution: null,
      historicalDisposition: null, reason: "OWNER_RESPONSE_UNAVAILABLE" },
  ],
  reason: null,
};
const questions = {
  observedAtEpochMs: 8_000,
  total: 3,
  items: [readyResearch, waitingResearch, unavailableResearch].map((requestIdentity, index) => ({
    requestIdentity,
    semanticDigest: `sha256:${String(index + 1).repeat(64)}`,
    committedAtEpochMs: (index + 1) * 1_000,
    availability: "available",
    unavailableReason: null,
    question: {
      hypothesis: `Research question ${index + 1}`,
      falsificationQuestion: `Falsifier ${index + 1}`,
      expectedObservation: `Expected observation ${index + 1}`,
    },
  })),
};
const artifactReviews = {
  availability: "available",
  observedAt: "1970-01-01T00:00:10.000Z",
  sourceObservedAt: "1970-01-01T00:00:08.000Z",
  completeness: "complete",
  candidateTotal: 1,
  scannedCandidateCount: 1,
  reviewableTotal: 0,
  unavailableTotal: 1,
  items: [{ buildRequestIdentity: buildRequest, attemptIdentity: attempt,
    availability: "unavailable", disposition: null, reason: "ARTIFACT_RESULT_UNAVAILABLE" }],
  reason: null,
};

function runPage(filter, identity, state, effectiveAt) {
  return {
    schema_version: 1,
    projection_version: 2,
    operation: "dashboard.run_store.list.v2",
    availability: "available",
    unavailable_reason: null,
    completeness: "complete",
    observed_at: "2027-01-15T08:00:02.000Z",
    retention_limit: 512,
    source_cut: `sha256:${"1".repeat(64)}`,
    snapshot: `attention-snapshot-${state}-value-long-enough`,
    filter_cut: filter,
    summary: { queued: 0, running: 0, unknown: state === "unknown" ? 1 : 0,
      succeeded: 0, cancelled: 0, completed: 0, failed: state === "failed" ? 1 : 0 },
    filtered_total: 1,
    total_pages: 1,
    runs: [{
      schema_version: 1,
      run_identity: identity,
      operation_id: "source_intake.research.submit_or_resolve.v1",
      workload_kind: "runs",
      trigger_kind: "dashboard_bff",
      state,
      owner_outcome_state: "unknown",
      effective_at: effectiveAt,
      started_at: effectiveAt,
      duration_ms: 100,
      path: "source_intake.research.submit_or_resolve.v1",
      principal_ref: null,
      tag: null,
      concurrency_key_present: null,
      terminal_code: state === "failed" ? "DEPLOYMENT_UNAVAILABLE" : "MANUAL_RECONCILIATION_REQUIRED",
    }],
  };
}

const failedRuns = runPage(
  DASHBOARD_ATTENTION_FAILED_RUN_FILTER_V1,
  "dashboard-run-v1-11111111-1111-4111-8111-111111111111",
  "failed",
  "2027-01-15T07:59:00.000Z",
);
const unknownRuns = runPage(
  DASHBOARD_ATTENTION_UNKNOWN_RUN_FILTER_V1,
  "dashboard-run-v1-22222222-2222-4222-8222-222222222222",
  "unknown",
  "2027-01-15T08:00:00.000Z",
);

test("Attention projects individual follow-up work without flattening source meaning", () => {
  const projection = projectDashboardAttentionV1({
    custody, researchOutcomes, questions, artifactReviews, failedRuns, unknownRuns,
  });
  assert.equal(projection.availability, "available");
  assert.equal(projection.completeness, "complete");
  assert.deepEqual(
    [projection.researchCount, projection.buildCount, projection.runCount, projection.totalCount],
    [2, 1, 2, 5],
  );
  assert.equal(projection.listedCount, 5);
  assert.deepEqual(projection.rows.map((row) => row.kind), ["run", "run", "build", "research", "research"]);
  assert.equal(projection.rows.some((row) => row.key.includes(readyResearch)), false);
});

test("a mismatched source withdraws only its dependent attention rows and count", () => {
  const projection = projectDashboardAttentionV1({
    custody,
    researchOutcomes: { ...researchOutcomes, items: researchOutcomes.items.slice(0, 2) },
    questions,
    artifactReviews,
    failedRuns,
    unknownRuns,
  });
  assert.equal(projection.availability, "available");
  assert.equal(projection.completeness, "partial");
  assert.equal(projection.researchCount, null);
  assert.equal(projection.buildCount, 1);
  assert.equal(projection.runCount, 2);
  assert.equal(projection.totalCount, null);
  assert.equal(projection.rows.some((row) => row.kind === "research"), false);
});

test("Attention is an admitted same-page read-only follow-up workspace", async () => {
  const [component, route, hook, en, zh] = await Promise.all([
    readFile(new URL("../components/dashboard-attention.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/dashboard-route-content.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/use-run-list-view.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../docs/guide/dashboard.md", import.meta.url), "utf8"),
    readFile(new URL("../../../docs/guide/dashboard.zh.md", import.meta.url), "utf8"),
  ]);
  assert.equal(maturityFor("/dashboard/attention"), "DRAWABLE_EXACT");
  assert.equal(exactBlueprints["/dashboard/attention"].primary, "DashboardAttention");
  assert.match(route, /dashboardAttention \? <DashboardAttention \/>/u);
  for (const token of ["DataWorkspaceTable", "rowDisclosure", "ResearchRequestPreview",
    "ArtifactAttemptPreview", "PanelFrameInfo", "CompactStatusBar", "useRunListView"]) {
    assert.ok(component.includes(token), `Dashboard attention missing ${token}`);
  }
  assert.match(hook, /admitRunListViewResponseV2/u);
  for (const actionLabel of [
    "Resolve same identity",
    "Retry run",
    "Copy locator",
    "Submit",
    "Run strategy",
  ]) {
    assert.equal(component.includes(`>${actionLabel}<`), false, `Attention must not render ${actionLabel}`);
  }
  expectBonded({ en, zh }, component, ["DashboardAttention"], "Attention");
});
