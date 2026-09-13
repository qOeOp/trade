import assert from "node:assert/strict";
import test from "node:test";

import {
  parseExploratoryReplayResultBrowserProjectionV1,
  readExploratoryReplayResultGatewayV1,
} from "../lib/exploratory-replay-result-gateway.ts";

const components = [
  "FROZEN_RESEARCH_INTENT", "TRIAL_FAMILY", "TRIAL_FAMILY_CENSUS_FRONTIER",
  "REPLAY_AUTHORITY", "STRATEGY_DESIGN", "STRATEGY_PLAN", "ARTIFACT",
  "RESOLVED_OWNER_INPUTS", "PIT_SCOPE", "PIT_SNAPSHOT", "UNIVERSE_SELECTION",
  "CORRECTION_RULE", "MARKET_SEMANTICS", "REPLAY_CONFIGURATION", "RUNTIME_KERNEL",
  "SIMULATOR", "COST_MODEL", "SLIPPAGE_MODEL", "CAPACITY_MODEL",
  "RUNNER_OPERATIONAL_PROFILE", "DIAGNOSTIC_POLICY", "DETERMINISTIC_SEED",
  "REPLAY_WINDOW", "CALENDAR", "SESSION", "TIME_ZONE", "CORPORATE_ACTION_CUT",
  "HISTORICAL_MEMBERSHIP_CUT",
];
const requestIdentity = "replay-request-1";
const meaningDigest = `blake3:${"a".repeat(64)}`;
const attemptIdentity = "backtest-attempt-1";
const resultDigest = `blake3:${"b".repeat(64)}`;
const resultIdentity = `backtest-replay-result-v2-${"b".repeat(64)}`;
const digest = (value) => `blake3:${value.repeat(64)}`;

function locator(component, index) {
  return { component, reference: `observation-${index}`, digest: digest("d") };
}

function canonicalResult() {
  return {
    schema_version: 2,
    result_identity: resultIdentity,
    result_digest: resultDigest,
    request_identity: requestIdentity,
    request_meaning_digest: meaningDigest,
    namespace: "EXPLORATORY",
    replay_authority: { namespace: "EXPLORATORY" },
    attempt_identity: attemptIdentity,
    terminal: "TERMINAL_RESULT",
    reconciliation: components.map((component, index) => ({
      component,
      requested_meaning_identity: `meaning-${index}`,
      requested_meaning_digest: digest("c"),
      observed_meaning_identity: `meaning-${index}`,
      observed_meaning_digest: digest("c"),
      observation_locator: locator(component, index),
      status: "EXACT",
    })),
    semantic_trace: {
      request_identity: requestIdentity,
      request_meaning_digest: meaningDigest,
      attempt_identity: attemptIdentity,
      component: "SEMANTIC_TRACE",
      locator: locator("SEMANTIC_TRACE", 29),
      observed_meaning_identity: "semantic-trace-1",
      observed_meaning_digest: digest("e"),
    },
    diagnostic_census: [{
      request_identity: requestIdentity,
      request_meaning_digest: meaningDigest,
      attempt_identity: attemptIdentity,
      category: "NO_EXECUTION_DEFECT",
      decisive_evidence: locator("SEMANTIC_TRACE", 30),
    }],
  };
}

function options(overrides = {}) {
  return {
    requestIdentity,
    meaningDigest,
    attemptIdentity,
    resultIdentity,
    environment: {
      RD_DASHBOARD_OWNER_READ_API_URL: "http://rd-dashboard-owner-read-api:8082/",
      RD_DASHBOARD_OWNER_READ_API_TOKEN: "read-secret",
    },
    clock: () => Date.parse("2026-09-13T01:00:00.000Z"),
    ...overrides,
  };
}

test("result gateway reads one exact Owner aggregate and emits only a compact business projection", async () => {
  const calls = [];
  const result = await readExploratoryReplayResultGatewayV1(options({
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json(canonicalResult());
    },
  }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url,
    `http://rd-dashboard-owner-read-api:8082/v2/exploratory-replay-results/${resultIdentity}?request_identity=${requestIdentity}&attempt_identity=${attemptIdentity}`);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.body, undefined);
  assert.deepEqual(calls[0].init.headers, { authorization: "Bearer read-secret" });
  assert.equal(result.status, 200);
  assert.deepEqual(result.projection.result, {
    terminal: "TERMINAL_RESULT",
    exactComponents: 28,
    totalComponents: 28,
    diagnostics: ["NO_EXECUTION_DEFECT"],
    semanticTraceAvailable: true,
  });
  assert.deepEqual(parseExploratoryReplayResultBrowserProjectionV1(result.projection), result.projection);
  assert.doesNotMatch(JSON.stringify(result.projection), /reconciliation|decisive_evidence|observed_meaning/u);
});

test("result gateway rejects cross-spliced or internally contradictory Owner bytes", async () => {
  const candidates = [
    { ...canonicalResult(), request_identity: "other-request" },
    { ...canonicalResult(), attempt_identity: "other-attempt" },
    { ...canonicalResult(), reconciliation: canonicalResult().reconciliation.slice(1) },
    { ...canonicalResult(), semantic_trace: null },
    { ...canonicalResult(), diagnostic_census: [] },
    { ...canonicalResult(), caller_evidence: {} },
  ];
  for (const candidate of candidates) {
    const result = await readExploratoryReplayResultGatewayV1(options({
      fetcher: async () => Response.json(candidate),
    }));
    assert.equal(result.status, 502);
    assert.equal(result.projection.availability, "unavailable");
    assert.equal(result.projection.result, null);
  }
});

test("invalid selectors and missing read configuration make zero Owner calls", async () => {
  let calls = 0;
  const fetcher = async () => { calls += 1; throw new Error("must not fetch"); };
  const invalid = await readExploratoryReplayResultGatewayV1(options({
    attemptIdentity: "",
    fetcher,
  }));
  const missing = await readExploratoryReplayResultGatewayV1(options({ environment: {}, fetcher }));
  assert.equal(calls, 0);
  assert.equal(invalid.status, 400);
  assert.equal(missing.status, 503);
});

test("not found, permission denial, oversized and transport failures remain distinct unavailable states", async () => {
  const cases = [
    [404, async () => new Response(null, { status: 404 }), "EXPLORATORY_REPLAY_RESULT_UNAVAILABLE"],
    [403, async () => new Response(null, { status: 403 }), "OWNER_PERMISSION_DENIED"],
    [502, async () => new Response("x".repeat(1_048_577)), "OWNER_RESPONSE_UNAVAILABLE"],
    [503, async () => { throw new Error("network"); }, "OWNER_TRANSPORT_UNAVAILABLE"],
  ];
  for (const [status, fetcher, reason] of cases) {
    const result = await readExploratoryReplayResultGatewayV1(options({ fetcher }));
    assert.equal(result.status, status);
    assert.equal(result.projection.reason, reason);
    assert.equal(result.projection.result, null);
  }
});

test("browser parser rejects unavailable envelopes with unbound selector identities", () => {
  const valid = {
    schemaVersion: 1,
    availability: "unavailable",
    requestIdentity,
    meaningDigest,
    attemptIdentity,
    resultIdentity,
    observedAt: null,
    result: null,
    reason: "OWNER_RESPONSE_UNAVAILABLE",
  };
  assert.deepEqual(parseExploratoryReplayResultBrowserProjectionV1(valid), valid);
  assert.equal(parseExploratoryReplayResultBrowserProjectionV1({
    ...valid,
    resultIdentity: "INVALID_BUT_UNRECOGNIZED",
  }), null);
  assert.equal(parseExploratoryReplayResultBrowserProjectionV1({
    ...valid,
    meaningDigest: "INVALID_BUT_UNRECOGNIZED",
  }), null);
});
