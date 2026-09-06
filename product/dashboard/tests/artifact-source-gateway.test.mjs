import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  projectArtifactSourceOwnerReadbackV1,
  readArtifactSourceGatewayV1,
} from "../lib/artifact-source-gateway.ts";

const source = "#![no_std]\npub fn signal() -> u32 { 1 }\n";
const sourceDigest = `sha256:${createHash("sha256").update(source).digest("hex")}`;
const ownerReadback = {
  schema_version: 1,
  build_request_identity: "artifact-build-1",
  attempt_identity: "artifact-attempt-1",
  artifact_identity: `blake3:${"a".repeat(64)}`,
  observed_at_epoch_ms: 1_788_669_600_000,
  file_name: "strategy.rs",
  language: "rust",
  source,
  source_digest: sourceDigest,
  wasm_preview_status: "NOT_RUN",
  wasm_preview_reason: "WASM_PREVIEW_NOT_RUN",
};

test("exact Owner source readback becomes a read-only viewer projection", () => {
  assert.deepEqual(projectArtifactSourceOwnerReadbackV1(
    ownerReadback,
    "artifact-build-1",
    "artifact-attempt-1",
  ), {
    availability: "available",
    artifactIdentity: ownerReadback.artifact_identity,
    observedAt: new Date(ownerReadback.observed_at_epoch_ms).toISOString(),
    source: { fileName: "strategy.rs", language: "rust", content: source, digest: sourceDigest },
    wasmPreview: {
      status: "not_run",
      moduleIdentity: null,
      target: null,
      durationMs: null,
      observedAt: null,
      output: null,
      diagnostics: [],
      reason: "WASM_PREVIEW_NOT_RUN",
    },
    reason: null,
  });
});

test("source readback fails closed for digest, identity, enum and shape drift", () => {
  for (const candidate of [
    { ...ownerReadback, source_digest: `sha256:${"b".repeat(64)}` },
    { ...ownerReadback, attempt_identity: "other-attempt" },
    { ...ownerReadback, wasm_preview_status: ["NOT_RUN"] },
    { ...ownerReadback, observed_at_epoch_ms: Number.MAX_SAFE_INTEGER },
    { ...ownerReadback, source, unexpected: true },
  ]) {
    assert.equal(projectArtifactSourceOwnerReadbackV1(
      candidate,
      "artifact-build-1",
      "artifact-attempt-1",
    ), null);
  }
});

test("gateway binds one GET with bearer custody and preserves no-store", async () => {
  const calls = [];
  const result = await readArtifactSourceGatewayV1({
    buildRequestIdentity: "artifact-build-1",
    attemptIdentity: "artifact-attempt-1",
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
  assert.equal(calls[0].url, "http://rd-owner-api:8080/v1/artifact-builds/artifact-build-1/attempts/artifact-attempt-1/source");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.cache, "no-store");
  assert.deepEqual(calls[0].init.headers, { authorization: "Bearer secret" });
  assert.equal(calls[0].init.body, undefined);
});

test("invalid identity and missing configuration make zero Owner calls", async () => {
  let calls = 0;
  const fetcher = async () => { calls += 1; throw new Error("must not fetch"); };
  const invalid = await readArtifactSourceGatewayV1({
    buildRequestIdentity: "bad identity",
    attemptIdentity: "attempt-1",
    baseUrl: "http://rd-owner-api:8080/",
    token: "secret",
    fetcher,
  });
  const missing = await readArtifactSourceGatewayV1({
    buildRequestIdentity: "build-1",
    attemptIdentity: "attempt-1",
    baseUrl: undefined,
    token: undefined,
    fetcher,
  });
  assert.equal(calls, 0);
  assert.equal(invalid.status, 400);
  assert.equal(missing.status, 503);
  assert.equal(invalid.projection.availability, "unavailable");
  assert.equal(missing.projection.availability, "unavailable");
});

test("non-root Owner base URLs and oversized declared responses fail closed", async () => {
  let calls = 0;
  const rejectedBase = await readArtifactSourceGatewayV1({
    buildRequestIdentity: "artifact-build-1",
    attemptIdentity: "artifact-attempt-1",
    baseUrl: "http://rd-owner-api:8080/untrusted-prefix/",
    token: "secret",
    fetcher: async () => { calls += 1; throw new Error("must not fetch"); },
  });
  const oversized = await readArtifactSourceGatewayV1({
    buildRequestIdentity: "artifact-build-1",
    attemptIdentity: "artifact-attempt-1",
    baseUrl: "http://rd-owner-api:8080/",
    token: "secret",
    fetcher: async () => {
      calls += 1;
      return new Response("{}", { headers: { "content-length": String(512 * 1024 + 1) } });
    },
  });
  assert.equal(calls, 1);
  assert.equal(rejectedBase.status, 503);
  assert.equal(oversized.status, 502);
  assert.equal(oversized.projection.source, null);
});

test("not found, malformed and transport responses never retain source", async () => {
  for (const [expectedStatus, fetcher] of [
    [404, async () => new Response("{}", { status: 404 })],
    [502, async () => new Response(JSON.stringify({ ...ownerReadback, source: "tampered" }), { status: 200 })],
    [503, async () => { throw new Error("offline"); }],
  ]) {
    const result = await readArtifactSourceGatewayV1({
      buildRequestIdentity: "artifact-build-1",
      attemptIdentity: "artifact-attempt-1",
      baseUrl: "http://rd-owner-api:8080/",
      token: "secret",
      fetcher,
    });
    assert.equal(result.status, expectedStatus);
    assert.equal(result.projection.availability, "unavailable");
    assert.equal(result.projection.source, null);
  }
});
