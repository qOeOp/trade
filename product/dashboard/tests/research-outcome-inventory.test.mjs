import assert from "node:assert/strict";
import test from "node:test";

import {
  parseResearchOutcomeInventoryBrowserProjectionV1,
  readResearchOutcomeInventoryV1,
  researchOutcomeInventoryMatchesCustodyV1,
} from "../lib/research-outcome-inventory.ts";

const observedAtEpochMs = 1_789_000_000_000;

function custody(count = 3, completeness = "COMPLETE", total = count) {
  return {
    resolution: "RETRIEVED",
    completeness,
    observedAtEpochMs,
    researchTotal: total,
    artifactAttemptTotal: 0,
    bindingTotal: 0,
    research: Array.from({ length: count }, (_, index) => ({
      requestIdentity: `research-request-${index}`,
      committedAtEpochMs: observedAtEpochMs - index,
      projectionState: "POINT_READ_REQUIRED",
    })),
    artifactAttempts: [],
    bindings: [],
  };
}

function historical(projection = custody()) {
  return async () => ({
    status: 200,
    envelope: { availability: "available", projection },
  });
}

function readable(requestIdentity, outcome) {
  return {
    status: 200,
    projection: {
      availability: "available",
      requestIdentity,
      observedAt: new Date(observedAtEpochMs).toISOString(),
      outcome,
      view: null,
      technical: outcome ? { ownerReceiptIdentity: `receipt-${requestIdentity}` } : null,
      reason: null,
    },
  };
}

function historicalOutcome(requestIdentity, historicalDisposition = "accepted") {
  return readable(requestIdentity, {
    resolution: "quarantined",
    historicalDisposition,
    intentIdentity: null,
    rejectionCode: historicalDisposition === "rejected" ? "REJECTED_REQUEST" : null,
    committedAt: new Date(observedAtEpochMs - 1).toISOString(),
  });
}

function unavailable(requestIdentity) {
  return {
    status: 503,
    projection: {
      availability: "unavailable",
      requestIdentity,
      observedAt: null,
      outcome: null,
      view: null,
      technical: null,
      reason: "OWNER_TRANSPORT_UNAVAILABLE",
    },
  };
}

test("outcome inventory distinguishes ready, awaiting, and unavailable Research requests", async () => {
  const result = await readResearchOutcomeInventoryV1({
    readHistorical: historical(),
    readResearch: async (requestIdentity) => requestIdentity.endsWith("0")
      ? historicalOutcome(requestIdentity)
      : requestIdentity.endsWith("1")
      ? readable(requestIdentity, null)
      : unavailable(requestIdentity),
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
    outcomeReadyTotal: 1,
    awaitingOutcomeTotal: 1,
    unavailableTotal: 1,
    items: [
      {
        requestIdentity: "research-request-0",
        status: "outcome_ready",
        resolution: "quarantined",
        historicalDisposition: "accepted",
        reason: null,
      },
      {
        requestIdentity: "research-request-1",
        status: "awaiting_outcome",
        resolution: null,
        historicalDisposition: null,
        reason: null,
      },
      {
        requestIdentity: "research-request-2",
        status: "unavailable",
        resolution: null,
        historicalDisposition: null,
        reason: "OWNER_TRANSPORT_UNAVAILABLE",
      },
    ],
    reason: null,
  });
  assert.deepEqual(parseResearchOutcomeInventoryBrowserProjectionV1(result.projection), result.projection);
  assert.equal(researchOutcomeInventoryMatchesCustodyV1(result.projection, custody()), true);
  assert.equal(researchOutcomeInventoryMatchesCustodyV1(result.projection, {
    ...custody(),
    research: custody().research.slice(1),
  }), false);
});

test("outcome inventory preserves truncation and serializes its point reads", async () => {
  let active = 0;
  let maximum = 0;
  const source = custody(12, "PARTIAL_TRUNCATED", 20);
  const result = await readResearchOutcomeInventoryV1({
    readHistorical: historical(source),
    readResearch: async (requestIdentity) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return readable(requestIdentity, null);
    },
    now: () => observedAtEpochMs + 100,
  });
  assert.equal(result.projection.completeness, "partial");
  assert.equal(result.projection.candidateTotal, 20);
  assert.equal(result.projection.scannedCandidateCount, 12);
  assert.equal(result.projection.awaitingOutcomeTotal, 12);
  // These reads are deliberately serialized. They share an Owner adapter's connection pool with
  // the directory and question reads the same page composes, and measured against a real Owner any
  // parallelism here took those with it: the page reported its source unavailable and rendered
  // nothing while every row answered in tens of milliseconds when asked alone.
  assert.equal(maximum, 1);
});

test("unavailable custody, thrown reads, and malformed browser totals fail closed", async () => {
  let reads = 0;
  const missingCustody = await readResearchOutcomeInventoryV1({
    readHistorical: async () => ({ status: 503, envelope: { availability: "unavailable" } }),
    readResearch: async (requestIdentity) => { reads += 1; return unavailable(requestIdentity); },
  });
  assert.equal(missingCustody.status, 503);
  assert.equal(missingCustody.projection.reason, "HISTORICAL_CUSTODY_UNAVAILABLE");
  assert.equal(reads, 0);

  const failedRead = await readResearchOutcomeInventoryV1({
    readHistorical: historical(custody(1)),
    readResearch: async () => { throw new Error("offline"); },
  });
  assert.equal(failedRead.status, 503);
  assert.equal(failedRead.projection.reason, "RESEARCH_OUTCOME_READ_UNAVAILABLE");

  const valid = (await readResearchOutcomeInventoryV1({
    readHistorical: historical(custody(1)),
    readResearch: async (requestIdentity) => historicalOutcome(requestIdentity),
    now: () => observedAtEpochMs + 100,
  })).projection;
  for (const candidate of [
    { ...valid, outcomeReadyTotal: 0 },
    { ...valid, candidateTotal: 2 },
    { ...valid, smuggled: true },
    { ...valid, items: [{ ...valid.items[0], status: "awaiting_outcome" }] },
  ]) assert.equal(parseResearchOutcomeInventoryBrowserProjectionV1(candidate), null);
});
