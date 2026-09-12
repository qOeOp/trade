import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseResearchReadbackBrowserProjectionV1,
  readResearchReadbackGatewayV1,
} from "../lib/research-readback-gateway.ts";

const accepted = JSON.parse(await readFile(
  new URL("./fixtures/research_accepted_v2.json", import.meta.url),
  "utf8",
));

test("exact Research Owner readback becomes a bounded browser projection", async () => {
  const calls = [];
  const result = await readResearchReadbackGatewayV1({
    requestIdentity: accepted.request_identity,
    environment: {
      RD_DASHBOARD_OWNER_READ_API_URL: "http://dashboard-read:8082/",
      RD_DASHBOARD_OWNER_READ_API_TOKEN: "secret",
      RD_OWNER_API_URL: "http://rd-owner-api:8080/",
      RD_OWNER_API_TOKEN: "write-secret",
    },
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(accepted), { status: 200 });
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.projection.availability, "available");
  assert.equal(result.projection.requestIdentity, accepted.request_identity);
  assert.equal(result.projection.outcome?.resolution, "accepted");
  assert.equal(result.projection.outcome?.intentIdentity, accepted.owner_receipt.resulting_research_intent_identity);
  assert.equal(result.projection.view?.phase, "intent_frozen");
  assert.equal(result.projection.view?.availability, "available");
  assert.equal(result.projection.technical?.ownerReceiptIdentity, accepted.owner_receipt.receipt_identity);
  assert.equal(result.projection.technical?.trialFamilyIdentity, accepted.trial_family.root.trial_family_identity);
  assert.deepEqual(parseResearchReadbackBrowserProjectionV1(result.projection), result.projection);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).pathname, "/v2/research-goals/request-1/readback");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.body, undefined);
  assert.deepEqual(calls[0].init.headers, { authorization: "Bearer secret" });
});

test("partial consolidated Dashboard target fails closed without borrowing write credentials", async () => {
  let calls = 0;
  const result = await readResearchReadbackGatewayV1({
    requestIdentity: accepted.request_identity,
    environment: {
      RD_DASHBOARD_OWNER_READ_API_URL: "http://dashboard-read:8082/",
      RD_OWNER_API_URL: "http://rd-owner-api:8080/",
      RD_OWNER_API_TOKEN: "write-secret",
    },
    fetcher: async () => { calls += 1; throw new Error("must not dispatch"); },
  });
  assert.equal(calls, 0);
  assert.equal(result.status, 503);
  assert.equal(result.projection.reason, "OWNER_CONFIGURATION_UNAVAILABLE");
});

test("verified unknown stays available without inventing an outcome", async () => {
  const unknown = {
    schema_version: 2,
    resolution: "SUBMITTED_OR_UNKNOWN",
    request_identity: "research-request-unknown",
    owner_receipt: null,
    research_view: null,
    independence_basis: null,
    protected_feedback: null,
    trial_family_resolution: "UNAVAILABLE",
    trial_family: null,
    next_legal_action: "RESOLVE_SAME_REQUEST_IDENTITY",
  };
  const result = await readResearchReadbackGatewayV1({
    requestIdentity: unknown.request_identity,
    environment: { RD_OWNER_API_URL: "http://owner.test/", RD_OWNER_API_TOKEN: "secret" },
    fetcher: async () => new Response(JSON.stringify(unknown), { status: 200 }),
  });
  assert.equal(result.status, 200);
  assert.equal(result.projection.availability, "available");
  assert.equal(result.projection.outcome, null);
  assert.equal(result.projection.view, null);
  assert.equal(result.projection.technical, null);
});

test("invalid identity, missing config and malformed Owner data fail closed", async () => {
  let calls = 0;
  const fetcher = async () => { calls += 1; return new Response("not json", { status: 200 }); };
  const invalid = await readResearchReadbackGatewayV1({
    requestIdentity: "bad identity",
    environment: { RD_OWNER_API_URL: "http://owner.test/", RD_OWNER_API_TOKEN: "secret" },
    fetcher,
  });
  const missing = await readResearchReadbackGatewayV1({
    requestIdentity: "research-request-missing",
    environment: {},
    fetcher,
  });
  const malformed = await readResearchReadbackGatewayV1({
    requestIdentity: "research-request-malformed",
    environment: { RD_OWNER_API_URL: "http://owner.test/", RD_OWNER_API_TOKEN: "secret" },
    fetcher,
  });
  assert.equal(calls, 1);
  assert.equal(invalid.status, 400);
  assert.equal(missing.status, 503);
  assert.equal(malformed.status, 502);
  for (const result of [invalid, missing, malformed]) {
    assert.equal(result.projection.availability, "unavailable");
    assert.equal(result.projection.outcome, null);
    assert.equal(result.projection.view, null);
    assert.equal(result.projection.technical, null);
  }
});

test("browser parser rejects identity drift and contradictory accepted fields", async () => {
  const result = await readResearchReadbackGatewayV1({
    requestIdentity: accepted.request_identity,
    environment: { RD_OWNER_API_URL: "http://owner.test/", RD_OWNER_API_TOKEN: "secret" },
    fetcher: async () => new Response(JSON.stringify(accepted), { status: 200 }),
  });
  assert.equal(parseResearchReadbackBrowserProjectionV1({
    ...result.projection,
    requestIdentity: "different-request",
  }, accepted.request_identity), null);
  assert.equal(parseResearchReadbackBrowserProjectionV1({
    ...result.projection,
    outcome: { ...result.projection.outcome, intentIdentity: null },
  }), null);
  assert.equal(parseResearchReadbackBrowserProjectionV1({
    ...result.projection,
    unexpected: true,
  }), null);
});
