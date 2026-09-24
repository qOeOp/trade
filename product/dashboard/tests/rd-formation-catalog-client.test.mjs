import assert from "node:assert/strict";
import test from "node:test";

import { OWNER_READ_NONCE_HEADER } from "../lib/owner-read-nonce.ts";
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
      committed_at_epoch_ms: 9_950,
      resolution: "SUCCESS",
      receipt_identity: "build-receipt-1",
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

// The read API's side of the binding: the nonce this read sent comes back beside the projection.
function owner(body, { echo = (nonce) => nonce, status = 200 } = {}) {
  const nonces = [];
  const fetcher = async (_url, init) => {
    const nonce = init.headers[OWNER_READ_NONCE_HEADER];
    nonces.push(nonce);
    const echoed = echo(nonce);
    return new Response(JSON.stringify(body), {
      status,
      headers: echoed === undefined ? {} : { [OWNER_READ_NONCE_HEADER]: echoed },
    });
  };
  return { fetcher, nonces };
}

async function read(fetcher) {
  return resolveRdFormationCatalogShadowV1({
    baseUrl: "http://owner.test",
    token: "opaque-test-token",
    now: clock(),
    fetcher,
  });
}

test("each read sends its own fresh nonce", async () => {
  const { fetcher, nonces } = owner(ownerReadback(9_990));
  assert.equal((await read(fetcher)).status, 200);
  assert.equal((await read(fetcher)).status, 200);
  assert.equal(nonces.length, 2);
  for (const nonce of nonces) assert.match(nonce, /^[0-9a-f]{32}$/u);
  assert.notEqual(nonces[0], nonces[1]);
});

// The Owner stamps its observation from its own clock, which can run ahead of this process's: a
// Docker Desktop VM's does. The echoed nonce, not this process's clock, is what binds the answer.
test("an Owner observation on a clock ahead of this process's is this read's answer", async () => {
  const result = await read(owner(ownerReadback(20_000, [completeFamily()])).fetcher);
  assert.equal(result.status, 200);
  assert.equal(result.envelope.availability, "available");
  assert.equal(result.envelope.projection.observedAtEpochMs, 20_000);
});

test("an answer that does not echo this read's nonce is not its answer", async () => {
  for (const echo of [
    () => undefined,
    () => "0".repeat(32),
    (nonce) => nonce.toUpperCase(),
    (nonce) => `${nonce}, ${nonce}`,
  ]) {
    const result = await read(owner(ownerReadback(9_990), { echo }).fetcher);
    assert.deepEqual([result.status, result.envelope.unavailable_reason], [502, "OWNER_RESPONSE_UNAVAILABLE"]);
    assert.equal(result.envelope.projection.families.length, 0);
  }
});

test("a commit later than the Owner's own observation fails closed", async () => {
  const result = await read(owner(ownerReadback(9_940, [completeFamily()])).fetcher);
  assert.deepEqual([result.status, result.envelope.unavailable_reason], [502, "OWNER_RESPONSE_UNAVAILABLE"]);
});

test("typed formation catalog retains exact attempt and Research enums", async () => {
  const result = await read(owner(ownerReadback(9_990, [completeFamily()])).fetcher);
  assert.equal(result.status, 200);
  const family = result.envelope.projection.families[0];
  assert.equal(family.research.viewAvailability, "AVAILABLE");
  assert.equal(family.research.nextLegalAction, "REVIEW_ARTIFACT");
  assert.equal(family.attemptHistory[0].resolution, "SUCCESS");
  assert.equal(family.attemptHistory[0].committedAtEpochMs, 9_950);
});

test("unknown attempt and Research enums fail closed", async () => {
  for (const mutate of [
    (family) => { family.attempt_history[0].resolution = "COMPLETED"; },
    (family) => { family.attempt_history[0].resolution = "FAILED_NO_ARTIFACT"; },
    (family) => { family.research.view_availability = "CURRENT"; },
    (family) => { family.research.next_legal_action = "RUN_AGAIN"; },
  ]) {
    const family = completeFamily();
    mutate(family);
    const result = await read(owner(ownerReadback(9_990, [family])).fetcher);
    assert.equal(result.status, 502);
    assert.equal(result.envelope.availability, "unavailable");
    assert.equal(result.envelope.projection.families.length, 0);
  }
});
