import assert from "node:assert/strict";
import test from "node:test";

import { projectSourceIntakeJourneyV1 } from "../lib/source-intake-journey.ts";

const terminalProjection = {
  schemaVersion: 1,
  availability: "available",
  requestIdentity: "source-intake-request-v1-example",
  observedAt: "2026-09-15T01:00:00.000Z",
  state: "terminal",
  terminal: {
    requestIdentity: "source-intake-request-v1-example",
    resolution: "RETRIEVED",
    bindingIdentity: "source-intake-binding-v1-example",
    receiptIdentity: "source-intake-receipt-v1-example",
    committedAt: "2026-09-15T00:59:00.000Z",
    authorityClass: "LIVE_EXTERNAL",
    content: { state: "retained", digest: `sha256:${"a".repeat(64)}` },
  },
  reason: null,
};

test("Source Intake journey completes only when retrieved evidence is retained", () => {
  const journey = projectSourceIntakeJourneyV1(terminalProjection);
  assert.equal(journey?.summary, "Source evidence is sealed and ready");
  assert.deepEqual(journey?.stages.map(({ state }) => state), ["complete", "complete", "complete"]);
});

test("Source Intake journey keeps pending and negative Owner outcomes fail closed", () => {
  const pending = projectSourceIntakeJourneyV1({
    ...terminalProjection,
    state: "no_verified_terminal",
    terminal: null,
  });
  assert.deepEqual(pending?.stages.map(({ state }) => state), ["complete", "current", "pending"]);

  for (const resolution of ["NOT_FOUND", "AUTH_REQUIRED", "ACCESS_DENIED", "TERMS_OR_LICENSE_BLOCKED", "MALFORMED"]) {
    const journey = projectSourceIntakeJourneyV1({
      ...terminalProjection,
      terminal: { ...terminalProjection.terminal, resolution, content: null },
    });
    assert.deepEqual(journey?.stages.map(({ state }) => state), ["complete", "blocked", "pending"]);
  }

  for (const resolution of ["RATE_LIMITED", "UNAVAILABLE"]) {
    const journey = projectSourceIntakeJourneyV1({
      ...terminalProjection,
      terminal: { ...terminalProjection.terminal, resolution, content: null },
    });
    assert.deepEqual(journey?.stages.map(({ state }) => state), ["complete", "warning", "pending"]);
  }

  assert.equal(projectSourceIntakeJourneyV1({
    ...terminalProjection,
    availability: "unavailable",
    state: null,
    terminal: null,
    observedAt: null,
    reason: "OWNER_TRANSPORT_UNAVAILABLE",
  }), null);
});
