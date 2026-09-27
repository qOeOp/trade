import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPLORATORY_REPLAY_RESULT_DIRECTORY_BOUND_V1,
  INVALID_EXPLORATORY_REPLAY_RESULT_DIRECTORY_SELECTOR,
  parseExploratoryReplayResultDirectoryV1,
  readExploratoryReplayResultDirectoryGatewayV1,
} from "../lib/exploratory-replay-result-directory-gateway.ts";

const requestIdentity = "replay request/α&#1";
const meaningDigest = `blake3:${"e".repeat(64)}`;
const selector = { requestIdentity, meaningDigest };
const environment = {
  RD_DASHBOARD_OWNER_READ_API_URL: "http://dashboard-read:8082/",
  RD_DASHBOARD_OWNER_READ_API_TOKEN: "secret",
};

function entry(result, attempt, at, terminal = "TERMINAL_RESULT") {
  return { attempt_identity: attempt, result_identity: result, terminal, committed_at_epoch_ms: at };
}

function owner(results) {
  return { schema_version: 1, request_identity: requestIdentity, meaning_digest: meaningDigest, results };
}

async function read(status, body, calls = []) {
  return readExploratoryReplayResultDirectoryGatewayV1({
    ...selector,
    environment,
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(body === undefined ? "" : JSON.stringify(body), { status });
    },
  });
}

test("the directory is one authenticated read of the Owner's list for exactly this request", async () => {
  const calls = [];
  const result = await read(200, owner([
    entry("result-a", "attempt-a", 1_000),
    entry("result-b", "attempt-b", 2_000, "RUN_REJECTED"),
  ]), calls);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    state: "available", requestIdentity, meaningDigest,
    results: [
      { attemptIdentity: "attempt-a", resultIdentity: "result-a", terminal: "TERMINAL_RESULT",
        committedAt: "1970-01-01T00:00:01.000Z" },
      { attemptIdentity: "attempt-b", resultIdentity: "result-b", terminal: "RUN_REJECTED",
        committedAt: "1970-01-01T00:00:02.000Z" },
    ],
  });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, "http://dashboard-read:8082/v2/exploratory-replay-results");
  assert.deepEqual([...url.searchParams], [["request_identity", requestIdentity], ["meaning_digest", meaningDigest]]);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.cache, "no-store");
  assert.deepEqual(calls[0].init.headers, { authorization: "Bearer secret" });
  assert.deepEqual(parseExploratoryReplayResultDirectoryV1(result.body, selector), result.body);
});

test("a request under which the Owner holds no Result lists none, which is an answer", async () => {
  const result = await read(200, owner([]));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { state: "available", requestIdentity, meaningDigest, results: [] });
});

test("an invalid selector reaches no Owner", async () => {
  for (const invalid of [
    { requestIdentity: " padded", meaningDigest },
    { requestIdentity, meaningDigest: "sha256:not-a-digest" },
  ]) {
    const calls = [];
    const result = await readExploratoryReplayResultDirectoryGatewayV1({
      ...invalid, environment, fetcher: async () => { calls.push(1); return new Response("{}"); },
    });
    assert.equal(result.status, 400);
    assert.equal(result.body.reason, INVALID_EXPLORATORY_REPLAY_RESULT_DIRECTORY_SELECTOR);
    assert.equal(calls.length, 0);
  }
});

// The page names why there is no list: the Owner's own reason, never one made up here.
test("a refusal is relayed under the Owner's reason and status", async () => {
  for (const [status, reason] of [
    [409, "EXPLORATORY_REQUEST_MEANING_MISMATCH"],
    [503, "EXPLORATORY_RECEIPT_ABSENT"],
    [503, "EXPLORATORY_REQUEST_RESULTS_EXCEED_BOUND"],
  ]) {
    const result = await read(status, { state: "UNAVAILABLE", reason });
    assert.equal(result.status, status, reason);
    assert.deepEqual(result.body, { state: "unavailable", requestIdentity, meaningDigest, reason });
  }
  assert.equal((await read(503, undefined)).body.reason, "OWNER_TRANSPORT_UNAVAILABLE");
  assert.equal((await read(403, { state: "UNAVAILABLE", reason: "X" })).body.reason, "OWNER_PERMISSION_DENIED");
  for (const [status, body] of [
    [404, { state: "UNAVAILABLE", reason: "X" }],
    [409, owner([])],
    [503, { state: "UNAVAILABLE", reason: "not a code" }],
  ]) {
    assert.equal((await read(status, body)).body.reason, "OWNER_RESPONSE_UNAVAILABLE", `${status}`);
  }
});

test("an Owner answer that is not exactly this request's directory is not shown", async () => {
  const tooMany = Array.from({ length: EXPLORATORY_REPLAY_RESULT_DIRECTORY_BOUND_V1 + 1 },
    (_, index) => entry(`result-${index}`, `attempt-${index}`, index));
  for (const [name, body] of [
    ["another request", { ...owner([]), request_identity: "another" }],
    ["another digest", { ...owner([]), meaning_digest: `blake3:${"f".repeat(64)}` }],
    ["an unknown top-level key", { ...owner([]), protected: true }],
    ["an unknown entry key", owner([{ ...entry("result-a", "attempt-a", 1), report: true }])],
    ["an attempt in progress", owner([entry("result-a", "attempt-a", 1, "IN_PROGRESS_OR_UNKNOWN")])],
    ["an unknown terminal", owner([entry("result-a", "attempt-a", 1, "FINISHED")])],
    ["one Result twice", owner([entry("result-a", "attempt-a", 1), entry("result-a", "attempt-b", 2)])],
    ["a negative time", owner([entry("result-a", "attempt-a", -1)])],
    ["a padded identity", owner([entry(" result-a", "attempt-a", 1)])],
    ["more than the bound", owner(tooMany)],
    ["a refusal envelope under 200", { state: "UNAVAILABLE", reason: "EXPLORATORY_RECEIPT_ABSENT" }],
  ]) {
    const result = await read(200, body);
    assert.equal(result.status, 502, name);
    assert.equal(result.body.reason, "OWNER_RESPONSE_UNAVAILABLE", name);
  }
});

test("the browser keeps only a directory for the selector it asked about", async () => {
  const listed = (await read(200, owner([entry("result-a", "attempt-a", 1_000)]))).body;
  assert.deepEqual(parseExploratoryReplayResultDirectoryV1(listed, selector), listed);
  assert.equal(parseExploratoryReplayResultDirectoryV1(listed, { ...selector, requestIdentity: "other" }), null);
  for (const value of [
    { ...listed, results: [{ ...listed.results[0], committedAt: "yesterday" }] },
    { ...listed, results: [{ ...listed.results[0], terminal: "IN_PROGRESS_OR_UNKNOWN" }] },
    { ...listed, extra: true },
    { state: "unavailable", requestIdentity, meaningDigest, reason: "lower case" },
  ]) {
    assert.equal(parseExploratoryReplayResultDirectoryV1(value, selector), null, JSON.stringify(value));
  }
});
