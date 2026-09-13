import assert from "node:assert/strict";
import test from "node:test";

import {
  parseExploratoryReplayHistoricalRejectionBrowserProjectionV1,
  readExploratoryReplayHistoricalRejectionGatewayV1,
} from "../lib/exploratory-replay-historical-rejection-gateway.ts";

const requestIdentity = "s3-final-reject-request-v1";
const attemptIdentity = "s3-final-reject-attempt-v1";
const semanticDigest = `sha256:${"3".repeat(64)}`;
const observedAtEpochMs = 1_787_266_714_000;
const committedAtEpochMs = 1_787_266_713_583;
const ownerReadback = {
  schema_version: 1,
  resolution: "LEGACY_REJECTION_QUARANTINED",
  disposition: "REJECTED_NO_WRITE",
  rejection_code: "INVALID_REPLAY_EVIDENCE",
  request_identity: requestIdentity,
  attempt_identity: attemptIdentity,
  semantic_digest: semanticDigest,
  receipt_identity: `rd-exploratory-request-rejection-v1-${"3".repeat(64)}`,
  artifact_identity: `blake3:${"a".repeat(64)}`,
  build_receipt_identity: `rd-build-receipt-v1-${"a".repeat(64)}`,
  channel: "MCP",
  committed_at_epoch_ms: committedAtEpochMs,
};

const environment = {
  RD_DASHBOARD_OWNER_READ_API_URL: "http://dashboard-read:8082/",
  RD_DASHBOARD_OWNER_READ_API_TOKEN: "read-secret",
  RD_OWNER_API_URL: "http://write-owner:8080/",
  RD_OWNER_API_TOKEN: "write-secret",
};

test("exact historical Replay rejection becomes a quarantined business projection", async () => {
  const result = await readExploratoryReplayHistoricalRejectionGatewayV1({
    requestIdentity,
    attemptIdentity,
    semanticDigest,
    environment,
    now: () => observedAtEpochMs,
    fetcher: async () => Response.json(ownerReadback),
  });

  assert.deepEqual(result, {
    status: 200,
    projection: {
      availability: "available",
      requestIdentity,
      attemptIdentity,
      observedAt: new Date(observedAtEpochMs).toISOString(),
      outcome: {
        record: "historical",
        result: "rejected",
        verification: "quarantined",
        committedAt: new Date(committedAtEpochMs).toISOString(),
      },
      technical: {
        semanticDigest,
        receiptIdentity: ownerReadback.receipt_identity,
        artifactIdentity: ownerReadback.artifact_identity,
        buildReceiptIdentity: ownerReadback.build_receipt_identity,
        rejectionCode: "INVALID_REPLAY_EVIDENCE",
        channel: "MCP",
      },
      reason: null,
    },
  });
  assert.deepEqual(
    parseExploratoryReplayHistoricalRejectionBrowserProjectionV1(
      result.projection,
      requestIdentity,
      attemptIdentity,
      semanticDigest,
    ),
    result.projection,
  );
});

test("gateway binds one authenticated no-store GET to the consolidated read API", async () => {
  const calls = [];
  const result = await readExploratoryReplayHistoricalRejectionGatewayV1({
    requestIdentity,
    attemptIdentity,
    semanticDigest,
    environment,
    now: () => observedAtEpochMs,
    fetcher: async (url, init) => {
      calls.push({ url: new URL(url), init });
      return Response.json(ownerReadback);
    },
  });

  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin, "http://dashboard-read:8082");
  assert.equal(calls[0].url.pathname, "/v1/exploratory-replay-rejections/readback");
  assert.deepEqual(Object.fromEntries(calls[0].url.searchParams), {
    request_identity: requestIdentity,
    attempt_identity: attemptIdentity,
    semantic_digest: semanticDigest,
  });
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.cache, "no-store");
  assert.deepEqual(calls[0].init.headers, { authorization: "Bearer read-secret" });
  assert.equal(calls[0].init.body, undefined);
});

test("current success, cross-spliced, widened and malformed custody fail closed", async () => {
  const candidates = [
    { ...ownerReadback, disposition: "SUCCESS" },
    { ...ownerReadback, resolution: "CURRENT" },
    { ...ownerReadback, request_identity: "other-replay-request-v1" },
    { ...ownerReadback, receipt_identity: "other-rejection-receipt-v1" },
    { ...ownerReadback, artifact_identity: null },
    { ...ownerReadback, channel: ["MCP"] },
    { ...ownerReadback, smuggled: true },
  ];
  for (const candidate of candidates) {
    const result = await readExploratoryReplayHistoricalRejectionGatewayV1({
      requestIdentity,
      attemptIdentity,
      semanticDigest,
      environment,
      fetcher: async () => Response.json(candidate),
    });
    assert.equal(result.status, 502);
    assert.equal(result.projection.availability, "unavailable");
    assert.equal(result.projection.outcome, null);
    assert.equal(result.projection.technical, null);
  }
});

test("invalid selector and malformed read configuration dispatch no Owner request", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return Response.json(ownerReadback);
  };
  const invalidSelector = await readExploratoryReplayHistoricalRejectionGatewayV1({
    requestIdentity: "short",
    attemptIdentity,
    semanticDigest,
    environment,
    fetcher,
  });
  assert.equal(invalidSelector.status, 400);
  const invalidConfiguration = await readExploratoryReplayHistoricalRejectionGatewayV1({
    requestIdentity,
    attemptIdentity,
    semanticDigest,
    environment: {
      RD_DASHBOARD_OWNER_READ_API_URL: "http://dashboard-read:8082/path",
      RD_DASHBOARD_OWNER_READ_API_TOKEN: "bad\ntoken",
    },
    fetcher,
  });
  assert.equal(invalidConfiguration.status, 503);
  assert.equal(calls, 0);
});

test("browser projection rejects added technical fields and unavailable data leakage", () => {
  const available = {
    availability: "available",
    requestIdentity,
    attemptIdentity,
    observedAt: new Date(observedAtEpochMs).toISOString(),
    outcome: {
      record: "historical",
      result: "rejected",
      verification: "quarantined",
      committedAt: new Date(committedAtEpochMs).toISOString(),
    },
    technical: {
      semanticDigest,
      receiptIdentity: ownerReadback.receipt_identity,
      artifactIdentity: ownerReadback.artifact_identity,
      buildReceiptIdentity: ownerReadback.build_receipt_identity,
      rejectionCode: "INVALID_REPLAY_EVIDENCE",
      channel: "MCP",
    },
    reason: null,
  };
  assert.equal(parseExploratoryReplayHistoricalRejectionBrowserProjectionV1(
    { ...available, operation_json: {} }, requestIdentity, attemptIdentity, semanticDigest,
  ), null);
  assert.equal(parseExploratoryReplayHistoricalRejectionBrowserProjectionV1({
    ...available,
    availability: "unavailable",
    outcome: available.outcome,
    reason: "OWNER_UNAVAILABLE",
  }, requestIdentity, attemptIdentity, semanticDigest), null);
  assert.equal(parseExploratoryReplayHistoricalRejectionBrowserProjectionV1({
    ...available,
    technical: { ...available.technical, semanticDigest: `sha256:${"4".repeat(64)}` },
  }, requestIdentity, attemptIdentity, semanticDigest), null);
  assert.equal(parseExploratoryReplayHistoricalRejectionBrowserProjectionV1({
    ...available,
    availability: ["available"],
  }, requestIdentity, attemptIdentity, semanticDigest), null);
  assert.equal(parseExploratoryReplayHistoricalRejectionBrowserProjectionV1({
    ...available,
    technical: { ...available.technical, channel: ["MCP"] },
  }, requestIdentity, attemptIdentity, semanticDigest), null);
});
