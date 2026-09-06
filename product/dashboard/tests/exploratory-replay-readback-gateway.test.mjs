import assert from "node:assert/strict";
import test from "node:test";

import {
  parseExploratoryReplayBrowserProjectionV1,
  readExploratoryReplayReadbackGatewayV1,
} from "../lib/exploratory-replay-readback-gateway.ts";

const sha = (character) => `sha256:${character.repeat(64)}`;
const meaningDigest = `blake3:${"e".repeat(64)}`;
const content = (identity, character) => ({ identity, digest: sha(character) });
const version = (identity) => ({ identity, version: "v1" });

function replayRequest(requestIdentity = "replay-request-1") {
  return {
    schema_version: 2,
    request_identity: requestIdentity,
    frozen_research_intent: content("intent-1", "1"),
    trial_family: content("trial-family-1", "2"),
    trial_family_census_frontier: content("census-frontier-1", "3"),
    strategy_design: content("strategy-design-1", "4"),
    strategy_plan: content("strategy-plan-1", "5"),
    artifact: content("artifact-1", "6"),
    resolved_owner_inputs: content("owner-inputs-1", "7"),
    pit_scope: content("pit-scope-1", "8"),
    pit_snapshot: content("pit-snapshot-1", "9"),
    universe_selection: content("universe-1", "a"),
    replay_configuration: content("replay-config-1", "b"),
    corporate_action_cut: content("corporate-action-cut-1", "c"),
    historical_membership_cut: content("membership-cut-1", "d"),
    replay_authority: { namespace: "EXPLORATORY" },
    correction_rule: version("correction-rule-1"),
    market_semantics: version("market-semantics-1"),
    runner_operational_profile: version("runner-profile-1"),
    diagnostic_policy: version("diagnostic-policy-1"),
    models: {
      runtime_kernel: version("runtime-kernel-1"),
      simulator: version("simulator-1"),
      cost: version("cost-model-1"),
      slippage: version("slippage-model-1"),
      capacity: version("capacity-model-1"),
    },
    deterministic_seed: 17,
    window: { start_event_ns: 10, end_event_ns_exclusive: 20 },
    calendar: version("calendar-1"),
    session: version("session-1"),
    time_zone: version("time-zone-1"),
  };
}

function ownerReadback({ requestIdentity = "replay-request-1", availability = "AVAILABLE" } = {}) {
  if (availability !== "AVAILABLE") {
    return {
      projection: {
        schema_version: 1,
        request_identity: requestIdentity,
        availability,
        next_legal_action: availability === "STALE"
          ? "CREATE_SUCCESSOR_REQUEST"
          : "RESOLVE_OWNER_CUSTODY",
      },
      readback: null,
    };
  }
  const request = replayRequest(requestIdentity);
  const committedAt = Date.parse("2026-09-06T12:00:00.000Z");
  return {
    projection: {
      schema_version: 1,
      request_identity: requestIdentity,
      availability: "AVAILABLE",
      next_legal_action: "LOCK_BY_LOCATOR",
    },
    readback: {
      request,
      canonical_request_bytes: [...new TextEncoder().encode(JSON.stringify(request))],
      meaning_digest: meaningDigest,
      receipt: {
        schema_version: 2,
        receipt_identity: "replay-receipt-1",
        request_identity: requestIdentity,
        meaning_digest: meaningDigest,
        seal_digest: sha("f"),
        committed_at_epoch_ms: committedAt,
      },
      owner_cut_epoch_ms: committedAt + 1_000,
    },
  };
}

test("gateway performs one authenticated Owner point read and filters sealed custody", async () => {
  const calls = [];
  const result = await readExploratoryReplayReadbackGatewayV1({
    requestIdentity: "replay-request-1",
    meaningDigest,
    environment: { RD_OWNER_API_URL: "http://rd-owner-api:8080/", RD_OWNER_API_TOKEN: "secret" },
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(ownerReadback()), { status: 200 });
    },
  });

  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `http://rd-owner-api:8080/v2/exploratory-replay-requests/replay-request-1/readback?meaning_digest=${encodeURIComponent(meaningDigest)}`,
  );
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.cache, "no-store");
  assert.deepEqual(calls[0].init.headers, { authorization: "Bearer secret" });
  assert.equal(calls[0].init.body, undefined);
  assert.deepEqual(result.projection.request, {
    availability: "AVAILABLE",
    namespace: "EXPLORATORY",
    deterministicSeed: 17,
  });
  assert.equal(result.projection.replayBasis.runtimeKernelIdentity, "runtime-kernel-1");
  assert.equal(result.projection.replayBasis.simulatorIdentity, "simulator-1");
  assert.deepEqual(parseExploratoryReplayBrowserProjectionV1(result.projection), result.projection);
  const browserBytes = JSON.stringify(result.projection);
  for (const withheld of [
    "canonical_request_bytes", "nextLegalAction", "LOCK_BY_LOCATOR", "strategy_plan",
    "resolved_owner_inputs", "cost-model-1", "slippage-model-1", "capacity-model-1",
  ]) assert.doesNotMatch(browserBytes, new RegExp(withheld, "u"));
});

test("invalid selectors and missing configuration make zero Owner calls", async () => {
  let calls = 0;
  const fetcher = async () => { calls += 1; throw new Error("must not fetch"); };
  const invalid = await readExploratoryReplayReadbackGatewayV1({
    requestIdentity: "bad identity",
    meaningDigest,
    environment: { RD_OWNER_API_URL: "http://rd-owner-api:8080", RD_OWNER_API_TOKEN: "secret" },
    fetcher,
  });
  const missing = await readExploratoryReplayReadbackGatewayV1({
    requestIdentity: "replay-request-1",
    meaningDigest,
    environment: {},
    fetcher,
  });
  assert.equal(calls, 0);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.projection.reason, "INVALID_EXPLORATORY_REPLAY_SELECTOR");
  assert.equal(missing.status, 503);
  assert.equal(missing.projection.reason, "OWNER_CONFIGURATION_UNAVAILABLE");
});

test("stale, unavailable, malformed and identity-drifted Owner responses fail closed", async () => {
  const responses = [
    new Response(JSON.stringify(ownerReadback({ availability: "STALE" })), { status: 200 }),
    new Response(JSON.stringify(ownerReadback({ availability: "UNAVAILABLE" })), { status: 200 }),
    new Response("not json", { status: 200 }),
    new Response(JSON.stringify(ownerReadback({ requestIdentity: "another-request" })), { status: 200 }),
  ];
  for (const response of responses) {
    const result = await readExploratoryReplayReadbackGatewayV1({
      requestIdentity: "replay-request-1",
      meaningDigest,
      environment: { RD_OWNER_API_URL: "http://rd-owner-api:8080", RD_OWNER_API_TOKEN: "secret" },
      fetcher: async () => response,
    });
    assert.notEqual(result.status, 200);
    assert.equal(result.projection.availability, "unavailable");
    assert.equal(result.projection.request, null);
    assert.equal(result.projection.custody, null);
    assert.equal(result.projection.replayBasis, null);
  }
});

test("canonical byte drift and raw browser additions are rejected", async () => {
  const drifted = ownerReadback();
  drifted.readback.canonical_request_bytes.push(32);
  const result = await readExploratoryReplayReadbackGatewayV1({
    requestIdentity: "replay-request-1",
    meaningDigest,
    environment: { RD_OWNER_API_URL: "http://rd-owner-api:8080", RD_OWNER_API_TOKEN: "secret" },
    fetcher: async () => new Response(JSON.stringify(drifted), { status: 200 }),
  });
  assert.equal(result.status, 502);
  assert.equal(result.projection.availability, "unavailable");

  const available = await readExploratoryReplayReadbackGatewayV1({
    requestIdentity: "replay-request-1",
    meaningDigest,
    environment: { RD_OWNER_API_URL: "http://rd-owner-api:8080", RD_OWNER_API_TOKEN: "secret" },
    fetcher: async () => new Response(JSON.stringify(ownerReadback()), { status: 200 }),
  });
  assert.equal(parseExploratoryReplayBrowserProjectionV1({
    ...available.projection,
    canonical_request_bytes: [],
  }), null);
});
