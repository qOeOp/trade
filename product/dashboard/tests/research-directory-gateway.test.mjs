import assert from "node:assert/strict";
import test from "node:test";

import {
  createResearchDirectoryRequestGuardV1,
  mergeResearchDirectoryItemsV1,
  parseResearchDirectoryBrowserProjectionV1,
  projectResearchDirectoryOwnerReadbackV1,
  readResearchDirectoryGatewayV1,
} from "../lib/research-directory-gateway.ts";

const ownerReadback = {
  schema_version: 1,
  observed_at_epoch_ms: 1_788_669_600_000,
  completeness: "PARTIAL",
  omitted_count: 1,
  next_cursor: {
    committed_at_epoch_ms: 1_788_669_500_000,
    request_identity: "research-request-1",
  },
  items: [{
    request_identity: "research-request-2",
    intent_identity: "research-intent-2",
    disposition: "ACCEPTED",
    availability: "AVAILABLE",
    phase: "INTENT_FROZEN",
    committed_at_epoch_ms: 1_788_669_550_000,
  }],
};

test("exact Owner Research directory becomes a bounded browser projection", () => {
  const projected = projectResearchDirectoryOwnerReadbackV1(ownerReadback);
  assert.deepEqual(projected, {
    availability: "available",
    observedAt: new Date(ownerReadback.observed_at_epoch_ms).toISOString(),
    completeness: "partial",
    omittedCount: 1,
    nextCursor: { committedAtEpochMs: 1_788_669_500_000, requestIdentity: "research-request-1" },
    items: [{
      requestIdentity: "research-request-2",
      intentIdentity: "research-intent-2",
      disposition: "ACCEPTED",
      availability: "AVAILABLE",
      phase: "INTENT_FROZEN",
      committedAt: new Date(1_788_669_550_000).toISOString(),
    }],
    reason: null,
  });
  assert.deepEqual(parseResearchDirectoryBrowserProjectionV1(projected), projected);
});

test("rejected-no-write rows cannot invent an intent or current view", () => {
  const rejected = structuredClone(ownerReadback);
  rejected.items = [{
    request_identity: "research-request-rejected",
    intent_identity: null,
    disposition: "REJECTED_NO_WRITE",
    availability: null,
    phase: null,
    committed_at_epoch_ms: 1_788_669_540_000,
  }];
  assert.equal(projectResearchDirectoryOwnerReadbackV1(rejected)?.items[0].intentIdentity, null);
  for (const mutation of [
    { intent_identity: "invented-intent" },
    { availability: "AVAILABLE" },
    { phase: "INTENT_FROZEN" },
  ]) {
    rejected.items[0] = { ...rejected.items[0], ...mutation };
    assert.equal(projectResearchDirectoryOwnerReadbackV1(rejected), null);
  }
});

test("projection rejects shape, enum, completeness, duplicates and future time", () => {
  for (const candidate of [
    { ...ownerReadback, unexpected: true },
    { ...ownerReadback, completeness: "COMPLETE" },
    { ...ownerReadback, completeness: ["PARTIAL"] },
    { ...ownerReadback, items: [{ ...ownerReadback.items[0], phase: "RUNNING" }] },
    { ...ownerReadback, items: [{ ...ownerReadback.items[0], disposition: ["ACCEPTED"] }] },
    { ...ownerReadback, items: [{ ...ownerReadback.items[0], committed_at_epoch_ms: 1_788_669_700_000 }] },
    { ...ownerReadback, items: [ownerReadback.items[0], ownerReadback.items[0]] },
    { ...ownerReadback, next_cursor: { ...ownerReadback.next_cursor, unexpected: true } },
  ]) assert.equal(projectResearchDirectoryOwnerReadbackV1(candidate), null);
});

test("browser projection independently rejects duplicate identities, future time and oversized omissions", () => {
  const projected = projectResearchDirectoryOwnerReadbackV1(ownerReadback);
  assert.ok(projected);
  for (const candidate of [
    { ...projected, omittedCount: 61 },
    { ...projected, items: [{ ...projected.items[0], committedAt: new Date(ownerReadback.observed_at_epoch_ms + 1).toISOString() }] },
    { ...projected, items: [projected.items[0], projected.items[0]] },
  ]) assert.equal(parseResearchDirectoryBrowserProjectionV1(candidate), null);
});

test("gateway binds one authenticated no-store GET and strict cursor", async () => {
  const calls = [];
  const result = await readResearchDirectoryGatewayV1({
    cursor: { committedAtEpochMs: 1_788_669_600_000, requestIdentity: "research-request-3" },
    baseUrl: "http://rd-owner-api:8080/",
    token: "secret",
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(ownerReadback), { status: 200 });
    },
  });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  const called = new URL(calls[0].url);
  assert.equal(called.pathname, "/v1/research-goals/directory");
  assert.deepEqual(Object.fromEntries(called.searchParams), {
    limit: "20",
    after_committed_at_epoch_ms: "1788669600000",
    after_request_identity: "research-request-3",
  });
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.cache, "no-store");
  assert.deepEqual(calls[0].init.headers, { authorization: "Bearer secret" });
  assert.equal(calls[0].init.body, undefined);
});

test("stale requests, duplicate pages and nonadvancing cursors fail closed", async () => {
  const guard = createResearchDirectoryRequestGuardV1();
  const older = guard.begin();
  const refresh = guard.begin();
  assert.equal(guard.isCurrent(older), false);
  assert.equal(guard.isCurrent(refresh), true);
  const projection = projectResearchDirectoryOwnerReadbackV1(ownerReadback);
  assert.ok(projection);
  assert.equal(mergeResearchDirectoryItemsV1(projection.items, projection.items), null);

  const result = await readResearchDirectoryGatewayV1({
    cursor: projection.nextCursor,
    baseUrl: "http://rd-owner-api:8080/",
    token: "secret",
    fetcher: async () => new Response(JSON.stringify(ownerReadback), { status: 200 }),
  });
  assert.equal(result.status, 502);
  assert.equal(result.projection.availability, "unavailable");
});

test("invalid cursor, missing config, malformed and oversized responses stay unavailable", async () => {
  let calls = 0;
  const fetcher = async () => { calls += 1; throw new Error("must not fetch"); };
  const invalid = await readResearchDirectoryGatewayV1({
    cursor: { committedAtEpochMs: -1, requestIdentity: "bad identity" },
    baseUrl: "http://rd-owner-api:8080/",
    token: "secret",
    fetcher,
  });
  const missing = await readResearchDirectoryGatewayV1({ fetcher });
  assert.equal(calls, 0);
  assert.equal(invalid.status, 400);
  assert.equal(missing.status, 503);

  for (const response of [
    new Response("not json", { status: 200 }),
    new Response(JSON.stringify(ownerReadback), {
      status: 200,
      headers: { "content-length": String(513 * 1024) },
    }),
    new Response("unavailable", { status: 503 }),
  ]) {
    const result = await readResearchDirectoryGatewayV1({
      baseUrl: "http://rd-owner-api:8080/",
      token: "secret",
      fetcher: async () => response,
    });
    assert.notEqual(result.status, 200);
    assert.equal(result.projection.availability, "unavailable");
    assert.deepEqual(result.projection.items, []);
  }
});
