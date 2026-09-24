import assert from "node:assert/strict";
import test from "node:test";

import {
  parseHistoricalCustodyBrowserEnvelopeV1,
  parseHistoricalCustodyOwnerV1,
  resolveHistoricalCustodyShadowV1,
} from "../lib/rd-historical-custody-client.ts";
import { OWNER_READ_NONCE_HEADER } from "../lib/owner-read-nonce.ts";

// The read API's side of the binding: the nonce this read sent comes back beside the projection.
function echoing(init, body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { [OWNER_READ_NONCE_HEADER]: init.headers[OWNER_READ_NONCE_HEADER] },
  });
}

function ownerReadback(overrides = {}) {
  return {
    schema_version: 1,
    operation: "rd.historical_custody_quarantine.read.v1",
    completeness: "COMPLETE",
    observed_at_epoch_ms: 1_500,
    research_total: 1,
    artifact_attempt_total: 1,
    binding_total: 1,
    research: [{
      request_identity: "research-request-v2-candidate",
      committed_at_epoch_ms: 1_100,
      projection_state: "POINT_READ_REQUIRED",
    }],
    artifact_attempts: [{
      build_request_identity: "artifact-build-request-candidate",
      attempt_identity: "artifact-build-attempt-candidate",
      prepared_at_epoch_ms: 1_200,
      projection_state: "POINT_READ_REQUIRED",
    }],
    bindings: [{
      binding_identity: "artifact-family-binding-candidate",
      trial_family_identity: "trial-family-candidate",
      committed_at_epoch_ms: 1_300,
      projection_state: "POINT_READ_REQUIRED",
    }],
    ...overrides,
  };
}

test("Owner candidate projection preserves point-read-only semantics", () => {
  const projection = parseHistoricalCustodyOwnerV1(ownerReadback());
  assert.equal(projection?.resolution, "RETRIEVED");
  assert.equal(projection?.research[0].projectionState, "POINT_READ_REQUIRED");
  assert.equal(projection?.artifactAttempts[0].projectionState, "POINT_READ_REQUIRED");
  assert.equal(projection?.bindings[0].projectionState, "POINT_READ_REQUIRED");
  assert.equal("disposition" in projection.research[0], false);
  assert.equal(parseHistoricalCustodyOwnerV1(ownerReadback({ research_total: 2 })), null);
  assert.equal(parseHistoricalCustodyOwnerV1(ownerReadback({ completeness: "PARTIAL_TRUNCATED" })), null);
  assert.equal(parseHistoricalCustodyOwnerV1(ownerReadback({
    completeness: "PARTIAL_TRUNCATED",
    research_total: 2,
  }))?.completeness, "PARTIAL_TRUNCATED");
  assert.equal(parseHistoricalCustodyOwnerV1(ownerReadback({
    research: [ownerReadback().research[0], ownerReadback().research[0]],
    research_total: 2,
  })), null);
  assert.equal(parseHistoricalCustodyOwnerV1(ownerReadback({
    research: [{ ...ownerReadback().research[0], committed_at_epoch_ms: 1_501 }],
  })), null);
  for (const requestIdentity of [".", ".."]) {
    assert.equal(parseHistoricalCustodyOwnerV1(ownerReadback({
      research: [{ ...ownerReadback().research[0], request_identity: requestIdentity }],
    })), null);
  }
  assert.equal(parseHistoricalCustodyOwnerV1(ownerReadback({
    artifact_attempts: [{ ...ownerReadback().artifact_attempts[0], attempt_identity: "." }],
  })), null);
  assert.equal(parseHistoricalCustodyOwnerV1(ownerReadback({
    bindings: [{ ...ownerReadback().bindings[0], trial_family_identity: ".." }],
  })), null);
});

test("missing configuration is an explicit zero-effect unavailable projection", async () => {
  let fetchCalls = 0;
  const result = await resolveHistoricalCustodyShadowV1({
    baseUrl: undefined,
    token: undefined,
    fetcher: async () => {
      fetchCalls += 1;
      throw new Error("must not fetch");
    },
    now: () => 2_000,
  });
  assert.equal(fetchCalls, 0);
  assert.equal(result.status, 503);
  assert.equal(result.envelope.availability, "unavailable");
  assert.equal(result.envelope.projection.resolution, "UNAVAILABLE");
});

test("authenticated GET accepts only the exact bounded Owner wire", async () => {
  const times = [1_000, 2_000];
  const result = await resolveHistoricalCustodyShadowV1({
    baseUrl: "http://owner.test",
    token: "opaque-test-token",
    now: () => times.shift() ?? 2_000,
    fetcher: async (_url, init) => {
      assert.equal(init.method, "GET");
      assert.equal(init.cache, "no-store");
      assert.equal(init.headers.authorization, "Bearer opaque-test-token");
      return echoing(init, ownerReadback());
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.envelope.availability, "available");
  assert.equal(result.envelope.projection.artifactAttemptTotal, 1);

  assert.equal(parseHistoricalCustodyOwnerV1(ownerReadback({ smuggled_resolution: "SUCCESS" })), null);
});

async function read(fetcher) {
  return resolveHistoricalCustodyShadowV1({
    baseUrl: "http://owner.test",
    token: "opaque-test-token",
    now: (() => {
      const times = [10_000, 10_020];
      return () => times.shift() ?? 10_020;
    })(),
    fetcher,
  });
}

// The Owner stamps its observation from its own clock, which can run ahead of this process's: a
// Docker Desktop VM's does. The echoed nonce, not this process's clock, is what binds the answer.
test("an Owner observation on a clock ahead of this process's is this read's answer", async () => {
  const nonces = [];
  const ahead = await read(async (_url, init) => {
    nonces.push(init.headers[OWNER_READ_NONCE_HEADER]);
    return echoing(init, ownerReadback({ observed_at_epoch_ms: 20_000 }));
  });
  assert.equal(ahead.status, 200);
  assert.equal(ahead.envelope.projection.observedAtEpochMs, 20_000);
  await read(async (_url, init) => {
    nonces.push(init.headers[OWNER_READ_NONCE_HEADER]);
    return echoing(init, ownerReadback());
  });
  for (const nonce of nonces) assert.match(nonce, /^[0-9a-f]{32}$/u);
  assert.notEqual(nonces[0], nonces[1]);
});

test("an answer that does not echo this read's nonce is not its answer", async () => {
  for (const echo of [
    () => undefined,
    () => "0".repeat(32),
    (nonce) => nonce.toUpperCase(),
    (nonce) => `${nonce}, ${nonce}`,
  ]) {
    const result = await read(async (_url, init) => {
      const echoed = echo(init.headers[OWNER_READ_NONCE_HEADER]);
      return new Response(JSON.stringify(ownerReadback()), {
        headers: echoed === undefined ? {} : { [OWNER_READ_NONCE_HEADER]: echoed },
      });
    });
    assert.deepEqual([result.status, result.envelope.unavailable_reason], [502, "OWNER_RESPONSE_UNAVAILABLE"]);
  }
});

test("browser envelope accepts only the exact journal-bound projection", () => {
  const projection = parseHistoricalCustodyOwnerV1(ownerReadback({ observed_at_epoch_ms: 9_500 }));
  const envelope = {
    schema_version: 1,
    operation: "rd_historical_custody.shadow_read.v1",
    channel: "DASHBOARD_SHADOW_READ",
    transport_observed_at: "1970-01-01T00:00:10.000Z",
    availability: "available",
    unavailable_reason: null,
    projection,
    operational_run: {
      schema_version: 1,
      availability: "available",
      unavailable_reason: null,
      run_identity: "dashboard-run-v1-00000000-0000-4000-8000-000000000001",
      state: "succeeded",
      owner_outcome_state: "available",
      transition_version: 2,
    },
  };
  assert.equal(parseHistoricalCustodyBrowserEnvelopeV1(envelope)?.researchTotal, 1);
  assert.equal(parseHistoricalCustodyBrowserEnvelopeV1({ ...envelope, smuggled: true }), null);
  assert.equal(parseHistoricalCustodyBrowserEnvelopeV1({ ...envelope, transport_observed_at: "not-an-instant" }), null);
  assert.equal(parseHistoricalCustodyBrowserEnvelopeV1({
    ...envelope,
    projection: { ...projection, research: [null] },
  }), null);
  assert.equal(parseHistoricalCustodyBrowserEnvelopeV1({
    ...envelope,
    projection: {
      ...projection,
      research: [{ ...projection.research[0], projectionState: "VERIFIED" }],
    },
  }), null);
  assert.equal(parseHistoricalCustodyBrowserEnvelopeV1({
    ...envelope,
    projection: {
      ...projection,
      artifactAttempts: [{ ...projection.artifactAttempts[0], preparedAtEpochMs: "1200" }],
    },
  }), null);
  assert.equal(parseHistoricalCustodyBrowserEnvelopeV1({
    ...envelope,
    projection: {
      ...projection,
      bindings: [{ ...projection.bindings[0], smuggled: true }],
    },
  }), null);
});
