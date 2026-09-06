import assert from "node:assert/strict";
import test from "node:test";

import {
  parseDevelopComposerBrowserProjectionV1,
  readDevelopComposerGatewayV1,
} from "../lib/develop-composer-readback-gateway.ts";

const bytes = (value) => Array.from({ length: 32 }, () => value);
const hex = (value) => value.toString(16).padStart(2, "0").repeat(32);

function success(requestIdentity = "composer-request-1") {
  return {
    schema_version: 2,
    request_identity: requestIdentity,
    disposition: "SUCCESS",
    receipt_identity: bytes(1),
    artifact: {
      artifact_locator: "rd-strategy-artifact-v2-abc",
      artifact_digest: bytes(2),
      canonical_plan_digest: bytes(3),
      design_digest: bytes(4),
    },
    coordinate: null,
    reason: null,
  };
}

test("gateway performs one authenticated GET and exposes only the bounded Composer projection", async () => {
  const calls = [];
  const result = await readDevelopComposerGatewayV1({
    requestIdentity: "composer-request-1",
    environment: { RD_OWNER_API_URL: "http://rd-owner-api:8080/", RD_OWNER_API_TOKEN: "secret" },
    clock: () => Date.parse("2026-09-06T12:00:00.000Z"),
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(success()), { status: 200 });
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://rd-owner-api:8080/v2/develop-composer/runs/composer-request-1/readback");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.cache, "no-store");
  assert.deepEqual(calls[0].init.headers, { authorization: "Bearer secret" });
  assert.equal(result.status, 200);
  assert.equal(result.projection.readback.receiptIdentity, hex(1));
  assert.deepEqual(result.projection.readback.artifact, {
    locator: "rd-strategy-artifact-v2-abc",
    artifactDigest: hex(2),
    canonicalPlanDigest: hex(3),
    designDigest: hex(4),
  });
  assert.deepEqual(parseDevelopComposerBrowserProjectionV1(result.projection), result.projection);
  assert.doesNotMatch(JSON.stringify(result.projection), /schema_version|receipt_identity|artifact_locator/u);
});

test("an exact Owner unavailable response remains a readback without inventing a positive projection", async () => {
  const result = await readDevelopComposerGatewayV1({
    requestIdentity: "composer-request-2",
    environment: { RD_OWNER_API_URL: "http://rd-owner-api:8080", RD_OWNER_API_TOKEN: "secret" },
    fetcher: async () => new Response(JSON.stringify({
      schema_version: 2,
      request_identity: "composer-request-2",
      disposition: "UNAVAILABLE",
      receipt_identity: null,
      artifact: null,
      coordinate: "composer.acceptance",
      reason: "Durable Composer is unavailable outside the sealed acceptance build",
    }), { status: 503 }),
  });
  assert.equal(result.status, 200);
  assert.equal(result.projection.availability, "available");
  assert.equal(result.projection.readback.disposition, "UNAVAILABLE");
  assert.equal(result.projection.readback.receiptIdentity, null);
  assert.equal(result.projection.readback.artifact, null);
});

test("invalid identity and missing configuration make zero Owner calls", async () => {
  let calls = 0;
  const fetcher = async () => { calls += 1; throw new Error("must not fetch"); };
  const invalid = await readDevelopComposerGatewayV1({
    requestIdentity: "bad identity",
    environment: { RD_OWNER_API_URL: "http://rd-owner-api:8080", RD_OWNER_API_TOKEN: "secret" },
    fetcher,
  });
  const missing = await readDevelopComposerGatewayV1({
    requestIdentity: "composer-request-1",
    environment: {},
    fetcher,
  });
  assert.equal(calls, 0);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.projection.reason, "INVALID_REQUEST_IDENTITY");
  assert.equal(missing.status, 503);
  assert.equal(missing.projection.reason, "OWNER_CONFIGURATION_UNAVAILABLE");
});

test("identity drift, contradictory success, unknown keys and oversized responses fail closed", async () => {
  const invalidBodies = [
    { ...success("another-request") },
    { ...success(), receipt_identity: null },
    { ...success(), coordinate: "unexpected" },
    { ...success(), raw_design_bytes: [] },
  ];
  for (const body of invalidBodies) {
    const result = await readDevelopComposerGatewayV1({
      requestIdentity: "composer-request-1",
      environment: { RD_OWNER_API_URL: "http://rd-owner-api:8080", RD_OWNER_API_TOKEN: "secret" },
      fetcher: async () => new Response(JSON.stringify(body), { status: 200 }),
    });
    assert.equal(result.status, 502);
    assert.equal(result.projection.availability, "unavailable");
    assert.equal(result.projection.readback, null);
  }
  const oversized = await readDevelopComposerGatewayV1({
    requestIdentity: "composer-request-1",
    environment: { RD_OWNER_API_URL: "http://rd-owner-api:8080", RD_OWNER_API_TOKEN: "secret" },
    fetcher: async () => new Response("x".repeat(1_048_577), { status: 200 }),
  });
  assert.equal(oversized.status, 502);
  assert.equal(oversized.projection.readback, null);
});

test("browser parser rejects raw additions and non-success positive fields", () => {
  const projection = {
    schemaVersion: 1,
    availability: "available",
    requestIdentity: "composer-request-1",
    observedAt: "2026-09-06T12:00:00.000Z",
    state: "readback",
    readback: {
      disposition: "UNAVAILABLE",
      receiptIdentity: null,
      artifact: null,
      coordinate: "operation",
      reason: "terminal is unavailable",
    },
    reason: null,
  };
  assert.deepEqual(parseDevelopComposerBrowserProjectionV1(projection), projection);
  assert.equal(parseDevelopComposerBrowserProjectionV1({ ...projection, raw: {} }), null);
  assert.equal(parseDevelopComposerBrowserProjectionV1({
    ...projection,
    readback: { ...projection.readback, receiptIdentity: hex(1) },
  }), null);
});
