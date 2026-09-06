import assert from "node:assert/strict";
import test from "node:test";

import {
  createArtifactDirectoryRequestGuardV1,
  mergeArtifactDirectoryItemsV1,
  parseArtifactDirectoryBrowserProjectionV1,
  projectArtifactDirectoryOwnerReadbackV1,
  readArtifactDirectoryGatewayV1,
} from "../lib/artifact-directory-gateway.ts";

const ownerReadback = {
  schema_version: 1,
  observed_at_epoch_ms: 1_788_669_600_000,
  completeness: "PARTIAL",
  omitted_count: 1,
  next_cursor: {
    prepared_at_epoch_ms: 1_788_669_500_000,
    build_request_identity: "artifact-build-1",
  },
  items: [{
    build_request_identity: "artifact-build-1",
    attempt_identity: "artifact-attempt-1",
    artifact_identity: `blake3:${"a".repeat(64)}`,
    intent_identity: "strategy-intent-1",
    committed_at_epoch_ms: 1_788_669_550_000,
    build_target: "wasm32-wasip1",
    build_security_state: "ADMITTED",
  }],
};

test("exact Owner directory readback becomes a bounded browser projection", () => {
  const projected = projectArtifactDirectoryOwnerReadbackV1(ownerReadback);
  assert.deepEqual(projected, {
    availability: "available",
    observedAt: new Date(ownerReadback.observed_at_epoch_ms).toISOString(),
    completeness: "partial",
    omittedCount: 1,
    nextCursor: {
      preparedAtEpochMs: ownerReadback.next_cursor.prepared_at_epoch_ms,
      buildRequestIdentity: "artifact-build-1",
    },
    items: [{
      buildRequestIdentity: "artifact-build-1",
      attemptIdentity: "artifact-attempt-1",
      artifactIdentity: ownerReadback.items[0].artifact_identity,
      intentIdentity: "strategy-intent-1",
      committedAt: new Date(ownerReadback.items[0].committed_at_epoch_ms).toISOString(),
      buildTarget: "wasm32-wasip1",
      buildSecurityState: "ADMITTED",
    }],
    reason: null,
  });
  assert.deepEqual(parseArtifactDirectoryBrowserProjectionV1(projected), projected);
});

test("directory projection fails closed for shape, security, completeness and time drift", () => {
  for (const candidate of [
    { ...ownerReadback, unexpected: true },
    { ...ownerReadback, completeness: "COMPLETE" },
    { ...ownerReadback, completeness: ["PARTIAL"] },
    { ...ownerReadback, observed_at_epoch_ms: Number.MAX_SAFE_INTEGER },
    { ...ownerReadback, items: [{ ...ownerReadback.items[0], build_security_state: "PENDING" }] },
    { ...ownerReadback, items: [{ ...ownerReadback.items[0], committed_at_epoch_ms: -1 }] },
    { ...ownerReadback, next_cursor: { ...ownerReadback.next_cursor, unexpected: true } },
  ]) assert.equal(projectArtifactDirectoryOwnerReadbackV1(candidate), null);
});

test("gateway binds one authenticated no-store GET and a strictly advancing cursor", async () => {
  const calls = [];
  const result = await readArtifactDirectoryGatewayV1({
    cursor: { preparedAtEpochMs: 1_788_669_600_000, buildRequestIdentity: "artifact-build-2" },
    baseUrl: "http://rd-owner-api:8080/",
    token: "secret",
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(ownerReadback), { status: 200 });
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.projection.availability, "available");
  assert.equal(calls.length, 1);
  const called = new URL(calls[0].url);
  assert.equal(called.pathname, "/v1/artifact-builds/directory");
  assert.deepEqual(Object.fromEntries(called.searchParams), {
    limit: "20",
    after_prepared_at_epoch_ms: "1788669600000",
    after_build_request_identity: "artifact-build-2",
  });
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.cache, "no-store");
  assert.deepEqual(calls[0].init.headers, { authorization: "Bearer secret" });
  assert.equal(calls[0].init.body, undefined);
});

test("request ordering and accumulated identity checks reject stale or repeated pages", () => {
  const guard = createArtifactDirectoryRequestGuardV1();
  const older = guard.begin();
  const refresh = guard.begin();
  assert.equal(guard.isCurrent(older), false);
  assert.equal(guard.isCurrent(refresh), true);

  const projection = projectArtifactDirectoryOwnerReadbackV1(ownerReadback);
  assert.ok(projection);
  assert.equal(mergeArtifactDirectoryItemsV1(projection.items, projection.items), null);
  assert.equal(mergeArtifactDirectoryItemsV1([], projection.items).length, 1);
});

test("gateway rejects a nonadvancing Owner cursor", async () => {
  const result = await readArtifactDirectoryGatewayV1({
    cursor: {
      preparedAtEpochMs: ownerReadback.next_cursor.prepared_at_epoch_ms,
      buildRequestIdentity: ownerReadback.next_cursor.build_request_identity,
    },
    baseUrl: "http://rd-owner-api:8080/",
    token: "secret",
    fetcher: async () => new Response(JSON.stringify(ownerReadback), { status: 200 }),
  });
  assert.equal(result.status, 502);
  assert.equal(result.projection.availability, "unavailable");
  assert.deepEqual(result.projection.items, []);
});

test("browser projection rejects coerced enum arrays", () => {
  const projection = projectArtifactDirectoryOwnerReadbackV1(ownerReadback);
  assert.ok(projection);
  assert.equal(parseArtifactDirectoryBrowserProjectionV1({
    ...projection,
    completeness: ["partial"],
  }), null);
  assert.equal(parseArtifactDirectoryBrowserProjectionV1({
    ...projection,
    availability: ["available"],
  }), null);
});

test("invalid cursor and missing configuration make zero Owner calls", async () => {
  let calls = 0;
  const fetcher = async () => { calls += 1; throw new Error("must not fetch"); };
  const invalid = await readArtifactDirectoryGatewayV1({
    cursor: { preparedAtEpochMs: -1, buildRequestIdentity: "bad identity" },
    baseUrl: "http://rd-owner-api:8080/",
    token: "secret",
    fetcher,
  });
  const missing = await readArtifactDirectoryGatewayV1({ fetcher });
  assert.equal(calls, 0);
  assert.equal(invalid.status, 400);
  assert.equal(missing.status, 503);
  assert.equal(invalid.projection.availability, "unavailable");
  assert.equal(missing.projection.availability, "unavailable");
});

test("malformed and oversized Owner responses remain unavailable", async () => {
  for (const response of [
    new Response("not json", { status: 200 }),
    new Response(JSON.stringify(ownerReadback), {
      status: 200,
      headers: { "content-length": String(513 * 1024) },
    }),
    new Response("unavailable", { status: 503 }),
  ]) {
    const result = await readArtifactDirectoryGatewayV1({
      baseUrl: "http://rd-owner-api:8080/",
      token: "secret",
      fetcher: async () => response,
    });
    assert.notEqual(result.status, 200);
    assert.equal(result.projection.availability, "unavailable");
    assert.deepEqual(result.projection.items, []);
  }
});
