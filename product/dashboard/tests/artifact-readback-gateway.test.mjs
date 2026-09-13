import assert from "node:assert/strict";
import test from "node:test";

import {
  parseArtifactHistoricalBrowserProjectionV1,
  projectArtifactHistoricalOwnerReadbackV1,
  readArtifactHistoricalGatewayV1,
} from "../lib/artifact-readback-gateway.ts";

const buildRequestIdentity = "artifact-build-1";
const attemptIdentity = "artifact-attempt-1";
const observedAtEpochMs = 1_788_669_700_000;
const ownerReadback = {
  schema_version: 1,
  resolution: "LEGACY_TERMINAL_QUARANTINED",
  build_request_identity: buildRequestIdentity,
  attempt_identity: attemptIdentity,
  owner_receipt: {
    schema_version: 1,
    receipt_identity: "rd-artifact-build-receipt-v1-a",
    build_request_identity: buildRequestIdentity,
    attempt_identity: attemptIdentity,
    request_semantic_digest: `sha256:${"a".repeat(64)}`,
    intent_identity: "intent-1",
    intent_semantic_digest: `sha256:${"b".repeat(64)}`,
    disposition: "REJECTED_NO_WRITE",
    artifact_identity: null,
    build_receipt_identity: null,
    failure_code: "INVALID_BUILD_REQUEST",
    committed_at_epoch_ms: 1_788_669_600_000,
  },
  research_view: null,
  artifact_review: null,
  artifact_review_actions: null,
  trial_family_resolution: "TRIAL_FAMILY_UNAVAILABLE_LEGACY",
  next_legal_action: "RESOLVE_SAME_ATTEMPT_IDENTITY",
};

test("exact legacy rejection becomes a quarantined business projection", () => {
  const projection = projectArtifactHistoricalOwnerReadbackV1(
    ownerReadback,
    buildRequestIdentity,
    attemptIdentity,
    observedAtEpochMs,
  );
  assert.deepEqual(projection, {
    availability: "available",
    buildRequestIdentity,
    attemptIdentity,
    observedAt: new Date(observedAtEpochMs).toISOString(),
    outcome: {
      resolution: "quarantined",
      historicalDisposition: "rejected",
      failureCode: "INVALID_BUILD_REQUEST",
      committedAt: new Date(ownerReadback.owner_receipt.committed_at_epoch_ms).toISOString(),
    },
    technical: { ownerReceiptIdentity: ownerReadback.owner_receipt.receipt_identity },
    reason: null,
  });
  assert.deepEqual(
    parseArtifactHistoricalBrowserProjectionV1(projection, buildRequestIdentity, attemptIdentity),
    projection,
  );
});

test("current, successful, widened and identity-drifted responses fail closed", () => {
  for (const candidate of [
    { ...ownerReadback, resolution: "REJECTED_NO_WRITE" },
    { ...ownerReadback, owner_receipt: { ...ownerReadback.owner_receipt, disposition: "SUCCESS" } },
    { ...ownerReadback, attempt_identity: "other-attempt" },
    { ...ownerReadback, smuggled: true },
    { ...ownerReadback, artifact_review: {} },
  ]) {
    assert.equal(projectArtifactHistoricalOwnerReadbackV1(
      candidate,
      buildRequestIdentity,
      attemptIdentity,
      observedAtEpochMs,
    ), null);
  }
});

test("gateway binds one no-store GET to the consolidated read target", async () => {
  const calls = [];
  const result = await readArtifactHistoricalGatewayV1({
    buildRequestIdentity,
    attemptIdentity,
    environment: {
      RD_DASHBOARD_OWNER_READ_API_URL: "http://dashboard-read:8082/",
      RD_DASHBOARD_OWNER_READ_API_TOKEN: "read-secret",
      RD_OWNER_API_URL: "http://write-owner:8080/",
      RD_OWNER_API_TOKEN: "write-secret",
    },
    now: () => observedAtEpochMs,
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(ownerReadback));
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.projection.availability, "available");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://dashboard-read:8082/v1/artifact-builds/artifact-build-1/attempts/artifact-attempt-1/readback");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.cache, "no-store");
  assert.deepEqual(calls[0].init.headers, { authorization: "Bearer read-secret" });
  assert.equal(calls[0].init.body, undefined);
});

test("invalid identity, malformed Owner data and transport errors remain unavailable", async () => {
  let calls = 0;
  const invalid = await readArtifactHistoricalGatewayV1({
    buildRequestIdentity: "bad identity",
    attemptIdentity,
    baseUrl: "http://dashboard-read:8082/",
    token: "secret",
    fetcher: async () => { calls += 1; return new Response("{}"); },
  });
  assert.equal(invalid.status, 400);
  assert.equal(calls, 0);

  for (const [expectedStatus, fetcher] of [
    [502, async () => new Response(JSON.stringify({ ...ownerReadback, smuggled: true }))],
    [503, async () => { throw new Error("offline"); }],
  ]) {
    const result = await readArtifactHistoricalGatewayV1({
      buildRequestIdentity,
      attemptIdentity,
      baseUrl: "http://dashboard-read:8082/",
      token: "secret",
      fetcher,
    });
    assert.equal(result.status, expectedStatus);
    assert.equal(result.projection.availability, "unavailable");
    assert.equal(result.projection.outcome, null);
  }
});
