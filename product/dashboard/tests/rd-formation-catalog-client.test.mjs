import assert from "node:assert/strict";
import test from "node:test";

import { resolveRdFormationCatalogShadowV1 } from "../lib/rd-formation-catalog-client.ts";

function ownerReadback(observedAtEpochMs, families = []) {
  return {
    schema_version: 1,
    operation: "rd.formation_catalog.read.v1",
    completeness: "COMPLETE",
    observed_at_epoch_ms: observedAtEpochMs,
    families,
  };
}

function completeFamily() {
  return {
    trial_family_identity: "trial-family-1",
    research: {
      request_identity: "research-request-1",
      receipt_identity: "research-receipt-1",
      intent_identity: "intent-1",
      committed_at_epoch_ms: 9_900,
      view_availability: "AVAILABLE",
      next_legal_action: "REVIEW_ARTIFACT",
      trial_budget: 1,
      consumed_trial_budget: 1,
    },
    attempt_history: [{
      build_request_identity: "build-request-1",
      attempt_identity: "attempt-1",
      prepared_at_epoch_ms: 9_950,
      resolution: "SUCCESS",
      receipt_identity: "build-receipt-1",
      disposition: "SUCCESS",
      artifact_identity: "artifact-1",
      review_identity: "review-1",
      family_binding_identity: "binding-1",
    }],
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

test("typed formation catalog retains exact attempt and Research enums", async () => {
  const result = await resolveRdFormationCatalogShadowV1({
    baseUrl: "http://owner.test",
    token: "opaque-test-token",
    now: clock(),
    fetcher: async () => new Response(JSON.stringify(ownerReadback(9_990, [completeFamily()]))),
  });
  assert.equal(result.status, 200);
  const family = result.envelope.projection.families[0];
  assert.equal(family.research.viewAvailability, "AVAILABLE");
  assert.equal(family.research.nextLegalAction, "REVIEW_ARTIFACT");
  assert.equal(family.attemptHistory[0].resolution, "SUCCESS");
  assert.equal(family.attemptHistory[0].disposition, "SUCCESS");
});

test("unknown attempt and Research enums fail closed", async () => {
  for (const mutate of [
    (family) => { family.attempt_history[0].resolution = "COMPLETED"; },
    (family) => { family.attempt_history[0].disposition = "COMPLETED"; },
    (family) => { family.research.view_availability = "CURRENT"; },
    (family) => { family.research.next_legal_action = "RUN_AGAIN"; },
  ]) {
    const family = completeFamily();
    mutate(family);
    const result = await resolveRdFormationCatalogShadowV1({
      baseUrl: "http://owner.test",
      token: "opaque-test-token",
      now: clock(),
      fetcher: async () => new Response(JSON.stringify(ownerReadback(9_990, [family]))),
    });
    assert.equal(result.status, 502);
    assert.equal(result.envelope.availability, "unavailable");
    assert.equal(result.envelope.projection.families.length, 0);
  }
});
