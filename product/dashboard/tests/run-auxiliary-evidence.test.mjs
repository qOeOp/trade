import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  availableRunAuxiliaryEvidenceEnvelopeV1,
  parseRunAuxiliaryEvidenceEnvelopeV1,
  unavailableRunAuxiliaryEvidenceEnvelopeV1,
} from "../lib/run-auxiliary-evidence-contract.ts";
import { readRunAuxiliaryEvidenceGatewayV1 } from "../lib/run-auxiliary-evidence-gateway.ts";

const runIdentity = "dashboard-run-v1-00000000-0000-4000-8000-000000000091";
const observedAt = "2026-09-04T00:00:00.000Z";

test("auxiliary evidence exposes exact non-fabricated states for every unadmitted producer", () => {
  const expected = [
    ["metrics", "not_collected", "METRICS_PRODUCER_NOT_ADMITTED"],
    ["traces", "not_captured", "HTTP_TRACE_NOT_CAPTURED"],
    ["assets", "empty", "RUN_ASSET_STORE_NOT_ADMITTED"],
  ];
  for (const [evidenceKind, state, reason] of expected) {
    const envelope = availableRunAuxiliaryEvidenceEnvelopeV1({ runIdentity, evidenceKind, observedAt });
    const parsed = parseRunAuxiliaryEvidenceEnvelopeV1(envelope);
    assert.equal(parsed?.state, state);
    assert.equal(parsed?.reason, reason);
    assert.deepEqual(parsed?.entries, []);
  }
});

test("auxiliary evidence rejects invented samples and cross-kind state claims", () => {
  const envelope = availableRunAuxiliaryEvidenceEnvelopeV1({
    runIdentity, evidenceKind: "metrics", observedAt,
  });
  assert.equal(parseRunAuxiliaryEvidenceEnvelopeV1({ ...envelope, entries: [{ value: 0 }] }), null);
  assert.equal(parseRunAuxiliaryEvidenceEnvelopeV1({ ...envelope, state: "empty" }), null);
  assert.equal(parseRunAuxiliaryEvidenceEnvelopeV1({ ...envelope, reason: "HTTP_TRACE_NOT_CAPTURED" }), null);
  assert.equal(parseRunAuxiliaryEvidenceEnvelopeV1({ ...envelope, count: 0 }), null);
});

test("auxiliary evidence preserves run-detail unavailable reasons and status", async () => {
  const readDetail = async () => ({
    status: 404,
    envelope: {
      availability: "unavailable",
      unavailable_reason: "RUN_NOT_FOUND",
      observed_at: observedAt,
    },
  });
  const result = await readRunAuxiliaryEvidenceGatewayV1(runIdentity, "assets", readDetail);
  assert.equal(result.status, 404);
  assert.equal(result.envelope.unavailable_reason, "RUN_NOT_FOUND");
  assert.equal(parseRunAuxiliaryEvidenceEnvelopeV1(result.envelope)?.state, null);
});

test("auxiliary evidence gateway returns an empty typed cut only after a run-detail read succeeds", async () => {
  const readDetail = async () => ({
    status: 200,
    envelope: {
      availability: "available",
      unavailable_reason: null,
      observed_at: observedAt,
    },
  });
  const result = await readRunAuxiliaryEvidenceGatewayV1(runIdentity, "traces", readDetail);
  assert.equal(result.status, 200);
  assert.equal(result.envelope.state, "not_captured");
  assert.deepEqual(result.envelope.entries, []);
});

test("unavailable auxiliary geometry carries no state or entries", () => {
  const envelope = unavailableRunAuxiliaryEvidenceEnvelopeV1({
    runIdentity, evidenceKind: "metrics", reason: "RUN_STORE_CONFIGURATION_UNAVAILABLE", observedAt,
  });
  assert.equal(parseRunAuxiliaryEvidenceEnvelopeV1(envelope)?.availability, "unavailable");
  assert.equal(envelope.state, null);
  assert.deepEqual(envelope.entries, []);
});

test("all three GET routes and the Run Detail tabs consume the shared contract", async () => {
  const [metrics, traces, assets, component, detail] = await Promise.all([
    readFile(new URL("../app/api/operations/runs/[runIdentity]/metrics/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/operations/runs/[runIdentity]/traces/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/operations/runs/[runIdentity]/assets/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/operations-run-auxiliary-evidence.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/operations-run-detail.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(metrics, /readRunAuxiliaryEvidenceGatewayV1\(runIdentity, "metrics"\)/);
  assert.match(traces, /readRunAuxiliaryEvidenceGatewayV1\(runIdentity, "traces"\)/);
  assert.match(assets, /readRunAuxiliaryEvidenceGatewayV1\(runIdentity, "assets"\)/);
  assert.match(component, /parseRunAuxiliaryEvidenceEnvelopeV1/);
  assert.match(detail, /<OperationsRunAuxiliaryEvidence/);
  assert.doesNotMatch(detail, /has no admitted producer for this run/);
});
