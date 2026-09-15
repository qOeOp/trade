import assert from "node:assert/strict";
import test from "node:test";

import { projectResearchDecisionDirectoryV1 } from "../lib/research-decision-projection.ts";

const custody = {
  resolution: "RETRIEVED",
  completeness: "COMPLETE",
  observedAtEpochMs: 300,
  researchTotal: 3,
  artifactAttemptTotal: 0,
  bindingTotal: 0,
  research: [
    { requestIdentity: "request-a", committedAtEpochMs: 100, projectionState: "POINT_READ_REQUIRED" },
    { requestIdentity: "request-b", committedAtEpochMs: 200, projectionState: "POINT_READ_REQUIRED" },
    { requestIdentity: "request-c", committedAtEpochMs: 300, projectionState: "POINT_READ_REQUIRED" },
  ],
  artifactAttempts: [],
  bindings: [],
};
const inventory = {
  availability: "available",
  observedAt: "1970-01-01T00:00:00.400Z",
  sourceObservedAt: "1970-01-01T00:00:00.300Z",
  completeness: "complete",
  candidateTotal: 3,
  scannedCandidateCount: 3,
  outcomeReadyTotal: 2,
  awaitingOutcomeTotal: 1,
  unavailableTotal: 0,
  items: [
    { requestIdentity: "request-a", status: "outcome_ready", resolution: "quarantined", historicalDisposition: "accepted", reason: null },
    { requestIdentity: "request-b", status: "outcome_ready", resolution: "rejected", historicalDisposition: null, reason: null },
    { requestIdentity: "request-c", status: "awaiting_outcome", resolution: null, historicalDisposition: null, reason: null },
  ],
  reason: null,
};

test("decision projection preserves current and historical meaning", () => {
  const projected = projectResearchDecisionDirectoryV1(inventory, custody);
  assert.equal(projected.availability, "available");
  assert.deepEqual({
    accepted: projected.acceptedTotal,
    rejected: projected.rejectedTotal,
    decided: projected.decidedTotal,
    waiting: projected.waitingTotal,
  }, { accepted: 1, rejected: 1, decided: 2, waiting: 1 });
  assert.deepEqual(projected.rows.map(({ requestIdentity, decision, record, requestRecordedAtEpochMs }) => ({
    requestIdentity, decision, record, requestRecordedAtEpochMs,
  })), [
    { requestIdentity: "request-a", decision: "accepted", record: "historical", requestRecordedAtEpochMs: 100 },
    { requestIdentity: "request-b", decision: "rejected", record: "current", requestRecordedAtEpochMs: 200 },
  ]);
});

test("partial, unavailable, drifted, and decisionless cuts fail closed", () => {
  const cases = [
    [{ ...inventory, completeness: "partial" }, custody],
    [{ ...inventory, unavailableTotal: 1, awaitingOutcomeTotal: 0, items: [
      ...inventory.items.slice(0, 2),
      { requestIdentity: "request-c", status: "unavailable", resolution: null, historicalDisposition: null, reason: "unavailable" },
    ] }, custody],
    [inventory, { ...custody, research: custody.research.map((row, index) => index ? row : { ...row, requestIdentity: "request-d" }) }],
    [{ ...inventory, items: inventory.items.map((item, index) => index ? item : {
      ...item, resolution: "quarantined", historicalDisposition: null,
    }) }, custody],
  ];
  for (const [candidateInventory, candidateCustody] of cases) {
    const projected = projectResearchDecisionDirectoryV1(candidateInventory, candidateCustody);
    assert.equal(projected.availability, "unavailable");
    assert.deepEqual(projected.rows, []);
    assert.equal(projected.decidedTotal, 0);
  }
});
