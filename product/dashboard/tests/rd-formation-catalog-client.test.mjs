import assert from "node:assert/strict";
import test from "node:test";

import { resolveRdFormationCatalogShadowV1 } from "../lib/rd-formation-catalog-client.ts";

function ownerReadback(observedAtEpochMs) {
  return {
    schema_version: 1,
    operation: "rd.formation_catalog.read.v1",
    completeness: "COMPLETE",
    observed_at_epoch_ms: observedAtEpochMs,
    families: [],
  };
}

function clock() {
  const times = [10_000, 10_020];
  return () => times.shift() ?? 10_020;
}

test("transport admits bounded Owner clock skew", async () => {
  const result = await resolveRdFormationCatalogShadowV1({
    baseUrl: "http://owner.test",
    token: "opaque-test-token",
    now: clock(),
    fetcher: async () => new Response(JSON.stringify(ownerReadback(9_990))),
  });
  assert.equal(result.status, 200);
  assert.equal(result.envelope.availability, "available");
});

test("transport rejects an Owner observation outside the read window", async () => {
  const result = await resolveRdFormationCatalogShadowV1({
    baseUrl: "http://owner.test",
    token: "opaque-test-token",
    now: clock(),
    fetcher: async () => new Response(JSON.stringify(ownerReadback(1_999))),
  });
  assert.equal(result.status, 502);
  assert.equal(result.envelope.availability, "unavailable");
});
