import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import * as journey from "../lib/research-journey.ts";
import * as reasons from "../lib/reason-presentation.ts";

import {
  parseResearchReadbackBrowserProjectionV1,
  readResearchReadbackGatewayV1,
} from "../lib/research-readback-gateway.ts";

const accepted = JSON.parse(await readFile(
  new URL("./fixtures/research_accepted_v2.json", import.meta.url),
  "utf8",
));
// The same result for a V3 request: the Owner states its version and admitted scope.
const scope = { schema_version: 1, identities: ["BTCUSDT-PERP.BINANCE"] };
const acceptedV3 = { ...accepted, request_schema_version: 3, instrument_scope: scope };

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
  assert.equal(result.projection.technical?.semanticDigest, accepted.owner_receipt.semantic_digest);
  assert.equal(result.projection.technical?.trialFamilyIdentity, accepted.trial_family.root.trial_family_identity);
  assert.deepEqual(parseResearchReadbackBrowserProjectionV1(result.projection), result.projection);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).pathname, "/v2/research-goals/request-1/readback");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.body, undefined);
  assert.deepEqual(calls[0].init.headers, { authorization: "Bearer secret" });
});

const initialPitVectors = JSON.parse(await readFile(
  new URL("../../rd-owner-client/fixtures/research_initial_pit_state_vectors_v1.json", import.meta.url),
  "utf8",
));

async function readbackOf(ownerResult) {
  return readResearchReadbackGatewayV1({
    requestIdentity: ownerResult.request_identity,
    environment: {
      RD_DASHBOARD_OWNER_READ_API_URL: "http://dashboard-read:8082/",
      RD_DASHBOARD_OWNER_READ_API_TOKEN: "secret",
    },
    fetcher: async () => new Response(JSON.stringify(ownerResult), { status: 200 }),
  });
}

test("an accepted Research readback carries the Owner's initial PIT state exactly as stated", async () => {
  // The vectors are the Owner's own: its test serializes every state it can state and checks it is
  // exactly this accepted list, so a state the Owner adds reaches this test through that file.
  assert.ok(initialPitVectors.accepted.length >= 8);
  // Only a V3 request's Intent binds a scope, so every stated state is carried on a V3 result, and
  // `null` on a V2 one.
  for (const [ownerResult, initialPit] of [
    ...initialPitVectors.accepted.map((state) => [acceptedV3, state]),
    [accepted, null],
  ]) {
    const result = await readbackOf({ ...ownerResult, initial_pit: structuredClone(initialPit) });
    assert.equal(result.status, 200, JSON.stringify(initialPit));
    assert.deepEqual(result.projection.outcome?.initialPit, initialPit);
    assert.deepEqual(parseResearchReadbackBrowserProjectionV1(result.projection), result.projection);
  }
});

test("a readback whose initial PIT state the Owner could not have stated is unavailable, not shown", async () => {
  for (const refused of initialPitVectors.refused) {
    const result = await readbackOf({ ...acceptedV3, initial_pit: structuredClone(refused.value ?? refused) });
    assert.equal(result.projection.availability, "unavailable", JSON.stringify(refused));
    assert.equal(result.projection.outcome, null);
  }
});

test("the browser parser keeps initialPit to what the Owner states for each outcome", async () => {
  const result = await readbackOf({ ...acceptedV3, initial_pit: { state: "NOT_ISSUED" } });
  const projection = result.projection;
  assert.equal(parseResearchReadbackBrowserProjectionV1({
    ...projection,
    outcome: { ...projection.outcome, initialPit: { state: "TERMINAL", disposition: "STALE", primary_blocker: "COVERAGE_INSUFFICIENT" } },
  }), null, "an unpaired terminal is refused");
  const { initialPit: _dropped, ...withoutInitialPit } = projection.outcome;
  assert.equal(parseResearchReadbackBrowserProjectionV1({ ...projection, outcome: withoutInitialPit }), null);
  assert.equal(parseResearchReadbackBrowserProjectionV1({
    ...projection,
    outcome: {
      ...projection.outcome,
      resolution: "rejected",
      intentIdentity: null,
      rejectionCode: "INSTRUMENT_SCOPE_NOT_RESOLVABLE",
      initialPit: { state: "NOT_ISSUED" },
    },
    view: null,
    technical: { ...projection.technical, projectionIdentity: null, sourceCut: null, trialFamilyIdentity: null },
  }), null, "a rejected record never carries an initial PIT state");
});

const rejectedDigest = `sha256:${"d".repeat(64)}`;
const rejectedV3 = {
  schema_version: 2,
  resolution: "REJECTED_NO_WRITE",
  request_identity: "request-1",
  owner_receipt: {
    schema_version: 1,
    receipt_identity: `rd-research-request-receipt-v2-${
      createHash("sha256").update(`v2:request-1:${rejectedDigest}`).digest("hex")
    }`,
    request_identity: "request-1",
    semantic_digest: rejectedDigest,
    disposition: "REJECTED_NO_WRITE",
    resulting_research_intent_identity: null,
    committed_at_epoch_ms: 100,
    rejection_code: "INSTRUMENT_SCOPE_NOT_RESOLVABLE",
  },
  research_view: null,
  independence_basis: null,
  protected_feedback: null,
  trial_family_resolution: "UNAVAILABLE",
  trial_family: null,
  next_legal_action: "CORRECT_INPUT_AND_CREATE_SUCCESSOR_REQUEST",
  initial_pit: null,
  request_schema_version: 3,
  instrument_scope: { schema_version: 1, identities: ["UNLISTED-PERP.BINANCE"] },
};

// The version is the Owner's, read from the admission, so a rejected V3 request is V3 too, and it
// keeps the instruments it was admitted with; nothing here infers a version from initialPit.
test("a Research readback states the request version and instruments the Owner states", async () => {
  for (const [ownerResult, requestVersion, instrumentIdentities] of [
    [accepted, 2, null],
    [{ ...acceptedV3, initial_pit: { state: "NOT_ISSUED" } }, 3, ["BTCUSDT-PERP.BINANCE"]],
    [rejectedV3, 3, ["UNLISTED-PERP.BINANCE"]],
  ]) {
    const result = await readbackOf(ownerResult);
    assert.equal(result.status, 200, ownerResult.resolution);
    assert.equal(result.projection.outcome?.requestVersion, requestVersion);
    assert.deepEqual(result.projection.outcome?.instrumentIdentities, instrumentIdentities);
    assert.deepEqual(parseResearchReadbackBrowserProjectionV1(result.projection), result.projection);
  }
});

test("the browser parser keeps the request version to what the Owner states for each outcome", async () => {
  const projection = (await readbackOf({ ...acceptedV3, initial_pit: { state: "NOT_ISSUED" } })).projection;
  const v2 = (await readbackOf(accepted)).projection;
  const quarantined = {
    ...v2,
    outcome: { ...v2.outcome, resolution: "quarantined", historicalDisposition: "accepted", intentIdentity: null,
      requestVersion: null, instrumentIdentities: null },
    view: null,
    technical: { ...v2.technical, projectionIdentity: null, sourceCut: null, trialFamilyIdentity: null },
  };
  assert.deepEqual(parseResearchReadbackBrowserProjectionV1(quarantined), quarantined);
  for (const [name, value] of [
    ["an accepted record with no version", { ...v2, outcome: { ...v2.outcome, requestVersion: null } }],
    ["an invented V1", { ...v2, outcome: { ...v2.outcome, requestVersion: 1 } }],
    ["V2 with instruments", { ...v2, outcome: { ...v2.outcome, instrumentIdentities: ["BTCUSDT-PERP.BINANCE"] } }],
    ["V3 without instruments", { ...projection, outcome: { ...projection.outcome, instrumentIdentities: null } }],
    ["an instrument that is not text", { ...projection, outcome: { ...projection.outcome, instrumentIdentities: [7] } }],
    ["an initial PIT state on V2", { ...v2, outcome: { ...v2.outcome, initialPit: { state: "NOT_ISSUED" } } }],
    ["a historical record with a version", { ...quarantined, outcome: { ...quarantined.outcome, requestVersion: 2 } }],
  ]) {
    assert.equal(parseResearchReadbackBrowserProjectionV1(value), null, name);
  }
  const { requestVersion: _dropped, ...withoutVersion } = projection.outcome;
  assert.equal(parseResearchReadbackBrowserProjectionV1({ ...projection, outcome: withoutVersion }), null);
});

// The production render tree of the readback page, fed the gateway's own projections; only the
// visual atoms are replaced, by ones that print their label and content.
async function renderedReadback(projection) {
  const compiled = ts.transpileModule(
    await readFile(new URL("../components/research-readback-content.tsx", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
  ).outputText;
  const require = createRequire(import.meta.url);
  const atom = ({ label, title, children }) => React.createElement("div", null, label ?? title, " ", children);
  const load = (path) => {
    if (path === "react/jsx-runtime") return require(path);
    if (path.includes("research-journey")) return journey;
    if (path.includes("reason-presentation")) return reasons;
    if (path.includes("entity-reference")) return { compactEntityIdentity: (value) => value };
    return new Proxy({}, { get: (_, key) => String(key).endsWith("Icons") ? new Proxy({}, { get: () => atom }) : atom });
  };
  const exports = {};
  new Function("require", "exports", compiled)(load, exports);
  return renderToStaticMarkup(React.createElement(exports.ResearchReadbackContent, {
    status: "available", projection, question: null, requestIdentity: projection.requestIdentity,
  }));
}

test("the readback page shows the request version the Owner states, and unknown where it states none", async () => {
  const unknownOwnerResult = {
    schema_version: 2, resolution: "SUBMITTED_OR_UNKNOWN", request_identity: "request-1",
    owner_receipt: null, research_view: null, independence_basis: null, protected_feedback: null,
    trial_family_resolution: "UNAVAILABLE", trial_family: null,
    next_legal_action: "RESOLVE_SAME_REQUEST_IDENTITY", initial_pit: null,
    request_schema_version: null, instrument_scope: null,
  };
  const quarantinedOwnerResult = {
    ...accepted, resolution: "LEGACY_TERMINAL_QUARANTINED", research_view: null, independence_basis: null,
    protected_feedback: null, trial_family_resolution: "UNAVAILABLE", trial_family: null,
    next_legal_action: "RESOLVE_SAME_REQUEST_IDENTITY", initial_pit: null,
    request_schema_version: null, instrument_scope: null,
  };
  for (const [name, ownerResult, shown, absent] of [
    ["accepted V3, initial PIT not terminated", { ...acceptedV3, initial_pit: { state: "NOT_ISSUED" } },
      ["Request V3", "Instrument BTCUSDT-PERP.BINANCE", "Initial PIT request Not issued"], ["Version unknown"]],
    ["rejected V3", rejectedV3,
      ["Request V3", "Instrument UNLISTED-PERP.BINANCE", "Initial PIT request None"], ["Version unknown"]],
    ["accepted V2", accepted, ["Request V2", "Instrument None", "Initial PIT request None"], ["Version unknown"]],
    ["historical", quarantinedOwnerResult, ["Request Version unknown", "Historical", "Instrument Not available"], ["V2", "V3"]],
    ["unresolved", unknownOwnerResult, ["Request version unknown"], ["V2", "V3"]],
  ]) {
    const result = await readbackOf(ownerResult);
    assert.equal(result.status, 200, name);
    const page = (await renderedReadback(result.projection)).replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ");
    for (const text of shown) assert.ok(page.includes(text), `${name}: ${text} in ${page}`);
    for (const text of absent) assert.ok(!page.includes(text), `${name}: no ${text} in ${page}`);
  }
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
    initial_pit: null,
    request_schema_version: null,
    instrument_scope: null,
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

test("verified legacy terminal custody stays visible without becoming current Research authority", async () => {
  const quarantined = {
    ...accepted,
    resolution: "LEGACY_TERMINAL_QUARANTINED",
    research_view: null,
    independence_basis: null,
    protected_feedback: null,
    trial_family_resolution: "UNAVAILABLE",
    trial_family: null,
    next_legal_action: "RESOLVE_SAME_REQUEST_IDENTITY",
    initial_pit: null,
    request_schema_version: null,
    instrument_scope: null,
  };
  const result = await readResearchReadbackGatewayV1({
    requestIdentity: quarantined.request_identity,
    environment: {
      RD_DASHBOARD_OWNER_READ_API_URL: "http://dashboard-read:8082/",
      RD_DASHBOARD_OWNER_READ_API_TOKEN: "secret",
    },
    fetcher: async () => new Response(JSON.stringify(quarantined), { status: 200 }),
  });

  assert.equal(result.status, 200);
  assert.equal(result.projection.outcome?.resolution, "quarantined");
  assert.equal(result.projection.outcome?.historicalDisposition, "accepted");
  assert.equal(result.projection.outcome?.requestVersion, null);
  assert.equal(result.projection.outcome?.instrumentIdentities, null);
  assert.equal(result.projection.outcome?.intentIdentity, null);
  assert.equal(result.projection.view, null);
  assert.equal(
    result.projection.technical?.ownerReceiptIdentity,
    accepted.owner_receipt.receipt_identity,
  );
  assert.equal(result.projection.technical?.trialFamilyIdentity, null);
  assert.deepEqual(parseResearchReadbackBrowserProjectionV1(result.projection), result.projection);

  const promoted = await readResearchReadbackGatewayV1({
    requestIdentity: quarantined.request_identity,
    environment: {
      RD_DASHBOARD_OWNER_READ_API_URL: "http://dashboard-read:8082/",
      RD_DASHBOARD_OWNER_READ_API_TOKEN: "secret",
    },
    fetcher: async () => new Response(JSON.stringify({
      ...quarantined,
      research_view: accepted.research_view,
    }), { status: 200 }),
  });
  assert.equal(promoted.status, 502);
  assert.equal(promoted.projection.availability, "unavailable");

  const rejected = await readResearchReadbackGatewayV1({
    requestIdentity: quarantined.request_identity,
    environment: {
      RD_DASHBOARD_OWNER_READ_API_URL: "http://dashboard-read:8082/",
      RD_DASHBOARD_OWNER_READ_API_TOKEN: "secret",
    },
    fetcher: async () => new Response(JSON.stringify({
      ...quarantined,
      owner_receipt: {
        ...quarantined.owner_receipt,
        disposition: "REJECTED_NO_WRITE",
        resulting_research_intent_identity: null,
        rejection_code: "INVALID_RESEARCH_REQUEST",
      },
    }), { status: 200 }),
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.projection.outcome?.resolution, "quarantined");
  assert.equal(rejected.projection.outcome?.historicalDisposition, "rejected");
  assert.equal(rejected.projection.outcome?.rejectionCode, "INVALID_RESEARCH_REQUEST");
  assert.deepEqual(parseResearchReadbackBrowserProjectionV1(rejected.projection), rejected.projection);
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
  assert.equal(parseResearchReadbackBrowserProjectionV1({
    ...result.projection,
    technical: { ...result.projection.technical, semanticDigest: "sha256:not-a-digest" },
  }), null);
});
