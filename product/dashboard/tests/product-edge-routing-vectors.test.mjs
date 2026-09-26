import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canonicalDigestV1,
  identityV1,
  resolveProductEdgeRoutingV1,
} from "../lib/product-edge-routing-client.ts";

// Product Edge seals these bindings and writes this file from its own encoding
// (crates/product_edge/src/operation_routing.rs). This side recomputes every digest and identity
// independently; the file both read is what makes a drift on either side fail where it is made.
const raw = await readFile(
  new URL("../../rd-owner-client/fixtures/operation_routing_binding_vectors_v1.json", import.meta.url),
  "utf8",
);
const vectors = JSON.parse(raw);
const environment = {
  PRODUCT_EDGE_ROUTING_READ_API_URL: "http://product-edge-routing.test/base",
  PRODUCT_EDGE_ROUTING_READ_API_TOKEN: "routing-vector-token",
  PRODUCT_EDGE_DEPLOYMENT_IDENTITY: vectors.deployment_identity,
};

function answering(status, body, requests) {
  return async (url, init) => {
    requests.push({ url: String(url), authorization: init.headers.authorization });
    return new Response(JSON.stringify(body), { status });
  };
}

test("the vector file is ASCII, named, and carries every answer the client distinguishes", () => {
  assert.match(raw, /^[\x00-\x7f]*$/u);
  const names = vectors.entries.map((entry) => entry.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(vectors.entries.length >= 4);
  const states = new Set(vectors.entries.map((entry) => entry.expected.state));
  assert.deepEqual([...states].sort(), ["ACTIVE", "UNAVAILABLE", "ZERO_ACTIVE"]);
  assert.ok(vectors.entries.some((entry) => entry.expected.dispatcher === "TRADE_DASHBOARD"));
});

for (const entry of vectors.entries) {
  test(`the client reads ${entry.name} as Product Edge sealed it`, async () => {
    const requests = [];
    const observation = await resolveProductEdgeRoutingV1(vectors.lookup, {
      environment,
      fetcher: answering(200, entry.response, requests),
    });
    assert.deepEqual(observation, entry.expected);
    assert.equal(requests.length, 1);
    const url = new URL(requests[0].url);
    assert.equal(url.pathname, "/base/v1/operation-routing");
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      operation: vectors.lookup.operation,
      version: String(vectors.lookup.version),
      channel: vectors.lookup.channel,
    });
    assert.equal(requests[0].authorization, `Bearer ${environment.PRODUCT_EDGE_ROUTING_READ_API_TOKEN}`);
  });
}

test("every sealed binding's digest and identity are what this side derives from its bytes", () => {
  const sealed = vectors.entries.filter((entry) => entry.canonical_bytes && entry.expected.state === "ACTIVE");
  assert.ok(sealed.length >= 2);
  for (const entry of sealed) {
    const content = JSON.parse(entry.canonical_bytes);
    assert.equal(JSON.stringify(content), entry.canonical_bytes, entry.name);
    const digest = canonicalDigestV1(vectors.digest_domain, content);
    assert.equal(digest, entry.expected.binding_digest, entry.name);
    assert.equal(identityV1(vectors.identity_domain, [digest]), entry.expected.binding_identity, entry.name);
  }
});

// A vector that only maps content to a digest proves the mapping exists; it says nothing about
// the field order, and the order is what both sides must agree on.
test("transposing two keys keeps the data and changes the digest", () => {
  const [genesis] = vectors.entries;
  const transposed = JSON.parse(vectors.order_sensitivity.canonical_bytes);
  assert.deepEqual(transposed, JSON.parse(genesis.canonical_bytes));
  assert.notEqual(vectors.order_sensitivity.canonical_bytes, genesis.canonical_bytes);
  assert.equal(canonicalDigestV1(vectors.digest_domain, transposed), vectors.order_sensitivity.binding_digest);
  assert.notEqual(vectors.order_sensitivity.binding_digest, genesis.expected.binding_digest);
});

test("a named refusal from the read port is UNAVAILABLE, never a route", async () => {
  for (const [status, refusal] of [
    [404, "OPERATION_ROUTING_ABSENT"],
    [409, "OPERATION_ROUTING_STALE"],
    [401, "OPERATION_ROUTING_UNAUTHORIZED"],
    [503, "OPERATION_ROUTING_UNAVAILABLE"],
  ]) {
    const observation = await resolveProductEdgeRoutingV1(vectors.lookup, {
      environment,
      fetcher: answering(status, { schema_version: 1, refusal }, []),
    });
    assert.equal(observation.state, "UNAVAILABLE", refusal);
  }
});

test("an answer for another deployment is refused", async () => {
  const observation = await resolveProductEdgeRoutingV1(vectors.lookup, {
    environment: { ...environment, PRODUCT_EDGE_DEPLOYMENT_IDENTITY: "another-deployment" },
    fetcher: answering(200, vectors.entries[0].response, []),
  });
  assert.equal(observation.state, "UNAVAILABLE");
});
