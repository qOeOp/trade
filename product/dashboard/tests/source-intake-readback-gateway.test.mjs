import assert from "node:assert/strict";
import test from "node:test";

import {
  parseSourceIntakeBrowserProjectionV1,
  readSourceIntakeReadbackGatewayV1,
} from "../lib/source-intake-readback-gateway.ts";

const digest = (character) => `sha256:${character.repeat(64)}`;

function sharedTime({ sequence, head, decisionCut }) {
  return {
    clock_epoch: "clock-epoch-1",
    clock_identity: "clock-1",
    comparison_rule: "EXCLUSIVE_VALID_THROUGH",
    decision_cut_epoch_ms: decisionCut,
    epoch_successor_proof_identity: null,
    head_digest: digest(head),
    head_identity: digest(head),
    monotonic_sequence: sequence,
    predecessor_head_digest: null,
    restart_continuity_digest: digest("9"),
    skew_bound_ms: 10,
    successor_proof_commit_cut_epoch_ms: null,
    uncertainty_bound_ms: 10,
    valid_through_epoch_ms: decisionCut + 60_000,
    wall_observed_epoch_ms: decisionCut,
  };
}

function notFoundOwnerReadback(requestIdentity = "source-request-1") {
  const bindingIdentity = "source-binding-1";
  const committedAt = Date.now() - 20_000;
  return {
    authority_class: "LIVE_EXTERNAL",
    binding_identity: bindingIdentity,
    content_digest: null,
    content_locator: null,
    environment_identity: "PRODUCTION_LIVE_EXTERNAL",
    fixture_corpus_digest: null,
    outbox_event_identity: "source-outbox-1",
    provenance_identity: null,
    provider_profile_digest: "sha256:18e4411c991be0a92514bc8ff238ef0429f379d7aa0fd17c1169c7a4c0f45c6b",
    receipt: {
      attempt_identity: bindingIdentity,
      binding_identity: bindingIdentity,
      committed_at_epoch_ms: committedAt,
      connected_address: null,
      content_digest: null,
      invocation_identity: "source-invocation-1",
      policy_decision_digest: digest("1"),
      policy_decision_identity: "source-policy-decision-1",
      policy_decision_time: sharedTime({ sequence: 1, head: "2", decisionCut: committedAt - 2_000 }),
      receipt_identity: "source-receipt-1",
      request_identity: requestIdentity,
      response_header_digest: digest("3"),
      response_media_type: null,
      response_size_bytes: null,
      response_status: 404,
      retrieval_time: sharedTime({ sequence: 2, head: "4", decisionCut: committedAt - 1_000 }),
      retrieval_time_evidence_digest: digest("5"),
      retrieval_time_evidence_identity: "source-retrieval-time-evidence-1",
      schema_version: 1,
      terminal: "NOT_FOUND",
      terminal_evidence_digest: digest("6"),
      terminal_evidence_identity: digest("7"),
    },
    request_identity: requestIdentity,
    source_candidate_identity: null,
    state: "TERMINAL",
    terminal: "NOT_FOUND",
  };
}

test("gateway performs one authenticated point read and filters Owner custody", async () => {
  const calls = [];
  const owner = notFoundOwnerReadback();
  const result = await readSourceIntakeReadbackGatewayV1({
    requestIdentity: "source-request-1",
    environment: {
      RD_OWNER_API_URL: "http://rd-owner-api:8080/",
      RD_OWNER_API_TOKEN: "secret",
    },
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(owner), { status: 200 });
    },
  });

  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://rd-owner-api:8080/v1/source-intakes/source-request-1/readback");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.cache, "no-store");
  assert.deepEqual(calls[0].init.headers, { authorization: "Bearer secret" });
  assert.equal(calls[0].init.body, undefined);
  assert.equal(result.projection.state, "terminal");
  assert.deepEqual(result.projection.terminal, {
    requestIdentity: "source-request-1",
    resolution: "NOT_FOUND",
    bindingIdentity: "source-binding-1",
    receiptIdentity: "source-receipt-1",
    committedAt: new Date(owner.receipt.committed_at_epoch_ms).toISOString(),
    authorityClass: "LIVE_EXTERNAL",
    content: null,
  });
  assert.deepEqual(parseSourceIntakeBrowserProjectionV1(result.projection), result.projection);
  const browserBytes = JSON.stringify(result.projection);
  for (const withheld of [
    "receipt_identity", "policy_decision", "provider_profile", "response_header", "connected_address",
    "invocation_identity", "outbox_event_identity", "source_candidate_identity", "provenance_identity",
  ]) assert.doesNotMatch(browserBytes, new RegExp(withheld, "u"));
});

test("exact Owner unknown becomes a neutral no-terminal projection", async () => {
  const result = await readSourceIntakeReadbackGatewayV1({
    requestIdentity: "source-request-unknown",
    environment: { RD_OWNER_API_URL: "http://rd-owner-api:8080", RD_OWNER_API_TOKEN: "secret" },
    fetcher: async () => new Response(JSON.stringify({
      request_identity: "source-request-unknown",
      resolution: "SUBMITTED_OR_UNKNOWN",
      next_legal_action: "RESOLVE_SAME_REQUEST",
    }), { status: 202 }),
  });
  assert.equal(result.status, 200);
  assert.equal(result.projection.availability, "available");
  assert.equal(result.projection.state, "no_verified_terminal");
  assert.equal(result.projection.terminal, null);
  assert.equal(JSON.stringify(result.projection).includes("RESOLVE_SAME_REQUEST"), false);
});

test("invalid identity and missing configuration make zero Owner calls", async () => {
  let calls = 0;
  const fetcher = async () => { calls += 1; throw new Error("must not fetch"); };
  const invalid = await readSourceIntakeReadbackGatewayV1({
    requestIdentity: "bad identity",
    environment: { RD_OWNER_API_URL: "http://rd-owner-api:8080", RD_OWNER_API_TOKEN: "secret" },
    fetcher,
  });
  const missing = await readSourceIntakeReadbackGatewayV1({
    requestIdentity: "source-request-1",
    environment: {},
    fetcher,
  });
  assert.equal(calls, 0);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.projection.reason, "INVALID_REQUEST_IDENTITY");
  assert.equal(missing.status, 503);
  assert.equal(missing.projection.reason, "OWNER_CONFIGURATION_UNAVAILABLE");
});

test("malformed, oversized and identity-drifted responses fail closed", async () => {
  const drifted = notFoundOwnerReadback("another-request");
  for (const response of [
    new Response("not json", { status: 200 }),
    new Response("x".repeat(1_048_577), { status: 200 }),
    new Response(JSON.stringify(drifted), { status: 200 }),
  ]) {
    const result = await readSourceIntakeReadbackGatewayV1({
      requestIdentity: "source-request-1",
      environment: { RD_OWNER_API_URL: "http://rd-owner-api:8080", RD_OWNER_API_TOKEN: "secret" },
      fetcher: async () => response,
    });
    assert.equal(result.status, 502);
    assert.equal(result.projection.availability, "unavailable");
    assert.equal(result.projection.terminal, null);
  }
});

test("browser parser rejects raw additions and contradictory terminal content", async () => {
  const result = await readSourceIntakeReadbackGatewayV1({
    requestIdentity: "source-request-1",
    environment: { RD_OWNER_API_URL: "http://rd-owner-api:8080", RD_OWNER_API_TOKEN: "secret" },
    fetcher: async () => new Response(JSON.stringify(notFoundOwnerReadback()), { status: 200 }),
  });
  assert.equal(parseSourceIntakeBrowserProjectionV1({ ...result.projection, receipt: {} }), null);
  assert.equal(parseSourceIntakeBrowserProjectionV1({
    ...result.projection,
    terminal: { ...result.projection.terminal, content: { state: "retained", digest: digest("7") } },
  }), null);
});
