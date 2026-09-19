import assert from "node:assert/strict";
import test from "node:test";

import {
  artifactReviewInventoryMatchesCustodyV1,
  parseArtifactReviewInventoryBrowserProjectionV1,
  readArtifactReviewInventoryV1,
} from "../lib/artifact-review-inventory.ts";

const observedAtEpochMs = 1_789_000_000_000;

function custody(count = 3, completeness = "COMPLETE", total = count) {
  return {
    resolution: "RETRIEVED",
    completeness,
    observedAtEpochMs,
    researchTotal: 0,
    artifactAttemptTotal: total,
    bindingTotal: 0,
    research: [],
    artifactAttempts: Array.from({ length: count }, (_, index) => ({
      buildRequestIdentity: `build-${index}`,
      attemptIdentity: `attempt-${index}`,
      preparedAtEpochMs: observedAtEpochMs - index,
      projectionState: "POINT_READ_REQUIRED",
    })),
    bindings: [],
  };
}

function historical(projection = custody()) {
  return async () => ({
    status: 200,
    envelope: { availability: "available", projection },
  });
}

function readable(buildRequestIdentity, attemptIdentity, disposition = "rejected") {
  return {
    status: 200,
    projection: {
      availability: "available",
      buildRequestIdentity,
      attemptIdentity,
      observedAt: new Date(observedAtEpochMs).toISOString(),
      outcome: {
        resolution: "quarantined",
        historicalDisposition: disposition,
        failureCode: "INVALID_BUILD_REQUEST",
        committedAt: new Date(observedAtEpochMs - 1).toISOString(),
      },
      technical: { ownerReceiptIdentity: `receipt-${attemptIdentity}` },
      reason: null,
    },
  };
}

function unreadable(buildRequestIdentity, attemptIdentity) {
  return {
    status: 503,
    projection: {
      availability: "unavailable",
      buildRequestIdentity,
      attemptIdentity,
      observedAt: null,
      outcome: null,
      technical: null,
      reason: "OWNER_RESPONSE_UNAVAILABLE",
    },
  };
}

test("review inventory distinguishes readable outcomes from custody candidates", async () => {
  const result = await readArtifactReviewInventoryV1({
    readHistorical: historical(),
    readArtifact: async ({ buildRequestIdentity, attemptIdentity }) => attemptIdentity === "attempt-1"
      ? unreadable(buildRequestIdentity, attemptIdentity)
      : readable(buildRequestIdentity, attemptIdentity),
    now: () => observedAtEpochMs + 100,
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.projection, {
    availability: "available",
    observedAt: new Date(observedAtEpochMs + 100).toISOString(),
    sourceObservedAt: new Date(observedAtEpochMs).toISOString(),
    completeness: "complete",
    candidateTotal: 3,
    scannedCandidateCount: 3,
    reviewableTotal: 2,
    unavailableTotal: 1,
    items: [
      { buildRequestIdentity: "build-0", attemptIdentity: "attempt-0", availability: "reviewable", disposition: "rejected", reason: null },
      { buildRequestIdentity: "build-1", attemptIdentity: "attempt-1", availability: "unavailable", disposition: null, reason: "OWNER_RESPONSE_UNAVAILABLE" },
      { buildRequestIdentity: "build-2", attemptIdentity: "attempt-2", availability: "reviewable", disposition: "rejected", reason: null },
    ],
    reason: null,
  });
  assert.deepEqual(parseArtifactReviewInventoryBrowserProjectionV1(result.projection), result.projection);
  assert.equal(artifactReviewInventoryMatchesCustodyV1(result.projection, custody()), true);
  assert.equal(artifactReviewInventoryMatchesCustodyV1(result.projection, {
    ...custody(),
    artifactAttempts: custody().artifactAttempts.slice(1),
  }), false);
});

test("review inventory preserves truncation and serializes its point reads", async () => {
  let active = 0;
  let maximum = 0;
  const source = custody(12, "PARTIAL_TRUNCATED", 20);
  const result = await readArtifactReviewInventoryV1({
    readHistorical: historical(source),
    readArtifact: async ({ buildRequestIdentity, attemptIdentity }) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return unreadable(buildRequestIdentity, attemptIdentity);
    },
    now: () => observedAtEpochMs + 100,
  });
  assert.equal(result.projection.completeness, "partial");
  assert.equal(result.projection.candidateTotal, 20);
  assert.equal(result.projection.scannedCandidateCount, 12);
  assert.equal(result.projection.unavailableTotal, 12);
  // These reads are deliberately serialized. They share an Owner adapter's connection pool with
  // the directory and question reads the same page composes, and measured against a real Owner any
  // parallelism here took those with it: the page reported its source unavailable and rendered
  // nothing while every row answered in tens of milliseconds when asked alone.
  assert.equal(maximum, 1);
});

test("unavailable custody and malformed browser totals fail closed", async () => {
  let reads = 0;
  const unavailable = await readArtifactReviewInventoryV1({
    readHistorical: async () => ({ status: 503, envelope: { availability: "unavailable" } }),
    readArtifact: async () => { reads += 1; return unreadable("build", "attempt"); },
  });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.projection.reason, "HISTORICAL_CUSTODY_UNAVAILABLE");
  assert.equal(reads, 0);

  const failedRead = await readArtifactReviewInventoryV1({
    readHistorical: historical(custody(1)),
    readArtifact: async () => { throw new Error("offline"); },
  });
  assert.equal(failedRead.status, 503);
  assert.equal(failedRead.projection.reason, "ARTIFACT_REVIEW_READ_UNAVAILABLE");

  const valid = (await readArtifactReviewInventoryV1({
    readHistorical: historical(custody(1)),
    readArtifact: async ({ buildRequestIdentity, attemptIdentity }) => readable(buildRequestIdentity, attemptIdentity),
    now: () => observedAtEpochMs + 100,
  })).projection;
  for (const candidate of [
    { ...valid, reviewableTotal: 0 },
    { ...valid, candidateTotal: 2 },
    { ...valid, smuggled: true },
    { ...valid, items: [{ ...valid.items[0], availability: "reviewable", reason: "OWNER_RESPONSE_UNAVAILABLE" }] },
  ]) assert.equal(parseArtifactReviewInventoryBrowserProjectionV1(candidate), null);
});
